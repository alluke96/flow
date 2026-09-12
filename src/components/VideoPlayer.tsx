"use client";

import { useCallback, useRef, useState } from "react";
import { useProfiles } from "@/context/profile-context";
import { streamUrl } from "@/lib/api-client";
import { FullscreenEnterIcon, FullscreenExitIcon, NextEpisodeIcon } from "./player-icons";
import { NextUpToast } from "./player/NextUpToast";
import { PlaybackErrorPanel } from "./player/PlaybackErrorPanel";
import { PlayerCenterControls } from "./player/PlayerCenterControls";
import { PlayerTopBar } from "./player/PlayerTopBar";
import { ProgressBar } from "./player/ProgressBar";
import { RateSelect } from "./player/RateSelect";
import { SeekFlashBadge } from "./player/SeekFlashBadge";
import { VolumeControl } from "./player/VolumeControl";
import { useDoubleTapSeek } from "./player/useDoubleTapSeek";
import { useExitPlayer } from "./player/useExitPlayer";
import { useFullscreen } from "./player/useFullscreen";
import { useKeyboardShortcuts } from "./player/useKeyboardShortcuts";
import { useNextEpisodeCountdown } from "./player/useNextEpisodeCountdown";
import { useOverlayVisibility } from "./player/useOverlayVisibility";
import { usePlaybackActions } from "./player/usePlaybackActions";
import { usePlaybackTime } from "./player/usePlaybackTime";
import { useProgressBarDrag } from "./player/useProgressBarDrag";
import { useProgressPersistence } from "./player/useProgressPersistence";
import { useResumePlayback } from "./player/useResumePlayback";
import { useSeekFlash } from "./player/useSeekFlash";
import type { PlaybackErrorDetail } from "./player/types";

interface VideoPlayerProps {
  titleId: string;
  episodeId: string | null;
  displayTitle: string;
  initialTime: number;
  onExit: () => void;
  onNextEpisode?: () => void;
}

