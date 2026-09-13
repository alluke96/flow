/**
 * Leitura do CABEÇALHO de um MP4 — só o índice, sem tocar no vídeo.
 *
 * Existe por causa da TV (ver a rota /api/diag/mp4): o AVPlay dela toca o
 * arquivo inteiro mas recusa qualquer navegação dentro dele, e recusa ANTES
 * de pedir qualquer coisa pro servidor — decide com o que leu do próprio
 * arquivo. Então é o arquivo que precisa ser olhado, e são duas perguntas:
 *
 *  - Onde está o índice (`moov`)? Na frente, dá pra navegar sem baixar tudo;
 *    no fim, não.
 *  - Quantos KEYFRAMES o vídeo tem? Busca só pode cair num keyframe. Com um
 *    intervalo enorme entre eles, não existe ponto pra onde pular, e um
 *    aparelho de TV recusa a operação em vez de decodificar minutos de vídeo
 *    pra chegar lá. Um navegador de PC disfarça: já baixou o arquivo e tem
 *    CPU sobrando pra decodificar até o ponto pedido.
 */

/** Uma caixa (atom) do MP4: tipo, onde começa o conteúdo e onde termina. */
interface Caixa {
  tipo: string;
  conteudo: number;
  fim: number;
  tamanho: number;
}

function lerCaixas(b: Uint8Array, v: DataView, ini: number, fim: number): Caixa[] {
  const achadas: Caixa[] = [];
  let pos = ini;
  while (pos + 8 <= fim) {
    let tamanho = v.getUint32(pos);
    const tipo = texto(b, pos + 4);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (pos + 16 > fim) break;
      // 64 bits: a parte alta só importaria em arquivo acima de 4 GB
      tamanho = v.getUint32(pos + 8) * 2 ** 32 + v.getUint32(pos + 12);
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = fim - pos; // "vai até o fim"
    }
    if (!/^[\x20-\x7e]{4}$/.test(tipo) || tamanho < cabecalho) break;
    achadas.push({ tipo, conteudo: pos + cabecalho, fim: Math.min(pos + tamanho, fim), tamanho });
    pos += tamanho;
  }
  return achadas;
}

const achar = (caixas: Caixa[], tipo: string) => caixas.find((c) => c.tipo === tipo);

/** Os 4 caracteres a partir de `pos` — como os tipos são escritos no MP4. */
const texto = (b: Uint8Array, pos: number) => String.fromCharCode(...b.slice(pos, pos + 4));

/** timescale + duration de mvhd/mdhd, que só diferem no tamanho dos campos. */
function lerTempo(v: DataView, c: Caixa): { timescale: number; duracao: number } {
  const versao = v.getUint8(c.conteudo);
  const base = c.conteudo + 4 + (versao === 1 ? 16 : 8);
  const timescale = v.getUint32(base);
  const duracao =
    versao === 1 ? v.getUint32(base + 4) * 2 ** 32 + v.getUint32(base + 8) : v.getUint32(base + 4);
  return { timescale, duracao };
}

export interface TrilhaMp4 {
  tipo: string;
  codec: string;
  segundos: number;
  amostras: number | null;
  keyframes: number | null;
  umKeyframeACada?: string;
  temStss?: boolean;
}

export interface AnaliseMp4 {
  faststart: boolean;
  moovCompleto: boolean;
  trilhas: TrilhaMp4[];
  diagnostico: string;
}

/** `cabeca` são os primeiros bytes do arquivo — o suficiente pro `moov`. */
export function analisarMp4(cabeca: Uint8Array): AnaliseMp4 {
  const v = new DataView(cabeca.buffer, cabeca.byteOffset, cabeca.byteLength);
  const topo = lerCaixas(cabeca, v, 0, cabeca.byteLength);
  const moov = achar(topo, "moov");
  const mdat = achar(topo, "mdat");
  const faststart = !!moov && (!mdat || moov.conteudo < mdat.conteudo);
  // O índice cabe inteiro no que foi lido? Se não, as contagens abaixo saem
  // incompletas e o diagnóstico avisa.
  const moovCompleto = !!moov && moov.conteudo + moov.tamanho - 8 <= cabeca.byteLength;

  const trilhas: TrilhaMp4[] = [];
  if (moov) {
    for (const trak of lerCaixas(cabeca, v, moov.conteudo, moov.fim).filter((c) => c.tipo === "trak")) {
      const mdia = achar(lerCaixas(cabeca, v, trak.conteudo, trak.fim), "mdia");
      if (!mdia) continue;
      const dentroMdia = lerCaixas(cabeca, v, mdia.conteudo, mdia.fim);
      const hdlr = achar(dentroMdia, "hdlr");
      const mdhd = achar(dentroMdia, "mdhd");
      const minf = achar(dentroMdia, "minf");
      const tipo = hdlr ? texto(cabeca, hdlr.conteudo + 8) : "?";
      const tempo = mdhd ? lerTempo(v, mdhd) : null;
      const segundos = tempo && tempo.timescale ? tempo.duracao / tempo.timescale : 0;

      const stbl = minf ? achar(lerCaixas(cabeca, v, minf.conteudo, minf.fim), "stbl") : undefined;
      const dentroStbl = stbl ? lerCaixas(cabeca, v, stbl.conteudo, stbl.fim) : [];
      const stsd = achar(dentroStbl, "stsd");
      const stss = achar(dentroStbl, "stss");
      const stsz = achar(dentroStbl, "stsz");

      // stsd: versão+flags(4), quantidade(4), e aí a primeira entrada, que
      // começa com tamanho(4) e o código do codec(4).
      const codec = stsd ? texto(cabeca, stsd.conteudo + 12) : "?";
      // stsz: versão+flags(4), tamanho fixo(4), quantidade de amostras(4).
      const amostras = stsz ? v.getUint32(stsz.conteudo + 8) : null;
      // Sem stss, TODA amostra é ponto de entrada — é o que a norma diz.
      const keyframes = stss ? v.getUint32(stss.conteudo + 4) : amostras;

      trilhas.push({
        tipo,
        codec,
        segundos: Math.round(segundos),
        amostras,
        keyframes,
        ...(tipo === "vide" && keyframes && segundos
          ? { umKeyframeACada: `${(segundos / keyframes).toFixed(1)}s` }
          : {}),
        ...(tipo === "vide" ? { temStss: !!stss } : {}),
      });
    }
  }

  const video = trilhas.find((t) => t.tipo === "vide");
  const intervalo = video?.umKeyframeACada ? parseFloat(video.umKeyframeACada) : null;

  return {
    faststart,
    moovCompleto,
    trilhas,
    diagnostico: !faststart
      ? "índice (moov) NO FIM — é isto que impede a TV de buscar"
      : !moovCompleto
        ? "índice maior que o pedaço lido: as contagens podem estar incompletas"
        : intervalo === null
          ? "não deu pra medir os keyframes"
          : intervalo > 20
            ? `keyframes muito espaçados (um a cada ${intervalo}s): quase não há ponto pra onde pular`
            : `índice na frente e keyframes a cada ${intervalo}s — pelo arquivo, dava pra navegar`,
  };
}
