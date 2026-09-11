import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";

// A googleapis usa APIs do Node (streams, auth) — roda sempre no runtime Node,
// nunca no Edge.
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const episodeParam = req.nextUrl.searchParams.get("ep");

  const idResult = titleIdSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  if (episodeParam) {
    const epResult = episodeIdSchema.safeParse(episodeParam);
    if (!epResult.success) {
      return NextResponse.json({ error: "episódio inválido" }, { status: 400 });
    }
  }

  const source = getCatalogSource();
  const rangeHeader = req.headers.get("range");

  // openVideo valida internamente que `id`/`ep` existem no catálogo
  // conhecido antes de tocar em qualquer credencial/fileId do Drive — é
  // essa checagem que impede IDOR neste endpoint (spec, seção 7).
  const result = await source.openVideo(idResult.data, episodeParam, rangeHeader);
  if (!result) {
    return NextResponse.json({ error: "vídeo não encontrado" }, { status: 404 });
  }

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.location, 302);
  }

  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Length": String(result.contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (result.range) {
    headers["Content-Range"] = `bytes ${result.range.start}-${result.range.end}/${result.totalSize}`;
  }

  return new NextResponse(result.body, { status: result.status, headers });
}
