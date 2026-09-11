"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";
import { useProfiles } from "@/context/profile-context";
import { streamUrl } from "@/lib/api-client";
import { fmtTime } from "@/lib/format";
import {
  Back10Icon,
  BackArrowIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  Forward10Icon,
  NextEpisodeIcon,
  PauseIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from "./player-icons";

interface VideoPlayerProps {
  titleId: string;
  episodeId: string | null;
  displayTitle: string;
  initialTime: number;
  onExit: () => void;
  onNextEpisode?: () => void;
}

/** APIs não-padrão do WebKit/iOS Safari pra fullscreen do <video>. */
interface WebkitVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
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
  const dragPctRef = useRef<number | null>(null);

  const { saveProgress } = useProfiles();

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  // Tenta iniciar com som (ver handleLoadedMetadata) — só cai pra mudo se
  // o navegador bloquear autoplay com som, daí sim precisa começar mudo pra
  // garantir que ao menos toque sozinho.
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);
  // depois do primeiro play, um "waiting" (rebuffer no meio de um seek, por
  // exemplo) não deve mais esconder os botões atrás de um spinner — só o
  // carregamento inicial faz isso
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ pct: number; time: number } | null>(null);

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
    // Tenta autoplay COM som primeiro (como YouTube/Netflix) — só cai pra
    // mudo se o navegador rejeitar. Isso funciona sempre que o navegador já
    // "confia" no site pra tocar som sozinho (ex: usuário já assistiu algo
    // aqui com som antes); é a política de autoplay do navegador, não tem
    // como forçar passar por cima dela, só tentar da forma mais provável de
    // funcionar e cair pra mudo graciosamente quando não der.
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

  function handleProgress() {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime) end = v.buffered.end(i);
    }
    setBufferedEnd(end);
  }

  // salva progresso periodicamente enquanto toca, e ao sair/trocar de título
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) doSaveProgress();
    }, 5000);
    return () => clearInterval(interval);
  }, [doSaveProgress]);

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
  }, [saveProgress, titleId, episodeId]);

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
    const next = Math.min(Math.max(0, v.currentTime + delta), max);
    v.currentTime = next;
    // feedback visual na hora (barra/tempo) sem esperar o próximo evento
    // `timeupdate` do navegador, que pode demorar a disparar depois de um seek
    setCurrentTime(next);
    showOverlay();
  }

  function seekToPct(pct: number) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const next = Math.min(Math.max(0, pct), 1) * v.duration;
    v.currentTime = next;
    setCurrentTime(next);
  }

  function pctFromClientX(clientX: number): number {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  function handleProgressPointerDown(e: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const pct = Math.min(Math.max(0, pctFromClientX(e.clientX)), 1);
    dragPctRef.current = pct;
    // clique simples (sem arrastar) já busca a posição na hora
    seekToPct(pct);
    if (duration) setPreview({ pct, time: pct * duration });
    showOverlay();
  }
  function handleProgressPointerMove(e: PointerEvent<HTMLDivElement>) {
    const pct = Math.min(Math.max(0, pctFromClientX(e.clientX)), 1);
    if (duration) setPreview({ pct, time: pct * duration });
    if (draggingRef.current) {
      // Enquanto arrasta, só atualiza o preview (visual) — buscar a cada
      // pixel de movimento faz um request novo pro Drive a cada tick e
      // trava tudo. O seek de verdade só acontece uma vez, ao soltar.
      dragPctRef.current = pct;
    }
  }
  function handleProgressPointerUp() {
    if (draggingRef.current && dragPctRef.current !== null) {
      seekToPct(dragPctRef.current);
    }
    draggingRef.current = false;
    dragPctRef.current = null;
    setDragging(false);
    setPreview(null);
  }
  function handleProgressPointerLeave() {
    if (!draggingRef.current) setPreview(null);
  }
  function handleProgressKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") seekBy(5);
    else if (e.key === "ArrowLeft") seekBy(-5);
  }

  function isControlTarget(el: EventTarget | null): boolean {
    return el instanceof HTMLElement
      ? Boolean(el.closest("button, .progress-bar, .volume-slider, .rate-select"))
      : false;
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

  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
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
  }

  function handleRateChange(e: ChangeEvent<HTMLSelectElement>) {
    const v = videoRef.current;
    if (!v) return;
    const next = parseFloat(e.target.value);
    v.playbackRate = next;
    setRate(next);
  }

  function toggleFullscreen() {
    const v = videoRef.current as WebkitVideoElement | null;
    if (!v) return;

    // iOS Safari não implementa Fullscreen API padrão em elementos
    // genéricos — só o próprio <video> sabe entrar em fullscreen, por uma
    // API própria da Apple. Sem isso, o botão simplesmente não faz nada
    // em iPhone/iPad.
    if (v.webkitEnterFullscreen) {
      if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen?.();
      else v.webkitEnterFullscreen();
      return;
    }

    const container = v.closest(".player-shell");
    if (!(container instanceof HTMLElement)) return;
    if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFsChange);

    // iOS não dispara "fullscreenchange" pro fullscreen nativo do <video> —
    // tem seus próprios eventos.
    const v = videoRef.current as WebkitVideoElement | null;
    function onBegin() {
      setIsFullscreen(true);
    }
    function onEnd() {
      setIsFullscreen(false);
    }
    v?.addEventListener("webkitbeginfullscreen", onBegin);
    v?.addEventListener("webkitendfullscreen", onEnd);

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      v?.removeEventListener("webkitbeginfullscreen", onBegin);
      v?.removeEventListener("webkitendfullscreen", onEnd);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isFormControl = target ? ["BUTTON", "SELECT", "INPUT"].includes(target.tagName) : false;
      if ((e.key === " " || e.code === "Space") && !isFormControl) {
        e.preventDefault();
        togglePlay();
        showOverlay();
      } else if (e.key === "ArrowRight" && !isFormControl) {
        seekBy(10);
      } else if (e.key === "ArrowLeft" && !isFormControl) {
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
  const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <div className="player-shell" onMouseMove={showOverlay}>
      <video
        ref={videoRef}
        className="player-video"
        src={src}
        playsInline
        muted={muted}
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noremoteplayback nofullscreen noplaybackrate"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onProgress={handleProgress}
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
        onPlaying={() => {
          setLoading(false);
          setHasPlayedOnce(true);
        }}
        onError={() => {
          // navegador não conseguiu decodificar/abrir o arquivo (contêiner
          // não suportado, ex: .mkv no Chrome/Safari, arquivo corrompido...)
          // — para de girar o spinner pra sempre e avisa em vez de travar.
          setLoading(false);
          setPlaybackError(true);
        }}
      />

      {/* Fora da camada que soma opacidade/pointer-events com o resto dos
          controles: sair do player precisa funcionar sempre, mesmo com o
          overlay escondido por inatividade — não devia exigir um primeiro
          toque só pra "acordar" os controles antes de conseguir voltar. */}
      <div className="player-top">
        <button onClick={onExit} aria-label="Voltar">
          <BackArrowIcon />
        </button>
        <div className="player-title">{displayTitle}</div>
      </div>

      <div className={`player-overlay${overlayHidden ? " hidden" : ""}`}>
        {playbackError ? (
          <div className="player-center">
            <div className="player-error">
              <p>Não foi possível reproduzir este vídeo.</p>
              <p className="player-error-hint">
                O formato do arquivo pode não ser compatível com o navegador (ex: .mkv não toca
                em Chrome/Safari — prefira .mp4 com vídeo H.264 e áudio AAC).
              </p>
            </div>
          </div>
        ) : loading && !hasPlayedOnce ? (
          // carregamento inicial: ainda não há nada pra interagir mesmo
          <div className="player-center">
            <div className="spinner" />
          </div>
        ) : (
          // depois do primeiro play, um rebuffer (ex: logo após um seek) não
          // esconde mais os botões — só troca o play/pause por um spinner
          // pequeno, ±10s continuam clicáveis normalmente
          <div className="player-center">
            <button onClick={() => seekBy(-10)} aria-label="Voltar 10 segundos">
              <Back10Icon />
            </button>
            {loading ? (
              <div className="spinner spinner-inline" />
            ) : (
              <button
                className="player-playpause"
                onClick={togglePlay}
                aria-label={playing ? "Pausar" : "Reproduzir"}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
            )}
            <button onClick={() => seekBy(10)} aria-label="Avançar 10 segundos">
              <Forward10Icon />
            </button>
          </div>
        )}

        <div className="player-bottom">
          <div className="progress-row">
            <span className="time">{fmtTime(currentTime)}</span>
            <div
              className={`progress-bar${dragging ? " dragging" : ""}`}
              ref={progressRef}
              onPointerDown={handleProgressPointerDown}
              onPointerMove={handleProgressPointerMove}
              onPointerUp={handleProgressPointerUp}
              onPointerLeave={handleProgressPointerLeave}
              onKeyDown={handleProgressKeyDown}
              role="slider"
              aria-label="Progresso do vídeo"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              tabIndex={0}
            >
              {preview && (
                <div className="progress-tooltip" style={{ left: `${preview.pct * 100}%` }}>
                  {fmtTime(preview.time)}
                </div>
              )}
              <div className="progress-track">
                <div className="progress-buffered" style={{ width: `${bufferedPct}%` }} />
              </div>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
              <div className="progress-handle" style={{ left: `${pct}%` }} />
            </div>
            <span className="time">{fmtTime(duration)}</span>
          </div>
          <div className="player-controls-row">
            <div className="volume-control">
              <button onClick={toggleMute} aria-label={muted ? "Ativar som" : "Silenciar"}>
                <VolumeIcon />
              </button>
              <input
                className="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
              />
            </div>

            <div className="rate-select-wrap">
              <select
                className="rate-select"
                value={rate}
                onChange={handleRateChange}
                aria-label="Velocidade de reprodução"
              >
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}x
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            {onNextEpisode && (
              <button className="next-ep-btn" onClick={onNextEpisode} aria-label="Próximo episódio">
                <span>Próximo</span>
                <NextEpisodeIcon />
              </button>
            )}
            <div className="spacer" />
            <button onClick={toggleFullscreen} aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
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
