import { NextResponse } from "next/server";
import { isDriveConfigured } from "@/lib/drive/client";
import pkg from "../../../../package.json";

/**
 * Diagnóstico simples: diz se o app está servindo o catálogo mock ou o
 * Google Drive real, sem expor nada sensível. Útil depois de configurar
 * env vars na Vercel — lembre que adicionar env var no painel não redeploya
 * sozinho; as funções da build atual só passam a enxergar a variável nova
 * depois de um redeploy.
 *
 * `version` existe pra responder, de fora, a pergunta mais básica de todas:
 * QUAL build está no ar agora? Sem isso não dava pra distinguir "a correção
 * não funcionou" de "a correção nem chegou a subir" (um deploy que falha no
 * meio deixa o serviço antigo rodando, e de fora os dois casos são
 * idênticos). Como a versão é incrementada a cada push, ela serve como
 * carimbo de frescor — é isso que o passo de verificação do deploy compara
 * (ver .github/workflows/deploy-selfhost.yml).
 */
export async function GET() {
  const usingDrive = isDriveConfigured();
  return NextResponse.json(
    {
      ok: true,
      version: pkg.version,
      catalogSource: usingDrive ? "drive" : "mock",
      driveConfigured: usingDrive,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
