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

/**
 * Erro do AVPlay em texto. As exceções dele vêm como WebAPIException, cujo
 * String() só diz "[object Object]" — o que interessa (`name`, `message`)
 * fica nas propriedades.
 */
function descreverErro(e: unknown): string {
  if (e && typeof e === "object") {
    const obj = e as { name?: string; message?: string; code?: number };
    return `${obj.name ?? "erro"}: ${obj.message ?? "(sem mensagem)"}${obj.code != null ? ` (code ${obj.code})` : ""}`;
  }
  return String(e);
}

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
  // Saltos RELATIVOS, a forma que a própria Samsung recomenda pro ±10s.
  // Opcionais no tipo porque modelos antigos podem não trazer os dois — o
  // código cai no seekTo quando faltarem.
  jumpForward?(ms: number, ok?: () => void, erro?: (e: unknown) => void): void;
  jumpBackward?(ms: number, ok?: () => void, erro?: (e: unknown) => void): void;
  /** "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED" — só diagnóstico. */
  getState?(): string;
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
/** Estado do player pro log ("PLAYING", "PAUSED", "IDLE"...). */
function estadoNativo(avplay: AVPlay): string {
  try {
    return avplay.getState ? avplay.getState() : "(sem getState)";
  } catch {
    return "(getState falhou)";
  }
}

