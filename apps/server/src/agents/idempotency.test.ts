import { describe, expect, it } from 'vitest';
import { requestFingerprint } from './idempotency.ts';

describe('empreinte d’une requête', () => {
  it('ne dépend pas de l’ordre des clés du JSON', () => {
    expect(requestFingerprint('POST', '/a', { x: 1, y: { b: 2, a: [1, { d: 1, c: 2 }] } })).toBe(
      requestFingerprint('post', '/a', { y: { a: [1, { c: 2, d: 1 }], b: 2 }, x: 1 }),
    );
  });

  it('distingue la méthode, le chemin et le contenu', () => {
    const base = requestFingerprint('POST', '/a', { x: 1 });
    expect(requestFingerprint('PATCH', '/a', { x: 1 })).not.toBe(base);
    expect(requestFingerprint('POST', '/b', { x: 1 })).not.toBe(base);
    expect(requestFingerprint('POST', '/a', { x: 2 })).not.toBe(base);
    // L'ordre d'un tableau compte.
    expect(requestFingerprint('POST', '/a', [1, 2])).not.toBe(
      requestFingerprint('POST', '/a', [2, 1]),
    );
  });
});
