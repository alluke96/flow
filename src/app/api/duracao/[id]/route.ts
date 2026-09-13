import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";
import { analisarMp4 } from "@/lib/mp4-caixas";

export const runtime = "nodejs";

/**
 * Quantos segundos tem um vídeo, lendo só o cabeçalho dele.
 *
 * Existe pro app de TV. Lá o vídeo pode chegar já cortado no ponto de
 * retomada (ver src/lib/remux.ts), e esse stream não carrega duração
 * nenhuma — o player responde zero. Zero, no resto do app, quer dizer
 * "ainda não carregou": a barra abriria vazia e o progresso pararia de ser
 * salvo justamente em quem está retomando.
 *
 * O progresso salvo passou a guardar a duração junto, o que resolve daí em
 * diante; isto aqui é pra quem já tinha progresso salvo antes disso, e pra
 * quando o catálogo não traz a duração do episódio.
 *
 * A resposta fica em memória: o cabeçalho de um arquivo não muda, e sem o
 * cache seriam 4 MB lidos do Drive a cada vez que alguém retoma.
 */
const cache = new Map<string, number>();

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ep = req.nextUrl.searchParams.get("ep");
  if (!titleIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  if (ep && !episodeIdSchema.safeParse(ep).success) {
    return NextResponse.json({ error: "episódio inválido" }, { status: 400 });
  }

  const chave = `${id}:${ep ?? "-"}`;
  const guardado = cache.get(chave);
  if (guardado !== undefined) {
    return NextResponse.json({ segundos: guardado }, { headers: { "Cache-Control": "no-store" } });
  }

  const result = await getCatalogSource().openVideo(id, ep, "bytes=0-4194303");
  if (!result) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (result.kind !== "stream") {
    return NextResponse.json({ error: "fonte redireciona (catálogo mock)" }, { status: 400 });
  }

  const cabeca = new Uint8Array(await new Response(result.body).arrayBuffer());
  const analise = analisarMp4(cabeca);
  const video = analise.trilhas.find((t) => t.tipo === "vide");
  const segundos = video?.segundos ?? 0;
  if (segundos > 0) cache.set(chave, segundos);

  return NextResponse.json({ segundos }, { headers: { "Cache-Control": "no-store" } });
}
