"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Player NATIVO da TV (webapis.avplay), usado quando o Flow roda dentro do
 * app Tizen empacotado.
 *
 * Por que existe: o <video> HTML5 desta TV tem um bug confirmado (ver o
 * comentário em parseRangeHeader, stream-utils.ts) — ele sabe que o arquivo
 * é buscável o inteiro (`seekable` cobre tudo), mas nunca chega a pedir os
 * bytes de um trecho ainda não baixado quando o usuário busca; só volta pro
 * ponto anterior, tanto num ±10s quanto na retomada de "continuar
 * assistindo". AVPlay é o motor de vídeo nativo da própria Samsung (o mesmo
 * que apps como Netflix usam nessas TVs): fala direto com o pipeline de
 * mídia do aparelho, contornando esse bug do WebKit.
 *
 * `webapis` só existe no documento de TOPO de um widget empacotado. Por
 * isso o app agora VAI DENTRO do .wgt (ver scripts/build-tizen.mjs) em vez
 * de ser carregado num <iframe> a partir do PC: dentro do iframe esse
 * objeto simplesmente não existe, e a ponte por postMessage que tentava
 * contornar isso nunca entregou mensagem nenhuma nesta TV.
 *
 * Em qualquer outro lugar (PC, celular, navegador web, ou a TV abrindo o
 * site pelo navegador) `webapis` não existe, `active` resolve pra false e o
 * player usa o <video> normal — este módulo não muda nada fora do widget.
 */

/** Só o pedaço da API do AVPlay que este módulo usa. */
interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (ms: number) => void;
  onstreamcompleted?: () => void;
  onerror?: (erro: string) => void;
  onevent?: (tipo: string, dados: string) => void;
  onsubtitlechange?: () => void;
  ondrmevent?: () => void;
}

