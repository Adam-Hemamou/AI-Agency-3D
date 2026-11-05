import { describe, expect, it } from 'vitest';
import type { AppError } from '../errors/AppError.ts';
import { createLoginThrottle } from './loginThrottle.ts';

/** Délai imposé (en secondes), ou null si l'essai est permis. */
function waitOf(check: () => void): number | null {
  try {
    check();
    return null;
  } catch (error) {
    return ((error as AppError).details as { retryAfterSeconds: number }).retryAfterSeconds;
  }
}

describe('freinage des connexions', () => {
  it('laisse 5 essais, puis impose un délai qui double, plafonné à 15 minutes', () => {
    let now = 0;
    const throttle = createLoginThrottle({ clock: () => new Date(now) });
    for (let i = 0; i < 4; i++) throttle.failure('ip');
    expect(waitOf(() => throttle.check('ip'))).toBeNull();

    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      throttle.failure('ip');
      waits.push(waitOf(() => throttle.check('ip'))!);
      now += 16 * 60_000; // attendre la fin du délai, sans dépasser l'heure d'oubli
    }
    expect(waits).toEqual([60, 120, 240, 480, 900, 900]);
  });

  it('une connexion réussie remet le compteur à zéro ; les origines sont séparées', () => {
    const throttle = createLoginThrottle({ clock: () => new Date(0) });
    for (let i = 0; i < 5; i++) throttle.failure('a');
    expect(waitOf(() => throttle.check('a'))).toBe(60);
    expect(waitOf(() => throttle.check('b'))).toBeNull();
    throttle.success('a');
    expect(waitOf(() => throttle.check('a'))).toBeNull();
  });

  it('oublie les échecs anciens', () => {
    let now = 0;
    const throttle = createLoginThrottle({ clock: () => new Date(now) });
    for (let i = 0; i < 4; i++) throttle.failure('ip');
    now += 61 * 60_000;
    throttle.failure('ip');
    expect(waitOf(() => throttle.check('ip'))).toBeNull();
  });
});
