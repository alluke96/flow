import { NextResponse } from "next/server";
import { readProfiles } from "@/lib/profiles-store";

// fs precisa do runtime Node — nunca roda no Edge.
export const runtime = "nodejs";

/**
 * Lista os perfis guardados no servidor, junto com as lápides (ids
 * excluídos — ver lib/profiles-store.ts). O cliente precisa das duas coisas:
 * os perfis pra juntar com a cópia local, e as lápides pra apagar da cópia
 * local o que já foi excluído em outro aparelho.
 */
export async function GET() {
  const { perfis, excluidos } = await readProfiles();
  return NextResponse.json(
    { perfis, excluidos },
    { headers: { "Cache-Control": "no-store" } }
  );
}
