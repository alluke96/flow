import type { CatalogResponse, TitleDetail } from "@/types/catalog";

/**
 * Helpers de chamada às rotas internas /api/*. O frontend nunca fala
 * diretamente com o Google Drive nem recebe credenciais — só bate nestes
 * endpoints (ver spec, seção 6/7).
 */

/**
 * Cache em memória (só do lado do cliente, dura a sessão da aba) pro
 * catálogo e pros títulos já vistos. Sem isso, voltar do player pra tela de
 * detalhe de um título que você acabou de ver refaz a busca do zero e
 * mostra uma tela de loading cheia sem necessidade — com o cache, a volta
 * é instantânea.
 */
let catalogCache: CatalogResponse | null = null;
const titleCache = new Map<string, TitleDetail>();

export function getCachedCatalog(): CatalogResponse | null {
  return catalogCache;
}

export function getCachedTitle(id: string): TitleDetail | undefined {
  return titleCache.get(id);
}

export async function fetchCatalog(): Promise<CatalogResponse> {
  const res = await fetch("/api/catalog");
  if (!res.ok) throw new Error("Falha ao carregar catálogo");
  const data: CatalogResponse = await res.json();
  catalogCache = data;
  return data;
}

export async function fetchTitle(id: string): Promise<TitleDetail | null> {
  const res = await fetch(`/api/title/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Falha ao carregar título");
  const data: TitleDetail = await res.json();
  titleCache.set(id, data);
  return data;
}

export function posterUrl(id: string): string {
  return `/api/image/${encodeURIComponent(id)}/poster`;
}

export function bannerUrl(id: string): string {
  return `/api/image/${encodeURIComponent(id)}/banner`;
}

export function seasonImageUrl(id: string, seasonNumero: number): string {
  return `/api/image/${encodeURIComponent(id)}/season/${seasonNumero}`;
}

export function streamUrl(id: string, episodeId?: string | null): string {
  const base = `/api/stream/${encodeURIComponent(id)}`;
  return episodeId ? `${base}?ep=${encodeURIComponent(episodeId)}` : base;
}
