import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles, readProfiles } from "@/lib/profiles-store";
import { DEFAULT_AVATAR_ID, isValidAvatarId } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";
import { MAX_PROFILES, type Profile } from "@/types/profile";

// fs precisa do runtime Node — nunca roda no Edge.
export const runtime = "nodejs";

function uid(): string {
  return "p" + Math.random().toString(36).slice(2, 10);
}

export async function GET() {
  const perfis = await readProfiles();
  return NextResponse.json({ perfis }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const nome = sanitizeProfileName(String((body as { nome?: unknown }).nome ?? ""));
  if (!nome) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }
  const avatarIdRaw = (body as { avatarId?: unknown }).avatarId;
  const avatarId = isValidAvatarId(avatarIdRaw) ? avatarIdRaw : DEFAULT_AVATAR_ID;

  let created: Profile | null = null;
  const perfis = await mutateProfiles((current) => {
    if (current.length >= MAX_PROFILES) return current;
    created = {
      id: uid(),
      nome,
      avatarId,
      listaAssistirMaisTarde: [],
      continuarAssistindo: [],
    };
    return [...current, created];
  });

  if (!created) {
    return NextResponse.json({ error: "limite de perfis atingido" }, { status: 409 });
  }
  return NextResponse.json({ perfis, profile: created }, { status: 201 });
}
