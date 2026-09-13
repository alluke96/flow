"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useProfiles } from "@/context/profile-context";
import { streamUrl } from "@/lib/api-client";
import { useTizenPlayer } from "@/lib/tizen-player-bridge";
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
 *
 * EXCEÇÃO: dentro da casca Tizen (ver tizen-player-bridge.ts), o vídeo em
 * si não usa <video> nenhum — usa o player NATIVO da TV (AVPlay), porque o
 * <video> HTML5 desta TV tem um bug confirmado de busca (seek) que nunca
 * chega a pedir bytes ainda não baixados. Os hooks acima continuam
 * existindo nesse modo (a maioria simplesmente não faz nada, já que
 * videoRef.current fica sempre null) — só as funções que precisam de fato
 * mexer no vídeo (play/pause/seek/volume/velocidade/salvar progresso/sair)
 * ganham uma versão "nativa" que fala com a casca por postMessage em vez
 * do elemento. Ver as variáveis `nativeMode`/`tz` abaixo.
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
  const shellRef = useRef<HTMLDivElement>(null);
  const nativeAreaRef = useRef<HTMLDivElement>(null);
  const { saveProgress, syncProfiles } = useProfiles();

  // Player nativo da TV (AVPlay), só existe dentro da casca Tizen — ver
  // tizen-player-bridge.ts pro porquê. `active` fica null até o handshake
  // resolver (quase instantâneo); PC/celular/web sempre resolvem pra false.
  const tz = useTizenPlayer();
  const nativeMode = tz.active === true;
  // Espelho síncrono de tz.state pra ler sem depender do ciclo de render
  // (mesmo motivo de doSaveProgress, em useProgressPersistence, ler
  // v.currentTime direto em vez de estado do React) — também é o que
  // useProgressPersistence usa como `nativeRef` (as formas coincidem:
  // currentTime/duration/seeking/paused).
  const tzStateRef = useRef(tz.state);
  useEffect(() => {
    tzStateRef.current = tz.state;
  }, [tz.state]);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  // depois do primeiro play, um "waiting" (rebuffer no meio de um seek, por
  // exemplo) não deve mais esconder os botões atrás de um spinner — só o
  // carregamento inicial faz isso
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackErrorDetail, setPlaybackErrorDetail] = useState<PlaybackErrorDetail | null>(null);

  const { overlayHidden, showOverlay } = useOverlayVisibility(
    videoRef,
    nativeMode ? tzStateRef : undefined
  );
  const {
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    bufferedEnd,
    setBufferedEnd,
    onProgress,
    seekBy: seekByVideo,
    seekToPct: seekToPctVideo,
  } = usePlaybackTime(videoRef, showOverlay);
  const {
    muted,
    setMuted,
    volume,
    setVolume,
    rate,
    setRate,
    togglePlay: togglePlayVideo,
    toggleMute: toggleMuteVideo,
    handleVolumeChange: handleVolumeChangeVideo,
    handleRateChange: handleRateChangeVideo,
  } = usePlaybackActions(videoRef);
  const { seekFlash, triggerSeekFlash } = useSeekFlash();

  // Busca (±10s, duplo-toque, setas, barra de progresso) e ações de
  // play/pause/mudo/volume/velocidade: em modo nativo, comandam o AVPlay da
  // casca por postMessage em vez do <video> (que nem existe nesse modo).
  // Ficam definidas aqui, e não dentro dos hooks de vídeo, porque são as
  // únicas funções que todo o resto do componente (JSX, useDoubleTapSeek,
  // useProgressBarDrag, useKeyboardShortcuts) precisa chamar sem saber qual
  // motor está tocando por trás.
  const seekBy = useCallback(
    (delta: number) => {
      if (nativeMode) {
        // Salto RELATIVO: quem soma os 10s é o player da TV, não a gente
        // (ver seekBy em tizen-player-bridge.ts). O valor abaixo é só o
        // palpite que a barra mostra até o espelho trazer o tempo de
        // verdade, no próximo quarto de segundo.
        tz.api.seekBy(delta);
        const max = tzStateRef.current.duration || Infinity;
        setCurrentTime(Math.min(Math.max(0, tzStateRef.current.currentTime + delta), max));
        showOverlay();
        return;
      }
      seekByVideo(delta);
    },
    [nativeMode, tz.api, setCurrentTime, showOverlay, seekByVideo]
  );

  const seekToPct = useCallback(
    (pct: number) => {
      if (nativeMode) {
        const dur = tzStateRef.current.duration;
        if (!dur) return;
        const next = Math.min(Math.max(0, pct), 1) * dur;
        tz.api.seekTo(next);
        setCurrentTime(next);
        return;
      }
      seekToPctVideo(pct);
    },
    [nativeMode, tz.api, setCurrentTime, seekToPctVideo]
  );

  const togglePlay = useCallback(() => {
    if (nativeMode) {
      const estavaPausado = tzStateRef.current.paused;
      if (estavaPausado) {
        tz.api.play();
        setPlaying(true);
        showOverlay();
      } else {
        tz.api.pause();
        setPlaying(false);
      }
      return;
    }
    togglePlayVideo();
  }, [nativeMode, tz.api, showOverlay, togglePlayVideo]);

  const toggleMute = useCallback(() => {
    // AVPlay não expõe volume por instância (é sempre o volume do sistema,
    // controlado pelo controle remoto físico) — em modo nativo o botão só
    // atualiza o desenho na tela, sem efeito real no áudio.
    if (nativeMode) {
      setMuted((m) => !m);
      return;
    }
    toggleMuteVideo();
  }, [nativeMode, setMuted, toggleMuteVideo]);

  const handleVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (nativeMode) {
        // Ver toggleMute: fica só visual em modo nativo.
        const value = parseFloat(e.target.value);
        setVolume(value);
        setMuted(value === 0);
        return;
      }
      handleVolumeChangeVideo(e);
    },
    [nativeMode, setVolume, setMuted, handleVolumeChangeVideo]
  );

  const handleRateChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      if (nativeMode) {
        const next = parseFloat(e.target.value);
        tz.api.setSpeed(next);
        setRate(next);
        return;
      }
      handleRateChangeVideo(e);
    },
    [nativeMode, tz.api, setRate, handleRateChangeVideo]
  );

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
  const { isFullscreen, toggleFullscreen } = useFullscreen(videoRef, shellRef);
  const { nextCountdown, startCountdown, cancelCountdown } = useNextEpisodeCountdown(onNextEpisode);

  const doSaveProgress = useProgressPersistence({
    videoRef,
    nativeRef: nativeMode ? tzStateRef : undefined,
    titleId,
    episodeId,
    saveProgress,
  });
  const { exitingRef, handleExit } = useExitPlayer({
    videoRef,
    doSaveProgress,
    onExit,
    syncProfiles,
    releaseMedia: nativeMode ? () => tz.api.close() : undefined,
  });
  const resumePlayback = useResumePlayback(videoRef, initialTime, setMuted);

  useKeyboardShortcuts({ showOverlay, togglePlay, seekBy, handleExit });

  const src = streamUrl(titleId, episodeId);
  // Capturados em ref pro efeito de abertura do AVPlay (abaixo) não precisar
  // reabrir o vídeo a cada re-render — só lê o valor mais recente na hora
  // que dispara.
  const srcRef = useRef(src);
  const initialTimeRef = useRef(initialTime);
  useEffect(() => {
    srcRef.current = src;
    initialTimeRef.current = initialTime;
  }, [src, initialTime]);

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
    if (nativeMode) {
      tz.api.seekTo(0);
      tz.api.play();
      setCurrentTime(0);
      setPlaying(true);
    } else {
      const v = videoRef.current;
      if (v) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    }
    setEnded(false);
    cancelCountdown();
  }

  // Abre o AVPlay uma vez, quando a casca Tizen é confirmada — equivalente
  // ao <video src=...> montar e disparar o carregamento sozinho. Fecha ao
  // desmontar (handleExit já fecha antes disso na saída normal — ver
  // releaseMedia acima — mas fechar de novo aqui é barato e cobre qualquer
  // desmonte que não passe por ali, ex: troca direta de episódio).
  useEffect(() => {
    if (!nativeMode) return;
    tz.api.open(srcRef.current, initialTimeRef.current);
    document.documentElement.classList.add("native-player-ativo");
    document.body.classList.add("native-player-ativo");
    return () => {
      document.documentElement.classList.remove("native-player-ativo");
      document.body.classList.remove("native-player-ativo");
      tz.api.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeMode]);

  // AVPlay desenha num plano de hardware ATRÁS da página inteira — a casca
  // (tizen/index.html) precisa saber exatamente que retângulo da TELA
  // corresponde à área do vídeo pra posicionar esse plano ali (setDisplayRect
  // usa coordenadas de tela, não do documento). Reporta de novo sempre que o
  // layout pode ter mudado.
  useEffect(() => {
    if (!nativeMode) return;
    function reportarRect() {
      const el = nativeAreaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // O AVPlay quer PIXELS DA TELA. Com a ampliação de 10 pés (`zoom` na
      // raiz, ver .tv-widget em globals.css) o documento passa a medir
      // menos que a tela, e versões diferentes do Blink discordam sobre se
      // getBoundingClientRect devolve o número já ampliado ou não — se vier
      // o de antes da ampliação, o vídeo apareceria num retângulo menor no
      // canto. Medir a PRÓPRIA raiz e comparar com a janela resolve sem
      // depender de qual das duas convenções a TV segue: a razão dá 1
      // quando não há ampliação nenhuma (todo o resto do mundo) e dá
      // exatamente o fator quando o rect veio sem ela.
      const larguraRaiz = document.documentElement.getBoundingClientRect().width;
      const escala = larguraRaiz > 0 ? window.innerWidth / larguraRaiz : 1;
      tz.api.setRect(
        Math.round(r.x * escala),
        Math.round(r.y * escala),
        Math.round(r.width * escala),
        Math.round(r.height * escala)
      );
    }
    reportarRect();
    window.addEventListener("resize", reportarRect);
    document.addEventListener("fullscreenchange", reportarRect);
    return () => {
      window.removeEventListener("resize", reportarRect);
      document.removeEventListener("fullscreenchange", reportarRect);
    };
  }, [nativeMode, tz.api]);

  // Espelha o estado do AVPlay (que chega por postMessage) nos MESMOS
  // estados do React que o ramo <video> já alimenta via onTimeUpdate/
  // onProgress/onPlay/onEnded/onError — assim todo o JSX abaixo (barra de
  // progresso, spinner, tela de erro...) continua funcionando sem saber
  // qual dos dois motores está tocando.
  useEffect(() => {
    if (!nativeMode) return;
    const s = tz.state;
    // Espelhamento de propósito: este efeito existe só pra sincronizar
    // estado que chega de FORA (postMessage da casca Tizen) — é exatamente
    // o caso de uso que a regra abaixo permite desativar.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDuration(s.duration);
    // seekPendente na frente: quando a TV recusa a busca e o vídeo está
    // sendo reaberto no ponto pedido (ver tizen-player-bridge), é o destino
    // que a barra mostra — o tempo de verdade ainda é o de antes do pulo, e
    // ver a barra voltar pra lá a cada toque seria pior que esperar.
    setCurrentTime(s.seekPendente ?? s.currentTime);
    setPlaying(!s.paused);
    setBufferedEnd(s.bufferedTime);
    setLoading(s.buffering);
    if (s.duration > 0) setHasPlayedOnce(true);
    if (s.error && !playbackError) {
      setPlaybackErrorDetail({ code: undefined, message: s.error });
      setPlaybackError(true);
      setLoading(false);
    }
    if (s.ended && !ended) handleEnded();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeMode, tz.state]);

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={`player-shell${overlayHidden ? " controls-hidden" : ""}${nativeMode ? " native-player" : ""}`}
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
      {nativeMode ? (
        // Sem <video> nenhum aqui de propósito: o vídeo de verdade é
        // desenhado pelo AVPlay da casca Tizen, NUM PLANO ATRÁS desta
        // página inteira (ver tizen-player-bridge.ts e tizen/index.html) —
        // esta div só reserva o espaço/tamanho (pra reportar o retângulo de
        // tela certo) e fica transparente (.native-player no CSS) pra não
        // tapar esse plano.
        <div ref={nativeAreaRef} className="player-video player-video-native" />
      ) : tz.active === false ? (
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
      ) : null /* tz.active ainda null: handshake com a casca em andamento — mesma tela de carregamento de sempre, sem <video> nem área nativa até decidir */}

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
