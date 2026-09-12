import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";
import { DEFAULT_AVATAR_ID, isValidAvatarId } from "@/lib/avatars";
import { sanitizeProfileName } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
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

  let found = false;
  const perfis = await mutateProfiles((current) =>
    current.map((p) => {
      if (p.id !== id) return p;
      found = true;
      return { ...p, nome, avatarId };
    })
  );

  if (!found) {
    return NextResponse.json({ error: "perfil não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ perfis });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const perfis = await mutateProfiles((current) => current.filter((p) => p.id !== id));
  return NextResponse.json({ perfis });
}
