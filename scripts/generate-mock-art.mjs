// Gera pôsteres/banners placeholder para o catálogo mock, para não depender
// de nenhuma imagem externa. Troque pelo Google Drive real quando conectar
// (ver src/lib/catalog-source/mock.ts).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const titles = JSON.parse(readFileSync("src/data/mock-titles.json", "utf8"));

mkdirSync("public/mock/posters", { recursive: true });
mkdirSync("public/mock/banners", { recursive: true });

function art(seed, w, h) {
  const h1 = (seed * 47) % 360;
  const h2 = (seed * 97 + 120) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h1} 55% 22%)"/>
      <stop offset="100%" stop-color="hsl(${h2} 55% 12%)"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`;
}

titles.forEach((t, i) => {
  const seed = i * 6 + 3;
  writeFileSync(`public/mock/posters/${t.id}.svg`, art(seed, 400, 600), "utf8");
  writeFileSync(`public/mock/banners/${t.id}.svg`, art(seed, 1600, 700), "utf8");
});

console.log(`Gerados posters/banners para ${titles.length} títulos mock.`);
