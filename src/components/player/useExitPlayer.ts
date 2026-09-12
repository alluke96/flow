import { useCallback, useRef, type RefObject } from "react";

/**
 * Sair do player. O ponto aqui é a navegação acontecer NA HORA, e tudo mais
 * ficar pra depois.
 *
 * A ORDEM aqui é o ponto todo, e já erramos ela: soltar a mídia antes de
 * navegar faz o vídeo pausar e ficar preto na hora, mas `pause()` dispara
 * "pause", que mexe no contexto de perfis — exatamente o tipo de escrita
 * que faz o React/Next abandonar uma navegação em andamento. Resultado:
 * pausava, escurecia e NÃO voltava. Agora navega PRIMEIRO e só depois (no
 * próximo tick, já fora do caminho da transição) solta a mídia e salva o
 * progresso. Enquanto sai, os handlers do <video> ficam mudos (exitingRef)
 * pra nenhum evento de desmontagem mexer em estado.
 */
export function useExitPlayer({
  videoRef,
  doSaveProgress,
  onExit,
  syncProfiles,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  doSaveProgress: () => void;
  onExit: () => void;
  syncProfiles: () => void;
}) {
  const exitingRef = useRef(false);

  const handleExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;

    // Lê o progresso agora (síncrono, elemento ainda válido). O envio em si
    // já é adiado por dentro de doSaveProgress.
    doSaveProgress();

    // Navega imediatamente — nada pode vir antes disto.
    onExit();

    // Só então solta a mídia: aborta o download em andamento e libera as
    // conexões que o streaming segurava. Fica pro próximo tick pra não
    // atravessar o commit da navegação.
    setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        // se o navegador reclamar, tudo bem: já saímos, que é o que importa
      }

      // Agora sim, com a navegação já feita e a mídia solta, o progresso
      // que acabou de ser salvo localmente pode ir pro servidor (pros
      // outros aparelhos enxergarem). É manda-e-esquece via sendBeacon: não
      // segura conexão nem volta pra mexer em estado. Este timeout roda
      // depois do agendado por doSaveProgress, então o que sai daqui já
      // inclui o momento em que o vídeo parou.
      syncProfiles();
    }, 0);
  }, [videoRef, doSaveProgress, onExit, syncProfiles]);

  return { exitingRef, handleExit };
}
