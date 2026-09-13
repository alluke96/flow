/**
 * Galeria fixa de avatares — allowlist. Um perfil só pode referenciar um
 * destes IDs; nunca uma URL arbitrária (ver ProfileProvider.updateProfile).
 * Gerados uma única vez por scripts/generate-avatars.mjs.
 */
export const AVATAR_IDS = Array.from(
  { length: 15 },
  (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`
);

export const DEFAULT_AVATAR_ID = AVATAR_IDS[0];

export function isValidAvatarId(id: unknown): id is string {
  return typeof id === "string" && AVATAR_IDS.includes(id);
}

export function avatarSrc(id: string): string {
  const safe = isValidAvatarId(id) ? id : DEFAULT_AVATAR_ID;
  // No app de TV a página roda de `file://` e "/avatars/..." apontaria pra
  // raiz do sistema de arquivos da TV — o avatar simplesmente não
  // carregaria. Lá o app é uma página só, na raiz, então relativo sempre
  // resolve certo; na web continua absoluto porque as rotas são aninhadas
  // (/title/xyz), onde "./avatars" viraria "/title/avatars".
  const base = typeof window !== "undefined" && window.location.protocol === "file:" ? "./" : "/";
  return `${base}avatars/${safe}.svg`;
}
