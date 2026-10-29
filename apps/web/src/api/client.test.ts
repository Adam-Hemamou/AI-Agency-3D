import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClientError, fetchJson } from './client';

const schema = z.object({ value: z.number() });

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('renvoie le corps validé', async () => {
    mockFetch(() => json({ value: 1 }));
    await expect(fetchJson('/x', schema)).resolves.toEqual({ value: 1 });
  });

  it("transmet le code d'erreur de l'API", async () => {
    mockFetch(() => json({ error: { code: 'NOT_FOUND', message: 'Introuvable' } }, 404));
    await expect(fetchJson('/x', schema)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Introuvable',
      status: 404,
    });
  });

  it('accepte un statut explicitement autorisé', async () => {
    mockFetch(() => json({ value: 2 }, 503));
    await expect(fetchJson('/x', schema, { acceptStatuses: [503] })).resolves.toEqual({
      value: 2,
    });
  });

  it('signale un serveur injoignable', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await fetchJson('/x', schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejette une réponse qui ne respecte pas le schéma', async () => {
    mockFetch(() => json({ value: 'pas un nombre' }));
    await expect(fetchJson('/x', schema)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
