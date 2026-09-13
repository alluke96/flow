import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";
import { analisarMp4 } from "@/lib/mp4-caixas";

export const runtime = "nodejs";

/**
 * DIAGNÓSTICO: como o MP4 está montado por dentro — por que a TV consegue
 * TOCAR um episódio e não consegue NAVEGAR dentro dele. A leitura em si
 * está em src/lib/mp4-caixas.ts, com o porquê de cada pergunta.
 *
 * Abra no navegador do PC:
 *   /api/diag/mp4/<id-do-titulo>?ep=s1e3
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ep = req.nextUrl.searchParams.get("ep");
  if (!titleIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  if (ep && !episodeIdSchema.safeParse(ep).success) {
    return NextResponse.json({ error: "episódio inválido" }, { status: 400 });
  }

  // 4 MB cobre o índice inteiro com folga (num episódio de 20 min ele fica
  // na casa de centenas de KB) sem puxar o vídeo junto.
  const result = await getCatalogSource().openVideo(id, ep, "bytes=0-4194303");
  if (!result) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (result.kind !== "stream") {
    return NextResponse.json({ error: "fonte redireciona (catálogo mock)" }, { status: 400 });
  }

  const cabeca = new Uint8Array(await new Response(result.body).arrayBuffer());
  return NextResponse.json({
    titulo: id,
    episodio: ep,
    tamanhoTotal: result.totalSize,
    contentType: result.contentType,
    ...analisarMp4(cabeca),
  });
}
