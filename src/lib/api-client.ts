import type { CatalogResponse, TitleDetail } from "@/types/catalog";

/**
 * Helpers de chamada às rotas internas /api/*. O frontend nunca fala
 * diretamente com o Google Drive nem recebe credenciais — só bate nestes
 * endpoints (ver spec, seção 6/7).
 */

export async function fetchCatalog(): Promise<CatalogResponse> {
  const res = await fetch("/api/catalog");
  if (!res.ok) throw new Error("Falha ao carregar catálogo");
  return res.json();
}

export async function fetchTitle(id: string): Promise<TitleDetail | null> {
  const res = await fetch(`/api/title/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Falha ao carregar título");
  return res.json();
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
