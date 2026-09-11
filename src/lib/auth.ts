/**
 * Middleware de autenticação "vazio"/plugável. Hoje não existe login de
 * usuário (só perfis locais, ver src/context/profile-context.tsx), então
 * `getSession` sempre retorna null e nenhuma rota exige sessão.
 *
 * Quando autenticação de verdade for adicionada (JWT/sessão + usuários
 * reais), a validação entra aqui e as rotas que chamarem `requireAuth`
 * passam a exigi-la — sem precisar reescrever a lógica de catálogo/streaming.
 */
export interface Session {
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getSession(req: Request): Promise<Session | null> {
  return null;
}

export async function requireAuth(req: Request): Promise<Session | null> {
  // Hoje: no-op, sempre libera. Trocar por validação real de token/cookie
  // quando o produto tiver contas de usuário.
  return getSession(req);
}
