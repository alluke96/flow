import { useCallback, useEffect, type RefObject } from "react";

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
export function useProgressPersistence({
  videoRef,
  titleId,
  episodeId,
  saveProgress,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  titleId: string;
  episodeId: string | null;
  saveProgress: SaveProgress;
}) {
  const doSaveProgress = useCallback(() => {
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
    if (v.seeking) return;
    const snapshot = { t: v.currentTime, d: v.duration };
    setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
  }, [videoRef, saveProgress, titleId, episodeId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) doSaveProgress();
    }, 5000);
    return () => clearInterval(interval);
  }, [videoRef, doSaveProgress]);

  useEffect(() => {
    // Captura o nó agora (continua válido até o desmonte de verdade) pra
    // não ler videoRef.current dentro do cleanup, que já pode ter mudado.
    const videoNode = videoRef.current;
    return () => {
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
  }, [videoRef, saveProgress, titleId, episodeId]);

  return doSaveProgress;
}
