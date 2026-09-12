"use client";

import { useEffect } from "react";

/**
 * Generic D-pad/remote spatial navigation, registered once for the whole
 * app (see ProfileProvider). Purely additive: only listens for keydown and
 * calls .focus() — never touches onClick/touch handlers, so mouse, touch
 * and existing keyboard (Tab, Enter) behavior is unchanged for web/mobile.
 * :focus-visible (used everywhere for the focus ring) already only
 * triggers for keyboard/programmatic focus, not mouse/touch clicks.
 *
 * Finds the nearest focusable element in the pressed direction by simple
 * geometry (bounding-box centers) instead of assuming any particular page
 * layout — works on the browse grid, hero, title detail, profile screen,
 * anywhere, with zero per-page wiring.
 *
 * Left/Right and the back key are skipped entirely while the video player
 * is open: VideoPlayer already has its own, more specific handling for them
 * (arrows = seek ±10s or adjust whatever control is focused, Escape/back =
 * exit) that would conflict with focus-jumping or global history.back().
 * Up/Down are NOT claimed by VideoPlayer at all, so they're left enabled
 * even inside the player — that's the only way to reach the progress bar,
 * volume, fullscreen etc. with a D-pad in the first place (there's no
 * Tab-equivalent on a TV remote): Down from the center controls reaches the
 * progress bar, Up goes back, same geometry-based logic as everywhere else.
 *
 * TIZEN_BACK_KEYCODE is the physical "Return" button on Samsung remotes
 * (not the same as Escape) — falls back to browser history.back(), which
 * is the natural "go back" for browse/title/profile screens. The player
 * has its own back handling for the same physical button (see
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
      cross = dy;
    } else if (direction === "right") {
      if (dx <= 1) continue;
      primary = dx;
      cross = dy;
    } else if (direction === "up") {
      if (dy >= -1) continue;
      primary = -dy;
      cross = dx;
    } else {
      if (dy <= 1) continue;
      primary = dy;
      cross = dx;
    }

    // Weighting cross-axis distance more heavily favors elements roughly
    // aligned on the perpendicular axis — the standard spatial-nav
    // heuristic (e.g. moving down a card grid keeps the same column).
    const score = primary + Math.abs(cross) * 2.5;
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
    function onKeyDown(e: KeyboardEvent) {
      const inPlayer = Boolean(document.querySelector(".player-shell"));

      if (e.keyCode === TIZEN_BACK_KEYCODE) {
        if (inPlayer) return; // VideoPlayer's own onKeyDown handles this.
        e.preventDefault();
        window.history.back();
        return;
      }

      const direction = ARROW_DIRECTIONS[e.key];
      if (!direction) return;
      // Left/Right belong entirely to VideoPlayer's own scheme while it's
      // open (global seek, or whatever control currently has focus).
      if (inPlayer && (direction === "left" || direction === "right")) return;
      if (moveFocus(direction)) e.preventDefault();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
