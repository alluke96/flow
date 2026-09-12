import { useCallback, type RefObject } from "react";
import { RESUME_SEEK_TIMEOUT_MS } from "./constants";

/**
 * Retoma de onde parou (progresso salvo do perfil) assim que os metadados
 * do vídeo carregam, e então dá play — tentando COM som primeiro (como
 * YouTube/Netflix), só caindo pra mudo se o navegador rejeitar autoplay
 * com som.
 */
export function useResumePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  initialTime: number,
  setMuted: (muted: boolean) => void
) {
  return useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    function startPlayback() {
      if (!v) return;
      v.muted = false;
      v.play()
        .then(() => setMuted(false))
        .catch(() => {
          v.muted = true;
          setMuted(true);
          v.play().catch(() => {
            // nem mudo tocou sozinho — fica pausado, usuário dá play manualmente
          });
        });
    }

    if (initialTime > 1 && initialTime < (v.duration || Infinity) - 2) {
      // Buscar um ponto que ainda não foi baixado é assíncrono de verdade
      // aqui — o vídeo é servido via Range Requests (ver /api/stream), então
      // pular pra 1:32 exige um NOVO request ao servidor por aqueles bytes
      // específicos antes do navegador ter algo pra tocar dali. Chamar
      // play() imediatamente, sem esperar isso terminar, deixaria o
      // navegador tocar o que já tinha bufferizado perto do início enquanto
      // o relógio na tela ficava travado no valor pedido (timeupdate não
      // dispara com uma seek pendente) — áudio e vídeo ficariam fora de
      // sincronia até outra seek (ex: ±10s) forçar tudo a se resolver de
      // vez, mas ainda mostrando o tempo errado. Esperar o evento "seeked"
      // (o navegador confirmando que já buscou e posicionou tudo ali) antes
      // de dar play evita a corrida inteira.
      //
      // MAS nunca dependendo SÓ disso: se "seeked" não vier (seek recusado,
      // buffer negado, arquivo problemático...), esperar por ele pra sempre
      // deixaria o vídeo parado eternamente — e aí NADA funciona: os
      // controles não somem (só somem com o vídeo tocando, ver
      // useOverlayVisibility), o relógio fica congelado no destino, e a
      // tela fica preta. Um fallback curto garante que a reprodução comece
      // de um jeito ou de outro.
      let started = false;
      let tentouDeNovo = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
      function startOnce() {
        if (started) return;

        // "seeked" disparar não é garantia de que a busca pousou onde
        // pedimos. Os logs de streaming (ver stream-utils.ts) mostraram
        // buscas grandes voltando pra perto de onde já estavam MESMO
        // disparando "seeked" normalmente — provavelmente o request pelo
        // trecho novo não completou a tempo e o navegador desistiu
        // sozinho. Sem checar isso aqui, "continuar assistindo" às vezes
        // recomeçava do zero sem avisar nada. Tenta a busca de novo, uma
        // vez só, antes de aceitar onde caiu — nunca mais que isso, pra não
        // arriscar travar esperando pra sempre se a rede estiver mesmo
        // ruim.
        const atual = videoRef.current;
        const pousouLonge = atual && Math.abs(atual.currentTime - initialTime) > 5;
        if (pousouLonge && !tentouDeNovo) {
          tentouDeNovo = true;
          atual.currentTime = initialTime;
          return;
        }

        started = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        videoRef.current?.removeEventListener("seeked", startOnce);
        startPlayback();
      }
      // Mais folga que um fallback de 1500ms daria: uma tentativa extra de
      // busca precisa de espaço pra um SEGUNDO round-trip de rede, não só
      // um.
      fallbackTimer = setTimeout(startOnce, RESUME_SEEK_TIMEOUT_MS);
      v.addEventListener("seeked", startOnce);
      v.currentTime = initialTime;
    } else {
      startPlayback();
    }
  }, [videoRef, initialTime, setMuted]);
}
