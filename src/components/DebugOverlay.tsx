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
const EVENTOS_DOCUMENTO = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "touchstart",
  "touchend",
  "keydown",
] as const;

// Eventos do próprio <video> que revelam o que acontece com a BUSCA em si
// (não com o clique que a pede). Ficam de fora de EVENTOS_DOCUMENTO de
// propósito: media events como "waiting"/"stalled"/"seeking" NÃO sobem
// (bubble) pro document — escutar só lá em cima nunca os pegaria, custe o
// que custar de capture. Precisam de listener direto no elemento.
const EVENTOS_VIDEO = [
  "seeking",
  "seeked",
  "waiting",
  "stalled",
  "suspend",
  "abort",
  "error",
  "canplay",
  // "emptied": dispara quando o recurso vira inutilizável de repente (ex:
  // a conexão caindo no meio de um redeploy do self-host) — quer testar
  // se currentTime/estado do progresso ficam bagunçados nesse instante.
  "emptied",
] as const;

/** "0.0-134.2, 200.0-210.0" — texto das faixas em video.seekable/buffered. */
function formatarRanges(ranges: TimeRanges): string {
  if (ranges.length === 0) return "(vazio)";
  const partes: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    partes.push(`${ranges.start(i).toFixed(1)}-${ranges.end(i).toFixed(1)}`);
  }
  return partes.join(", ");
}

function descreverAlvo(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const tag = el.tagName.toLowerCase();
  // O alvo de um clique num botão de ícone quase sempre é o <svg>/<path>
  // do desenho, não o <button> em si — e SVG não tem className string
  // (é um SVGAnimatedString), então sem isto toda entrada de ícone
  // aparecia só como "svg", indistinguível entre ±10s, play/pause,
  // voltar, tela cheia... closest("[aria-label]") sobe até achar o
  // botão de verdade por trás do desenho.
  const comLabel = el.closest("[aria-label]");
  const label = comLabel?.getAttribute("aria-label");
  if (label) {
    const tagLabel = comLabel!.tagName.toLowerCase();
    return tagLabel === tag ? `${tag}[${label}]` : `${tag}→${tagLabel}[${label}]`;
  }
  const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
  return cls ? `${tag}.${cls}` : tag;
}

/**
 * Overlay de diagnóstico: mostra ao vivo, na própria tela, todo evento de
 * clique/toque/tecla que o navegador da TV realmente entrega ao app, e o
 * que acontece com o <video> em si (busca, travamento de rede) — sem
 * precisar de DevTools, que não dá pra abrir na TV.
 *
 * Ativa/desativa tocando 5x no número da versão (ver ProfileScreen). Só
 * OBSERVA: escuta em fase de CAPTURA (pega o evento mesmo que algo no
 * caminho chame stopPropagation depois) e nunca chama preventDefault nem
 * stopPropagation — não muda em nada o funcionamento real do app, mesmo
 * ligado. `pointerEvents: none` garante que o quadro nem bloqueia cliques
 * por baixo dele.
 *
 * NÃO aparece durante o fullscreen NATIVO do <video> (webkitEnterFullscreen
 * — ver toggleFullscreen em VideoPlayer.tsx): esse modo é uma camada de
 * renderização separada do navegador, por cima de tudo, e nada do nosso
 * DOM (overlay incluído) consegue aparecer ali. Se for testar isto, deixe
 * o player no modo normal (sem fullscreen).
 */
export function DebugOverlay() {
  const [on, setOn] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const idRef = useRef(0);
  const t0Ref = useRef(0);
  const videoWireadoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const sync = () => setOn(isDebugEnabled());
    sync();
    window.addEventListener(EVENTO_MUDANCA, sync);
    return () => window.removeEventListener(EVENTO_MUDANCA, sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    t0Ref.current = Date.now();

    function push(type: string, alvo: string) {
      idRef.current += 1;
      setLog((prev) =>
        [{ id: idRef.current, t: Date.now() - t0Ref.current, type, alvo }, ...prev].slice(0, 20)
      );
    }

    function registrarDoc(e: Event) {
      push(e.type, descreverAlvo(e.target));
    }
    for (const tipo of EVENTOS_DOCUMENTO) document.addEventListener(tipo, registrarDoc, { capture: true });

    function registrarVideo(e: Event) {
      const v = e.currentTarget as HTMLVideoElement;
      push(e.type, `<video> t=${v.currentTime.toFixed(1)}`);
    }

    // Estado do <video> ao vivo (currentTime/duration/seeking/paused), e
    // liga os listeners de EVENTOS_VIDEO assim que o elemento aparece —
    // ele só existe depois de entrar no player, então precisa checar
    // periodicamente em vez de uma vez só no mount deste componente.
    const poll = setInterval(() => {
      const v = document.querySelector("video");
      if (!v) {
        setVideoInfo(null);
        videoWireadoRef.current = null;
        return;
      }
      setVideoInfo(
        `t=${v.currentTime.toFixed(1)}/${v.duration ? v.duration.toFixed(1) : "?"}` +
          ` seeking=${v.seeking} paused=${v.paused} readyState=${v.readyState}` +
          ` networkState=${v.networkState}` +
          `\nseekable=[${formatarRanges(v.seekable)}] buffered=[${formatarRanges(v.buffered)}]`
      );
      if (videoWireadoRef.current !== v) {
        videoWireadoRef.current = v;
        for (const tipo of EVENTOS_VIDEO) v.addEventListener(tipo, registrarVideo);
      }
    }, 300);

    return () => {
      for (const tipo of EVENTOS_DOCUMENTO) document.removeEventListener(tipo, registrarDoc, { capture: true });
      if (videoWireadoRef.current) {
        for (const tipo of EVENTOS_VIDEO) videoWireadoRef.current.removeEventListener(tipo, registrarVideo);
      }
      clearInterval(poll);
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
      {videoInfo && (
        <div style={{ color: "#ffd23d", marginBottom: 6, wordBreak: "break-all", whiteSpace: "pre-line" }}>
          vídeo: {videoInfo}
        </div>
      )}
      {log.length === 0 && <div style={{ color: "#888" }}>aguardando toque/clique/tecla…</div>}
      {log.map((e) => (
        <div key={e.id}>
          +{e.t}ms {e.type} → {e.alvo}
        </div>
      ))}
    </div>
  );
}
