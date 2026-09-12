import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";

// A googleapis usa APIs do Node (streams, auth) — roda sempre no runtime Node,
// nunca no Edge.
export const runtime = "nodejs";

/**
 * Alguns contêineres que o navegador CONSEGUE demuxar são recusados de cara
 * só por causa do MIME que o Drive reporta: mandamos
 * `X-Content-Type-Options: nosniff` em toda resposta (ver
 * applySecurityHeaders no proxy), o que proíbe o navegador de olhar os bytes
 * e obriga ele a confiar 100% no Content-Type. Aí um `video/x-matroska`
 * (que Chrome/Safari não reconhecem como tipo tocável) faz o <video> falhar
 * com MEDIA_ERR_SRC_NOT_SUPPORTED (código 4) ANTES de tentar ler o arquivo —
 * mesmo quando o vídeo/áudio lá dentro são H.264/AAC, perfeitamente
 * suportados.
 *
 * O mapeamento abaixo só troca o rótulo por um tipo do MESMO contêiner que
 * o navegador aceita — não é mentira sobre o formato:
 *  - WebM é literalmente um perfil de Matroska (mesmo demuxer no Chrome).
 *  - .mov e .m4v são ISO-BMFF, o mesmo contêiner do .mp4.
 * Formatos genuinamente sem suporte (.wmv/.asf, .avi, .flv) ficam de fora de
 * propósito: rotular não faria eles tocarem, só trocaria um erro claro de
 * "formato não suportado" por um erro de decodificação confuso.
 */
const PLAYABLE_MIME_ALIASES: Record<string, string> = {
  "video/x-matroska": "video/webm",
  "video/quicktime": "video/mp4",
  "video/x-m4v": "video/mp4",
};

function playableMime(mime: string): string {
  return PLAYABLE_MIME_ALIASES[mime.toLowerCase()] ?? mime;
}

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
    console.error(`[stream] falha ao abrir vídeo ${idResult.data} (ep=${episodeParam}):`, err);
    return NextResponse.json({ error: "falha ao abrir o vídeo" }, { status: 500 });
  }
  if (!result) {
    console.error(`[stream] vídeo não encontrado: ${idResult.data} (ep=${episodeParam})`);
    return NextResponse.json({ error: "vídeo não encontrado" }, { status: 404 });
  }

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.location, 302);
  }

  const headers: Record<string, string> = {
    "Content-Type": playableMime(result.contentType),
    "Content-Length": String(result.contentLength),
    "Accept-Ranges": "bytes",
    // "private" (nunca em cache compartilhado/proxy) mas NÃO "no-store":
    // no-store proíbe o navegador de guardar QUALQUER pedaço da resposta,
    // inclusive o buffer de mídia que ele precisa pra costurar os Range
    // Requests de um seek. Com no-store, tocar do início (sequencial) até
    // funciona, mas PULAR pra um ponto trava — tela preta, relógio
    // congelado no destino e áudio fora de sincronia — que é exatamente o
    // padrão "só quebra em vídeo que já tinha histórico" (histórico =>
    // seek no load; sem histórico => sem seek => tocava normal). O
    // conteúdo aqui é o próprio acervo do dono do servidor, então deixar o
    // navegador dele bufferizar é seguro — e ainda economiza cota do Drive
    // ao evitar rebaixar os mesmos bytes o tempo todo.
    "Cache-Control": "private, max-age=3600",
  };
  if (result.range) {
    headers["Content-Range"] = `bytes ${result.range.start}-${result.range.end}/${result.totalSize}`;
  }

  return new NextResponse(result.body, { status: result.status, headers });
}
