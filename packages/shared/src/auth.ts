import { z } from 'zod';

/**
 * Authentification de l'utilisateur humain (propriétaire de l'agence).
 * Un mot de passe local, défini depuis le terminal, ouvre une session de 12 heures.
 * Toute requête qui n'est ni celle d'une session humaine valide, ni celle d'un agent muni
 * de sa clé, est refusée.
 */

/** Durée d'une session humaine, fixe à partir de la connexion. */
export const OWNER_SESSION_HOURS = 12;

/** Longueur minimale du mot de passe administrateur. */
export const OWNER_PASSWORD_MIN_LENGTH = 12;

/** Nom du cookie de session (HttpOnly : jamais lisible par le JavaScript de la page). */
export const SESSION_COOKIE_NAME = 'agency_session';

export const loginRequestSchema = z.strictObject({
  password: z.string().min(1, { error: 'Mot de passe obligatoire' }).max(512),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  /** Fin de la session (ISO 8601), null si non connecté. */
  expiresAt: z.string().nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export function checkOwnerPassword(password: string): string | null {
  if (password.length < OWNER_PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${OWNER_PASSWORD_MIN_LENGTH} caractères`;
  }
  if (password.trim() !== password)
    return 'Le mot de passe ne doit pas commencer ni finir par un espace';
  return null;
}
