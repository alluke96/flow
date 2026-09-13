import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { OVERLAY_HIDE_MS } from "./constants";

/**
 * Mostra/esconde os controles por inatividade. Qualquer atividade (mouse,
 * toque, tecla) chama `showOverlay`, que reaparece na hora e reagenda o
 * timer de auto-esconder — mas só esconde de fato se o vídeo ainda estiver
 * tocando (pausado, os controles ficam sempre visíveis).
 */
export function useOverlayVisibility(
  videoRef: RefObject<HTMLVideoElement | null>,
  // Modo player nativo (AVPlay): não existe <video> nenhum pra perguntar se
  // está tocando — quem sabe é o estado que vem da TV. Sem isto os
  // controles NUNCA sumiam na TV (videoRef.current é sempre null lá), o que
  // além de tapar o vídeo confundia a navegação por controle remoto, que
  // muda de comportamento conforme os controles estão à vista ou não (ver
  // tv-nav.ts).
  nativeRef?: RefObject<{ paused: boolean }>
) {
  const [overlayHidden, setOverlayHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    function agendar() {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        const v = videoRef.current;
        const tocando = nativeRef ? !nativeRef.current.paused : Boolean(v && !v.paused);
        if (tocando) {
          setOverlayHidden(true);
          return;
        }
        // Ainda não começou: tenta de novo em vez de desistir. Desistir
        // deixava os controles na tela pra SEMPRE quando o vídeo demorava
        // mais que este intervalo pra começar — que é justo o caso de quem
        // retoma de onde parou na TV, onde o trecho é preparado na hora.
        agendar();
      }, OVERLAY_HIDE_MS);
    }
    agendar();
  }, [videoRef, nativeRef]);

  const showOverlay = useCallback(() => {
    setOverlayHidden(false);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    // dispara o timer de auto-hide assim que o player monta
    // eslint-disable-next-line react-hooks/set-state-in-effect
    showOverlay();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showOverlay]);

  return { overlayHidden, showOverlay };
}
