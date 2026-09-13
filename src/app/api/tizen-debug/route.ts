import { NextRequest, NextResponse } from "next/server";
import { horaLog } from "@/lib/log";

/**
 * Janela pro console do app de TV: recebe uma mensagem por GET e escreve no
 * log do servidor (flow.log).
 *
 * Existe porque dentro do widget Tizen não há como ver console nenhum: a TV
 * não tem DevTools alcançável, e `sdb dlog`/`dlogutil` não devolvem nada
 * nela (parece bloqueado de fábrica, mesmo com Developer Mode ligado). Se
 * algo quebrar antes da interface aparecer, este endpoint é a única forma
 * de saber o quê — o app já fala HTTP com este servidor pra tudo (catálogo,
 * imagens, vídeo), então uma chamada a mais sempre chega.
 *
 * Só um GET com `?msg=`, sem persistir nada — janela pro log, não histórico.
 *
 * Responde um GIF 1x1 transparente, não JSON: os faróis do widget são
 * `<img>`/`new Image()` (a forma que atravessa qualquer CSP e não depende
 * de fetch nem de CORS), e devolver JSON pra uma <img> faz o navegador
 * tratar como imagem quebrada — o que aparecia no próprio log como um
 * enganoso "falhou ao carregar".
 */
const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(req: NextRequest) {
  const msg = req.nextUrl.searchParams.get("msg") ?? "(vazio)";
  console.log(`[${horaLog()}] [tizen-debug] ${msg}`);
  return new NextResponse(GIF_1X1, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
