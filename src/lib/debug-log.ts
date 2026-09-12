"use client";

/**
 * Liga/desliga o overlay de diagnóstico (ver DebugOverlay.tsx). Existe
 * porque a TV não tem DevTools acessível — sem isso, "o que a TV realmente
 * manda quando aperta o botão" é pura suposição. Fica em localStorage pra
 * sobreviver a navegação entre telas (é ligado na tela de perfis, mas o
 * mais útil é ver os eventos DENTRO do player).
 */

const KEY = "flow_debug_v1";
const EVENTO_MUDANCA = "flow-debug-changed";

export function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    return;
  }
  // Mesma aba: 'storage' só dispara em OUTRAS abas/documentos, nunca na que
  // fez a escrita — este evento próprio é o que avisa o overlay (que já
  // está montado na mesma página) que acabou de ser ligado/desligado.
  window.dispatchEvent(new Event(EVENTO_MUDANCA));
}

export { EVENTO_MUDANCA };
