import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { seasonNumberSchema, titleIdSchema } from "@/lib/validation";

/**
 * Capa de uma temporada específica (`capa.jpg` dentro de `Temporada NN/`,
 * ver README) — usada como miniatura repetida em todos os episódios daquela
 * temporada. 404 quando a temporada não tem capa própria; o frontend cai de
 * volta pro banner do título (ver components/EpisodeThumb).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; season: string }> }
) {
  const { id, season } = await ctx.params;
  const idResult = titleIdSchema.safeParse(id);
  const seasonResult = seasonNumberSchema.safeParse(season);
  if (!idResult.success || !seasonResult.success) {
    return NextResponse.json({ error: "parâmetros inválidos" }, { status: 400 });
  }

  const source = getCatalogSource();
  const result = await source.openSeasonImage(idResult.data, seasonResult.data);
  if (!result) {
    return NextResponse.json({ error: "capa da temporada não encontrada" }, { status: 404 });
  }

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.location, 302);
  }

  return new NextResponse(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.contentLength),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
