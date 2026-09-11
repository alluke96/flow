"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type TouchEvent } from "react";
import { useProfiles } from "@/context/profile-context";
import { streamUrl } from "@/lib/api-client";
import { fmtTime } from "@/lib/format";

interface VideoPlayerProps {
  titleId: string;
  episodeId: string | null;
  displayTitle: string;
  initialTime: number;
  onExit: () => void;
  onNextEpisode?: () => void;
}

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];
const OVERLAY_HIDE_MS = 3200;
const DOUBLE_TAP_MS = 320;

/**
 * Player customizado: controles próprios, gestos de toque (tap = play/pause,
 * duplo tap nas metades esquerda/direita = -10s/+10s), teclado (espaço,
 * setas, Esc) e navegação por foco grande o bastante pro "10-foot UI" de
 * Smart TV (ver globals.css). O <video> aponta pra /api/stream/:id, que
 * suporta Range Requests de verdade — o próprio elemento cuida do seek.
 */
export function VideoPlayer({
  titleId,
  episodeId,
  displayTitle,
  initialTime,
  onExit,
  onNextEpisode,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ t: number } | null>(null);
  const draggingRef = useRef(false);

  const { saveProgress } = useProfiles();

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);

  const src = streamUrl(titleId, episodeId);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setOverlayHidden(true);
    }, OVERLAY_HIDE_MS);
  }, []);

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
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, [showOverlay]);

  const doSaveProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    saveProgress(titleId, episodeId, v.currentTime, v.duration);
  }, [saveProgress, titleId, episodeId]);

  // retoma de onde parou (progresso salvo do perfil) assim que os metadados carregam
  function handleLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    if (initialTime > 1 && initialTime < (v.duration || Infinity) - 2) {
      v.currentTime = initialTime;
    }
    v.play().catch(() => {
      // autoplay bloqueado (política do navegador) — usuário pode dar play manualmente
    });
  }

  // salva progresso periodicamente enquanto toca, e ao sair/trocar de título
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) doSaveProgress();
    }, 5000);
    return () => clearInterval(interval);
  }, [doSaveProgress]);

  useEffect(() => {
    return () => doSaveProgress();
  }, [doSaveProgress]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seekBy(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    const max = v.duration || Infinity;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), max);
    showOverlay();
  }

  function seekToPct(pct: number) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.min(Math.max(0, pct), 1) * v.duration;
  }

  function pctFromClientX(clientX: number): number {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  function handleProgressPointerDown(e: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToPct(pctFromClientX(e.clientX));
    showOverlay();
  }
  function handleProgressPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    seekToPct(pctFromClientX(e.clientX));
  }
  function handleProgressPointerUp() {
    draggingRef.current = false;
  }
  function handleProgressKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") seekBy(5);
    else if (e.key === "ArrowLeft") seekBy(-5);
  }

  function isControlTarget(el: EventTarget | null): boolean {
    return el instanceof HTMLElement ? Boolean(el.closest("button, .progress-bar")) : false;
  }

  function handleVideoAreaClick(e: React.MouseEvent) {
    if (isControlTarget(e.target)) return;
    togglePlay();
    showOverlay();
  }

  function handleTouchEnd(e: TouchEvent<HTMLVideoElement>) {
    if (isControlTarget(e.target)) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    e.preventDefault();

    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.t < DOUBLE_TAP_MS) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;
      const half = window.innerWidth / 2;
      seekBy(touch.clientX < half ? -10 : 10);
    } else {
      lastTapRef.current = { t: now };
      singleTapTimerRef.current = setTimeout(() => {
        togglePlay();
        showOverlay();
        lastTapRef.current = null;
      }, DOUBLE_TAP_MS);
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function cycleRate() {
    const v = videoRef.current;
    if (!v) return;
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    v.playbackRate = next;
    setRate(next);
  }

  function toggleFullscreen() {
    const container = videoRef.current?.closest(".player-shell");
    if (!(container instanceof HTMLElement)) return;
    if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isButton = target?.tagName === "BUTTON";
      if ((e.key === " " || e.code === "Space") && !isButton) {
        e.preventDefault();
        togglePlay();
        showOverlay();
      } else if (e.key === "ArrowRight") {
        seekBy(10);
      } else if (e.key === "ArrowLeft") {
        seekBy(-10);
      } else if (e.key === "Escape") {
        onExit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit]);

  function handleEnded() {
    setEnded(true);
    doSaveProgress();
    if (onNextEpisode) {
      setTimeout(() => onNextEpisode(), 1800);
    }
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-shell" onMouseMove={showOverlay}>
      <video
        ref={videoRef}
        className="player-video"
        src={src}
        playsInline
        autoPlay
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          showOverlay();
        }}
        onPause={() => {
          setPlaying(false);
          doSaveProgress();
        }}
        onEnded={handleEnded}
        onClick={handleVideoAreaClick}
        onTouchEnd={handleTouchEnd}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => setLoading(false)}
      />

      {loading && (
        <div className="center-loader">
          <div className="spinner" />
        </div>
      )}

      <div className={`player-overlay${overlayHidden ? " hidden" : ""}`}>
        <div className="player-top">
          <button onClick={onExit} aria-label="Voltar" style={{ fontSize: 24 }}>
            ←
          </button>
          <div className="player-title">{displayTitle}</div>
        </div>

        <div className="player-center">
          <button onClick={() => seekBy(-10)} aria-label="Voltar 10 segundos">
            ⏪
          </button>
          <button
            className="player-playpause"
            onClick={togglePlay}
            aria-label={playing ? "Pausar" : "Reproduzir"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button onClick={() => seekBy(10)} aria-label="Avançar 10 segundos">
            ⏩
          </button>
        </div>

        <div className="player-bottom">
          <div className="progress-row">
            <span className="time">{fmtTime(currentTime)}</span>
            <div
              className="progress-bar"
              ref={progressRef}
              onPointerDown={handleProgressPointerDown}
              onPointerMove={handleProgressPointerMove}
              onPointerUp={handleProgressPointerUp}
              onKeyDown={handleProgressKeyDown}
              role="slider"
              aria-label="Progresso do vídeo"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              tabIndex={0}
            >
              <div className="progress-track" />
              <div className="progress-fill" style={{ width: `${pct}%` }} />
              <div className="progress-handle" style={{ left: `${pct}%` }} />
            </div>
            <span className="time">{fmtTime(duration)}</span>
          </div>
          <div className="player-controls-row">
            <button onClick={toggleMute} aria-label={muted ? "Ativar som" : "Silenciar"}>
              {muted ? "🔇" : "🔊"}
            </button>
            <button className="rate-btn" onClick={cycleRate} aria-label="Velocidade de reprodução">
              {rate}x
            </button>
            {onNextEpisode && (
              <button onClick={onNextEpisode} aria-label="Próximo episódio">
                Próximo ⏭
              </button>
            )}
            <div className="spacer" />
            <button onClick={toggleFullscreen} aria-label="Tela cheia">
              ⛶
            </button>
          </div>
        </div>
      </div>

      {ended && !onNextEpisode && (
        <div className="modal-backdrop" style={{ position: "absolute" }}>
          <div className="modal" style={{ textAlign: "center" }}>
            <h2>Fim do vídeo</h2>
            <div className="modal-actions" style={{ justifyContent: "center" }}>
              <button className="btn btn-ghost" onClick={onExit}>
                Voltar aos detalhes
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) {
                    v.currentTime = 0;
                    v.play().catch(() => {});
                  }
                  setEnded(false);
                }}
              >
                Assistir de novo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
