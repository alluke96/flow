/** Envolve um Buffer/Uint8Array já em memória num ReadableStream (Web Streams). */
export function bufferToStream(buf: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
}

/**
 * Converte uma stream Node (a que a googleapis devolve) pra Web Streams.
 *
 * DOIS requisitos, e a versão anterior só atendia um:
 *
 * 1) BACKPRESSURE (é o que estava faltando e quebrou o streaming). Só
 *    registrar um listener de "data" coloca a stream Node em modo fluente:
 *    ela lê do Drive o mais rápido que conseguir e empurra TUDO pro
 *    controller, ignorando `desiredSize` — ou seja, um arquivo de 350 MB
 *    era baixado inteiro pra memória do servidor a toda velocidade, mesmo
 *    que o navegador estivesse consumindo devagar. Isso satura o processo
 *    justamente enquanto ele deveria estar respondendo OUTRO range request.
 *
 *    Isso castiga .mkv muito mais que .mp4, e o motivo é estrutural: o
 *    índice de um MP4 "faststart" fica no COMEÇO do arquivo (dá pra
 *    conferir: ftyp seguido de moov logo nos primeiros bytes), então um
 *    request sequencial basta. Já o índice do Matroska (Cues) costuma ficar
 *    no FIM, então o navegador precisa de um segundo range request lá no
 *    final antes de conseguir tocar/buscar qualquer coisa. Com a origem
 *    despejando o arquivo inteiro sem freio, esse segundo request fica
 *    disputando espaço com a mangueira aberta — o navegador não recebe o
 *    índice a tempo e desiste, reportando como "formato não suportado".
 *    `Readable.toWeb` (que estava aqui antes) fazia backpressure certo; a
 *    substituição não fazia.
 *
 * 2) Não explodir numa corrida de fechamento. Cancelar (o navegador aborta
 *    um range request pra fazer outro — normal a cada seek) pode coincidir
 *    com a origem terminando sozinha, e os dois tentam fechar o mesmo
 *    controller: "Invalid state: Controller is already closed", que
 *    aparecia como uncaughtException no flow.log. Por isso o estado é
 *    rastreado aqui e toda chamada ao controller é protegida.
 */
export function nodeToWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  let closed = false;
  const source = node as NodeJS.ReadableStream & {
    pause?(): void;
    resume?(): void;
    destroy?(): void;
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        function finish(fn: () => void) {
          if (closed) return;
          closed = true;
          try {
            fn();
          } catch {
            // O consumidor pode ter cancelado bem nesse instante (ver
            // cancel() abaixo) — o controller já fechou por esse caminho.
          }
        }

        let bytes = 0;
        node.on("data", (chunk: Buffer) => {
          if (closed) return;
          bytes += chunk.length;
          try {
            controller.enqueue(new Uint8Array(chunk));
          } catch {
            // Corrida com um cancel concorrente: descarta o chunk.
            return;
          }
          // Fila do consumidor cheia: para de puxar da origem até ele pedir
          // mais (ver pull). É isto que impede o arquivo inteiro de ser
          // baixado de uma vez.
          if ((controller.desiredSize ?? 1) <= 0) source.pause?.();
        });
        node.on("end", () => finish(() => controller.close()));
        // Sem log nenhum aqui, um erro do Drive no meio de um range
        // request (rede, token expirado, limite de taxa) era engolido em
        // silêncio: o navegador só via a busca "falhar" e voltar sozinho
        // pra posição anterior — indistinguível de "o clique não fez
        // nada". `bytes` na mensagem ajuda a diferenciar "nem começou a
        // baixar" de "caiu no meio".
        node.on("error", (err) => {
          console.error(`[stream] origem (Drive) falhou depois de ${bytes} bytes:`, err);
          finish(() => controller.error(err));
        });
        // 'close' pode vir depois de 'end'/'error' (não é erro por si só).
        node.on("close", () => finish(() => controller.close()));
      },
      pull() {
        // O consumidor quer mais bytes: volta a puxar da origem.
        if (!closed) source.resume?.();
      },
      cancel() {
        // O navegador abortou este range request (caso comum: seek). É
        // normal — marca fechado e destrói a origem pra não seguir baixando
        // do Drive à toa.
        closed = true;
        source.destroy?.();
      },
    },
    // ~16 chunks (o Node entrega ~64 KB cada) de folga antes de frear: o
    // suficiente pra não ficar pausando/retomando a cada chunk, longe de
    // "carrega o arquivo todo".
    { highWaterMark: 16 }
  );
}

/** Faz o parse de um header `Range: bytes=start-end`. Retorna null se ausente/ inválido. */
export function parseRangeHeader(
  headerValue: string | null,
  totalSize: number
): { start: number; end: number } | null {
  if (!headerValue) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(headerValue.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;

  let start: number;
  let end: number;

  if (startStr === "") {
    // sufixo: últimos N bytes
    const suffixLength = parseInt(endStr, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? totalSize - 1 : parseInt(endStr, 10);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end) return null;
  return { start, end: Math.min(end, totalSize - 1) };
}
