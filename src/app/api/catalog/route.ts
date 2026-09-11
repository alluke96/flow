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
