import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PASSO_BARRA } from "./constants";
import type { ProgressPreview } from "./types";

/**
 * Clique/arrasto na barra de progresso, e o preview de tempo que segue o
 * ponteiro. Durante o arrasto só o preview (visual) atualiza a cada
 * movimento — buscar a cada pixel faria um request novo pro Drive a cada
 * tick e travaria tudo; o seek de verdade só acontece uma vez, ao soltar
 * (ou na hora, num clique simples sem arrastar).
 */
export function useProgressBarDrag({
  duration,
  seekToPct,
  showOverlay,
}: {
  duration: number;
  seekToPct: (pct: number) => void;
  showOverlay: () => void;
}) {
  const progressRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragPctRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ProgressPreview | null>(null);

  function pctFromClientX(clientX: number): number {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
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
    // nele. Se ela fosse a primeira linha da função, a exceção abortaria
    // tudo antes de chegar no seekToPct, fazendo o clique não fazer nada.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // sem suporte/instável neste navegador — degrada bem: o clique simples
      // já funcionou acima, só um arrasto saindo da barra pode não continuar
      // sendo rastreado perfeitamente.
    }
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const pct = Math.min(Math.max(0, pctFromClientX(e.clientX)), 1);
    if (duration) setPreview({ pct, time: pct * duration });
    if (draggingRef.current) dragPctRef.current = pct;
  }

  function handlePointerUp() {
    if (draggingRef.current && dragPctRef.current !== null) {
      seekToPct(dragPctRef.current);
    }
    draggingRef.current = false;
    dragPctRef.current = null;
    setDragging(false);
    setPreview(null);
  }

  function handlePointerLeave() {
    if (!draggingRef.current) setPreview(null);
  }

  function handleKeyDown(
    e: KeyboardEvent,
    seekBy: (delta: number) => void,
    passoDeBusca: (direcao: 1 | -1, passoBase: number) => number
  ) {
    // Mesma aceleração das setas soltas (ver useSeekAcelerado), com passo
    // base menor: com a barra focada o ajuste começa mais fino, e segurar
    // continua sendo o jeito de atravessar o filme.
    if (e.key === "ArrowRight") seekBy(passoDeBusca(1, PASSO_BARRA));
    else if (e.key === "ArrowLeft") seekBy(passoDeBusca(-1, PASSO_BARRA));
  }

  return {
    progressRef,
    dragging,
    preview,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleKeyDown,
  };
}
