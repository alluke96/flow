import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { imageKindSchema, titleIdSchema } from "@/lib/validation";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> }
) {
  const { id, kind } = await ctx.params;
  const idResult = titleIdSchema.safeParse(id);
  const kindResult = imageKindSchema.safeParse(kind);
  if (!idResult.success || !kindResult.success) {
    return NextResponse.json({ error: "parâmetros inválidos" }, { status: 400 });
  }

  const source = getCatalogSource();
  // A validação de que `id` de fato existe no catálogo acontece aqui dentro
  // (allowlist) — nunca repassamos o parâmetro cru pro Drive.
  const result = await source.openImage(idResult.data, kindResult.data);
  if (!result) {
    return NextResponse.json({ error: "imagem não encontrada" }, { status: 404 });
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
