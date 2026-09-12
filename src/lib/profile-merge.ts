import type { Profile } from "@/types/profile";

/**
 * Junta duas listas de perfis escolhendo, PERFIL A PERFIL, a versão com o
 * carimbo mais novo (ver Profile.atualizadoEm).
 *
 * Por que por perfil e não "a lista inteira mais nova ganha": o caso real
 * aqui é a TV e o celular em uso ao mesmo tempo, cada um num perfil
 * diferente. Trocando a lista inteira, quem salvasse por último apagaria o
 * progresso que o outro acabou de gravar. Comparando individualmente, cada
 * perfil evolui sozinho e os dois sobrevivem.
 *
 * Exclusão não passa por aqui de propósito: um perfil ausente de um lado é
 * tratado como "esse lado ainda não sabe dele", nunca como "foi apagado" —
 * senão um aparelho desatualizado ressuscitaria perfis excluídos. Excluir
 * tem rota própria (DELETE /api/profiles/[id]), que age na hora.
 */
export function mergeProfiles(a: Profile[], b: Profile[]): Profile[] {
  const byId = new Map<string, Profile>();
  for (const p of a) byId.set(p.id, p);
  for (const p of b) {
    const atual = byId.get(p.id);
    if (!atual || (p.atualizadoEm ?? 0) > (atual.atualizadoEm ?? 0)) {
      byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}
