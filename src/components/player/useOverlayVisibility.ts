import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { OVERLAY_HIDE_MS } from "./constants";

/**
 * Mostra/esconde os controles por inatividade. Qualquer atividade (mouse,
 * toque, tecla) chama `showOverlay`, que reaparece na hora e reagenda o
 * timer de auto-esconder — mas só esconde de fato se o vídeo ainda estiver
 * tocando (pausado, os controles ficam sempre visíveis).
 */
export function useOverlayVisibility(videoRef: RefObject<HTMLVideoElement | null>) {
  const [overlayHidden, setOverlayHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setOverlayHidden(true);
    }, OVERLAY_HIDE_MS);
  }, [videoRef]);

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
