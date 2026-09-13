import { useEffect } from "react";
import { TIZEN_BACK_KEYCODE } from "./constants";

/**
 * Espaço (play/pause), setas (±10s) e Esc/botão físico de voltar da TV
 * (exit). Registrado no document, não no player, pra funcionar não importa
 * onde o foco esteja.
 *
 * Divide as setas com a navegação por controle remoto (ver tv-nav.ts):
 * enquanto os controles estão escondidos, Esquerda/Direita são busca ±10s;
 * com eles à vista depois de um Cima/Baixo, andam com o foco pela linha —
 * e aí chegam aqui já com defaultPrevented, que é como este handler sabe
 * que não deve buscar também.
 */
export function useKeyboardShortcuts({
  showOverlay,
  togglePlay,
  seekBy,
  handleExit,
}: {
  showOverlay: () => void;
  togglePlay: () => void;
  seekBy: (delta: number) => void;
  handleExit: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Qualquer tecla conta como atividade e acorda os controles — sem
      // isso, só onMouseMove resetava o timer de auto-esconder. Um controle
      // remoto de TV nunca dispara mousemove, então depois de ~3s os
      // controles (inclusive o botão de voltar, que também some
      // visualmente) ficavam com pointer-events:none, parecendo
      // "quebrados": Cima/Baixo (usados pra navegar entre eles, ver
      // tv-nav.ts) eram as únicas teclas que não passavam por aqui pra
      // reativar o overlay.
      showOverlay();

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // A barra de progresso (role="slider", uma <div>, não pega no check
      // de tag abaixo) tem seu próprio onKeyDown (±5s, ver
      // useProgressBarDrag) — sem essa exclusão aqui, focar nela e apertar
      // seta disparava OS DOIS handlers pra mesma tecla (±5 dali, ±10 daqui),
      // somando 15s por vez em vez de avançar do jeito certo.
      const isSlider = target?.getAttribute("role") === "slider";
      // Só exclui campos com uso NATIVO próprio pra seta (o <select> de
      // velocidade navega opções, o <input type=range> do volume muda de
      // valor) — um <button> comum (play/pause, ±10s, mudo, tela cheia...)
      // não tem comportamento nativo pra seta nenhum, então não deveria
      // bloquear o seek global. Isso importa de verdade num controle de TV:
      // excluir BUTTON aqui deixaria ArrowLeft/Right sem efeito nenhum
      // sempre que o foco estivesse em qualquer botão do player, ou seja,
      // na prática o tempo todo no controle remoto.
      const isRealFormControl = tag === "SELECT" || tag === "INPUT";
      // Seta já consumida pela navegação por controle remoto (ver tv-nav.ts:
      // com os controles à vista, Esquerda/Direita andam com o FOCO pela
      // linha de botões em vez de buscar). O preventDefault de lá é o
      // combinado — sem ler isto aqui, a mesma tecla moveria o foco E
      // pularia 10s.
      const jaTratada = e.defaultPrevented;
      if ((e.key === " " || e.code === "Space") && !isRealFormControl) {
        e.preventDefault();
        togglePlay();
        showOverlay();
      } else if (e.key === "ArrowRight" && !isRealFormControl && !isSlider && !jaTratada) {
        seekBy(10);
      } else if (e.key === "ArrowLeft" && !isRealFormControl && !isSlider && !jaTratada) {
        seekBy(-10);
      } else if (e.key === "Escape" || e.keyCode === TIZEN_BACK_KEYCODE) {
        handleExit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showOverlay, togglePlay, seekBy, handleExit]);
}
