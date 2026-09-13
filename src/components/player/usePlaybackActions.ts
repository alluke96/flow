import { useCallback, useState, type ChangeEvent, type RefObject } from "react";

/** Play/pause, mudo, volume e velocidade — as ações que mexem direto no <video>. */
export function usePlaybackActions(videoRef: RefObject<HTMLVideoElement | null>) {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [videoRef]);

  const handleVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const value = parseFloat(e.target.value);
      // iOS Safari ignora volume via JS (só o usuário controla pelos botões
      // físicos) — o slider fica visível mas sem efeito lá, é limitação da
      // plataforma, não bug nosso.
      v.volume = value;
      setVolume(value);
      const shouldMute = value === 0;
      v.muted = shouldMute;
      setMuted(shouldMute);
    },
    [videoRef]
  );

  const handleRateChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const next = parseFloat(e.target.value);
      v.playbackRate = next;
      setRate(next);
    },
    [videoRef]
  );

  return {
    muted,
    setMuted,
    volume,
    // setVolume/setRate expostos (além dos já usados handleVolumeChange/
    // handleRateChange) pro modo player nativo AVPlay (ver VideoPlayer.tsx)
    // atualizar esse estado sem passar por um <video> que não existe nesse
    // modo.
    setVolume,
    rate,
    setRate,
    togglePlay,
    toggleMute,
    handleVolumeChange,
    handleRateChange,
  };
}
