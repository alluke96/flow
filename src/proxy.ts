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
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
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

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  if (pathname.startsWith("/api/")) {
    // CORS restrito: só a própria origem pode chamar /api/*. Em vez de
    // comparar contra um domínio único fixo (o que quebra assim que o app
    // roda em mais de um endereço — self-host acessado por IP, hostname
    // .local, um domínio local via Pi-hole/AdGuard, etc., além do Vercel),
    // compara contra o Host da própria request: uma chamada same-origin de
    // verdade sempre tem Origin === "<protocolo>://<host que ela mesma
    // recebeu>", não importa qual endereço isso seja. Uma origem diferente
    // (outro site tentando chamar essa API) nunca bate com o Host da
    // request dela mesma, então continua barrada igual.
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const expectedOrigin = host ? `${req.nextUrl.protocol}//${host}` : null;
    if (origin && expectedOrigin && origin !== expectedOrigin) {
      const res = NextResponse.json({ error: "origem não permitida" }, { status: 403 });
      res.headers.set("Content-Security-Policy", csp);
      return applySecurityHeaders(res);
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
    return applySecurityHeaders(apiRes);
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
