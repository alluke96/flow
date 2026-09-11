/**
 * Cache simples em memória com TTL, usado para não estourar a cota da API
 * do Google Drive a cada carregamento de página (ver spec, seção 6).
 *
 * Isso vive por instância de servidor — em produção com múltiplas
 * regiões/instâncias seria melhor um backend compartilhado (Upstash Redis,
 * Vercel KV...), mas para o volume de um catálogo pessoal isto é suficiente
 * e mantém o projeto sem dependências externas obrigatórias.
 */
const store = new Map<string, { value: unknown; expiresAt: number }>();

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateCached(key: string): void {
  store.delete(key);
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  setCached(key, value, ttlMs);
  return value;
}
