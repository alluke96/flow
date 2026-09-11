/**
 * Galeria fixa de avatares — allowlist. Um perfil só pode referenciar um
 * destes IDs; nunca uma URL arbitrária (ver ProfileProvider.updateProfile).
 * Gerados uma única vez por scripts/generate-avatars.mjs.
 */
export const AVATAR_IDS = Array.from(
  { length: 16 },
  (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`
);

export const DEFAULT_AVATAR_ID = AVATAR_IDS[0];

export function isValidAvatarId(id: unknown): id is string {
  return typeof id === "string" && AVATAR_IDS.includes(id);
}

export function avatarSrc(id: string): string {
  const safe = isValidAvatarId(id) ? id : DEFAULT_AVATAR_ID;
  return `/avatars/${safe}.svg`;
}
