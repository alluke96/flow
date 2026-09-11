import { readFileSync } from "node:fs";
import path from "node:path";
import titlesJson from "@/data/mock-titles.json";
import type { SeasonSummary, TitleDetail, TitleSummary, TitleType } from "@/types/catalog";
import { bufferToStream } from "@/lib/stream-utils";
import type { CatalogSource, OpenResult } from "./types";

/**
 * Fonte de dados MOCK — usada enquanto GOOGLE_SERVICE_ACCOUNT_KEY /
 * GOOGLE_DRIVE_ROOT_FOLDER_ID não estiverem configuradas no ambiente (ver
 * src/lib/catalog-source/index.ts e o README para trocar para o Drive real).
 */

interface MockEpisodeRaw {
  numero: number;
  titulo: string;
  duracaoMinutos: number;
}
interface MockSeasonRaw {
  numero: number;
  episodios: MockEpisodeRaw[];
}
interface MockTitleRaw {
  id: string;
  tipo: TitleType;
  titulo: string;
  ano: number;
  genero: string[];
  duracaoMinutos?: number;
  classificacaoIndicativa?: string;
  sinopse: string;
  elenco?: string[];
  diretor?: string;
  temporadas?: MockSeasonRaw[];
}

const RAW = titlesJson as MockTitleRaw[];

// Vídeo de amostra livre de direitos (Mozilla), usado só no modo mock — cada
// título/episódio "aponta" pra ele. Assim que o Drive real for configurado,
// esta fonte deixa de ser usada automaticamente (ver getCatalogSource()).
const SAMPLE_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function toSummary(t: MockTitleRaw): TitleSummary {
  return {
    id: t.id,
    tipo: t.tipo,
    titulo: t.titulo,
    ano: t.ano,
    genero: t.genero,
    duracaoMinutos: t.duracaoMinutos,
    sinopse: t.sinopse,
    totalTemporadas: t.temporadas?.length,
  };
}

function toDetail(t: MockTitleRaw): TitleDetail {
  const temporadas: SeasonSummary[] | undefined = t.temporadas?.map((s) => ({
    numero: s.numero,
    episodios: s.episodios.map((e) => ({
      id: `s${s.numero}e${e.numero}`,
      numero: e.numero,
      titulo: e.titulo,
      duracaoMinutos: e.duracaoMinutos,
    })),
  }));
  return {
    ...toSummary(t),
    classificacaoIndicativa: t.classificacaoIndicativa,
    elenco: t.elenco,
    diretor: t.diretor,
    temporadas,
  };
}

function findRaw(id: string): MockTitleRaw | undefined {
  return RAW.find((t) => t.id === id);
}

function readPublicAsset(relPath: string): Buffer | null {
  try {
    return readFileSync(path.join(process.cwd(), "public", relPath));
  } catch {
    return null;
  }
}

export const mockCatalogSource: CatalogSource = {
  async listCatalog() {
    return RAW.map(toSummary);
  },

  async getTitle(id) {
    const raw = findRaw(id);
    return raw ? toDetail(raw) : null;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock não faz range real, mas mantém a assinatura da interface
  async openVideo(titleId, episodeId, rangeHeader) {
    // Allowlist: só serve se o título existe no catálogo mock e, se for
    // série, se o episódio pedido de fato existe naquele título — nunca
    // aceitamos um ID "porque sim".
    const raw = findRaw(titleId);
    if (!raw) return null;
    if (raw.tipo === "serie") {
      const exists = raw.temporadas?.some((s) =>
        s.episodios.some((e) => `s${s.numero}e${e.numero}` === episodeId)
      );
      if (!exists) return null;
    }
    const result: OpenResult = { kind: "redirect", location: SAMPLE_VIDEO_URL };
    return result;
  },

  async openImage(titleId, kind) {
    const raw = findRaw(titleId);
    if (!raw) return null;
    const folder = kind === "poster" ? "posters" : "banners";
    const buf = readPublicAsset(`mock/${folder}/${titleId}.svg`);
    if (!buf) return null;
    const result: OpenResult = {
      kind: "stream",
      status: 200,
      contentType: "image/svg+xml",
      contentLength: buf.byteLength,
      totalSize: buf.byteLength,
      range: null,
      body: bufferToStream(new Uint8Array(buf)),
    };
    return result;
  },
};
