import { spawn } from "node:child_process";
import { horaLog } from "@/lib/log";

/**
 * Entrega o vídeo JÁ COMEÇANDO no ponto pedido, pra quem não consegue
 * navegar dentro do arquivo sozinho.
 *
 * Quem não consegue é a TV (ver tizen/README.md): o AVPlay dela pede o
 * arquivo uma vez, do byte zero, baixa linearmente e recusa toda busca com
 * PLAYER_ERROR_INVALID_STATE — sem nunca pedir outro intervalo de bytes.
 * Não é defeito do arquivo (índice na frente, keyframe a cada 3,4s,
 * H.264/AAC) nem do servidor (responde 206 com o intervalo certo): é o
 * aparelho. Como ele sabe tocar do início, a saída é fazer o "início" ser
 * onde o usuário parou.
 *
 * NADA é recodificado: `-c copy` copia os pacotes de vídeo e áudio como
 * estão, então não há perda de qualidade nem CPU de encoder, e nenhum
 * arquivo do Drive é tocado. O corte cai no keyframe mais próximo, que é o
 * mesmo lugar onde uma busca cairia.
 *
 * A saída é MPEG-TS, e não MP4, porque MP4 precisa de um índice que só
 * pode ser escrito depois de saber o tamanho de tudo — impossível num
 * stream que sai enquanto é gerado. TS foi feito pra isso (é o formato da
 * transmissão de TV) e é o que um aparelho desses melhor entende. O preço
 * é que o stream não carrega duração: quem sabe a duração total é o app
 * (ver o `duracaoConhecida` em tizen-player-bridge.ts).
 */

let disponivel: boolean | null = null;
let checadoEm = 0;
/** Achou: não precisa perguntar de novo. Não achou: pode ser que instalem. */
const REPETIR_CHECAGEM_MS = 60_000;

/**
 * O ffmpeg existe nesta máquina?
 *
 * A resposta positiva vale pra sempre; a negativa só por um minuto. Essa
 * assimetria existe pra quem acabou de instalar o ffmpeg não precisar
 * adivinhar que o serviço inteiro tem que ser reiniciado pra deixar de
 * ouvir "não tem" — ele volta a procurar sozinho.
 */
export async function ffmpegDisponivel(): Promise<boolean> {
  if (disponivel === true) return true;
  if (disponivel === false && Date.now() - checadoEm < REPETIR_CHECAGEM_MS) return false;
  checadoEm = Date.now();
  disponivel = await new Promise<boolean>((resolve) => {
    try {
      const p = spawn(caminhoFfmpeg(), ["-version"], { stdio: "ignore" });
      p.on("error", () => resolve(false));
      p.on("close", (codigo) => resolve(codigo === 0));
    } catch {
      resolve(false);
    }
  });
  return disponivel;
}

/**
 * FLOW_FFMPEG permite apontar pro executável quando ele não está no PATH —
 * no Windows é o caso comum (baixa-se o .zip e descompacta em algum lugar).
 */
function caminhoFfmpeg(): string {
  return process.env.FLOW_FFMPEG || "ffmpeg";
}

export interface TrechoRemuxado {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

/**
 * `urlOrigem` é a URL do próprio endpoint de streaming (sem `inicio`): o
 * ffmpeg busca por HTTP e usa Range pra pular direto pro ponto, do mesmo
 * jeito que um player faria — é isso que faz o corte ser rápido mesmo num
 * arquivo de 190 MB, sem baixar o que vem antes.
 *
 * `cancelar` é o sinal da request: se o aparelho fecha a conexão (troca de
 * episódio, sai do player, pula de novo), o ffmpeg morre junto em vez de
 * ficar puxando o vídeo inteiro do Drive à toa.
 */
export function abrirTrechoRemuxado(
  urlOrigem: string,
  inicioSegundos: number,
  cancelar: AbortSignal
): TrechoRemuxado {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    // -ss ANTES do -i: o ffmpeg pula pelo índice do arquivo (com Range no
    // HTTP) em vez de decodificar tudo até lá. É a diferença entre ~1s e
    // vários minutos.
    "-ss",
    String(Math.max(0, Math.floor(inicioSegundos))),
    "-i",
    urlOrigem,
    "-c",
    "copy",
    "-f",
    "mpegts",
    "pipe:1",
  ];

  const inicio = Date.now();
  const proc = spawn(caminhoFfmpeg(), args, { stdio: ["ignore", "pipe", "pipe"] });

  let erro = "";
  proc.stderr.on("data", (pedaco: Buffer) => {
    // O ffmpeg escreve TUDO em stderr, inclusive o que não é erro; com
    // -loglevel error sobra só o que interessa. Guardado e registrado
    // depois, junto do código de saída, pra virar uma linha só no log.
    erro += pedaco.toString();
    if (erro.length > 2000) erro = erro.slice(-2000);
  });
  proc.on("close", (codigo) => {
    const ms = Date.now() - inicio;
    if (codigo === 0 || cancelar.aborted) {
      console.log(`[${horaLog()}] [remux] trecho de ${inicioSegundos}s encerrado em ${ms}ms (codigo=${codigo})`);
    } else {
      console.error(`[${horaLog()}] [remux] ffmpeg falhou (codigo=${codigo}) em ${ms}ms: ${erro.trim()}`);
    }
  });
  proc.on("error", (e) => {
    console.error(`[${horaLog()}] [remux] não consegui executar o ffmpeg:`, e);
  });

  const matar = () => {
    if (!proc.killed) proc.kill("SIGKILL");
  };
  cancelar.addEventListener("abort", matar, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on("data", (pedaco: Buffer) => controller.enqueue(new Uint8Array(pedaco)));
      proc.stdout.on("end", () => {
        try {
          controller.close();
        } catch {
          // já fechado pelo cancelamento — nada a fazer
        }
      });
      proc.stdout.on("error", () => {
        try {
          controller.close();
        } catch {
          // idem
        }
      });
    },
    cancel() {
      matar();
    },
  });

  return { body, contentType: "video/mp2t" };
}
