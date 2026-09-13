"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Ponte pro player NATIVO da TV (webapis.avplay), usado só dentro da casca
 * Tizen (ver tizen/index.html).
 *
 * Por quê: o <video> HTML5 desta TV tem um bug confirmado (ver comentário
 * em parseRangeHeader, stream-utils.ts) — ele sabe que o arquivo é buscável
 * o inteiro (seekable cobre tudo), mas nunca chega a pedir os bytes de um
 * trecho ainda não baixado quando o usuário busca; só volta pro ponto
 * anterior, tanto num ±10s quanto na retomada de "continuar assistindo".
 * AVPlay é o motor de vídeo NATIVO da própria Samsung (o mesmo que apps
 * como Netflix usam nessas TVs) — ele fala direto com o pipeline de mídia
 * do aparelho, contornando esse bug específico do WebKit.
 *
 * webapis só existe no documento de TOPO do widget empacotado — nunca
 * dentro de um iframe de outra origem, que é exatamente onde o Flow roda
 * (http://ip-do-pc:3000 dentro do file:// da casca, ver tizen/index.html).
 * Por isso o vídeo em si é aberto e controlado LÁ, na casca; este módulo só
 * troca mensagens com ela via postMessage — abrir/tocar/pausar/buscar/
 * redimensionar de um lado, estado (tempo, duração, buffering...) do outro.
 *
 * Em qualquer lugar que não seja essa casca (PC, celular, navegador web,
 * ou até um Tizen mais antigo sem essa ponte), o handshake abaixo nunca
 * recebe resposta e o player cai de volta pro <video> normal sozinho —
 * este módulo nunca muda o comportamento de ninguém além da TV.
 */

const CANAL = "flow-tizen-avplay";
// Tempo máximo esperando a casca responder ao handshake antes de desistir e
// usar o <video> normal. Troca de mensagem dentro do mesmo processo (mesmo
// WebKit, duas janelas) é praticamente instantânea — esta margem é generosa
// de propósito, só pra cobrir uma casca lenta pra terminar de carregar.
const HANDSHAKE_TIMEOUT_MS = 1500;
const HANDSHAKE_RETRY_MS = 200;

export interface TizenPlayerState {
  currentTime: number; // segundos
  duration: number; // segundos
  paused: boolean;
  buffering: boolean;
  bufferedTime: number; // segundos, estimado a partir do progresso de buffer do AVPlay
  seeking: boolean;
  ended: boolean;
  error: string | null;
}

const ESTADO_INICIAL: TizenPlayerState = {
  currentTime: 0,
  duration: 0,
  paused: true,
  buffering: false,
  bufferedTime: 0,
  seeking: false,
  ended: false,
  error: null,
};

export interface TizenPlayerApi {
  open(url: string, startTime: number): void;
  play(): void;
  pause(): void;
  seekTo(time: number): void;
  setRect(x: number, y: number, width: number, height: number): void;
  setSpeed(rate: number): void;
  close(): void;
}

interface UseTizenPlayerResult {
  /** null = ainda checando se existe a casca; true/false = resultado final. */
  active: boolean | null;
  state: TizenPlayerState;
  api: TizenPlayerApi;
  /**
   * A CASCA_VERSAO que a própria casca (tizen/index.html) mandou junto com
   * o "ack" — null enquanto active não for true. Existe só pra diagnóstico
   * (ver DebugOverlay): confirma que o .wgt instalado na TV É de fato a
   * versão que você acabou de reinstalar, em vez de confiar só em "eu
   * reinstalei" — o handshake mostra a versão de verdade, não a que você
   * acha que devia estar lá.
   */
  shellVersion: string | null;
}

/**
 * Detecta a casca Tizen e, se existir, dá acesso ao AVPlay dela. Chame uma
 * vez por instância de VideoPlayer — o handshake roda de novo a cada
 * montagem, mas é barato e rápido (ver HANDSHAKE_TIMEOUT_MS).
 */
export function useTizenPlayer(): UseTizenPlayerResult {
  const [active, setActive] = useState<boolean | null>(null);
  const [state, setState] = useState<TizenPlayerState>(ESTADO_INICIAL);
  const [shellVersion, setShellVersion] = useState<string | null>(null);

  useEffect(() => {
    // Sem pai (não estamos dentro de um iframe) = com certeza não é a
    // casca Tizen. Resolve na hora, sem nem tentar o handshake — é o que
    // garante que PC/celular/navegador web nunca esperam nada aqui.
    if (typeof window === "undefined" || window.parent === window) {
      // Resolução síncrona de propósito: não existe handshake nenhum pra
      // esperar quando nem há um pai (não estamos num iframe) — é o caso
      // de PC/celular/navegador web, a maioria de longe.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(false);
      return;
    }

    let resolvido = false;

    function onMessage(e: MessageEvent) {
      const data = e.data as { channel?: string; type?: string } & Record<string, unknown>;
      if (!data || data.channel !== CANAL) return;

      if (data.type === "ack") {
        if (!resolvido) {
          resolvido = true;
          setActive(true);
        }
        if (typeof data.cascaVersao === "string") setShellVersion(data.cascaVersao);
        return;
      }

      if (data.type === "state") {
        setState({
          currentTime: Number(data.currentTime) || 0,
          duration: Number(data.duration) || 0,
          paused: Boolean(data.paused),
          buffering: Boolean(data.buffering),
          bufferedTime: Number(data.bufferedTime) || 0,
          seeking: Boolean(data.seeking),
          ended: Boolean(data.ended),
          error: typeof data.error === "string" ? data.error : null,
        });
      }
    }
    window.addEventListener("message", onMessage);

    // A casca pode ainda não ter terminado de montar o listener dela quando
    // este efeito roda — reenvia "ready" periodicamente até vir o "ack" em
    // vez de confiar num único disparo no instante certo.
    const retry = setInterval(() => {
      window.parent.postMessage({ channel: CANAL, type: "ready" }, "*");
    }, HANDSHAKE_RETRY_MS);
    window.parent.postMessage({ channel: CANAL, type: "ready" }, "*");

    const desistir = setTimeout(() => {
      if (!resolvido) setActive(false);
    }, HANDSHAKE_TIMEOUT_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(desistir);
    };
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage({ channel: CANAL, ...msg }, "*");
  }, []);

  // useMemo (não useRef) pra api ficar disponível de forma estável sem
  // acessar `.current` durante a renderização — só recria se `send` mudar,
  // e `send` é estável (deps vazias) pela vida toda do componente.
  const api = useMemo<TizenPlayerApi>(
    () => ({
      open: (url, startTime) => send({ type: "open", url, startTime }),
      play: () => send({ type: "play" }),
      pause: () => send({ type: "pause" }),
      seekTo: (time) => send({ type: "seek", time }),
      setRect: (x, y, width, height) => send({ type: "rect", x, y, width, height }),
      setSpeed: (rate) => send({ type: "speed", value: rate }),
      close: () => send({ type: "close" }),
    }),
    [send]
  );

  return { active, state, api, shellVersion };
}
