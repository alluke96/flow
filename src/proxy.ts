import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Proxy (chamado "middleware" em versões anteriores do Next.js) — roda antes
 * de cada request. Cross-cutting de segurança (ver spec, seção 7):
 *  - Headers de segurança em toda resposta (CSP com nonce, HSTS, nosniff...).
 *  - CORS restrito: só a própria origem pode chamar /api/*.
 *  - Rate limiting por IP nos endpoints de API, com foco em streaming.
 */

const IS_DEV = process.env.NODE_ENV === "development";

const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  "/api/stream": { limit: 90, windowMs: 60_000 },
  "/api/catalog": { limit: 30, windowMs: 60_000 },
  "/api/title": { limit: 60, windowMs: 60_000 },
  "/api/image": { limit: 180, windowMs: 60_000 },
  // Perfis: só é chamado em momento pontual (abrir o app, esconder a aba,
  // sair do player, mexer na tela de perfis) — nunca em intervalo fixo.
  // Folga suficiente pra vários aparelhos na mesma casa (mesmo IP na LAN).
  "/api/profiles": { limit: 60, windowMs: 60_000 },
};

function matchRateLimit(pathname: string) {
  for (const [prefix, cfg] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return cfg;
  }
  return null;
}

// Gera um nonce novo por request e monta o header CSP. Next.js lê o
// 'nonce-...' deste header sozinho e aplica automaticamente aos scripts
// inline/chunks que ele mesmo injeta (framework, RSC payload etc.) — por
// isso o layout raiz precisa forçar renderização dinâmica (ver
// src/app/layout.tsx, `await connection()`), senão não há request pra
// gerar nonce a cada carregamento. Ver:
// https://nextjs.org/docs/app/guides/content-security-policy
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    // o vídeo de amostra do modo mock é servido por um domínio externo via
    // redirect — remova esta origem do media-src assim que o Drive real
    // estiver configurado, se quiser travar ainda mais.
    "media-src 'self' blob: https://interactive-examples.mdn.mozilla.net",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_DEV ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' aqui é só pro atributo `style` (usado nos
    // banners/posters com imagem dinâmica) — script-src continua travado
    // por nonce, que é o que importa contra XSS.
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    // `file:` aqui é herança da montagem ANTIGA do app de TV, em que uma
    // casca file:// carregava o Flow num <iframe> em tela cheia. Hoje o app
    // vai empacotado dentro do .wgt (ver tizen/README.md) e não enquadra
    // nada — quem ainda depende disto é só um widget da versão antiga que
    // continue instalado numa TV, que sem isto mostraria tela preta em vez
    // de uma pista do que houve. Pode sair assim que não houver mais
    // nenhum por aí. O custo de manter é pequeno: permite que uma página
    // file:// do próprio aparelho enquadre o Flow, num app de LAN
    // doméstica, sem login nem sessão pra roubar.
    "frame-ancestors 'self' file:",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  // X-Frame-Options saiu de propósito: ele só sabe dizer DENY/SAMEORIGIN e
  // não consegue expressar "permita a casca file:// do app de TV". Pela
  // especificação o frame-ancestors do CSP tem precedência quando os dois
  // existem, mas o webview do Tizen é um Chromium de alguns anos atrás e
  // não vale apostar nisso pra descobrir com tela preta na TV. Quem manda
  // no enquadramento agora é só o frame-ancestors acima — que é o
  // mecanismo moderno, mais expressivo, e respeitado por todo navegador
  // relevante.
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  return res;
}

/**
 * Libera a leitura das respostas de /api/* pra origens que não são a do
 * próprio servidor. Existe por causa do app de TV: ele roda de `file://`
 * dentro do widget, então TODA chamada dele é cross-origin e, sem estes
 * headers, o navegador da TV até faz a request mas proíbe o app de ler a
 * resposta — catálogo vazio, perfis que não carregam, e nenhum erro óbvio
 * dizendo o porquê.
 *
 * Ecoa a origem recebida em vez de "*" só pra manter `Vary: Origin`
 * coerente em cache; sem cookie/sessão no app, os dois seriam equivalentes
 * em permissividade.
 */
