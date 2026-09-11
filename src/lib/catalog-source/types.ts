import type { TitleDetail, TitleSummary } from "@/types/catalog";

export type ImageKind = "poster" | "banner";

export interface FileRange {
  start: number;
  end: number;
}

export interface StreamResult {
  kind: "stream";
  status: 200 | 206;
  contentType: string;
  /** tamanho do trecho retornado no body */
  contentLength: number;
  /** tamanho total do arquivo original */
  totalSize: number;
  range: FileRange | null;
  body: ReadableStream<Uint8Array>;
}

export interface RedirectResult {
  kind: "redirect";
  location: string;
}

export type OpenResult = StreamResult | RedirectResult;

/**
 * Contrato entre a API e a fonte de dados real (mock ou Google Drive).
 * O frontend e as rotas de API só conhecem esta interface — trocar de mock
 * para Drive (ou vice-versa) é só trocar a implementação retornada por
 * `getCatalogSource()`, sem tocar em rota nenhuma.
 *
 * Importante para segurança: `titleId`/`episodeId` são sempre os IDs do
 * nosso próprio índice (já validados contra o catálogo conhecido) — nunca
 * um fileId do Drive vindo direto do cliente. Cada implementação é
 * responsável por resolver esses IDs internamente e retornar `null` quando
 * não encontrar correspondência (o que vira 404, nunca uma chamada "às
 * cegas" pro Drive).
 */
export interface CatalogSource {
  listCatalog(): Promise<TitleSummary[]>;
  getTitle(id: string): Promise<TitleDetail | null>;
  /**
   * `rangeHeader` é o header `Range` cru vindo do cliente (ou null). Cada
   * fonte resolve o range contra o tamanho real do arquivo que ela mesma
   * conhece — é por isso que o parsing não acontece na rota.
   */
  openVideo(
    titleId: string,
    episodeId: string | null,
    rangeHeader: string | null
  ): Promise<OpenResult | null>;
  openImage(titleId: string, kind: ImageKind): Promise<OpenResult | null>;
  /**
   * Capa de uma temporada específica (usada como miniatura repetida em
   * todos os episódios daquela temporada). Retorna null se a temporada não
   * existir ou não tiver `capa.*` própria — a rota decide o fallback.
   */
  openSeasonImage(titleId: string, seasonNumero: number): Promise<OpenResult | null>;
}
