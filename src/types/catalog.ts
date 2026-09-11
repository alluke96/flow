/**
 * Tipos do catálogo. Esta forma é o "contrato" entre o backend (mock ou
 * Google Drive) e o frontend — o frontend nunca sabe qual das duas fontes
 * está por trás de /api/catalog, /api/title/:id etc.
 */

export type TitleType = "filme" | "serie";

export interface EpisodeSummary {
  id: string;
  numero: number;
  titulo: string;
  duracaoMinutos?: number;
}

export interface SeasonSummary {
  numero: number;
  episodios: EpisodeSummary[];
}

export interface TitleSummary {
  id: string;
  tipo: TitleType;
  titulo: string;
  tituloOriginal?: string;
  ano?: number;
  genero: string[];
  duracaoMinutos?: number;
  sinopse: string;
  /** Quantas temporadas, só para séries — usado nos cards/metadados sem buscar o detalhe inteiro. */
  totalTemporadas?: number;
  /**
   * false quando a pasta existe no Drive mas ainda não tem conteúdo
   * jogável (filme sem arquivo de vídeo, ou série sem nenhum episódio em
   * nenhuma temporada) — permite avisar "ainda não disponível" em vez de
   * deixar o usuário cair num player quebrado. Ausente/undefined == true
   * (mock e dados antigos sempre "disponíveis").
   */
  disponivel?: boolean;
}

export interface TitleDetail extends TitleSummary {
  classificacaoIndicativa?: string;
  elenco?: string[];
  diretor?: string;
  temporadas?: SeasonSummary[];
}

export interface CatalogResponse {
  titulos: TitleSummary[];
}
