import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * DIAGNÓSTICO: como o MP4 está montado por dentro.
 *
 * Existe por causa da TV. O AVPlay dela toca qualquer episódio do começo
 * ao fim, mas recusa TODA navegação dentro do arquivo — busca e velocidade
 * diferente de 1x, que pra ele são a mesma família (trick play) — com
 * PLAYER_ERROR_INVALID_STATE e "Internal error". Nenhum pedido chega a sair
 * pro servidor quando isso acontece, então a decisão é tomada com o que ele
 * já leu do arquivo.
 *
 * A explicação clássica pra isso é o índice do MP4 (o átomo `moov`) estar
 * no FIM do arquivo em vez do começo. Quem lê por HTTP sem baixar tudo
 * precisa do índice pra saber a que byte corresponde cada segundo; com ele
 * no fim, um navegador de PC se vira (baixa o arquivo inteiro, ou busca o
 * fim com um range) e um aparelho mais simples desiste de navegar.
 *
 * Abra no navegador do PC:
 *   /api/diag/mp4/<id-do-titulo>?ep=s1e3
 *
 * `faststart: true` = índice na frente, o arquivo está do jeito certo.
 * `faststart: false` = índice no fim, e é aí que a TV desiste.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ep = req.nextUrl.searchParams.get("ep");
  if (!titleIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  if (ep && !episodeIdSchema.safeParse(ep).success) {
    return NextResponse.json({ error: "episódio inválido" }, { status: 400 });
  }

  const result = await getCatalogSource().openVideo(id, ep, "bytes=0-262143");
  if (!result) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (result.kind !== "stream") {
    return NextResponse.json({ error: "fonte redireciona (catálogo mock)" }, { status: 400 });
  }

  const cabeca = new Uint8Array(await new Response(result.body).arrayBuffer());
  const view = new DataView(cabeca.buffer, cabeca.byteOffset, cabeca.byteLength);

  const caixas: { tipo: string; tamanho: number; offset: number }[] = [];
  let pos = 0;
  let truncado = false;
  while (pos + 8 <= cabeca.byteLength) {
    let tamanho = view.getUint32(pos);
    const tipo = String.fromCharCode(...cabeca.slice(pos + 4, pos + 8));
    let cabecalho = 8;
    if (tamanho === 1) {
      if (pos + 16 > cabeca.byteLength) break;
      // 64 bits: a parte alta só importaria acima de 4 GB
      tamanho = view.getUint32(pos + 8) * 2 ** 32 + view.getUint32(pos + 12);
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = result.totalSize - pos; // "vai até o fim do arquivo"
    }
    if (!/^[\x20-\x7e]{4}$/.test(tipo) || tamanho < cabecalho) break;
    caixas.push({ tipo, tamanho, offset: pos });
    pos += tamanho;
    if (pos > cabeca.byteLength) {
      truncado = true;
      break;
    }
  }

  const iMoov = caixas.findIndex((c) => c.tipo === "moov");
  const iMdat = caixas.findIndex((c) => c.tipo === "mdat");
  const faststart = iMoov !== -1 && (iMdat === -1 || iMoov < iMdat);

  return NextResponse.json({
    titulo: id,
    episodio: ep,
    tamanhoTotal: result.totalSize,
    contentType: result.contentType,
    faststart,
    diagnostico: faststart
      ? "índice (moov) na frente — o arquivo está no formato que permite navegar"
      : iMdat !== -1
        ? "índice (moov) NO FIM: o vídeo (mdat) vem primeiro — é isto que impede a TV de buscar"
        : "não deu pra identificar (nem moov nem mdat nos primeiros 256 KB)",
    caixas,
    ...(truncado ? { nota: "só os primeiros 256 KB foram lidos" } : {}),
  });
}
