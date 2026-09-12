import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";
import { mergeProfiles } from "@/lib/profile-merge";
import { isValidAvatarId, DEFAULT_AVATAR_ID } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";
import { MAX_PROFILES, type Profile } from "@/types/profile";

export const runtime = "nodejs";

/**
 * Recebe a cópia local de um aparelho e junta com a do servidor (ver
 * mergeProfiles: vence o mais recente, perfil a perfil).
 *
 * Chamado via navigator.sendBeacon, sempre em momento seguro — ao sair do
 * player ou ao esconder a aba, NUNCA durante a reprodução. O cliente ignora
 * a resposta por construção (sendBeacon não devolve nada): é justamente
 * isso que garante que nada aqui possa mexer no estado do React em hora
 * ruim, que é o que quebrava o player na tentativa anterior.
 */
function sanitize(raw: unknown): Profile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
    .map((p) => ({
      id: typeof p.id === "string" && p.id ? p.id : "",
      nome: sanitizeProfileName(String(p.nome ?? "")),
      avatarId: isValidAvatarId(p.avatarId) ? p.avatarId : DEFAULT_AVATAR_ID,
      listaAssistirMaisTarde: Array.isArray(p.listaAssistirMaisTarde)
        ? p.listaAssistirMaisTarde.filter((x): x is string => typeof x === "string")
        : [],
      continuarAssistindo: Array.isArray(p.continuarAssistindo)
        ? p.continuarAssistindo.filter(
            (c): c is Profile["continuarAssistindo"][number] =>
              Boolean(c) && typeof c === "object" && typeof c.tituloId === "string"
          )
        : [],
      atualizadoEm: typeof p.atualizadoEm === "number" ? p.atualizadoEm : 0,
    }))
    .filter((p) => p.id && p.nome)
    .slice(0, MAX_PROFILES);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const recebidos = sanitize((body as { perfis?: unknown })?.perfis);
  if (recebidos.length === 0) {
    return NextResponse.json({ perfis: [] }, { status: 400 });
  }

  const { perfis, excluidos } = await mutateProfiles((atual) => {
    // Um perfil excluído não volta só porque um aparelho desatualizado
    // ainda o tinha na cópia local (ver as lápides em profiles-store.ts).
    const vivos = recebidos.filter((p) => {
      const apagadoEm = atual.excluidos[p.id];
      return apagadoEm === undefined || (p.atualizadoEm ?? 0) > apagadoEm;
    });
    return {
      perfis: mergeProfiles(atual.perfis, vivos).slice(0, MAX_PROFILES),
      excluidos: atual.excluidos,
    };
  });
  return NextResponse.json(
    { perfis, excluidos },
    { headers: { "Cache-Control": "no-store" } }
  );
}
