import type { drive_v3 } from "googleapis";
import { getDriveClient, getRootFolderId } from "./client";
import type { SeasonSummary, TitleDetail, TitleType } from "@/types/catalog";

/**
 * Varre a árvore de pastas do Google Drive e monta o índice do catálogo,
 * seguindo as regras de nomenclatura descritas no spec (seção 8):
 *
 *   Catálogo/
 *   ├── Nome do Filme (2023)/{capa.*, banner.*, info.json, *.mp4}
 *   └── Nome da Série/{capa.*, banner.*, info.json, Temporada 01/{01 - Ep.mp4, ...}}
 *
 * O resultado (DriveIndex) é a única coisa usada pelas rotas de API — elas
 * nunca chamam a API do Drive com um ID que não tenha vindo daqui, o que é
 * a proteção contra IDOR pedida no spec (seção 7).
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SEASON_RE = /^temporada\s+0*(\d+)/i;
const EPISODE_RE = /^0*(\d+)\s*[-–—]\s*(.+)$/;
const YEAR_RE = /\((\d{4})\)\s*$/;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const VIDEO_EXT_RE = /\.(mp4|mkv|webm|mov|m4v)$/i;

interface DriveEpisodeEntry {
  id: string;
  fileId: string;
  mimeType: string;
  size: number;
  numero: number;
  titulo: string;
}

interface DriveSeasonEntry {
  numero: number;
  episodios: DriveEpisodeEntry[];
}

export interface DriveIndexEntry {
  detail: TitleDetail;
  posterFileId?: string;
  posterMime?: string;
  posterSize?: number;
  bannerFileId?: string;
  bannerMime?: string;
  bannerSize?: number;
  movieFileId?: string;
  movieMime?: string;
  movieSize?: number;
  seasons?: DriveSeasonEntry[];
}

export type DriveIndex = Map<string, DriveIndexEntry>;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

async function listChildren(drive: drive_v3.Drive, parentId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: 1000,
      pageToken,
      spaces: "drive",
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ?? undefined });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function readInfoJson(
  drive: drive_v3.Drive,
  fileId: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseTitleFolderName(name: string): { titulo: string; ano?: number } {
  const yearMatch = YEAR_RE.exec(name);
  if (!yearMatch) return { titulo: name.trim() };
  return {
    titulo: name.slice(0, yearMatch.index).trim(),
    ano: parseInt(yearMatch[1], 10),
  };
}

async function scanTitleFolder(
  drive: drive_v3.Drive,
  folder: DriveFile
): Promise<DriveIndexEntry> {
  const children = await listChildren(drive, folder.id);
  const { titulo: parsedTitulo, ano: parsedAno } = parseTitleFolderName(folder.name);

  const infoFile = children.find((c) => c.name.toLowerCase() === "info.json");
  const info = infoFile ? await readInfoJson(drive, infoFile.id) : null;

  const posterFile = children.find(
    (c) => /^capa\./i.test(c.name) && IMAGE_EXT_RE.test(c.name)
  );
  const bannerFile = children.find(
    (c) => /^banner\./i.test(c.name) && IMAGE_EXT_RE.test(c.name)
  );

  const seasonFolders = children.filter(
    (c) => c.mimeType === FOLDER_MIME && SEASON_RE.test(c.name)
  );

  const entry: DriveIndexEntry = {
    detail: {
      id: folder.id,
      tipo: "filme",
      titulo: (info?.titulo as string) ?? parsedTitulo,
      tituloOriginal: info?.titulo_original as string | undefined,
      ano: (info?.ano as number) ?? parsedAno,
      genero: (info?.genero as string[]) ?? [],
      sinopse: (info?.sinopse as string) ?? "",
      classificacaoIndicativa: info?.classificacao_indicativa as string | undefined,
      duracaoMinutos: info?.duracao_minutos as number | undefined,
      elenco: info?.elenco as string[] | undefined,
      diretor: info?.diretor as string | undefined,
    },
    posterFileId: posterFile?.id,
    posterMime: posterFile?.mimeType,
    posterSize: posterFile?.size ? parseInt(posterFile.size, 10) : undefined,
    bannerFileId: bannerFile?.id,
    bannerMime: bannerFile?.mimeType,
    bannerSize: bannerFile?.size ? parseInt(bannerFile.size, 10) : undefined,
  };

  if (seasonFolders.length > 0) {
    entry.detail.tipo = "serie";
    entry.detail.duracaoMinutos = undefined;
    const seasons: DriveSeasonEntry[] = [];
    for (const seasonFolder of seasonFolders) {
      const seasonMatch = SEASON_RE.exec(seasonFolder.name);
      const numero = seasonMatch ? parseInt(seasonMatch[1], 10) : seasons.length + 1;
      const episodeFiles = await listChildren(drive, seasonFolder.id);
      const episodios: DriveEpisodeEntry[] = episodeFiles
        .filter((f) => VIDEO_EXT_RE.test(f.name))
        .map((f) => {
          const match = EPISODE_RE.exec(f.name.replace(VIDEO_EXT_RE, ""));
          const numeroEp = match ? parseInt(match[1], 10) : 0;
          const tituloEp = match ? match[2].trim() : f.name.replace(VIDEO_EXT_RE, "");
          return {
            id: `s${numero}e${numeroEp}`,
            fileId: f.id,
            mimeType: f.mimeType,
            size: f.size ? parseInt(f.size, 10) : 0,
            numero: numeroEp,
            titulo: tituloEp,
          };
        })
        .sort((a, b) => a.numero - b.numero);
      seasons.push({ numero, episodios });
    }
    seasons.sort((a, b) => a.numero - b.numero);
    entry.seasons = seasons;
    entry.detail.totalTemporadas = seasons.length;
    entry.detail.temporadas = seasons.map(
      (s): SeasonSummary => ({
        numero: s.numero,
        episodios: s.episodios.map((e) => ({
          id: e.id,
          numero: e.numero,
          titulo: e.titulo,
        })),
      })
    );
  } else {
    entry.detail.tipo = (info?.tipo as TitleType) ?? "filme";
    const videoFile = children.find((f) => VIDEO_EXT_RE.test(f.name));
    if (videoFile) {
      entry.movieFileId = videoFile.id;
      entry.movieMime = videoFile.mimeType;
      entry.movieSize = videoFile.size ? parseInt(videoFile.size, 10) : 0;
    }
  }

  return entry;
}

export async function buildDriveIndex(): Promise<DriveIndex> {
  const drive = getDriveClient();
  const rootId = getRootFolderId();
  const topLevel = await listChildren(drive, rootId);
  const titleFolders = topLevel.filter(
    (f) => f.mimeType === FOLDER_MIME && f.name !== "_avatares"
  );

  const index: DriveIndex = new Map();
  // Sequencial de propósito: mantém a cota de requisições da API do Drive
  // sob controle (o catálogo inteiro é cacheado depois, ver catalog-source/drive.ts).
  for (const folder of titleFolders) {
    try {
      const entry = await scanTitleFolder(drive, folder);
      index.set(folder.id, entry);
    } catch {
      // uma pasta malformada não deve derrubar o catálogo inteiro
      continue;
    }
  }
  return index;
}
