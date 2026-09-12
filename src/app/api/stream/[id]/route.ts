import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";
import { horaLog } from "@/lib/log";

// A googleapis usa APIs do Node (streams, auth) — roda sempre no runtime Node,
// nunca no Edge.
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const episodeParam = req.nextUrl.searchParams.get("ep");

  const idResult = titleIdSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  if (episodeParam) {
    const epResult = episodeIdSchema.safeParse(episodeParam);
    if (!epResult.success) {
      return NextResponse.json({ error: "episódio inválido" }, { status: 400 });
    }
  }

  const source = getCatalogSource();
  const rangeHeader = req.headers.get("range");

  // Log de toda entrada/saída deste endpoint — é o que falta pra
  // correlacionar "cliquei em +10s na TV" com o que o servidor de fato fez
  // com aquele pedido: chegou? veio com o Range certo? respondeu 206 com o
  // intervalo certo, ou algo deu errado antes disso? Sem isto, uma busca
  // que falha silenciosamente (o navegador só volta pra posição anterior,
  // sem erro visível nenhum) não deixava rastro nenhum aqui.
  const inicio = Date.now();
  console.log(`[${horaLog()}] [stream] pedido ${idResult.data} ep=${episodeParam ?? "-"} range=${rangeHeader ?? "-"}`);

  // openVideo valida internamente que `id`/`ep` existem no catálogo
  // conhecido antes de tocar em qualquer credencial/fileId do Drive — é
  // essa checagem que impede IDOR neste endpoint (spec, seção 7).
  //
  // Log explícito em qualquer falha aqui: sem isso, um erro ao abrir o
  // vídeo (Drive fora do ar, credencial expirada, id desconhecido...) só
  // aparecia pro usuário como o <video> genericamente "não conseguiu
  // reproduzir" — sem nada no log do servidor (ver flow.log no self-host)
  // pra saber se a causa foi essa ou outra coisa inteiramente.
  let result;
  try {
    result = await source.openVideo(idResult.data, episodeParam, rangeHeader);
  } catch (err) {
    console.error(`[${horaLog()}] [stream] falha ao abrir vídeo ${idResult.data} (ep=${episodeParam}):`, err);
    return NextResponse.json({ error: "falha ao abrir o vídeo" }, { status: 500 });
  }
  if (!result) {
    console.error(`[${horaLog()}] [stream] vídeo não encontrado: ${idResult.data} (ep=${episodeParam})`);
    return NextResponse.json({ error: "vídeo não encontrado" }, { status: 404 });
  }

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.location, 302);
  }

  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Length": String(result.contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (result.range) {
    headers["Content-Range"] = `bytes ${result.range.start}-${result.range.end}/${result.totalSize}`;
  }

  console.log(
    `[${horaLog()}] [stream] resposta ${idResult.data}: status=${result.status}` +
      ` ${headers["Content-Range"] ?? "(sem range)"} (abriu em ${Date.now() - inicio}ms)`
  );

  return new NextResponse(result.body, { status: result.status, headers });
}
