import { Readable } from "node:stream";

/** Envolve um Buffer/Uint8Array já em memória num ReadableStream (Web Streams). */
export function bufferToStream(buf: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
}

/** Converte uma stream Node (a que a googleapis devolve) para Web Streams. */
export function nodeToWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(node as Readable) as ReadableStream<Uint8Array>;
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
