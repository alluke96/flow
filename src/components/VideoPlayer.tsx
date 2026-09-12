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
  ReplayIcon,
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
// Teto pra esperar o "seeked" do seek de retomada antes de dar play assim
// mesmo (ver handleLoadedMetadata) — nunca deixa o player travado esperando
// um evento que pode não vir.
const RESUME_SEEK_TIMEOUT_MS = 1500;
const NEXT_EPISODE_COUNTDOWN_S = 5;

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
  const lastTapRef = useRef<{ t: number } | null>(null);
  const draggingRef = useRef(false);
  const dragPctRef = useRef<number | null>(null);

  const { saveProgress, syncProfiles } = useProfiles();

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
  // Detalhe real do MediaError (ver onError) — sem isso, QUALQUER falha
  // (rede/CORS bloqueando o request, arquivo corrompido, codec não suportado
  // de verdade...) mostrava a mesma mensagem genérica de ".mkv não
  // compatível", mesmo quando a causa real era outra inteiramente (ex: uma
  // resposta 403/500 no lugar dos bytes do vídeo — o <video> não sabe
  // diferenciar isso de um arquivo ilegível, e a mensagem genérica escondia
  // qual dos dois realmente aconteceu). Mostrar o código/mensagem de
  // verdade permite saber a causa real da próxima vez, em vez de adivinhar.
  const [playbackErrorDetail, setPlaybackErrorDetail] = useState<{
    code: number | undefined;
    message: string;
  } | null>(null);
  // depois do primeiro play, um "waiting" (rebuffer no meio de um seek, por
  // exemplo) não deve mais esconder os botões atrás de um spinner — só o
  // carregamento inicial faz isso
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ pct: number; time: number } | null>(null);
  // null = sem contagem rolando (ainda não acabou, ou usuário cancelou).
  // Enquanto tem próximo episódio, o fim do vídeo arma essa contagem em
  // vez de já disparar onNextEpisode — dá pra cancelar e ficar aqui.
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  // Feedback visual do duplo-toque pra buscar ±10s (estilo YouTube) — sem
  // isso, o seek era seco demais: nada na tela indicava que o duplo-toque
  // tinha sido reconhecido, só o tempo pulando. `id` incrementa a cada
  // duplo-toque, mesmo repetido do mesmo lado — é a troca de `key` no JSX
  // (ver render) que reinicia a animação CSS a cada vez.
  const [seekFlash, setSeekFlash] = useState<{ dir: "back" | "fwd"; id: number } | null>(null);
  const seekFlashIdRef = useRef(0);

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
    };
  }, [showOverlay]);

  // saveProgress mexe num contexto ancestral (perfis) — chamar isso de forma
  // síncrona bem no meio de uma transição de rota em andamento (ex: acabou
  // de clicar em "voltar") pode fazer o React/Next.js abortar essa transição
  // silenciosamente (já vimos essa exata causa raiz umas 3 vezes nesta base
  // de código: no efeito de cleanup do desmonte, no onPause, e agora aqui).
  // Em vez de lembrar de adiar em cada lugar que chama doSaveProgress (é
  // assim que a gente foi mordido de novo — o intervalo de 5s abaixo nunca
  // tinha esse adiamento), o adiamento agora mora AQUI, uma vez só, pra
  // proteger todo mundo que chamar essa função. Os valores em si são lidos
  // na hora (síncrono, com o <video> ainda garantidamente válido) — só a
  // chamada que toca o contexto ancestral é que espera o próximo tick.
  const doSaveProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const snapshot = { t: v.currentTime, d: v.duration };
    setTimeout(() => saveProgress(titleId, episodeId, snapshot.t, snapshot.d), 0);
  }, [saveProgress, titleId, episodeId]);

  /**
   * Sair do player. O ponto aqui é a navegação acontecer NA HORA, e tudo
   * mais ficar pra depois.
   *
   * A ORDEM aqui é o ponto todo, e já erramos ela: soltar a mídia antes de
   * navegar faz o vídeo pausar e ficar preto na hora, mas `pause()` dispara
   * "pause", que mexe no contexto de perfis — exatamente o tipo de escrita
   * que faz o React/Next abandonar uma navegação em andamento. Resultado:
   * pausava, escurecia e NÃO voltava. Agora navega PRIMEIRO e só depois
   * (no próximo tick, já fora do caminho da transição) solta a mídia e
   * salva o progresso. Enquanto sai, os handlers do <video> ficam mudos
   * (exitingRef) pra nenhum evento de desmontagem mexer em estado.
   */
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
      // outros aparelhos enxergarem). É manda-e-esquece via sendBeacon:
      // não segura conexão nem volta pra mexer em estado. Este timeout roda
      // depois do agendado por doSaveProgress, então o que sai daqui já
      // inclui o minuto em que o vídeo parou.
      syncProfiles();
    }, 0);
  }, [doSaveProgress, onExit, syncProfiles]);

  // retoma de onde parou (progresso salvo do perfil) assim que os metadados carregam
  function handleLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);

    // Tenta autoplay COM som primeiro (como YouTube/Netflix) — só cai pra
    // mudo se o navegador rejeitar. Isso funciona sempre que o navegador já
    // "confia" no site pra tocar som sozinho (ex: usuário já assistiu algo
    // aqui com som antes); é a política de autoplay do navegador, não tem
    // como forçar passar por cima dela, só tentar da forma mais provável de
    // funcionar e cair pra mudo graciosamente quando não der.
    function startPlayback() {
      if (!v) return;
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

    if (initialTime > 1 && initialTime < (v.duration || Infinity) - 2) {
      // Buscar um ponto que ainda não foi baixado é assíncrono de verdade
      // aqui — o vídeo é servido via Range Requests (ver /api/stream), então
      // pular pra 1:32 exige um NOVO request ao servidor por aqueles bytes
      // específicos antes do navegador ter algo pra tocar dali. Chamar
      // play() imediatamente (como era antes), sem esperar isso terminar,
      // deixava o navegador tocar o que já tinha bufferizado perto do
      // início enquanto o relógio na tela ficava travado no valor pedido
      // (timeupdate não dispara com uma seek pendente) — áudio e vídeo
      // ficavam fora de sincronia até outra seek (ex: ±10s) forçar tudo a
      // se resolver de vez, mas ainda mostrando o tempo errado. Esperar o
      // evento "seeked" (o navegador confirmando que já buscou e
      // posicionou tudo ali) antes de dar play evita a corrida inteira.
      //
      // MAS nunca dependendo SÓ disso: se "seeked" não vier (seek recusado,
      // buffer negado, arquivo problemático...), esperar por ele pra sempre
      // deixa o vídeo parado eternamente — e aí NADA funciona: os controles
      // não somem (só somem com o vídeo tocando, ver scheduleHide), o
      // relógio fica congelado no destino, e a tela fica preta. Um fallback
      // curto garante que a reprodução comece de um jeito ou de outro.
      let started = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
      function startOnce() {
        if (started) return;
        started = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        videoRef.current?.removeEventListener("seeked", startOnce);
        startPlayback();
      }
      fallbackTimer = setTimeout(startOnce, RESUME_SEEK_TIMEOUT_MS);
      v.addEventListener("seeked", startOnce);
      v.currentTime = initialTime;
    } else {
      startPlayback();
    }
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

  // Some sozinho depois de tocar a animação (ver .seek-flash no CSS) — tem
  // que bater com a duração dela.
  useEffect(() => {
    if (!seekFlash) return;
    const t = setTimeout(() => setSeekFlash(null), 700);
    return () => clearTimeout(t);
  }, [seekFlash]);

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
    const pct = Math.min(Math.max(0, pctFromClientX(e.clientX)), 1);
    dragPctRef.current = pct;
    // clique simples (sem arrastar) já busca a posição na hora
    seekToPct(pct);
    if (duration) setPreview({ pct, time: pct * duration });
    showOverlay();
    // setPointerCapture só garante que pointermove/pointerup continuem
    // chegando aqui se o ponteiro sair da barra durante um arrasto — não é
    // essencial pro clique simples acima, que já aconteceu. Precisa ficar
    // DEPOIS do seek e dentro de um try/catch: o navegador da TV (Tizen,
    // acessado direto pelo browser, sem ser via app) tem uma implementação
    // de Pointer Events incompleta/instável, e essa chamada pode lançar
    // nele. Antes, ela era a primeira linha da função — a exceção abortava
    // tudo antes de chegar no seekToPct, fazendo o clique não fazer nada
    // (o preview no hover funcionava normal porque só depende de
    // pointermove, que nunca passa por essa chamada).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // sem suporte/instável neste navegador — degrada bem: o clique simples
      // já funcionou acima, só um arrasto saindo da barra pode não continuar
      // sendo rastreado perfeitamente.
    }
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
    // Element, não HTMLElement: os ícones dos botões (voltar, play/pause,
    // ±10s, mudo, tela cheia...) são <svg>/<path>, que são SVGElement —
    // uma hierarquia de classes SEPARADA de HTMLElement no navegador (uma
    // não é instância da outra). Com o check em HTMLElement, um clique que
    // acertasse o desenho do ícone (o alvo visual óbvio de qualquer botão)
    // never passava no closest() abaixo — a exclusão simplesmente não
    // rodava — e o clique vazava pra handleVideoAreaClick, disparando
    // togglePlay() junto. Isso ficou invisível enquanto esse handler só
    // vivia no <video> (irmão dos controles, nunca alcançado por um clique
    // neles) — virou um bug de verdade assim que passou a viver no
    // .player-shell (ver handleVideoAreaClick/handleTouchEnd), alcançável
    // por clique em QUALQUER botão do player. Element é a interface comum
    // a HTML e SVG — closest() existe nela pros dois.
    return el instanceof Element
      ? Boolean(el.closest("button, .progress-bar, .volume-slider, .rate-select"))
      : false;
  }

  // Clicar/tocar no vídeo em si NÃO alterna play/pause — só o botão
  // dedicado (.player-center) faz isso. Um toque na área do vídeo era fácil
  // demais de disparar sem querer (segurar o celular, um duplo-toque que
  // "vazava" um toque simples primeiro, etc.), e cada vez que isso
  // acontecia bem no meio de outra coisa (uma troca de rota, por exemplo)
  // era mais uma chance de esbarrar na classe de bug do botão de voltar que
  // já perseguimos várias vezes nesta base de código. Só acorda os
  // controles (showOverlay) — bem mais previsível.
  function handleVideoAreaClick(e: React.MouseEvent) {
    if (isControlTarget(e.target)) return;
    showOverlay();
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (isControlTarget(e.target)) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    e.preventDefault();

    // Acorda os controles na hora, sem esperar pra ver se vira duplo-toque
    // — não tem mais nada pra "desambiguar" aqui (o toque simples não faz
    // mais nada além disso), então não tem por que atrasar. O duplo-toque
    // (abaixo) já acorda os controles de novo por conta própria (via
    // seekBy), sem problema nenhum em chamar showOverlay() duas vezes.
    showOverlay();

    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.t < DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      const half = window.innerWidth / 2;
      const isLeft = touch.clientX < half;
      seekBy(isLeft ? -10 : 10);
      seekFlashIdRef.current += 1;
      setSeekFlash({ dir: isLeft ? "back" : "fwd", id: seekFlashIdRef.current });
    } else {
      lastTapRef.current = { t: now };
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
      // Qualquer tecla conta como atividade e acorda os controles — sem
      // isso, só onMouseMove resetava o timer de auto-esconder (ver
      // .player-shell). Um controle remoto de TV nunca dispara mousemove,
      // então depois de ~3s os controles (inclusive o botão de voltar,
      // que também passou a sumir visualmente — ver .player-top.hidden)
      // ficavam com pointer-events:none, parecendo "quebrados": Cima/Baixo
      // (usados pra navegar entre eles, ver tv-nav.ts) eram as únicas
      // teclas que não passavam por aqui pra reativar o overlay.
      showOverlay();

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // A barra de progresso (role="slider", uma <div>, não pega no check
      // de tag abaixo) tem seu próprio onKeyDown (handleProgressKeyDown,
      // ±5s) — sem essa exclusão aqui, focar nela e apertar seta disparava
      // OS DOIS handlers pro mesmo tecla (±5 daqui, ±10 do handler global
      // logo abaixo), somando 15s por vez em vez de avançar do jeito certo.
      const isSlider = target?.getAttribute("role") === "slider";
      // Só exclui campos com uso NATIVO próprio pra seta (o <select> de
      // velocidade navega opções, o <input type=range> do volume muda de
      // valor) — um <button> comum (play/pause, ±10s, mudo, tela cheia...)
      // não tem comportamento nativo pra seta nenhum, então não deveria
      // bloquear o seek global. Isso importa de verdade num controle de TV:
      // sem mouse, o D-pad só alcança ±10s/±5s FOCANDO um botão primeiro
      // (ver tv-nav.ts) — excluir BUTTON aqui deixava ArrowLeft/Right sem
      // efeito nenhum sempre que o foco estivesse em qualquer botão do
      // player, ou seja, na prática o tempo todo no controle remoto.
      const isRealFormControl = tag === "SELECT" || tag === "INPUT";
      if ((e.key === " " || e.code === "Space") && !isRealFormControl) {
        e.preventDefault();
        togglePlay();
        showOverlay();
      } else if (e.key === "ArrowRight" && !isRealFormControl && !isSlider) {
        seekBy(10);
      } else if (e.key === "ArrowLeft" && !isRealFormControl && !isSlider) {
        seekBy(-10);
      } else if (e.key === "Escape" || e.keyCode === 10009) {
        // 10009 = physical "Return"/back button on Samsung TV remotes
        // (Tizen WebKit), not the same key as Escape — handled here too so
        // the remote's back button exits the player directly, same as
        // Escape does on a keyboard.
        handleExit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleExit]);

  function handleEnded() {
    setEnded(true);
    doSaveProgress();
    if (onNextEpisode) setNextCountdown(NEXT_EPISODE_COUNTDOWN_S);
  }

  // onNextEpisode é uma função nova a cada render de WatchInner (closure
  // inline) — troca de identidade sempre que aquele componente re-renderiza
  // por qualquer motivo (ex: o próprio doSaveProgress mexendo no contexto de
  // perfis). Se ela estivesse nas deps do efeito abaixo, cada uma dessas
  // trocas reiniciaria o setTimeout de 1s do zero, e a contagem podia nunca
  // chegar a disparar de verdade. Uma ref sempre aponta pra versão mais
  // recente sem forçar o efeito a re-rodar por causa dela.
  const onNextEpisodeRef = useRef(onNextEpisode);
  useEffect(() => {
    onNextEpisodeRef.current = onNextEpisode;
  }, [onNextEpisode]);

  // Contagem regressiva pro próximo episódio: um segundo por vez. O
  // setState que zera o estado e dispara onNextEpisode acontece dentro do
  // callback do setTimeout (assíncrono), nunca direto no corpo do efeito —
  // evita disparar duas vezes e mantém só uma fonte de verdade pro "acabou
  // a contagem". Cancelar (ou dar replay) também só zera esse estado.
  useEffect(() => {
    if (nextCountdown === null) return;
    const t = setTimeout(() => {
      if (nextCountdown <= 1) {
        setNextCountdown(null);
        // onNextEpisode chama router.replace(...), que o Next.js processa
        // como uma transição de baixa prioridade. Chamar isso no MESMO
        // tick síncrono que o setNextCountdown(null) acima faz o React
        // batelar os dois — e o React pode descartar/atrasar a transição
        // de navegação em favor do update local, fazendo o toast sumir sem
        // trocar de episódio (só navegando bem mais tarde, de forma
        // solta, ex: no próximo clique). Mesma causa raiz do bug já
        // corrigido em onPause/no efeito de desmonte: nunca misturar um
        // router.replace/push com outro setState no mesmo tick síncrono.
        // Adiar pro próximo tick resolve.
        setTimeout(() => onNextEpisodeRef.current?.(), 0);
      } else {
        setNextCountdown(nextCountdown - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [nextCountdown]);

  function cancelNextEpisode() {
    setNextCountdown(null);
  }

  function handleReplay() {
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setEnded(false);
    setNextCountdown(null);
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (bufferedEnd / duration) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;

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
          situação mais comum (é por isso que o duplo-toque parecia nunca
          funcionar: só funcionava na rara janela em que os controles já
          tinham sumido sozinhos). isControlTarget continua filtrando
          cliques que caem em cima de um botão/slider de verdade. */}
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
        onTimeUpdate={(e) => {
          if (exitingRef.current) return;
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onProgress={handleProgress}
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
          // tocando). doSaveProgress já adia a parte que importa (ver sua
          // definição) — é por isso que chamar direto aqui é seguro.
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
          // navegador não conseguiu decodificar/abrir o arquivo (contêiner
          // não suportado, arquivo corrompido, MAS TAMBÉM uma resposta de
          // erro HTTP no lugar dos bytes do vídeo — ex: um 403/429/500 do
          // nosso próprio servidor) — para de girar o spinner pra sempre e
          // avisa em vez de travar. Guarda o MediaError de verdade (ver
          // playbackErrorDetail) pra não esconder qual dessas causas foi.
          //
          // Durante a saída (ver handleExit) a gente solta a mídia de
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

      {/* Independente de .player-overlay/controls-hidden de propósito — o
          feedback do seek tem que aparecer mesmo se os controles já
          sumiram por inatividade (é bem comum dar duplo-toque justo
          quando eles estão escondidos). pointer-events:none no CSS: nunca
          deve atrapalhar nenhum toque por baixo. */}
      {seekFlash && (
        <div key={seekFlash.id} className={`seek-flash seek-flash-${seekFlash.dir}`}>
          <div className="seek-flash-badge">
            {seekFlash.dir === "back" ? <Back10Icon /> : <Forward10Icon />}
            <span>10 segundos</span>
          </div>
        </div>
      )}

      {/* Fica fora da camada que soma opacity+pointer-events com o resto dos
          controles (.player-overlay) — mas ainda assim SOME visualmente
          junto com o resto por inatividade (classe "hidden" abaixo, só
          opacity). A diferença é só que aqui pointer-events continua
          "auto": sair do player precisa funcionar sempre, mesmo com os
          controles escondidos — não devia exigir um primeiro toque só pra
          "acordar" os controles antes de conseguir voltar. */}
      <div className={`player-top${overlayHidden ? " hidden" : ""}`}>
        <button onClick={handleExit} aria-label="Voltar">
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
                {playbackErrorDetail?.code === 2
                  ? // MEDIA_ERR_NETWORK: o navegador NÃO recebeu o arquivo de
                    // vídeo de verdade — algo entre ele e o servidor falhou
                    // (conexão caiu, CORS bloqueou, o servidor respondeu
                    // com erro em vez dos bytes do vídeo). Não é o formato.
                    "Falha de rede ao carregar o vídeo — não chegou a baixar o suficiente pra tocar. Verifique a conexão com o servidor e tente de novo."
                  : playbackErrorDetail?.code === 3
                    ? // MEDIA_ERR_DECODE: os bytes chegaram, mas o navegador
                      // não conseguiu decodificá-los (arquivo corrompido, ou
                      // um codec dentro do contêiner que ele não suporta).
                      "O navegador recebeu o arquivo mas não conseguiu decodificá-lo — o codec dentro dele pode não ser suportado, ou o arquivo está corrompido."
                    : "O formato do arquivo pode não ser compatível com o navegador (ex: .mkv não toca em Chrome/Safari — prefira .mp4 com vídeo H.264 e áudio AAC)."}
              </p>
              {playbackErrorDetail && (
                <p className="player-error-code">
                  Detalhe técnico: código {playbackErrorDetail.code ?? "?"} — {playbackErrorDetail.message}
                </p>
              )}
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
            ) : ended ? (
              <button className="player-playpause" onClick={handleReplay} aria-label="Assistir de novo">
                <ReplayIcon />
              </button>
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

      {/* Canto inferior direito, discreto (não bloqueia nada por baixo —
          diferente do antigo modal de "fim do vídeo", que cobria a tela
          inteira e travava até o botão de voltar). Só aparece com próximo
          episódio disponível; cancelar ou dar replay já limpa o estado. */}
      {nextCountdown !== null && (
        <div className="next-up-toast">
          <span>Iniciando o próximo em {nextCountdown}…</span>
          <button onClick={cancelNextEpisode}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
