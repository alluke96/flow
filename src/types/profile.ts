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
  /**
   * Carimbo (Date.now()) da última alteração DESTE perfil. É o que permite
   * juntar as cópias de aparelhos diferentes sem escolher no chute: na
   * junção, vence a versão mais recente de cada perfil, individualmente.
   * Sem isso, a TV salvando progresso sobrescreveria o que o celular acabou
   * de gravar em OUTRO perfil. Perfis antigos (sem o campo) contam como 0.
   */
  atualizadoEm?: number;
}

export interface ProfileStore {
  perfis: Profile[];
  perfilAtivoId: string | null;
}

export const MAX_PROFILES = 4;
