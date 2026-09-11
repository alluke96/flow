import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { titleIdSchema } from "@/lib/validation";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const parsedId = titleIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const source = getCatalogSource();
  const title = await source.getTitle(parsedId.data);
  if (!title) {
    return NextResponse.json({ error: "título não encontrado" }, { status: 404 });
  }

  return NextResponse.json(title, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
