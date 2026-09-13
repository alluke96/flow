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
 */
export async function GET(req: NextRequest) {
  const msg = req.nextUrl.searchParams.get("msg") ?? "(vazio)";
  console.log(`[${horaLog()}] [tizen-debug] ${msg}`);
  return NextResponse.json({ ok: true });
}
