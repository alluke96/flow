import type { CatalogResponse, TitleDetail } from "@/types/catalog";
import type { Profile } from "@/types/profile";

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

/**
 * Refresh forçado (botão no menu de perfil): ignora tanto este cache do
 * cliente quanto o cache de ~5min do índice do Drive no servidor (ver
 * POST /api/catalog). Limpa também os títulos já vistos, já que um título
 * pode ter ganhado episódios/ficado disponível desde a última busca.
 */
export async function refreshCatalog(): Promise<CatalogResponse> {
  const res = await fetch("/api/catalog", { method: "POST" });
  if (!res.ok) throw new Error("Falha ao atualizar catálogo");
  const data: CatalogResponse = await res.json();
  catalogCache = data;
  titleCache.clear();
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

/**
 * Perfis (ver profile-context.tsx e profiles-store.ts) — persistidos no
 * servidor, não mais em localStorage, então qualquer dispositivo enxerga os
 * mesmos. Toda função aqui devolve a lista inteira e atualizada de perfis
 * (é o que cada rota responde), pra o contexto reconciliar seu estado local
 * com o que o servidor realmente gravou.
 */

async function profilesJson(res: Response, action: string): Promise<Profile[]> {
  if (!res.ok) throw new Error(`Falha ao ${action}`);
  const data: { perfis: Profile[] } = await res.json();
  return data.perfis;
}

export function fetchProfiles(): Promise<Profile[]> {
  return fetch("/api/profiles", { cache: "no-store" }).then((res) =>
    profilesJson(res, "carregar perfis")
  );
}

export function importLegacyProfiles(perfis: Profile[]): Promise<Profile[]> {
  return fetch("/api/profiles/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ perfis }),
  }).then((res) => profilesJson(res, "importar perfis"));
}

export function createProfile(nome: string, avatarId: string): Promise<Profile[]> {
  return fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, avatarId }),
  }).then((res) => profilesJson(res, "criar perfil"));
}

export function updateProfileApi(id: string, nome: string, avatarId: string): Promise<Profile[]> {
  return fetch(`/api/profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, avatarId }),
  }).then((res) => profilesJson(res, "editar perfil"));
}

export function deleteProfileApi(id: string): Promise<Profile[]> {
  return fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) =>
    profilesJson(res, "excluir perfil")
  );
}

export function setWatchlistApi(
  id: string,
  tituloId: string,
  action: "add" | "remove"
): Promise<Profile[]> {
  return fetch(`/api/profiles/${encodeURIComponent(id)}/watchlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tituloId, action }),
  }).then((res) => profilesJson(res, "atualizar lista"));
}

export function saveProgressApi(
  id: string,
  tituloId: string,
  episodioId: string | null,
  progressoSegundos: number,
  duracaoSegundos: number
): Promise<Profile[]> {
  return fetch(`/api/profiles/${encodeURIComponent(id)}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tituloId, episodioId, progressoSegundos, duracaoSegundos }),
  }).then((res) => profilesJson(res, "salvar progresso"));
}

export function clearProgressApi(id: string, tituloId: string): Promise<Profile[]> {
  return fetch(
    `/api/profiles/${encodeURIComponent(id)}/progress?tituloId=${encodeURIComponent(tituloId)}`,
    { method: "DELETE" }
  ).then((res) => profilesJson(res, "limpar progresso"));
}
