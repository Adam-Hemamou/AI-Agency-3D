import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AGENT_API_KEY_PATTERN, AGENT_API_KEY_PREFIX } from '@agency/shared';

/**
 * Clés API des agents.
 *
 * Format : agk_<identifiant public>_<secret>
 * - l'identifiant public (12 caractères) sert à retrouver la clé en base sans la révéler ;
 * - le secret (32 octets aléatoires, 256 bits) n'est jamais stocké : seule l'empreinte SHA-256
 *   de la clé complète l'est. Une clé de cette longueur, tirée au hasard, ne peut pas être
 *   retrouvée à partir de son empreinte : un hachage lent (bcrypt…) n'apporterait rien ici.
 */

const PUBLIC_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const PUBLIC_ID_LENGTH = 12;
const SECRET_BYTES = 32;

export interface GeneratedAgentKey {
  /** Clé complète, à transmettre une seule fois à l'utilisateur. */
  apiKey: string;
  /** Partie publique stockée en clair ("agk_xxxxxxxxxxxx"). */
  prefix: string;
  /** Empreinte stockée en base. */
  secretHash: string;
}

function randomPublicId(): string {
  // Tirage sans biais : 256 est rejeté au-delà du plus grand multiple de 36.
  const limit = 256 - (256 % PUBLIC_ID_ALPHABET.length);
  let id = '';
  while (id.length < PUBLIC_ID_LENGTH) {
    for (const byte of randomBytes(PUBLIC_ID_LENGTH * 2)) {
      if (byte < limit && id.length < PUBLIC_ID_LENGTH) {
        id += PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length];
      }
    }
  }
  return id;
}

export function hashAgentKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export function generateAgentKey(): GeneratedAgentKey {
  const prefix = `${AGENT_API_KEY_PREFIX}${randomPublicId()}`;
  const apiKey = `${prefix}_${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { apiKey, prefix, secretHash: hashAgentKey(apiKey) };
}

/** Extrait la partie publique d'une clé au bon format ; null sinon. */
export function parseAgentKey(apiKey: string): { prefix: string } | null {
  const match = AGENT_API_KEY_PATTERN.exec(apiKey);
  return match ? { prefix: `${AGENT_API_KEY_PREFIX}${match[1]}` } : null;
}

/** Compare la clé présentée à l'empreinte stockée, en temps constant. */
export function agentKeyMatches(apiKey: string, storedHash: string): boolean {
  const presented = Buffer.from(hashAgentKey(apiKey), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
