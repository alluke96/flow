// Gera a galeria fixa de avatares (estilo flat/ilustrado) usados na tela de
// perfis. Roda uma única vez em dev — os SVGs resultantes ficam versionados
// em /public/avatars e viram uma allowlist fixa (ver src/lib/avatars.ts).
// Não é geração "em tempo real": é só um script de preparação de assets.
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

mkdirSync("public/avatars", { recursive: true });

const COUNT = 15;

function shapeFor(i) {
  const kind = i % 4;
  const fg = `hsl(${(i * 47 + 40) % 360} 70% 72%)`;
  if (kind === 0) return `<circle cx="50" cy="46" r="22" fill="${fg}"/>`;
  if (kind === 1) return `<polygon points="50,22 78,70 22,70" fill="${fg}"/>`;
  if (kind === 2) return `<rect x="27" y="27" width="46" height="46" rx="13" fill="${fg}"/>`;
  return `<ellipse cx="50" cy="50" rx="26" ry="20" fill="${fg}"/>`;
}

for (let i = 1; i <= COUNT; i++) {
  const h1 = (i * 63) % 360;
  const h2 = (i * 121 + 35) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h1} 55% 24%)"/>
      <stop offset="100%" stop-color="hsl(${h2} 55% 14%)"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#g)"/>
  ${shapeFor(i)}
</svg>`;
  const id = `avatar-${String(i).padStart(2, "0")}`;
  writeFileSync(`public/avatars/${id}.svg`, svg, "utf8");
}

console.log(`Gerados ${COUNT} avatares em public/avatars/`);
