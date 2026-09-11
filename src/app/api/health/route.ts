import { NextResponse } from "next/server";
import { isDriveConfigured } from "@/lib/drive/client";

/**
 * Diagnóstico simples: diz se o app está servindo o catálogo mock ou o
 * Google Drive real, sem expor nada sensível. Útil depois de configurar
 * env vars na Vercel — lembre que adicionar env var no painel não redeploya
 * sozinho; as funções da build atual só passam a enxergar a variável nova
 * depois de um redeploy.
 */
export async function GET() {
  const usingDrive = isDriveConfigured();
  return NextResponse.json({
    ok: true,
    catalogSource: usingDrive ? "drive" : "mock",
    driveConfigured: usingDrive,
  });
}
