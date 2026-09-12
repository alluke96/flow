import { NextRequest, NextResponse } from "next/server";
import { mutateProfiles } from "@/lib/profiles-store";

export const runtime = "nodejs";

/**
 * Exclusão é a única operação que age na hora, e por um motivo: a junção
 * (ver lib/profile-merge.ts) nunca interpreta "ausente" como "apagado",
 * senão um aparelho desatualizado ressuscitaria o perfil na próxima
 * sincronização. Por isso, além de tirar o perfil da lista, grava uma
 * lápide — é ela que faz a exclusão vencer as cópias locais que ainda têm o
 * perfil. Só acontece na tela de perfis, longe da reprodução.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { perfis, excluidos } = await mutateProfiles((atual) => ({
    perfis: atual.perfis.filter((p) => p.id !== id),
    excluidos: { ...atual.excluidos, [id]: Date.now() },
  }));
  return NextResponse.json({ perfis, excluidos });
}