/**
 * Player customizado: controles próprios, gestos de toque (tap = play/pause,
 * duplo tap nas metades esquerda/direita = -10s/+10s), teclado (espaço,
 * setas, Esc) e navegação por foco grande o bastante pro "10-foot UI" de
 * Smart TV (ver globals.css). O <video> aponta pra /api/stream/:id, que
 * suporta Range Requests de verdade — o próprio elemento cuida do seek.
 *
 * A lógica em si mora em hooks dedicados sob ./player (um por
 * responsabilidade: overlay, tempo/seek, feedback do duplo-toque, arrasto
 * da barra, retomada, persistência, saída, fullscreen, contagem do próximo
 * episódio, atalhos de teclado) — este componente só liga tudo e renderiza.
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
  const { saveProgress, syncProfiles } = useProfiles();

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  // depois do primeiro play, um "waiting" (rebuffer no meio de um seek, por
  // exemplo) não deve mais esconder os botões atrás de um spinner — só o
  // carregamento inicial faz isso
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackErrorDetail, setPlaybackErrorDetail] = useState<PlaybackErrorDetail | null>(null);

  const { overlayHidden, showOverlay } = useOverlayVisibility(videoRef);
  const { currentTime, setCurrentTime, duration, setDuration, bufferedEnd, onProgress, seekBy, seekToPct } =
    usePlaybackTime(videoRef, showOverlay);
  const { muted, setMuted, volume, rate, togglePlay, toggleMute, handleVolumeChange, handleRateChange } =
    usePlaybackActions(videoRef);
  const { seekFlash, triggerSeekFlash } = useSeekFlash();
  const { handleVideoAreaClick, handleTouchEnd } = useDoubleTapSeek({ seekBy, triggerSeekFlash, showOverlay });
  const {
    progressRef,
    dragging,
    preview,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleKeyDown: handleProgressKeyDown,
  } = useProgressBarDrag({ duration, seekToPct, showOverlay });
  const { isFullscreen, toggleFullscreen } = useFullscreen(videoRef);
  const { nextCountdown, startCountdown, cancelCountdown } = useNextEpisodeCountdown(onNextEpisode);

  const doSaveProgress = useProgressPersistence({ videoRef, titleId, episodeId, saveProgress });
  const { exitingRef, handleExit } = useExitPlayer({ videoRef, doSaveProgress, onExit, syncProfiles });
  const resumePlayback = useResumePlayback(videoRef, initialTime, setMuted);

  useKeyboardShortcuts({ showOverlay, togglePlay, seekBy, handleExit });

  const src = streamUrl(titleId, episodeId);

  // retoma de onde parou (progresso salvo do perfil) assim que os metadados carregam
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    resumePlayback();
  }, [setDuration, resumePlayback]);

  function handleEnded() {
    setEnded(true);
    doSaveProgress();
    if (onNextEpisode) startCountdown();
  }

  function handleReplay() {
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setEnded(false);
    cancelCountdown();
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;

  return (
    <div
      className={`player-shell${overlayHidden ? " controls-hidden" : ""}`}
      onMouseMove={showOverlay}
      onClick={handleVideoAreaClick}
      onTouchEnd={handleTouchEnd}
    >
      {/* Clique/toque pra tocar-pausar e o duplo-toque pra buscar ±10s
          precisam ficar AQUI, no container, não no <video> em si: .player-
          overlay (controles) é um IRMÃO do <video>, empilhado por cima via
          position:absolute, e fica visível a maior parte do tempo (só some
          de verdade depois de alguns segundos de inatividade). Um toque
          nessa área nunca chega no <video> — elementos irmãos não propagam
          evento um pro outro. Só bindar aqui é que garante que o gesto
          funciona também quando os controles estão visíveis, que é a
          situação mais comum. */}
      <video
        ref={videoRef}
        className="player-video"
        src={src}
        playsInline
        muted={muted}
        disablePictureInPicture
        disableRemotePlayback
        // Nunca focável: em webviews de TV há relatos de que um <video>
        // com foco nativo pode capturar as teclas de seta do controle pra
        // trick-play próprio ANTES de qualquer JS vê-las. O foco no player
        // sempre fica num elemento de controle (botão, barra de progresso —
        // ver tv-nav.ts), nunca no vídeo em si.
        tabIndex={-1}
        controlsList="nodownload noremoteplayback nofullscreen noplaybackrate"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(e) => {
          if (exitingRef.current) return;
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onProgress={onProgress}
        onPlay={() => {
          setPlaying(true);
          showOverlay();
        }}
        onPause={() => {
          // Saindo: o "pause" da desmontagem não pode mexer em estado nem
          // no contexto de perfis — é isso que atropelava a navegação.
          if (exitingRef.current) return;
          setPlaying(false);
          // O navegador dispara "pause" nativamente ao remover o <video> do
          // DOM — bem no meio de uma troca de rota (ex: "voltar" com o vídeo
          // tocando). doSaveProgress já adia a parte que importa — é por
          // isso que chamar direto aqui é seguro.
          doSaveProgress();
        }}
        onEnded={handleEnded}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => {
          setLoading(false);
          setHasPlayedOnce(true);
        }}
        onError={(e) => {
          // Durante a saída (ver useExitPlayer) a gente solta a mídia de
          // propósito, o que faz alguns navegadores dispararem "error" de
          // src vazio — isso não é falha nenhuma, e mostrar a tela de erro
          // por uma fração de segundo bem na hora de sair seria só ruído.
          if (exitingRef.current) return;
          const mediaError = e.currentTarget.error;
          setPlaybackErrorDetail({
            code: mediaError?.code,
            message: mediaError?.message || "sem detalhes",
          });
          setLoading(false);
          setPlaybackError(true);
        }}
      />

      <SeekFlashBadge flash={seekFlash} />

      <PlayerTopBar hidden={overlayHidden} title={displayTitle} onExit={handleExit} />

      <div className={`player-overlay${overlayHidden ? " hidden" : ""}`}>
        {playbackError ? (
          <PlaybackErrorPanel detail={playbackErrorDetail} />
        ) : loading && !hasPlayedOnce ? (
          // carregamento inicial: ainda não há nada pra interagir mesmo
          <div className="player-center">
            <div className="spinner" />
          </div>
        ) : (
          <PlayerCenterControls
            playing={playing}
            ended={ended}
            loading={loading}
            onSeekBack={() => seekBy(-10)}
            onSeekForward={() => seekBy(10)}
            onTogglePlay={togglePlay}
            onReplay={handleReplay}
          />
        )}

        <div className="player-bottom">
          <ProgressBar
            progressRef={progressRef}
            currentTime={currentTime}
            duration={duration}
            pct={pct}
            bufferedPct={bufferedPct}
            dragging={dragging}
            preview={preview}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onKeyDown={(e) => handleProgressKeyDown(e, seekBy)}
          />
          <div className="player-controls-row">
            <VolumeControl muted={muted} volume={volume} onToggleMute={toggleMute} onVolumeChange={handleVolumeChange} />
            <RateSelect rate={rate} onChange={handleRateChange} />

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

      {nextCountdown !== null && <NextUpToast secondsLeft={nextCountdown} onCancel={cancelCountdown} />}
    </div>
  );
}
