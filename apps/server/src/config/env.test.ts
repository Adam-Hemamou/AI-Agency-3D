import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const DB = 'mysql://agency:pw@localhost:3306/ai_agency';

describe('configuration (.env)', () => {
  it('applique les valeurs par défaut', () => {
    const config = parseEnv({ DATABASE_URL: DB });
    expect(config.SERVER_PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
  });

  it('active le mode simulation par défaut', () => {
    expect(parseEnv({ DATABASE_URL: DB }).MODE_SIMULATION).toBe(true);
  });

  it('ne désactive le mode simulation que sur "false" explicite', () => {
    expect(parseEnv({ DATABASE_URL: DB, MODE_SIMULATION: 'false' }).MODE_SIMULATION).toBe(false);
    expect(parseEnv({ DATABASE_URL: DB, MODE_SIMULATION: 'true' }).MODE_SIMULATION).toBe(true);
  });

  it('refuse une valeur ambiguë pour MODE_SIMULATION', () => {
    expect(() => parseEnv({ DATABASE_URL: DB, MODE_SIMULATION: 'non' })).toThrow(/MODE_SIMULATION/);
  });

  it('exige DATABASE_URL au format mysql://', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x' })).toThrow(/mysql:\/\//);
  });

  it('refuse un port invalide', () => {
    expect(() => parseEnv({ DATABASE_URL: DB, SERVER_PORT: '99999' })).toThrow(/SERVER_PORT/);
  });
});
