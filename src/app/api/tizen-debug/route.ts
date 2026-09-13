import { NextRequest, NextResponse } from "next/server";
import { horaLog } from "@/lib/log";

/**
 * Endpoint de depuração só pra receber logs da CASCA Tizen (tizen/index.html)
 * e escrevê-los no próprio log do servidor (flow.log) — existe porque, nesta
 * TV específica, nenhuma das formas normais de ver o que a casca está
 * fazendo funciona: não tem DevTools, `sdb dlog`/`dlogutil` não devolvem
 * nada (parece bloqueado de fábrica), e um log desenhado NA TELA da própria
 * casca não aparece — o <iframe> do Flow, uma vez carregado, desenha por
 * cima de QUALQUER elemento irmão nesta TV, ignorando z-index e até o
 * próprio tamanho declarado em CSS (bug de navegador antigo, não algo que
 * dê pra contornar só com CSS).
 *
 * A casca já sabe falar HTTP com este servidor (é assim que ela carrega o
 * app), então um GET simples (sem preflight de CORS, já que não lê a
 * resposta) chega aqui de qualquer jeito — sem precisar de tela, sdb nem
 * postMessage nenhum. `console.log` aqui aparece no flow.log de sempre,
 * onde o self-host já sabe olhar.
 *
 * Só um GET com `?msg=`, sem persistir nada — é só uma janela pro log do
 * servidor, não guarda histórico depois de reiniciar o serviço.
 */
export async function GET(req: NextRequest) {
  const msg = req.nextUrl.searchParams.get("msg") ?? "(vazio)";
  console.log(`[${horaLog()}] [tizen-debug] ${msg}`);
  return NextResponse.json({ ok: true });
}
