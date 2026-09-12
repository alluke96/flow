import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";
import { titleIdSchema, watchlistActionSchema } from "@/lib/validation";

export const runtime = "nodejs";

// "add"/"remove" explícitos (em vez de um "toggle") de propósito: cada
// request fica idempotente e autossuficiente — não depende de o cliente
// saber o estado atual pra decidir o que fazer, o que importa porque a
// mutação real acontece contra o estado mais recente do arquivo (ver
// mutateProfiles), não contra o que o cliente tinha em memória no momento
// do clique.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const tituloId = titleIdSchema.safeParse((body as { tituloId?: unknown })?.tituloId);
  const action = watchlistActionSchema.safeParse((body as { action?: unknown })?.action);
  if (!tituloId.success || !action.success) {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  let found = false;
  const perfis = await mutateProfiles((current) =>
    current.map((p) => {
      if (p.id !== id) return p;
      found = true;
      const has = p.listaAssistirMaisTarde.includes(tituloId.data);
      if (action.data === "add" && !has) {
        return { ...p, listaAssistirMaisTarde: [...p.listaAssistirMaisTarde, tituloId.data] };
      }
      if (action.data === "remove" && has) {
        return {
          ...p,
          listaAssistirMaisTarde: p.listaAssistirMaisTarde.filter((x) => x !== tituloId.data),
        };
      }
      return p;
    })
  );

  if (!found) {
    return NextResponse.json({ error: "perfil não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ perfis });
}
