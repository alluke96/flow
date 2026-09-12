import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";
import { isValidAvatarId, DEFAULT_AVATAR_ID } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";
import { MAX_PROFILES, type Profile } from "@/types/profile";

export const runtime = "nodejs";

// Rota de migração única: perfis viviam só em localStorage (por navegador)
// antes desta mudança pra persistência compartilhada no servidor (ver
// profiles-store.ts). Na primeira vez que este servidor for acessado por
// QUALQUER navegador que já tinha perfis salvos do jeito antigo, o cliente
// importa esse localStorage pra cá — assim ninguém perde os perfis que já
// tinha criado só porque o formato de armazenamento mudou.
//
// Só aplica se o servidor ainda não tiver nenhum perfil: evita que um
// segundo navegador (já sem perfis "antigos" reais, só um cache vazio ou
// desatualizado) sobrescreva à toa perfis reais que outro dispositivo já
// migrou pra cá primeiro.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw = (body as { perfis?: unknown })?.perfis;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const sanitized: Profile[] = raw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
    .map((p) => ({
      id: typeof p.id === "string" && p.id ? p.id : "p" + Math.random().toString(36).slice(2, 10),
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
    }))
    .filter((p) => p.nome)
    .slice(0, MAX_PROFILES);

  let imported = false;
  const perfis = await mutateProfiles((current) => {
    if (current.length > 0) return current;
    imported = true;
    return sanitized;
  });

  return NextResponse.json({ perfis, imported });
}
