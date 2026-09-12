/**
 * Perfis sem login (ver profile-context.tsx e profiles-store.ts). Formato
 * espelha exatamente o schema descrito no spec do produto.
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

export const MAX_PROFILES = 4;
