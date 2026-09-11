/**
 * Rate limiting simples em memória (janela fixa por chave). Aplicado nos
 * endpoints de catálogo e streaming (ver middleware.ts) para mitigar abuso
 * básico. Assim como o cache, isto é por instância — para produção em
 * múltiplas regiões, troque por um backend compartilhado mantendo a mesma
 * assinatura de `checkRateLimit`.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt, limit };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    limit,
  };
}

// Evita crescimento ilimitado do Map em processos de longa duração (dev
// server, funções "warm"). Em ambientes serverless de vida curta isto
// nunca chega a rodar, o que é inofensivo.
if (typeof setInterval !== "undefined") {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key);
    }
  }, 60_000);
  sweep.unref?.();
}
