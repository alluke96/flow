#!/usr/bin/env node
/**
 * Gera o conteúdo do app de TV (Tizen) — um export estático do Flow, pra ser
 * empacotado dentro do `.wgt`.
 *
 * Por que precisa de um script e não é só `next build`: o mesmo repositório
 * serve dois alvos ao mesmo tempo.
 *
 *  - No PC continua rodando o Next.js completo: são as rotas `/api/*` que
 *    falam com o Drive e servem o vídeo. Isso NÃO vai pra dentro da TV.
 *  - Na TV vai só o front-end, como arquivos estáticos rodando de `file://`.
 *
 * Um export estático não convive com rotas de API, com o proxy (middleware)
 * nem com rotas dinâmicas (`/title/[id]`), que não têm como ser
 * pré-renderizadas — os ids vêm do Drive em runtime. Então, só durante o
 * build, este script tira essas peças do caminho e põe no lugar da página
 * raiz a versão de tela única do app (ver src/app/tv/page.tsx), que não usa
 * roteamento por URL. Tudo volta ao lugar no fim, inclusive se o build
 * falhar no meio (ver o finally lá embaixo).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guardados = join(raiz, ".tizen-build-guardado");

const servidor = process.env.FLOW_SERVER ?? process.argv[2];
if (!servidor || !/^https?:\/\//.test(servidor)) {
  console.error(
    "Falta o endereço do servidor do Flow (o PC que roda o self-host).\n" +
      "Uso:  node scripts/build-tizen.mjs http://192.168.15.7:3000\n" +
      "  ou: FLOW_SERVER=http://192.168.15.7:3000 npm run build:tizen\n\n" +
      "É esse endereço que o app instalado na TV vai chamar pra buscar\n" +
      "catálogo, imagens, perfis e o vídeo em si — ele fica embutido no\n" +
      "build, então mudou o IP do PC, precisa gerar e reinstalar de novo."
  );
  process.exit(1);
}

const versao = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version;

// [de, para] — tirados do caminho só durante o build.
const mover = [
  ["src/app/api", "api"], // rotas de API continuam só no PC
  ["src/proxy.ts", "proxy.ts"], // middleware não existe em export estático
  ["src/app/browse", "browse"], // rotas web; na TV é tudo uma tela só
  ["src/app/title", "title"], // rota dinâmica: não dá pra pré-renderizar
  ["src/app/watch", "watch"], // idem
  ["src/app/tv", "tv"], // vira a página raiz (abaixo)
  ["src/app/page.tsx", "page.tsx"], // tela de perfis da web dá lugar ao app de TV
  // Ícones de navegador: não existem em app de TV (quem define o ícone lá é
  // o <icon> do config.xml) e o `icon.png` gerado ainda tem o MESMO NOME do
  // ícone do app Samsung, que mora ao lado do config.xml — copiar por cima
  // trocaria o ícone do app sem avisar. Tirando daqui, o Next nem chega a
  // gerar os <link>, nem as entradas de metadata que o React reinsere na
  // hidratação (que apontariam pra "/favicon.ico", caminho absoluto que de
  // file:// nem existe).
  ["src/app/icon.png", "icon.png"],
  ["src/app/apple-icon.png", "apple-icon.png"],
  ["src/app/favicon.ico", "favicon.ico"],
];

function guardar() {
  mkdirSync(guardados, { recursive: true });
  for (const [de, nome] of mover) {
    const origem = join(raiz, de);
    if (existsSync(origem)) renameSync(origem, join(guardados, nome));
  }
}

function restaurar() {
  for (const [de, nome] of mover) {
    const salvo = join(guardados, nome);
    if (existsSync(salvo)) {
      rmSync(join(raiz, de), { recursive: true, force: true });
      renameSync(salvo, join(raiz, de));
    }
  }
  rmSync(guardados, { recursive: true, force: true });
}

// Se um build anterior morreu no meio (Ctrl+C, falta de espaço...), os
// arquivos ficaram guardados — devolve antes de começar, senão este build
// apagaria o que sobrou.
if (existsSync(guardados)) {
  console.log("Restaurando arquivos de um build interrompido antes...");
  restaurar();
}

console.log(`Gerando app de TV — servidor ${servidor}, versão ${versao}`);
try {
  guardar();
  // a página raiz do export passa a ser o app de tela única
  cpSync(join(guardados, "tv", "page.tsx"), join(raiz, "src/app/page.tsx"));

  // Chama o binário do Next pelo próprio Node, em vez de "npx next build":
  // no Windows o executável é `npx.cmd`, e execFileSync não resolve
  // extensão do PATHEXT nem passa por shell — dava `spawnSync npx ENOENT`.
  // Assim funciona igual nos dois sistemas, sem shell no meio.
  const binNext = join(raiz, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(binNext)) {
    throw new Error(`Next não encontrado em ${binNext} — rodou \`npm ci\` neste diretório?`);
  }
  execFileSync(process.execPath, [binNext, "build"], {
    cwd: raiz,
    stdio: "inherit",
    env: {
      ...process.env,
      FLOW_TIZEN: "1",
      NEXT_PUBLIC_FLOW_SERVER: servidor,
      NEXT_PUBLIC_FLOW_VERSAO: versao,
    },
  });
} finally {
  restaurar();
}

// Com `distDir` customizado (ver next.config.ts), o export cai direto ali —
// não num `out/` à parte. O distDir é separado de propósito: `next build`
// normal (o que roda no PC) usa `.next`, e um build aqui não pode passar por
// cima do build que está servindo o site.
const saida = join(raiz, ".next-tizen");
const destino = join(raiz, "tizen", "app");
rmSync(destino, { recursive: true, force: true });
cpSync(saida, destino, { recursive: true });

// O Next ainda emite favicon/ícones com caminho absoluto ("/icon.png"), que
// de `file://` apontaria pra raiz do sistema de arquivos da TV. Só esses —
// todo o resto já sai relativo por causa do assetPrefix.
const indexHtml = join(destino, "index.html");
writeFileSync(
  indexHtml,
  readFileSync(indexHtml, "utf8")
    .replace(/(href|src)="\/(favicon\.ico|icon\.png|apple-icon\.png)/g, '$1="./$2')
    // <link rel=preload as=font>: some junto com o motivo dele existir. A
    // fonte vira data: URI no CSS (ver abaixo), então o preload só sobraria
    // pra tomar um erro de CORS no console da TV buscando um arquivo que
    // ninguém mais usa.
    .replace(/<link[^>]*as="font"[^>]*>/g, "")
    // O mesmo preload aparece de novo dentro do payload que o Next embute
    // no HTML (as dicas `:HL[...,"font",...]`), e o router do cliente
    // dispara a partir dele. Mesmo motivo de tirar: a fonte já está em
    // data: URI no CSS.
    .replace(/:HL\[\\"[^\]]*?\.woff2[^\]]*?\]/g, ":HL[]")
);

// Peso morto dentro do widget:
//  - mock/ é o catálogo de demonstração, só serve rodando no PC;
//  - os .svg são o boilerplate que vem do template do Next;
//  - os .txt/_not-found/404 são artefatos de roteamento de servidor, que
//    não existe aqui: o app é uma tela só (ver src/app/tv/page.tsx).
for (const lixo of [
  "mock",
  "file.svg",
  "globe.svg",
  "next.svg",
  "vercel.svg",
  "window.svg",
  "404.html",
  "index.txt",
  "_not-found",
  "_not-found.html",
  "_not-found.txt",
  "__next.__PAGE__.txt",
  "__next._full.txt",
  "__next._tree.txt",
]) {
  rmSync(join(destino, lixo), { recursive: true, force: true });
}

// Fonte embutida como data: URI. Um documento `file://` tem origem "null",
// e fonte é um recurso que passa por CORS mesmo assim — o navegador recusa
// carregar o .woff2 do disco ("blocked by CORS policy") e o wordmark do
// Flow cai pra fonte de sistema. Confirmado rodando o próprio export por
// file:// aqui. Virando data: URI, não há request nenhuma pra bloquear.
const dirChunks = join(destino, "_next", "static", "chunks");
let fontesEmbutidas = 0;
for (const arquivo of readdirSync(dirChunks).filter((f) => f.endsWith(".css"))) {
  const caminhoCss = join(dirChunks, arquivo);
  const css = readFileSync(caminhoCss, "utf8");
  const novo = css.replace(/url\(([^)"']+\.woff2)\)/g, (inteiro, ref) => {
    const caminhoFonte = resolve(dirChunks, ref);
    if (!existsSync(caminhoFonte)) return inteiro;
    fontesEmbutidas += 1;
    return `url(data:font/woff2;base64,${readFileSync(caminhoFonte).toString("base64")})`;
  });
  if (novo !== css) writeFileSync(caminhoCss, novo);
}
console.log(`Fontes embutidas no CSS: ${fontesEmbutidas}`);

console.log(
  `\nPronto: tizen/app/\n\n` +
    `No Tizen Studio, o conteúdo dessa pasta é o do projeto (index.html na\n` +
    `raiz, junto do config.xml e do icon.png) — ver tizen/README.md.`
);
