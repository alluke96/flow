import type { CatalogResponse, TitleDetail } from "@/types/catalog";

/**
 * Endereço do servidor do Flow, embutido no build.
 *
 * Só tem efeito no app de TV: lá o app roda empacotado dentro do `.wgt`, a
 * partir de `file://`, onde "mesma origem" não existe — um fetch("/api/...")
 * viraria `file:///api/...` e não acharia nada. Todo caminho precisa virar
 * absoluto pro IP do PC (ver scripts/build-tizen.mjs, que passa este valor
 * no build).
 *
 * Na web (PC, celular, navegador) isto fica vazio de propósito: os caminhos
 * continuam relativos, mesma origem, sem CORS nenhum no meio.
 */
const SERVIDOR = process.env.NEXT_PUBLIC_FLOW_SERVER ?? "";

export function apiUrl(caminho: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return SERVIDOR + caminho;
  }
  return caminho;
}

const api = apiUrl;

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
  const res = await fetch(api("/api/catalog"));
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
  const res = await fetch(api("/api/catalog"), { method: "POST" });
  if (!res.ok) throw new Error("Falha ao atualizar catálogo");
  const data: CatalogResponse = await res.json();
  catalogCache = data;
  titleCache.clear();
  return data;
}

export async function fetchTitle(id: string): Promise<TitleDetail | null> {
  const res = await fetch(api(`/api/title/${encodeURIComponent(id)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Falha ao carregar título");
  const data: TitleDetail = await res.json();
  titleCache.set(id, data);
  return data;
}

export function posterUrl(id: string): string {
  return api(`/api/image/${encodeURIComponent(id)}/poster`);
}

export function bannerUrl(id: string): string {
  return api(`/api/image/${encodeURIComponent(id)}/banner`);
}

export function seasonImageUrl(id: string, seasonNumero: number): string {
  return api(`/api/image/${encodeURIComponent(id)}/season/${seasonNumero}`);
}

export function streamUrl(id: string, episodeId?: string | null): string {
  const base = api(`/api/stream/${encodeURIComponent(id)}`);
  return episodeId ? `${base}?ep=${encodeURIComponent(episodeId)}` : base;
}