function corsApi(res: NextResponse, origin: string | null): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  if (pathname.startsWith("/api/")) {
    // CORS restrito: só a própria origem pode fazer requests que MUDAM
    // estado em /api/* (é o que de fato importa proteger — um site hostil
    // induzindo o navegador de alguém a chamar isso é o cenário clássico de
    // CSRF). GET/HEAD ficam de fora de propósito: são leitura pura
    // (catálogo, imagem, STREAMING DE VÍDEO) e bloquear eles por engano é
    // muito pior que o risco que essa checagem evita num app sem login (não
    // tem sessão/cookie de ninguém pra proteger de CSRF em primeiro lugar).
    //
    // Essa distinção importa na prática, não só em teoria: antes desta app
    // comparar Origin contra o Host da própria request (em vez de um
    // domínio fixo em NEXT_PUBLIC_SITE_ORIGIN, opcional), a checagem inteira
    // ficava desligada sempre que essa variável não estivesse configurada —
    // que era exatamente o caso do self-host. Vídeo sempre "funcionou"
    // simplesmente porque a checagem nunca rodava de verdade. Assim que ela
    // passou a rodar sempre, algum request de streaming (Origin enviado
    // pelo navegador/TV não batendo com o Host que o servidor recebeu —
    // porta, hostname .local, sei lá) começou a tomar 403 no meio da
    // reprodução: o <video> recebe um JSON de erro no lugar dos bytes do
    // arquivo, falha ao decodificar AQUILO, e a mensagem genérica de erro
    // do player (que não distingue rede de codec) aponta pro formato do
    // arquivo — mesmo sendo, na real, um bloqueio de CORS.
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const expectedOrigin = host ? `${req.nextUrl.protocol}//${host}` : null;
    const isSafeMethod = req.method === "GET" || req.method === "HEAD";
    // "null" é a origem que um documento file:// manda — é exatamente o
    // caso do app de TV, que roda empacotado dentro do .wgt e fala com
    // este servidor por IP (ver scripts/build-tizen.mjs e api-client.ts).
    // Liberar isso aqui não afrouxa nada de verdade: como o comentário
    // acima já explica, não existe login nem cookie de sessão neste app
    // pra um CSRF roubar — a checagem é higiene, não fronteira.
    const isWidgetTizen = origin === "null";
    if (!isSafeMethod && origin && !isWidgetTizen && expectedOrigin && origin !== expectedOrigin) {
      const res = NextResponse.json({ error: "origem não permitida" }, { status: 403 });
      res.headers.set("Content-Security-Policy", csp);
      return corsApi(applySecurityHeaders(res), origin);
    }

    // Preflight (OPTIONS): o navegador manda antes de um POST/PUT com
    // Content-Type: application/json vindo de outra origem — sem responder
    // isso, salvar perfil pelo app de TV nunca sai do lugar.
    if (req.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      return corsApi(applySecurityHeaders(res), origin);
    }

    const cfg = matchRateLimit(pathname);
    if (cfg) {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      const routeGroup = pathname.split("/").slice(0, 3).join("/");
      const result = checkRateLimit(`${ip}:${routeGroup}`, cfg.limit, cfg.windowMs);
      if (!result.allowed) {
        const res = NextResponse.json(
          { error: "muitas requisições, tente novamente em instantes." },
          { status: 429 }
        );
        res.headers.set(
          "Retry-After",
          Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)).toString()
        );
        res.headers.set("Content-Security-Policy", csp);
        return applySecurityHeaders(res);
      }
    }

    const apiRes = NextResponse.next();
    apiRes.headers.set("Content-Security-Policy", csp);
    return corsApi(applySecurityHeaders(apiRes), origin);
  }

  // Páginas: propaga o nonce pro Next.js via header de request (é assim que
  // ele descobre o nonce pra aplicar aos scripts que injeta) e devolve o
  // mesmo CSP na resposta.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return applySecurityHeaders(res);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
