import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";
import { episodeIdSchema, progressSecondsSchema, titleIdSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    tituloId?: unknown;
    episodioId?: unknown;
    progressoSegundos?: unknown;
    duracaoSegundos?: unknown;
  } | null;

  const tituloId = titleIdSchema.safeParse(body?.tituloId);
  const episodioId =
    body?.episodioId === null || body?.episodioId === undefined
      ? { success: true as const, data: null }
      : episodeIdSchema.safeParse(body.episodioId);
  const progressoSegundos = progressSecondsSchema.safeParse(body?.progressoSegundos);
  const duracaoSegundos = progressSecondsSchema.safeParse(body?.duracaoSegundos);
  if (!tituloId.success || !episodioId.success || !progressoSegundos.success || !duracaoSegundos.success) {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }
  if (!duracaoSegundos.data) {
    return NextResponse.json({ error: "duração inválida" }, { status: 400 });
  }

  let found = false;
  const perfis = await mutateProfiles((current) =>
    current.map((p) => {
      if (p.id !== id) return p;
      found = true;
      const rest = p.continuarAssistindo.filter((c) => c.tituloId !== tituloId.data);
      // Mesma regra do player: não vale a pena lembrar posição perto do
      // início (é como se não tivesse começado) nem perto do fim (fica
      // marcado como assistido/some da lista, não "continuar assistindo").
      const quaseNoFim = progressoSegundos.data >= duracaoSegundos.data - 5;
      const quaseNoInicio = progressoSegundos.data <= 5;
      if (quaseNoFim || quaseNoInicio) {
        return { ...p, continuarAssistindo: rest };
      }
      return {
        ...p,
        continuarAssistindo: [
          ...rest,
          { tituloId: tituloId.data, episodioId: episodioId.data, progressoSegundos: progressoSegundos.data },
        ],
      };
    })
  );

  if (!found) {
    return NextResponse.json({ error: "perfil não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ perfis });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const tituloId = titleIdSchema.safeParse(req.nextUrl.searchParams.get("tituloId"));
  if (!tituloId.success) {
    return NextResponse.json({ error: "tituloId inválido" }, { status: 400 });
  }

  let found = false;
  const perfis = await mutateProfiles((current) =>
    current.map((p) => {
      if (p.id !== id) return p;
      found = true;
      return {
        ...p,
        continuarAssistindo: p.continuarAssistindo.filter((c) => c.tituloId !== tituloId.data),
      };
    })
  );

  if (!found) {
    return NextResponse.json({ error: "perfil não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ perfis });
}
