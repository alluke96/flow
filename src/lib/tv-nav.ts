"use client";

import { useEffect } from "react";
import { voltarNav } from "@/lib/nav";

/**
 * Generic D-pad/remote spatial navigation, registered once for the whole
 * app (see ProfileProvider). Purely additive: only listens for keydown and
 * calls .focus() — never touches onClick/touch handlers, so mouse, touch
 * and existing keyboard (Tab, Enter) behavior is unchanged for web/mobile.
 * The focus ring (see globals.css) already only shows up for
 * keyboard/programmatic focus, not mouse/touch clicks.
 *
 * Finds the nearest focusable element in the pressed direction by simple
 * geometry (bounding-box centers) instead of assuming any particular page
 * layout — works on the browse grid, hero, title detail, profile screen,
 * anywhere, with zero per-page wiring.
 *
 * Inside the video player, Left/Right have TWO jobs and the "controls
 * mode" below is what tells them apart:
 *
 * - While just watching (no controls in sight), Left/Right belong to
 *   VideoPlayer: seek ±10s, the one thing a remote should always be able
 *   to do without aiming at anything.
 * - Pressing Up or Down is the deliberate "I want the controls" gesture:
 *   from there on Left/Right walk the focus along the row, which is the
 *   ONLY way to reach play/pause at all. The player's controls sit in
 *   three horizontal rows (top bar, center, bottom), so without horizontal
 *   movement Up/Down alone can only ever reach whatever happens to be
 *   nearest in a straight line — in practice the back and mute buttons,
 *   with play/pause unreachable.
 *
 * Controls mode ends when the controls themselves auto-hide, so going back
 * to just watching restores seeking without any extra gesture. Every arrow
 * key keeps the controls on screen (see useKeyboardShortcuts), so it lasts
 * as long as the user is actually navigating.
 *
 * The back key is skipped in the player: VideoPlayer already exits on it.
 *
 * TIZEN_BACK_KEYCODE is the physical "Return" button on Samsung remotes
 * (not the same as Escape) — routed through voltarNav() (see lib/nav), the
 * only "go back" that works in BOTH contexts: browser history on the web,
 * the screen stack inside the Tizen widget (where there is no history to
 * go back to at all, since the whole app is a single file:// page). The
 * player has its own back handling for the same physical button (see
 * VideoPlayer's onKeyDown), so this is skipped there too.
 */
const TIZEN_BACK_KEYCODE = 10009;

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

function getFocusables(): HTMLElement[] {
  const nodes = document.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter(isFocusable);
}

/**
 * Distância entre duas FAIXAS num eixo — 0 quando elas se sobrepõem.
 *
 * É isto, e não a distância entre os centros, que decide o alinhamento na
 * navegação abaixo. A diferença aparece em elemento largo: a barra de
 * progresso ocupa a tela toda e tem centro no meio dela, então pelo centro
 * ela parecia longe de qualquer botão do canto — subindo do botão de mudo
 * (canto inferior esquerdo) o foco pulava a barra inteira e ia parar no
 * botão de voltar, lá no topo. Pela faixa, ela está exatamente acima, que
 * é o que o olho vê.
 */
function folga(aIni: number, aFim: number, bIni: number, bFim: number): number {
  if (bFim < aIni) return aIni - bFim;
  if (bIni > aFim) return bIni - aFim;
  return 0;
}

function moveFocus(direction: "up" | "down" | "left" | "right"): boolean {
  const active = document.activeElement;
  const focusables = getFocusables();
  if (!focusables.length) return false;

  if (!(active instanceof HTMLElement) || !focusables.includes(active)) {
    // Nothing meaningful focused yet — jump into the first focusable
    // element so testing with a keyboard/remote doesn't require Tab first.
    focusables[0].focus();
    return true;
  }

  const from = active.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of focusables) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - fx;
    const dy = ey - fy;

    let primary: number;
    let cross: number;
    if (direction === "left") {
      if (dx >= -1) continue;
      primary = -dx;
      cross = folga(from.top, from.bottom, r.top, r.bottom);
    } else if (direction === "right") {
      if (dx <= 1) continue;
      primary = dx;
      cross = folga(from.top, from.bottom, r.top, r.bottom);
    } else if (direction === "up") {
      if (dy >= -1) continue;
      primary = -dy;
      cross = folga(from.left, from.right, r.left, r.right);
    } else {
      if (dy <= 1) continue;
      primary = dy;
      cross = folga(from.left, from.right, r.left, r.right);
    }

    // Weighting cross-axis distance more heavily favors elements roughly
    // aligned on the perpendicular axis — the standard spatial-nav
    // heuristic (e.g. moving down a card grid keeps the same column).
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

const ARROW_DIRECTIONS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function useTVNav() {
  useEffect(() => {
    // See the comment at the top: only Up/Down turn this on, and the
    // controls hiding turns it off.
    let controlsMode = false;

    function onKeyDown(e: KeyboardEvent) {
      const inPlayer = Boolean(document.querySelector(".player-shell"));

      if (e.keyCode === TIZEN_BACK_KEYCODE) {
        if (inPlayer) return; // VideoPlayer's own onKeyDown handles this.
        e.preventDefault();
        voltarNav();
        return;
      }

      const direction = ARROW_DIRECTIONS[e.key];
      if (!direction) return;

      // Left/Right belong to whatever is focused when that element uses
      // them itself: the progress bar (role="slider", ±5s), the speed
      // <select>, the volume <input type=range>. Moving the focus away on
      // those keys would make the control impossible to operate with a
      // remote — Up/Down still leave it.
      const active = document.activeElement;
      const tag = active?.tagName;
      const usesArrows =
        tag === "SELECT" || tag === "INPUT" || active?.getAttribute("role") === "slider";
      if (usesArrows && (direction === "left" || direction === "right")) return;

      if (inPlayer) {
        if (document.querySelector(".player-overlay.hidden")) controlsMode = false;
        if (direction === "up" || direction === "down") controlsMode = true;
        // Not in controls mode: Left/Right are VideoPlayer's seek. Leaving
        // the event untouched (no preventDefault) is what says so — that's
        // the handshake useKeyboardShortcuts reads.
        else if (!controlsMode) return;
      }

      if (moveFocus(direction)) e.preventDefault();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
