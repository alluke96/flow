import { getDriveClient } from "@/lib/drive/client";
import { buildDriveIndex, type DriveIndex } from "@/lib/drive/scan";
import { cached } from "@/lib/cache";
import { nodeToWebStream, parseRangeHeader } from "@/lib/stream-utils";
import type { CatalogSource, FileRange, OpenResult } from "./types";

const CATALOG_CACHE_KEY = "drive:catalog-index";
// TTL curto o bastante pra refletir mudanças no Drive rápido, longo o
// bastante pra não estourar a cota da API a cada carregamento de página
// (ver spec, seção 6).
const CATALOG_TTL_MS = 5 * 60 * 1000;

function getIndex(): Promise<DriveIndex> {
  return cached(CATALOG_CACHE_KEY, CATALOG_TTL_MS, buildDriveIndex);
}

async function fetchDriveRange(
  fileId: string,
  mimeType: string,
  totalSize: number,
  range: FileRange | null
): Promise<OpenResult> {
  const drive = getDriveClient();
  const headers: Record<string, string> = {};
  if (range) headers.Range = `bytes=${range.start}-${range.end}`;

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream", headers }
  );

  const status = range ? 206 : 200;
  const contentLength = range ? range.end - range.start + 1 : totalSize;

  return {
    kind: "stream",
    status,
    contentType: mimeType || "application/octet-stream",
    contentLength,
    totalSize,
    range,
    body: nodeToWebStream(res.data as unknown as NodeJS.ReadableStream),
  };
}

export const driveCatalogSource: CatalogSource = {
  async listCatalog() {
    const index = await getIndex();
    return Array.from(index.values()).map((entry) => ({
      id: entry.detail.id,
      tipo: entry.detail.tipo,
      titulo: entry.detail.titulo,
      tituloOriginal: entry.detail.tituloOriginal,
      ano: entry.detail.ano,
      genero: entry.detail.genero,
      duracaoMinutos: entry.detail.duracaoMinutos,
      sinopse: entry.detail.sinopse,
      totalTemporadas: entry.detail.totalTemporadas,
      disponivel: entry.detail.disponivel,
    }));
  },

  async getTitle(id) {
    const index = await getIndex();
    return index.get(id)?.detail ?? null;
  },

  async openVideo(titleId, episodeId, rangeHeader) {
    const index = await getIndex();
    const entry = index.get(titleId);
    if (!entry) return null; // não está no índice conhecido -> nunca chama o Drive

    if (entry.detail.tipo === "serie") {
      if (!episodeId) return null;
      const episode = entry.seasons
        ?.flatMap((s) => s.episodios)
        .find((e) => e.id === episodeId);
      if (!episode) return null;
      const range = parseRangeHeader(rangeHeader, episode.size);
      return fetchDriveRange(episode.fileId, episode.mimeType, episode.size, range);
    }

    if (!entry.movieFileId) return null;
    const totalSize = entry.movieSize ?? 0;
    const range = parseRangeHeader(rangeHeader, totalSize);
    return fetchDriveRange(entry.movieFileId, entry.movieMime ?? "video/mp4", totalSize, range);
  },

  async openImage(titleId, kind) {
    const index = await getIndex();
    const entry = index.get(titleId);
    if (!entry) return null;

    const fileId = kind === "poster" ? entry.posterFileId : entry.bannerFileId;
    const mime = kind === "poster" ? entry.posterMime : entry.bannerMime;
    const size = kind === "poster" ? entry.posterSize : entry.bannerSize;
    if (!fileId) return null;

    return fetchDriveRange(fileId, mime ?? "image/jpeg", size ?? 0, null);
  },

  async openSeasonImage(titleId, seasonNumero) {
    const index = await getIndex();
    const entry = index.get(titleId);
    if (!entry) return null;

    const season = entry.seasons?.find((s) => s.numero === seasonNumero);
    if (!season?.posterFileId) return null;

    return fetchDriveRange(
      season.posterFileId,
      season.posterMime ?? "image/jpeg",
      season.posterSize ?? 0,
      null
    );
  },
};
