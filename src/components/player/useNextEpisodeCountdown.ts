import { useCallback, useEffect, useRef, useState } from "react";
import { NEXT_EPISODE_COUNTDOWN_S } from "./constants";

/**
 * Contagem regressiva pro próximo episódio: um segundo por vez. O setState
 * que zera o estado e dispara onNextEpisode acontece dentro do callback do
 * setTimeout (assíncrono), nunca direto no corpo do efeito — evita disparar
 * duas vezes e mantém só uma fonte de verdade pro "acabou a contagem".
 * Cancelar (ou dar replay) também só zera esse estado.
 */
export function useNextEpisodeCountdown(onNextEpisode?: () => void) {
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  // onNextEpisode costuma ser uma closure inline, nova a cada render do
  // componente pai — trocando de identidade sempre que ele re-renderiza por
  // qualquer motivo (ex: o próprio doSaveProgress mexendo no contexto de
  // perfis). Se ela estivesse nas deps do efeito abaixo, cada uma dessas
  // trocas reiniciaria o setTimeout de 1s do zero, e a contagem podia nunca
  // chegar a disparar de verdade. Uma ref sempre aponta pra versão mais
  // recente sem forçar o efeito a re-rodar por causa dela.
  const onNextEpisodeRef = useRef(onNextEpisode);
  useEffect(() => {
    onNextEpisodeRef.current = onNextEpisode;
  }, [onNextEpisode]);

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
        // solta, ex: no próximo clique). Mesma causa raiz de outros bugs já
        // corrigidos nesta base (onPause, o efeito de desmonte): nunca
        // misturar um router.replace/push com outro setState no mesmo tick
        // síncrono. Adiar pro próximo tick resolve.
        setTimeout(() => onNextEpisodeRef.current?.(), 0);
      } else {
        setNextCountdown(nextCountdown - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [nextCountdown]);

  const startCountdown = useCallback(() => setNextCountdown(NEXT_EPISODE_COUNTDOWN_S), []);
  const cancelCountdown = useCallback(() => setNextCountdown(null), []);

  return { nextCountdown, startCountdown, cancelCountdown };
}
