import { NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";

export async function GET() {
  const source = getCatalogSource();
  const titulos = await source.listCatalog();
  return NextResponse.json(
    { titulos },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

// Refresh forçado (botão no menu de perfil): pula o cache de ~5min do
// índice do Drive e reconsulta na hora. POST porque é uma ação que muda
// estado do servidor (invalida cache), não uma leitura idempotente — e de
// quebra evita qualquer cache HTTP de GET no caminho.
export async function POST() {
  const source = getCatalogSource();
  source.invalidate?.();
  const titulos = await source.listCatalog();
  return NextResponse.json({ titulos }, { headers: { "Cache-Control": "no-store" } });
}
