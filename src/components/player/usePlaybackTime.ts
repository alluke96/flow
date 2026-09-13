import { useCallback, useState, type RefObject } from "react";

/**
 * Tempo/duração/buffer do vídeo, e as funções de busca (seek) que mexem
 * neles. `seekBy` é o motor por trás dos botões ±10s (e do duplo-toque, ver
 * useDoubleTapSeek) e das setas do teclado; `seekToPct` é usado pela barra
 * de progresso (clique/arrasto, ver useProgressBarDrag).
 *
 * Ambas atualizam `currentTime` NA HORA, sem esperar o próximo `timeupdate`
 * do navegador — que pode demorar a disparar depois de um seek — pra dar
 * feedback visual imediato na barra/tempo.
 */
export function usePlaybackTime(videoRef: RefObject<HTMLVideoElement | null>, showOverlay: () => void) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);

  const onProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime) end = v.buffered.end(i);
    }
    setBufferedEnd(end);
  }, [videoRef]);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const max = v.duration || Infinity;
      const next = Math.min(Math.max(0, v.currentTime + delta), max);
      v.currentTime = next;
      setCurrentTime(next);
      showOverlay();
    },
    [videoRef, showOverlay]
  );

  const seekToPct = useCallback(
    (pct: number) => {
      const v = videoRef.current;
      if (!v || !v.duration) return;
      const next = Math.min(Math.max(0, pct), 1) * v.duration;
      v.currentTime = next;
      setCurrentTime(next);
    },
    [videoRef]
  );

  return {
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    bufferedEnd,
    // Exposto (além do já usado onProgress) pro modo player nativo AVPlay
    // (ver VideoPlayer.tsx) espelhar o buffer que chega por postMessage —
    // não passa pelo <video>, então onProgress nunca dispara nesse modo.
    setBufferedEnd,
    onProgress,
    seekBy,
    seekToPct,
  };
}
