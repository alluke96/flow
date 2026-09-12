/**
 * Perfis locais (sem login). Formato espelha exatamente o schema descrito
 * no spec do produto, para que trocar a persistência por uma API real no
 * futuro seja só trocar a implementação do ProfileProvider.
 */

export interface WatchProgress {
  tituloId: string;
  episodioId: string | null;
  progressoSegundos: number;
}

export interface Profile {
  id: string;
  nome: string;
  avatarId: string;
  listaAssistirMaisTarde: string[];
  continuarAssistindo: WatchProgress[];
}

export interface ProfileStore {
  perfis: Profile[];
  perfilAtivoId: string | null;
}

export const MAX_PROFILES = 4;
