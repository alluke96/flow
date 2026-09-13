import type { NextConfig } from "next";

/**
 * FLOW_TIZEN=1 muda o alvo do build: em vez do app servido pelo PC, gera um
 * EXPORT ESTÁTICO pra ir empacotado dentro do `.wgt` do app de TV (ver
 * scripts/build-tizen.mjs, que é quem liga essa variável).
 *
 * A diferença que importa é `assetPrefix`: dentro do widget a página é
 * servida de `file://`, e um caminho absoluto tipo `/_next/...` apontaria
 * pra raiz do sistema de arquivos da TV — nada carregaria. Relativo resolve
 * a partir do próprio diretório do app.
 */
const paraTizen = process.env.FLOW_TIZEN === "1";

const nextConfig: NextConfig = paraTizen
  ? {
      output: "export",
      distDir: ".next-tizen",
      assetPrefix: "./",
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
