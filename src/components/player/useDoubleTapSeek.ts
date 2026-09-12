import { useRef, type MouseEvent, type TouchEvent } from "react";
import { DOUBLE_TAP_MS } from "./constants";
import type { SeekFlashState } from "./types";

/**
 * Duplo-toque nas metades esquerda/direita da tela = -10s/+10s (o mesmo
 * gesto do YouTube/Netflix no celular). Clique/toque simples no vídeo NÃO
 * alterna play/pause — só o botão dedicado (.player-center) faz isso; um
 * toque na área do vídeo era fácil demais de disparar sem querer (segurar
 * o celular, um duplo-toque que "vazava" um toque simples primeiro, etc.),
 * e cada vez que isso acontecia bem no meio de outra coisa (uma troca de
 * rota, por exemplo) era mais uma chance de esbarrar na classe de bug do
 * botão de voltar que já perseguimos várias vezes nesta base de código. Só
 * acorda os controles (showOverlay) — bem mais previsível.
 */
export function useDoubleTapSeek({
  seekBy,
  triggerSeekFlash,
  showOverlay,
}: {
  seekBy: (delta: number) => void;
  triggerSeekFlash: (dir: SeekFlashState["dir"]) => void;
  showOverlay: () => void;
}) {
  const lastTapRef = useRef<{ t: number } | null>(null);

  // Element, não HTMLElement: os ícones dos botões (voltar, play/pause,
  // ±10s, mudo, tela cheia...) são <svg>/<path>, que são SVGElement — uma
  // hierarquia de classes SEPARADA de HTMLElement no navegador (uma não é
  // instância da outra). Com o check em HTMLElement, um clique que
  // acertasse o desenho do ícone (o alvo visual óbvio de qualquer botão)
  // nunca passava no closest() abaixo — a exclusão simplesmente não rodava
  // — e o clique vazava pra handleVideoAreaClick, disparando togglePlay()
  // junto. Element é a interface comum a HTML e SVG — closest() existe
  // nela pros dois.
  function isControlTarget(el: EventTarget | null): boolean {
    return el instanceof Element
      ? Boolean(el.closest("button, .progress-bar, .volume-slider, .rate-select"))
      : false;
  }

  function handleVideoAreaClick(e: MouseEvent) {
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
      triggerSeekFlash(isLeft ? "back" : "fwd");
    } else {
      lastTapRef.current = { t: now };
    }
  }

  return { handleVideoAreaClick, handleTouchEnd };
}
