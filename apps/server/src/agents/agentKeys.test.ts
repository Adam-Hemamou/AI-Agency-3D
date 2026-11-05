import { describe, expect, it } from 'vitest';
import { AGENT_API_KEY_PATTERN } from '@agency/shared';
import { agentKeyMatches, generateAgentKey, hashAgentKey, parseAgentKey } from './agentKeys.ts';

describe('clés API des agents', () => {
  it('génère une clé au format attendu, avec son identifiant public', () => {
    const key = generateAgentKey();
    expect(key.apiKey).toMatch(AGENT_API_KEY_PATTERN);
    expect(key.apiKey.startsWith(`${key.prefix}_`)).toBe(true);
    expect(key.prefix).toMatch(/^agk_[a-z0-9]{12}$/);
  });

  it('génère des clés toutes différentes', () => {
    const keys = Array.from({ length: 200 }, () => generateAgentKey());
    expect(new Set(keys.map((k) => k.apiKey)).size).toBe(200);
    expect(new Set(keys.map((k) => k.prefix)).size).toBe(200);
  });

  it('ne stocke que l’empreinte : le secret n’y figure pas', () => {
    const key = generateAgentKey();
    const secret = key.apiKey.slice(key.prefix.length + 1);
    expect(key.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.secretHash).toBe(hashAgentKey(key.apiKey));
    expect(key.secretHash).not.toContain(secret);
  });

  it('reconnaît la bonne clé et refuse les autres', () => {
    const key = generateAgentKey();
    expect(agentKeyMatches(key.apiKey, key.secretHash)).toBe(true);
    expect(agentKeyMatches(generateAgentKey().apiKey, key.secretHash)).toBe(false);
    // Même identifiant public, secret différent.
    const forged = `${key.prefix}_${'A'.repeat(43)}`;
    expect(agentKeyMatches(forged, key.secretHash)).toBe(false);
    // Empreinte stockée corrompue ou vide.
    expect(agentKeyMatches(key.apiKey, '')).toBe(false);
  });

  it('extrait l’identifiant public d’une clé bien formée seulement', () => {
    const key = generateAgentKey();
    expect(parseAgentKey(key.apiKey)).toEqual({ prefix: key.prefix });
    for (const bad of ['', 'owner', key.prefix, `${key.apiKey} `, `Bearer ${key.apiKey}`]) {
      expect(parseAgentKey(bad)).toBeNull();
    }
  });
});
