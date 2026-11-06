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

describe('écoute Tailscale (.env)', () => {
  const PC = '100.90.1.10';
  const VPS = '100.90.2.20';
  const tailnet = (overrides: Record<string, string> = {}) =>
    parseEnv({
      DATABASE_URL: DB,
      ALLOWED_HOSTS: PC,
      TAILSCALE_BIND_ADDRESS: PC,
      TAILSCALE_ALLOWED_PEER: VPS,
      ...overrides,
    });

  it('est désactivée par défaut (écoute locale uniquement)', () => {
    const config = parseEnv({ DATABASE_URL: DB });
    expect(config.TAILSCALE_BIND_ADDRESS).toBe('');
    expect(config.TAILSCALE_ALLOWED_PEER).toBe('');
  });

  it('accepte l’adresse du PC et celle du VPS', () => {
    const config = tailnet();
    expect(config.TAILSCALE_BIND_ADDRESS).toBe(PC);
    expect(config.TAILSCALE_ALLOWED_PEER).toBe(VPS);
  });

  it('refuse explicitement 0.0.0.0 et ::', () => {
    expect(() => tailnet({ TAILSCALE_BIND_ADDRESS: '0.0.0.0', ALLOWED_HOSTS: '0.0.0.0' })).toThrow(
      /0\.0\.0\.0 est interdit/,
    );
    expect(() => tailnet({ TAILSCALE_BIND_ADDRESS: '::' })).toThrow(/:: est interdit/);
  });

  it('refuse toute adresse d’écoute hors Tailscale (réseau local, 127.0.0.1…)', () => {
    for (const ip of ['192.168.1.20', '127.0.0.1', '10.0.0.5', 'localhost']) {
      expect(() => tailnet({ TAILSCALE_BIND_ADDRESS: ip, ALLOWED_HOSTS: ip })).toThrow(
        /TAILSCALE_BIND_ADDRESS/,
      );
    }
  });

  it('refuse les écritures ambiguës des deux adresses (hexadécimal, 1e2, zéros en tête…)', () => {
    const ambiguous = (ip: string) => [
      ip.replace('100.', '0x64.'),
      ip.replace('100.', '1e2.'),
      ip.replace(/\.(\d+)$/, '.0$1'),
      ip.replace(/\.\d+$/, '.'),
      ip.replace('.', '..'),
      `+${ip}`,
    ];
    for (const bad of ambiguous(PC)) {
      expect(() => tailnet({ TAILSCALE_BIND_ADDRESS: bad, ALLOWED_HOSTS: bad }), bad).toThrow(
        /TAILSCALE_BIND_ADDRESS/,
      );
    }
    for (const bad of ambiguous(VPS)) {
      expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: bad }), bad).toThrow(/TAILSCALE_ALLOWED_PEER/);
    }
  });

  it('ignore les espaces autour des valeurs du .env', () => {
    const config = tailnet({
      TAILSCALE_BIND_ADDRESS: ` ${PC} `,
      TAILSCALE_ALLOWED_PEER: `${VPS} `,
    });
    expect(config.TAILSCALE_BIND_ADDRESS).toBe(PC);
    expect(config.TAILSCALE_ALLOWED_PEER).toBe(VPS);
  });

  it('exige une machine autorisée unique et Tailscale', () => {
    expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: '0.0.0.0' })).toThrow(/TAILSCALE_ALLOWED_PEER/);
    expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: '100.64.0.0/10' })).toThrow(
      /TAILSCALE_ALLOWED_PEER/,
    );
    expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: `${VPS},100.100.1.1` })).toThrow(
      /TAILSCALE_ALLOWED_PEER/,
    );
    expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: PC })).toThrow(/pas celle de ce PC/);
  });

  it('exige les deux variables ensemble', () => {
    expect(() => tailnet({ TAILSCALE_ALLOWED_PEER: '' })).toThrow(/vont ensemble/);
    expect(() => tailnet({ TAILSCALE_BIND_ADDRESS: '' })).toThrow(/vont ensemble/);
  });

  it('exige que ALLOWED_HOSTS contienne l’adresse d’écoute (hostGuard reste explicite)', () => {
    expect(() => tailnet({ ALLOWED_HOSTS: '' })).toThrow(/ALLOWED_HOSTS/);
    expect(tailnet({ ALLOWED_HOSTS: `host.docker.internal, ${PC}` }).ALLOWED_HOSTS).toEqual([
      'host.docker.internal',
      PC,
    ]);
  });
});

describe('délai des missions interrompues (.env)', () => {
  it('60 minutes par défaut', () => {
    expect(parseEnv({ DATABASE_URL: DB }).MISSION_STALE_MINUTES).toBe(60);
  });

  it('accepte une valeur configurée', () => {
    expect(parseEnv({ DATABASE_URL: DB, MISSION_STALE_MINUTES: '180' }).MISSION_STALE_MINUTES).toBe(
      180,
    );
  });

  it.each(['0', '4', '10081', '30.5', 'une heure', '-60'])('refuse « %s »', (value) => {
    expect(() => parseEnv({ DATABASE_URL: DB, MISSION_STALE_MINUTES: value })).toThrow(
      /MISSION_STALE_MINUTES/,
    );
  });
});
