/**
 * APIs de Node puro (process.on) isoladas num arquivo à parte, importado só
 * dinamicamente (ver instrumentation.ts) — assim o bundle do Edge Runtime
 * nem chega a incluir esse código, evitando o aviso de build de "API do
 * Node usada, não suportada no Edge" mesmo com a checagem de runtime já
 * presente (a análise estática do bundler roda antes dessa checagem valer
 * em tempo de execução).
 */
export function registerNodeInstrumentation() {
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException] processo continua no ar:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection] processo continua no ar:", reason);
  });
}
