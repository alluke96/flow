import { NextRequest, NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { episodeIdSchema, titleIdSchema } from "@/lib/validation";
import { horaLog } from "@/lib/log";
import { abrirTrechoRemuxado, ffmpegDisponivel } from "@/lib/remux";

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

  // Entrega começando num ponto, pro app de TV (ver src/lib/remux.ts).
  //
  // Os dois parâmetros existem pra esta rota continuar EXATAMENTE como
  // sempre foi pra todo o resto: `tv=1` só é enviado de dentro do widget
  // Tizen (é lá que o player nativo vive, ver tizen-player-bridge.ts) e
  // `inicio` só é pedido quando a busca de verdade já foi recusada pelo
  // aparelho. Navegador de PC e celular nunca mandam nenhum dos dois, e
  // seguem recebendo o arquivo com Range normal.
  const inicioSegundos = Number(req.nextUrl.searchParams.get("inicio") ?? 0);
  const doAppDeTv = req.nextUrl.searchParams.get("tv") === "1";
  if (doAppDeTv && Number.isFinite(inicioSegundos) && inicioSegundos > 0) {
    if (!(await ffmpegDisponivel())) {
      // Sem ffmpeg não dá pra cortar — mas deixar de responder seria pior:
      // melhor o vídeo tocar do começo (o comportamento de antes) do que
      // não tocar. A linha abaixo é o que explica, pra quem for olhar o
      // log, por que a TV voltou pro início.
      console.error(
        `[${horaLog()}] [stream] ffmpeg não encontrado: não dá pra começar em ${inicioSegundos}s.` +
          ` Instale o ffmpeg ou aponte FLOW_FFMPEG pro executável (ver tizen/README.md).`
      );
    } else if (!(await source.getTitle(idResult.data))) {
      // Confere que o título existe ANTES de criar um processo: sem isto,
      // qualquer id bem-formado ligaria um ffmpeg. O conteúdo em si continua
      // protegido pela própria rota, que o ffmpeg vai chamar (é lá que a
      // allowlist de catálogo roda), mas processo à toa não passa daqui.
      console.error(`[${horaLog()}] [stream] trecho pedido pra título desconhecido: ${idResult.data}`);
      return NextResponse.json({ error: "vídeo não encontrado" }, { status: 404 });
    } else {
      // O ffmpeg lê pela PRÓPRIA rota, sem `inicio`: assim ele usa Range
      // pra pular direto pro ponto e reaproveita toda a lógica de Drive,
      // allowlist e cache que já existe aqui.
      const origem = new URL(req.nextUrl.toString());
      origem.searchParams.delete("inicio");
      origem.searchParams.delete("tv");
      console.log(`[${horaLog()}] [stream] trecho pra TV de ${idResult.data} ep=${episodeParam ?? "-"} a partir de ${inicioSegundos}s`);
      const trecho = abrirTrechoRemuxado(origem.toString(), inicioSegundos, req.signal);
      return new NextResponse(trecho.body, {
        status: 200,
        headers: {
          "Content-Type": trecho.contentType,
          // Sem Content-Length nem Range: o tamanho só se saberia gerando
          // o stream inteiro, e o ponto todo é ele sair enquanto é gerado.
          "Accept-Ranges": "none",
          "Cache-Control": "private, no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

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