interface AVPlay {
  open(url: string): void;
  close(): void;
  stop(): void;
  prepareAsync(ok: () => void, erro: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  seekTo(ms: number, ok?: () => void, erro?: (e: unknown) => void): void;
  setDisplayRect(x: number, y: number, largura: number, altura: number): void;
  setDisplayMethod(metodo: string): void;
  setListener(listener: AVPlayListener): void;
  setSpeed(valor: number): void;
  getDuration(): number;
  getCurrentTime(): number;
}

declare global {
  interface Window {
    webapis?: { avplay?: AVPlay };
  }
}

/**
 * Manda uma linha pro log do servidor (ver /api/tizen-debug, que a escreve
 * no flow.log). Dentro do widget não existe console alcançável — a TV não
 * expõe DevTools e `sdb dlog` não devolve nada nela —, então isto é a única
 * forma de uma falha silenciosa aqui dentro deixar rastro.
 *
 * `new Image()` em vez de fetch: dispara o GET e não liga pra resposta, sem
 * depender de CORS nem de nada mais estar funcionando.
 */
function logarServidor(mensagem: string): void {
  try {
    const servidor = process.env.NEXT_PUBLIC_FLOW_SERVER ?? "";
    const img = new Image();
    img.src = `${servidor}/api/tizen-debug?msg=${encodeURIComponent("[avplay] " + mensagem)}`;
  } catch {
    // sem rede/sem servidor: não há mais nada a fazer, e o log nunca pode
    // ser o motivo de uma falha nova
  }
}

function pegarAvplay(): AVPlay | null {
  if (typeof window === "undefined") return null;
  return window.webapis?.avplay ?? null;
}

// Com que frequência o estado do AVPlay (que chega por callbacks, bem mais
// rápido que isso) vira estado do React. 4x/s é fluido pra barra de
// progresso/relógio sem re-renderizar o player à toa.
const INTERVALO_ESTADO_MS = 250;
// Teto pra esperar o seek de retomada antes de dar play assim mesmo — mesma
// ideia (e mesmo valor) do caminho do <video>, ver RESUME_SEEK_TIMEOUT_MS.
const TIMEOUT_SEEK_RETOMADA_MS = 3000;

export interface TizenPlayerState {
  currentTime: number; // segundos
  duration: number; // segundos
  paused: boolean;
  buffering: boolean;
  bufferedTime: number; // segundos, estimado pelo progresso de buffer do AVPlay
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
  /** null = ainda checando (só até o primeiro efeito); true/false = final. */
  active: boolean | null;
  state: TizenPlayerState;
  api: TizenPlayerApi;
  /** Versão do app empacotado — diagnóstico, ver DebugOverlay. */
  shellVersion: string | null;
}

/**
 * Detecta o AVPlay e, se existir, dá o controle dele. Chame uma vez por
 * instância de VideoPlayer.
 */
export function useTizenPlayer(): UseTizenPlayerResult {
  const [active, setActive] = useState<boolean | null>(null);
  const [state, setState] = useState<TizenPlayerState>(ESTADO_INICIAL);

  // Espelho mutável: os callbacks do AVPlay disparam muito mais rápido que o
  // ciclo de render, então eles escrevem aqui e um intervalo publica isso no
  // estado do React (ver INTERVALO_ESTADO_MS).
  const estadoRef = useRef<TizenPlayerState>({ ...ESTADO_INICIAL });
  const abertoRef = useRef(false);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    // Sem detecção assíncrona nenhuma: ou o objeto nativo está aqui, ou não
    // está. (A versão anterior deste módulo dependia de um handshake por
    // postMessage com uma casca em iframe — que nesta TV nunca respondeu.)
    //
    // Fica num efeito, e não direto no corpo do componente, porque `webapis`
    // só existe no navegador: decidir isso durante a renderização faria o
    // HTML pré-gerado no build divergir do que o cliente monta (hydration
    // mismatch). É sincronização com um sistema externo — o caso que a regra
    // abaixo existe pra permitir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(pegarAvplay() !== null);
  }, []);

  // Publica o espelho no estado do React enquanto houver mídia aberta.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setState({ ...estadoRef.current });
    }, INTERVALO_ESTADO_MS);
    return () => clearInterval(t);
  }, [active]);

  const fechar = useCallback(() => {
    const avplay = pegarAvplay();
    if (avplay && abertoRef.current) {
      try {
        avplay.stop();
      } catch {
        // já parado/nunca tocou — nada a fazer
      }
      try {
        avplay.close();
      } catch {
        // idem: fechar duas vezes não é erro que importe aqui
      }
    }
    abertoRef.current = false;
    estadoRef.current = { ...ESTADO_INICIAL };
  }, []);

  const abrir = useCallback(
    (url: string, startTime: number) => {
      const avplay = pegarAvplay();
      if (!avplay) return;
      fechar();

      try {
        avplay.open(url);
        // LETTER_BOX preserva a proporção do vídeo dentro do retângulo (em
        // vez de esticar pra preencher, que distorce em conteúdo que não
        // seja exatamente 16:9).
        avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
        const r = rectRef.current;
        if (r) avplay.setDisplayRect(r.x, r.y, r.width, r.height);

        avplay.setListener({
          onbufferingstart: () => {
            estadoRef.current.buffering = true;
          },
          onbufferingprogress: (percent) => {
            estadoRef.current.buffering = true;
            if (estadoRef.current.duration) {
              estadoRef.current.bufferedTime = (estadoRef.current.duration * percent) / 100;
            }
          },
          onbufferingcomplete: () => {
            estadoRef.current.buffering = false;
          },
          oncurrentplaytime: (ms) => {
            estadoRef.current.currentTime = ms / 1000;
          },
          onstreamcompleted: () => {
            estadoRef.current.ended = true;
            estadoRef.current.paused = true;
            try {
              avplay.stop();
            } catch {
              // fim normal da mídia — se já parou sozinho, tudo bem
            }
          },
          onerror: (erro) => {
            estadoRef.current.error = String(erro);
          },
        });

        abertoRef.current = true;

        avplay.prepareAsync(
          () => {
            const duracaoMs = avplay.getDuration();
            estadoRef.current.duration = duracaoMs / 1000;

            function comecar() {
              // Relê o objeto em vez de fechar sobre o `avplay` de fora:
              // dentro de uma function declaration o TypeScript não mantém
              // o estreitamento de tipo do null-check lá de cima.
              const player = pegarAvplay();
              if (!player) return;
              try {
                player.play();
              } catch {
                // se play() falhar aqui, o estado de erro do listener é
                // quem vai contar a história — não adianta insistir
              }
              estadoRef.current.paused = false;
              estadoRef.current.seeking = false;
            }

            // Retomada ("continuar assistindo"): busca ANTES de tocar, com
            // uma reconferência se pousar longe do pedido, e um teto de
            // tempo pra nunca ficar preso esperando um callback que pode
            // não vir. Mesma lógica do caminho do <video> (ver
            // useResumePlayback).
            const alvoMs = Math.round(startTime * 1000);
            if (startTime > 1 && alvoMs < duracaoMs - 2000) {
              estadoRef.current.seeking = true;
              let tentouDeNovo = false;
              let comecou = false;
              const desistir = setTimeout(() => {
                if (!comecou) {
                  comecou = true;
                  comecar();
                }
              }, TIMEOUT_SEEK_RETOMADA_MS);

              const aposSeek = () => {
                if (comecou) return;
                const atualMs = avplay.getCurrentTime();
                if (Math.abs(atualMs - alvoMs) > 5000 && !tentouDeNovo) {
                  tentouDeNovo = true;
                  avplay.seekTo(alvoMs, aposSeek, aposSeek);
                  return;
                }
                comecou = true;
                clearTimeout(desistir);
                comecar();
              };
              avplay.seekTo(alvoMs, aposSeek, aposSeek);
            } else {
              comecar();
            }
          },
          (erro) => {
            estadoRef.current.error = "Falha ao preparar o vídeo: " + String(erro);
          }
        );
      } catch (e) {
        estadoRef.current.error = "AVPlay falhou ao abrir: " + String(e);
      }
    },
    [fechar]
  );

  const api = useMemo<TizenPlayerApi>(
    () => ({
      open: abrir,
      play() {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.play();
          estadoRef.current.paused = false;
        } catch {
          // estado inválido pra tocar (ex: mídia já fechada) — ignora
        }
      },
      pause() {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.pause();
          estadoRef.current.paused = true;
        } catch {
          // idem
        }
      },
      seekTo(time) {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        // `seeking` PRECISA voltar pra false em todos os caminhos —
        // sucesso, erro e exceção. Travado em true, doSaveProgress (ver
        // useProgressPersistence, ramo nativo) se recusa a salvar
        // progresso, e aí nenhum save da sessão inteira acontece depois do
        // primeiro ±10s: nem o periódico de 5s, nem o final ao sair. O
        // efeito prático é "continuar assistindo" resumindo de bem antes
        // do primeiro seek, quase sempre perto do início (pular a abertura
        // costuma ser a primeira coisa que se faz). Foi exatamente esse o
        // bug na versão anterior deste bridge, que passava só o callback de
        // sucesso.
        estadoRef.current.seeking = true;
        const pronto = () => {
          estadoRef.current.seeking = false;
        };
        try {
          avplay.seekTo(Math.round(time * 1000), pronto, (erro) => {
            pronto();
            // Falha de busca não é falha de reprodução: o vídeo segue
            // tocando de onde estava, então NÃO vira `error` (que jogaria
            // a tela de "não foi possível reproduzir" por cima de um vídeo
            // que está tocando). Registra no log do servidor, que é a
            // única janela pra dentro do widget.
            logarServidor(`seekTo(${Math.round(time * 1000)}ms) falhou: ${String(erro)}`);
          });
        } catch (e) {
          pronto();
          logarServidor(`seekTo lançou: ${String(e)}`);
        }
      },
      setRect(x, y, width, height) {
        rectRef.current = { x, y, width, height };
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.setDisplayRect(x, y, width, height);
        } catch {
          // rect inválido (ex: elemento ainda sem layout) — a próxima
          // medida corrige
        }
      },
      setSpeed(rate) {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.setSpeed(rate);
        } catch {
          // nem todo conteúdo aceita trick play — segue em 1x
        }
      },
      close: fechar,
    }),
    [abrir, fechar]
  );

  const shellVersion = useMemo(
    () => (process.env.NEXT_PUBLIC_FLOW_VERSAO ? `app ${process.env.NEXT_PUBLIC_FLOW_VERSAO}` : null),
    []
  );

  return { active, state, api, shellVersion };
}
