import { ERROR_CODES } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock } from '../missions/missionService.ts';

/**
 * Freine les essais de mot de passe : après FREE_ATTEMPTS échecs, chaque nouvel essai attend
 * un délai qui double (1 min, 2 min, 4 min…), jusqu'à 15 minutes. Une connexion réussie remet
 * le compteur à zéro. En mémoire : suffisant pour un serveur local unique.
 */

const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 15 * 60_000;
/** Un compteur sans échec depuis ce délai est oublié. */
const FORGET_AFTER_MS = 60 * 60_000;

interface Entry {
  failures: number;
  blockedUntil: number;
  lastFailure: number;
}

export function createLoginThrottle({ clock = systemClock }: { clock?: Clock } = {}) {
  const entries = new Map<string, Entry>();

  function current(key: string, now: number): Entry | undefined {
    const entry = entries.get(key);
    if (entry && now - entry.lastFailure > FORGET_AFTER_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    /** Lève RATE_LIMITED (429) si cette origine doit encore attendre. */
    check(key: string): void {
      const now = clock().getTime();
      const entry = current(key, now);
      if (entry && entry.blockedUntil > now) {
        const seconds = Math.ceil((entry.blockedUntil - now) / 1000);
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          `Trop de tentatives de connexion : réessayez dans ${seconds} s`,
          429,
          { retryAfterSeconds: seconds },
        );
      }
    },

    failure(key: string): void {
      const now = clock().getTime();
      const entry = current(key, now) ?? { failures: 0, blockedUntil: 0, lastFailure: now };
      entry.failures += 1;
      entry.lastFailure = now;
      if (entry.failures >= FREE_ATTEMPTS) {
        const delay = Math.min(BASE_DELAY_MS * 2 ** (entry.failures - FREE_ATTEMPTS), MAX_DELAY_MS);
        entry.blockedUntil = now + delay;
      }
      entries.set(key, entry);
    },

    success(key: string): void {
      entries.delete(key);
    },
  };
}

export type LoginThrottle = ReturnType<typeof createLoginThrottle>;
