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
 * NÃO usa Readable.toWeb: essa função embutida do Node tem uma corrida de
 * verdade entre o consumidor cancelando a stream (o navegador aborta um
 * range request em andamento — completamente normal, acontece a cada seek,
 * já que um novo range request cancela o anterior) e a stream de origem
 * terminando sozinha ao mesmo tempo — os dois tentam fechar o MESMO
 * controller, e quem perde a corrida lança "Invalid state: Controller is
 * already closed". Isso acontecia DE VERDADE em produção (self-host, ver
 * flow.log) como uma uncaughtException fora do try/catch da rota — corrompe
 * os bytes do vídeo entregues até ali, e o <video> reporta isso como
 * "formato não suportado" (MediaError code 4), parecendo um problema de
 * codec quando na real é essa corrida.
 *
 * Esta versão rastreia o estado ela mesma (uma flag local) e trata
 * cancel()/erro/fim concorrentes como o que são — eventos normais de
 * streaming, nunca uma exceção não tratada.
 */
export function nodeToWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function finish(fn: () => void) {
        if (closed) return;
        closed = true;
        try {
          fn();
        } catch {
          // O consumidor pode ter cancelado bem nesse instante (ver
          // cancel() abaixo) — o controller já fechou por esse caminho,
          // não há nada a fazer aqui.
        }
      }

      node.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          // Mesma corrida, do lado do enqueue: consumidor cancelou entre o
          // `if (closed)` acima e esta chamada. Descarta o chunk, sem
          // problema — a stream já era.
        }
      });
      node.on("end", () => finish(() => controller.close()));
      node.on("error", (err) => finish(() => controller.error(err)));
      // 'close' pode disparar depois de 'end'/'error' (não é erro por si
      // só) — só faz algo se nenhum dos outros dois já tiver fechado.
      node.on("close", () => finish(() => controller.close()));
    },
    cancel() {
      // O consumidor (a resposta HTTP) cancelou — o navegador abortou este
      // range request pra fazer outro (o caso comum: seek). Isso É normal
      // durante streaming de vídeo. Marca fechado (qualquer callback
      // pendente vira no-op) e destrói a stream de origem, pra não
      // continuar baixando do Drive à toa.
      closed = true;
      const destroyable = node as NodeJS.ReadableStream & { destroy?: () => void };
      destroyable.destroy?.();
    },
  });
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