export function logarServidor(mensagem: string): void {
  // Só DENTRO do widget. Sem esta guarda, agora que o log é usado também
  // pelo salvamento de progresso (compartilhado com a web), todo navegador
  // de PC e celular passaria a escrever no flow.log do servidor a cada 5
  // segundos de vídeo.
  if (typeof window === "undefined") return;
  if (!window.webapis && window.location.protocol !== "file:") return;
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
/**
 * Quanto esperar antes de reabrir o vídeo no ponto pedido, depois que a TV
 * recusa uma busca. Serve pra juntar vários toques seguidos no ±10s numa
 * reabertura só — sem isso, cinco toques seriam cinco recarregamentos.
 */
const ATRASO_REABERTURA_MS = 900;
/** Teto pra barra ficar parada no ponto pedido esperando a reabertura. */
const LIMITE_ALVO_PENDENTE_MS = 20000;
/** De quanto em quanto tempo o player nativo se reporta pro flow.log. */
const BATIMENTO_MS = 10000;
/** Quanto esperar, já tocando, pra conferir se a retomada pegou. */
const ESPERA_CONFERIR_RETOMADA_MS = 2500;

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
  /** ±N segundos a partir de onde está — ver o porquê na implementação. */
  seekBy(delta: number): void;
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
  const urlRef = useRef<string | null>(null);
  // Ponto pra onde o vídeo está indo por REABERTURA (ver agendarReabertura):
  // enquanto está marcado, é ele que a interface mostra, não o tempo do
  // player — que ainda é o de antes do pulo, ou zero durante a recarga.
  const alvoPendenteRef = useRef<number | null>(null);
  const alvoPendenteDesdeRef = useRef(0);
  const timerReaberturaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Publica o espelho no estado do React enquanto houver mídia aberta — e,
  // antes de publicar, PERGUNTA o tempo ao player em vez de só esperar o
  // callback `oncurrentplaytime`.
  //
  // Perguntar é o que torna tudo abaixo independente de um callback que
  // pode simplesmente não vir neste aparelho. Com o espelho parado em
  // zero, nada acusa nada: a barra fica no começo, o ±10s vira "seek pra
  // 10s" (parece que o botão não faz nada) e o progresso nunca é salvo,
  // porque duração 0 é lida como "vídeo ainda não carregado". getCurrentTime
  // e getDuration são síncronos e baratos, e a cada 250ms não pesam.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const avplay = pegarAvplay();
      if (avplay && abertoRef.current) {
        try {
          const ms = avplay.getCurrentTime();
          if (typeof ms === "number" && ms >= 0) {
            const alvo = alvoPendenteRef.current;
            const desistiuDeEsperar = Date.now() - alvoPendenteDesdeRef.current > LIMITE_ALVO_PENDENTE_MS;
            if (alvo === null) {
              estadoRef.current.currentTime = ms / 1000;
            } else if (Math.abs(ms / 1000 - alvo) < 5 || desistiuDeEsperar) {
              // Chegou onde foi pedido — ou não chegou e já passou tempo
              // demais (a reabertura também não pegou): de um jeito ou de
              // outro, voltar a mostrar o tempo real é melhor que uma barra
              // congelada num ponto onde o vídeo não está.
              alvoPendenteRef.current = null;
              estadoRef.current.currentTime = ms / 1000;
            } else {
              estadoRef.current.currentTime = alvo;
            }
          }
          const durMs = avplay.getDuration();
          if (typeof durMs === "number" && durMs > 0) estadoRef.current.duration = durMs / 1000;
        } catch {
          // player entre estados (fechando, trocando de mídia): a próxima
          // volta do intervalo lê de novo
        }
      }
      setState({ ...estadoRef.current });
    }, INTERVALO_ESTADO_MS);
    return () => clearInterval(t);
  }, [active]);

  // Batimento pro log do servidor enquanto toca: é a única forma de ver, de
  // fora, o que o player nativo está fazendo (a TV não tem console
  // alcançável). Sai a cada BATIMENTO_MS e só com mídia aberta.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const avplay = pegarAvplay();
      if (!avplay || !abertoRef.current) return;
      const e = estadoRef.current;
      let estadoNativo = "?";
      try {
        estadoNativo = avplay.getState ? avplay.getState() : "(sem getState)";
      } catch {
        estadoNativo = "(getState falhou)";
      }
      logarServidor(
        `t=${e.currentTime.toFixed(1)}/${e.duration.toFixed(1)} estado=${estadoNativo}` +
          ` pausado=${e.paused} buffering=${e.buffering} seeking=${e.seeking}` +
          (e.error ? ` erro=${e.error}` : "")
      );
    }, BATIMENTO_MS);
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

  /**
   * Fechar de verdade (sair do player), diferente do `fechar` acima, que
   * também é usado ENTRE duas aberturas do mesmo vídeo (a reabertura). Aqui
   * é a hora de esquecer a URL e cancelar qualquer reabertura no forno.
   */
  const fecharDeVez = useCallback(() => {
    if (timerReaberturaRef.current) {
      clearTimeout(timerReaberturaRef.current);
      timerReaberturaRef.current = null;
    }
    alvoPendenteRef.current = null;
    urlRef.current = null;
    fechar();
  }, [fechar]);

  const abrir = useCallback(
    (url: string, startTime: number) => {
      const avplay = pegarAvplay();
      if (!avplay) return;
      fechar();
      // `fechar` zera o espelho: abrir é sempre carregar alguma coisa, e a
      // interface tem que mostrar isso desde o primeiro instante.
      estadoRef.current.buffering = true;

      urlRef.current = url;
      try {
        logarServidor(`abrindo ${url}`);
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

        // POSIÇÃO INICIAL: seekTo AQUI, com a mídia aberta mas ainda NÃO
        // preparada (estado IDLE). É o caminho que a Samsung documenta pra
        // "começar de tal ponto", e é outro caminho no aparelho: a posição
        // entra na própria preparação do stream, em vez de pedir ao
        // decodificador que já está rodando pra pular. Esta TV recusa o
        // segundo (PLAYER_ERROR_INVALID_STATE em qualquer busca, mesmo
        // tocando, mesmo 10s à frente), e era por isso que "continuar
        // assistindo" recomeçava do zero.
        const alvoMs = Math.round(startTime * 1000);
        if (startTime > 1) {
          try {
            avplay.seekTo(alvoMs);
            logarServidor(`posicao inicial ${alvoMs}ms pedida antes do prepare`);
          } catch (e) {
            logarServidor(`posicao inicial ${alvoMs}ms recusada: ${descreverErro(e)}`);
          }
        }

        avplay.prepareAsync(
          () => {
            const duracaoMs = avplay.getDuration();
            estadoRef.current.duration = duracaoMs / 1000;
            logarServidor(`preparado: duracao=${(duracaoMs / 1000).toFixed(1)}s retomar=${startTime.toFixed(1)}s`);

            const player = pegarAvplay();
            if (player) {
              try {
                player.play();
              } catch (e) {
                logarServidor(`play() apos preparar falhou: ${descreverErro(e)}`);
              }
            }
            estadoRef.current.paused = false;
            estadoRef.current.seeking = false;

            // Confere, já tocando, se a posição inicial pegou. Não tenta
            // consertar: se não pegou, buscar agora seria justamente a
            // operação que esta TV recusa. Serve pro log dizer, da próxima
            // vez, qual das duas coisas aconteceu.
            if (startTime > 1) {
              setTimeout(() => {
                const p2 = pegarAvplay();
                if (!p2 || !abertoRef.current) return;
                try {
                  const atualMs = p2.getCurrentTime();
                  const pegou = Math.abs(atualMs - alvoMs) <= 5000;
                  logarServidor(`retomada ${pegou ? "ok" : "NAO pegou"}: pedi ${alvoMs}ms, estou em ${atualMs}ms`);
                } catch (e) {
                  logarServidor(`retomada: getCurrentTime falhou: ${descreverErro(e)}`);
                }
              }, ESPERA_CONFERIR_RETOMADA_MS);
            }
          },
          (erro) => {
            estadoRef.current.error = "Falha ao preparar o vídeo: " + String(erro);
            logarServidor(`prepareAsync falhou: ${descreverErro(erro)}`);
          }
        );
      } catch (e) {
        estadoRef.current.error = "AVPlay falhou ao abrir: " + String(e);
      }
    },
    [fechar]
  );

  /**
   * Busca ABSOLUTA (retomada, arrastar a barra). Fica fora do objeto `api`
   * porque o salto relativo abaixo também precisa dela como plano B, e
   * chamar de lá por `this` quebraria assim que alguém guardasse o método
   * numa variável.
   */
  /**
   * Plano B pra busca: reabrir o vídeo já no ponto pedido.
   *
   * Existe porque esta TV recusa TODA busca com a mídia rodando —
   * PLAYER_ERROR_INVALID_STATE mesmo em PLAYING, mesmo 10s à frente, mesmo
   * pelos métodos de salto que a Samsung fez pra isso. O que ela aceita é
   * dizer a posição ANTES de preparar o stream (ver `abrir`). Então é isso
   * que se faz: fecha e abre de novo começando de lá.
   *
   * O custo é a recarga (alguns segundos de tela parada); o ganho é ±10s e
   * arrastar a barra passarem a funcionar em vez de não fazer nada. Onde a
   * busca normal funciona, nada disto chega a rodar.
   *
   * O atraso junta toques seguidos: apertar +10s cinco vezes vira uma
   * reabertura em +50s, não cinco recarregamentos.
   */
  const agendarReabertura = useCallback(
    (alvo: number) => {
      const url = urlRef.current;
      if (!url) return;
      alvoPendenteRef.current = alvo;
      alvoPendenteDesdeRef.current = Date.now();
      estadoRef.current.currentTime = alvo;
      // Spinner na hora: a reabertura demora alguns segundos, e sem sinal
      // nenhum o botão parece não ter feito nada de novo.
      estadoRef.current.buffering = true;
      if (timerReaberturaRef.current) clearTimeout(timerReaberturaRef.current);
      timerReaberturaRef.current = setTimeout(() => {
        timerReaberturaRef.current = null;
        const destino = alvoPendenteRef.current;
        if (destino === null || !urlRef.current) return;
        logarServidor(`reabrindo em ${destino.toFixed(1)}s (a TV recusou a busca)`);
        abrir(urlRef.current, destino);
      }, ATRASO_REABERTURA_MS);
    },
    [abrir]
  );

  /**
   * Busca ABSOLUTA (retomada, arrastar a barra). Fica fora do objeto `api`
   * porque o salto relativo também precisa dela, e chamar de lá por `this`
   * quebraria assim que alguém guardasse o método numa variável.
   */
  const buscar = useCallback(
    (time: number) => {
      const avplay = pegarAvplay();
      if (!avplay || !abertoRef.current) return;
      // `seeking` PRECISA voltar pra false em todos os caminhos — sucesso,
      // erro e exceção. Travado em true, doSaveProgress (ver
      // useProgressPersistence, ramo nativo) se recusa a salvar progresso.
      estadoRef.current.seeking = true;
      const pronto = () => {
        estadoRef.current.seeking = false;
      };
      // Falha de busca não é falha de reprodução: o vídeo segue tocando de
      // onde estava, então NÃO vira `error` (que jogaria a tela de "não foi
      // possível reproduzir" por cima de um vídeo que está tocando). Vai
      // pro log, e o ponto pedido vira uma reabertura.
      const recusou = (erro: unknown) => {
        pronto();
        logarServidor(`seekTo(${Math.round(time * 1000)}ms) recusado em ${estadoNativo(avplay)}: ${descreverErro(erro)}`);
        agendarReabertura(time);
      };
      try {
        logarServidor(`seekTo pedido: ${estadoRef.current.currentTime.toFixed(1)}s -> ${time.toFixed(1)}s`);
        avplay.seekTo(Math.round(time * 1000), pronto, recusou);
      } catch (e) {
        recusou(e);
      }
    },
    [agendarReabertura]
  );

  // Não deixa uma reabertura agendada disparar depois que o player saiu.
  useEffect(() => {
    return () => {
      if (timerReaberturaRef.current) clearTimeout(timerReaberturaRef.current);
    };
  }, []);

  const api = useMemo<TizenPlayerApi>(
    () => ({
      open: abrir,
      play() {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.play();
          estadoRef.current.paused = false;
        } catch (e) {
          logarServidor(`play() falhou em ${estadoNativo(avplay)}: ${descreverErro(e)}`);
        }
      },
      pause() {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        try {
          avplay.pause();
          estadoRef.current.paused = true;
        } catch (e) {
          logarServidor(`pause() falhou em ${estadoNativo(avplay)}: ${descreverErro(e)}`);
        }
      },
      seekTo: buscar,
      seekBy(delta) {
        const avplay = pegarAvplay();
        if (!avplay || !abertoRef.current) return;
        const ms = Math.round(Math.abs(delta) * 1000);
        // O ponto de partida é o pulo que já está no forno, se houver:
        // apertar +10s cinco vezes seguidas tem que somar 50s, não repetir
        // os mesmos 10s cinco vezes (ver agendarReabertura).
        const base = alvoPendenteRef.current ?? estadoRef.current.currentTime;
        const teto = estadoRef.current.duration || Infinity;
        const alvo = Math.min(Math.max(0, base + delta), teto);

        // jumpForward/jumpBackward são os métodos que a Samsung fez pra
        // este caso, e o cálculo acontece dentro do player. Nesta TV eles
        // são recusados como qualquer outra busca, e aí o pedido vira uma
        // reabertura no ponto — mas tentar primeiro é o certo: onde a busca
        // funciona, ela é instantânea e sem recarregar nada.
        const pular = delta >= 0 ? avplay.jumpForward : avplay.jumpBackward;
        estadoRef.current.seeking = true;
        const pronto = () => {
          estadoRef.current.seeking = false;
        };
        const recusou = (erro: unknown) => {
          pronto();
          logarServidor(
            `${delta >= 0 ? "jumpForward" : "jumpBackward"}(${ms}ms) recusado em ${estadoNativo(avplay)}: ${descreverErro(erro)}`
          );
          agendarReabertura(alvo);
        };
        if (pular) {
          try {
            pular.call(avplay, ms, pronto, recusou);
            logarServidor(`pulo de ${delta}s pedido em t=${base.toFixed(1)} (${estadoNativo(avplay)})`);
          } catch (e) {
            recusou(e);
          }
          return;
        }
        buscar(alvo);
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
          logarServidor(`setSpeed(${rate}) aceito em ${estadoNativo(avplay)}`);
        } catch (e) {
          // Nem todo conteúdo aceita trick play — mas agora fica registrado
          // QUAL foi a recusa, que é o que diferencia "a TV não suporta"
          // de "a gente chamou na hora errada".
          logarServidor(`setSpeed(${rate}) falhou em ${estadoNativo(avplay)}: ${descreverErro(e)}`);
        }
      },
      close: fecharDeVez,
    }),
    [abrir, fecharDeVez, buscar, agendarReabertura]
  );

  const shellVersion = useMemo(
    () => (process.env.NEXT_PUBLIC_FLOW_VERSAO ? `app ${process.env.NEXT_PUBLIC_FLOW_VERSAO}` : null),
    []
  );

  return { active, state, api, shellVersion };
}
