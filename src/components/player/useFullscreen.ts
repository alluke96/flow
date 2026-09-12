import { useCallback, useEffect, useState, type RefObject } from "react";
import type { WebkitVideoElement } from "./types";

export function useFullscreen(videoRef: RefObject<HTMLVideoElement | null>) {
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
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const v = videoRef.current as WebkitVideoElement | null;
    if (!v) return;

    // Prioridade invertida de propósito: tenta SEMPRE a Fullscreen API
    // padrão primeiro (no container, não no <video>), e só cai pro
    // webkitEnterFullscreen do <video> quando o padrão nem existe.
    //
    // Checar webkitEnterFullscreen primeiro pensando só em iOS Safari (que
    // de fato não implementa Fullscreen API padrão em elemento genérico
    // nenhum, só o <video> tem essa API própria da Apple) tem um problema:
    // o WebKit antigo de TVs Tizen TAMBÉM expõe webkitEnterFullscreen no
    // <video>, então o app pegaria esse caminho lá também — e nesse modo o
    // NAVEGADOR assume um player nativo próprio por cima do vídeo, com os
    // controles dele, não os nossos. É assim que somem os botões ±10s, a
    // barra de progresso e o overlay de debug: webkitEnterFullscreen troca
    // pra uma camada de renderização separada que cobre a página inteira,
    // então nada do nosso DOM aparece mais por cima. Checando
    // requestFullscreen no container primeiro, a TV (que TEM a API padrão,
    // só também tem a antiga) fica com os nossos próprios controles — e o
    // iOS, que não tem requestFullscreen em elemento genérico, cai pro
    // webkitEnterFullscreen do jeito de sempre.
    const container = v.closest(".player-shell");
    if (container instanceof HTMLElement && typeof container.requestFullscreen === "function") {
      if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
      return;
    }

    if (v.webkitEnterFullscreen) {
      if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen?.();
      else v.webkitEnterFullscreen();
    }
  }, [videoRef]);

  return { isFullscreen, toggleFullscreen };
}
