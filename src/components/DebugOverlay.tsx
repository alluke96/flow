"use client";

import { useEffect, useRef, useState } from "react";
import { isDebugEnabled, EVENTO_MUDANCA } from "@/lib/debug-log";

interface LogEntry {
  id: number;
  t: number;
  type: string;
  alvo: string;
}

// Cobre os dois vocabulários de entrada (mouse "de verdade" e touch/pointer
// unificado) porque não sabemos de antemão qual deles a TV usa pra
// simular o clique — é exatamente essa incerteza que este overlay existe
// pra resolver com dado real, em vez de mais suposição.
const EVENTOS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "touchstart",
  "touchend",
  "keydown",
] as const;

function descreverAlvo(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const tag = el.tagName.toLowerCase();
  const label = el.getAttribute("aria-label");
  const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
  return label ? `${tag}[${label}]` : cls ? `${tag}.${cls}` : tag;
}

/**
 * Overlay de diagnóstico: mostra ao vivo, na própria tela, todo evento de
 * clique/toque/tecla que o navegador da TV realmente entrega ao app — sem
 * precisar de DevTools, que não dá pra abrir na TV.
 *
 * Ativa/desativa tocando 5x no número da versão (ver ProfileScreen). Só
 * OBSERVA: escuta em fase de CAPTURA (pega o evento mesmo que algo no
 * caminho chame stopPropagation depois) e nunca chama preventDefault nem
 * stopPropagation — não muda em nada o funcionamento real do app, mesmo
 * ligado. `pointerEvents: none` garante que o quadro nem bloqueia cliques
 * por baixo dele.
 */
export function DebugOverlay() {
  const [on, setOn] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const idRef = useRef(0);
  const t0Ref = useRef(0);

  useEffect(() => {
    const sync = () => setOn(isDebugEnabled());
    sync();
    window.addEventListener(EVENTO_MUDANCA, sync);
    return () => window.removeEventListener(EVENTO_MUDANCA, sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    t0Ref.current = Date.now();
    function registrar(e: Event) {
      idRef.current += 1;
      const entrada: LogEntry = {
        id: idRef.current,
        t: Date.now() - t0Ref.current,
        type: e.type,
        alvo: descreverAlvo(e.target),
      };
      setLog((prev) => [entrada, ...prev].slice(0, 18));
    }
    for (const tipo of EVENTOS) document.addEventListener(tipo, registrar, { capture: true });
    return () => {
      for (const tipo of EVENTOS) document.removeEventListener(tipo, registrar, { capture: true });
    };
  }, [on]);

  if (!on) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 999999,
        width: 320,
        maxHeight: "72vh",
        overflow: "hidden",
        background: "rgba(0,0,0,0.9)",
        color: "#3ddc4a",
        font: "13px/1.5 monospace",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid #3ddc4a",
        pointerEvents: "none",
      }}
    >
      <div style={{ color: "#fff", marginBottom: 4 }}>
        DEBUG — toque 5x na versão pra desligar
      </div>
      {log.length === 0 && <div style={{ color: "#888" }}>aguardando toque/clique/tecla…</div>}
      {log.map((e) => (
        <div key={e.id}>
          +{e.t}ms {e.type} → {e.alvo}
        </div>
      ))}
    </div>
  );
}
