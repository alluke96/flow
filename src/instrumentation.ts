/**
 * Roda uma vez, na inicialização do servidor (ver
 * https://nextjs.org/docs/app/guides/instrumentation).
 *
 * Rede de segurança contra uncaughtException/unhandledRejection: sem isso,
 * qualquer exceção que escape de um contexto assíncrono fora do try/catch
 * de uma rota (foi exatamente assim que a corrida em nodeToWebStream, ver
 * stream-utils.ts, se manifestou em produção — "Invalid state: Controller
 * is already closed" toda vez que um range request de vídeo era abortado)
 * pode derrubar o processo Node inteiro, tirando o app do ar por completo
 * até o serviço reiniciar sozinho — um preço bem mais alto que uma única
 * request falhando. Loga e segue vivo em vez disso; a causa raiz de
 * qualquer coisa capturada aqui ainda deveria ser corrigida na origem
 * quando identificada (isto é uma rede de segurança, não uma correção).
 *
 * O `process.on` de verdade mora num arquivo à parte (instrumentation-node),
 * importado só dinamicamente aqui — ver comentário nele.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNodeInstrumentation } = await import("./instrumentation-node");
  registerNodeInstrumentation();
}
