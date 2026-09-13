import { useCallback, useEffect, useRef, type RefObject } from "react";
import { logarServidor } from "@/lib/tizen-player-bridge";

type SaveProgress = (
  tituloId: string,
  episodioId: string | null,
  progressoSegundos: number,
  duracaoSegundos: number
) => void;

/**
 * Salva progresso periodicamente enquanto toca (5 em 5s), e captura o
 * instante final no desmonte do componente (troca de episódio/título, saída
 * do player). Quem dispara o salvamento na SAÍDA de propósito (navegação
 * primeiro, mídia depois) é useExitPlayer — este hook cobre o "enquanto
 * assiste" e o "desmontou sem passar pelo botão de voltar" (ex: trocou de
 * episódio direto).
 */
/** Só os campos que este hook precisa do estado do player nativo AVPlay. */
interface NativeSnapshot {
  currentTime: number;
  duration: number;
  seeking: boolean;
  paused: boolean;
}

/**
 * Quanto tempo uma busca pode ficar "em andamento" antes de a gente parar
 * de esperar por ela.
 *
 * Existe porque nesta TV a busca pode nunca terminar: no <video> o
 * `seeking` fica true pra sempre (é o bug do aparelho que trouxe o AVPlay
 * pra cá), e no AVPlay o callback de conclusão pode não vir. Como o
 * salvamento se recusa a rodar durante uma busca — a amostra seria de um
 * ponto que não vale mais —, uma busca que não acaba significava NENHUM
 * progresso salvo na sessão inteira depois do primeiro ±10s. Passado este
 * tempo, a amostra atual é melhor que amostra nenhuma: o vídeo segue
 * tocando e o tempo dele continua andando, buscando ou não.
 */
const BUSCA_TRAVADA_MS = 4000;

export function useProgressPersistence({
  videoRef,
  // Opcional: quando dado (modo player nativo AVPlay, ver VideoPlayer.tsx),
  // prevalece sobre videoRef — não existe <video> nenhum nesse modo pra ler
  // currentTime/duration/seeking dele. `duration` em 0 (estado inicial,
  // antes do primeiro "state" chegar por postMessage) já faz o mesmo papel
  // de "vídeo ainda não carregado" que `!v.duration` faz no <video>.
  nativeRef,
  titleId,
  episodeId,
  saveProgress,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  nativeRef?: RefObject<NativeSnapshot | null>;
  titleId: string;
  episodeId: string | null;
  saveProgress: SaveProgress;
}) {
  // Desde quando a busca atual está em andamento (null = não está).
  const buscandoDesdeRef = useRef<number | null>(null);

  /** true = dá pra salvar; false = tem busca em andamento, ainda dentro do prazo. */
  const buscaAssentou = useCallback((buscando: boolean) => {
    if (!buscando) {
      buscandoDesdeRef.current = null;
      return true;
    }
    if (buscandoDesdeRef.current === null) buscandoDesdeRef.current = Date.now();
    return Date.now() - buscandoDesdeRef.current >= BUSCA_TRAVADA_MS;
  }, []);

  const doSaveProgress = useCallback(() => {
    const nativo = nativeRef?.current;
    if (nativo) {
      // Mesmo cuidado do ramo <video> abaixo: `seeking` true = busca em
      // andamento, currentTime ainda não reflete o destino.
      if (!nativo.duration) {
        logarServidor(`nao salvou: duracao=0 (t=${nativo.currentTime.toFixed(1)})`);
        return;
      }
      if (!buscaAssentou(nativo.seeking)) return;
      const snapshot = { t: nativo.currentTime, d: nativo.duration };
      logarServidor(`salvando progresso t=${snapshot.t.toFixed(1)}/${snapshot.d.toFixed(1)}`);
      setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
      return;
    }
    const v = videoRef.current;
    if (!v || !v.duration) return;
    // v.seeking true = uma busca ainda em andamento (ex: o seek de
    // retomada, logo ao entrar — ver useResumePlayback). currentTime pode
    // não refletir o destino ainda nesse meio-tempo, especialmente numa
    // rede mais lenta (uma TV na Wi-Fi contra o self-host, por exemplo):
    // salvar essa amostra podia registrar um valor perto de 0 mesmo tendo
    // acabado de retomar de bem mais adiante. Pra uma série, isso é
    // destrutivo — perto de 0 faz saveProgress DESCARTAR a entrada de
    // "continuar assistindo" (ver quaseNoInicio em profile-context.tsx), e
    // o próximo episódio a resolver, sem progresso nenhum pra achar, viraria
    // o primeiro da série. Esperar a busca assentar evita salvar essa
    // amostra ruim; o intervalo de 5s abaixo tenta de novo em seguida.
    if (!buscaAssentou(v.seeking)) return;
    const snapshot = { t: v.currentTime, d: v.duration };
    setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
  }, [videoRef, nativeRef, saveProgress, titleId, episodeId, buscaAssentou]);

  useEffect(() => {
    const interval = setInterval(() => {
      const nativo = nativeRef?.current;
      if (nativo) {
        if (!nativo.paused) doSaveProgress();
        return;
      }
      if (videoRef.current && !videoRef.current.paused) doSaveProgress();
    }, 5000);
    return () => clearInterval(interval);
  }, [videoRef, nativeRef, doSaveProgress]);

  useEffect(() => {
    // Captura o nó agora (continua válido até o desmonte de verdade) pra
    // não ler videoRef.current dentro do cleanup, que já pode ter mudado.
    const videoNode = videoRef.current;
    return () => {
      // Ao contrário do videoNode (capturado ANTES pra continuar válido no
      // cleanup), nativeRef.current é lido AGORA, na hora do desmonte, DE
      // PROPÓSITO — é uma ref comum (não aponta pra um nó do DOM que possa
      // já ter sido desmontado), que continua espelhando o postMessage mais
      // recente até este exato instante.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const nativo = nativeRef?.current;
      if (nativo) {
        if (!nativo.duration) return;
        const snapshot = { t: nativo.currentTime, d: nativo.duration };
        setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
        return;
      }
      // Os valores (currentTime/duration) são lidos AGORA, no desmonte, com
      // o elemento ainda válido — mas a chamada que atualiza estado
      // (saveProgress) é adiada pra depois do commit atual. Esse desmonte
      // quase sempre acontece junto de uma troca de rota (usuário saindo
      // do player) — chamar setState de um contexto ancestral de forma
      // síncrona bem no meio dessa transição pode fazer o React/Next.js
      // abandonar a navegação em andamento silenciosamente.
      if (!videoNode || !videoNode.duration) return;
      const snapshot = { t: videoNode.currentTime, d: videoNode.duration };
      setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
    };
  }, [videoRef, nativeRef, saveProgress, titleId, episodeId]);

  return doSaveProgress;
}
