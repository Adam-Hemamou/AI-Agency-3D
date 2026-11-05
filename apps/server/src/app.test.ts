import request from 'supertest';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@agency/shared';
import { createApp, type AppDeps } from './app.ts';
import type { OwnerAuthService } from './auth/ownerAuth.ts';
import type { DatabaseProbe } from './db/prisma.ts';
import { AppError } from './errors/AppError.ts';
import { errorHandler } from './errors/errorHandler.ts';
import type { MissionService } from './missions/missionService.ts';

/** Ces tests ne sollicitent pas les missions (testées à part, avec MySQL). */
const unusedMissions = {} as MissionService;

const upDb: DatabaseProbe = { ping: async () => {} };
const downDb: DatabaseProbe = {
  ping: async () => {
    throw new Error('connexion refusée');
  },
};

const SESSION = 'S'.repeat(43);
const SESSION_COOKIE = `agency_session=${SESSION}`;
/** Une seule session reconnue : SESSION. */
const fakeOwner = {
  authenticate: async (token: string) =>
    token === SESSION ? { id: 'session-1', expiresAt: new Date('2026-11-06T00:00:00Z') } : null,
} as unknown as OwnerAuthService;

function makeApp(db: DatabaseProbe, extra: Partial<AppDeps> = {}) {
  return createApp({
    db,
    missions: unusedMissions,
    version: '0.1.0',
    simulationMode: true,
    owner: fakeOwner,
    ...extra,
  });
}

describe('GET /api/health', () => {
  it('répond 200 et "ok" quand la base répond', async () => {
    const res = await request(makeApp(upDb)).get('/api/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      status: 'ok',
      simulationMode: true,
      checks: { database: { status: 'up' } },
    });
  });

  it('répond 503 et "degraded" quand la base est injoignable', async () => {
    const res = await request(makeApp(downDb)).get('/api/health');
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toEqual({ status: 'down', error: 'connexion refusée' });
  });

  it("n'expose pas l'en-tête x-powered-by", async () => {
    const res = await request(makeApp(upDb)).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('gestion des erreurs', () => {
  it('ne révèle rien à une requête sans identité, même pour une route inconnue (401)', async () => {
    const res = await request(makeApp(upDb)).get('/api/inexistant');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('renvoie une 404 au format standard pour une route inconnue (connecté)', async () => {
    const res = await request(makeApp(upDb)).get('/api/inexistant').set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route introuvable : GET /api/inexistant' },
    });
  });

  it('renvoie une 400 pour un JSON mal formé', async () => {
    const res = await request(makeApp(upDb))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{mal formé');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  function appThrowing(error: unknown) {
    const app = express();
    app.get('/boom', () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it('transmet le code et le statut HTTP d’une AppError', async () => {
    const res = await request(appThrowing(AppError.externalActionBlocked('envoi e-mail'))).get(
      '/boom',
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'EXTERNAL_ACTION_BLOCKED',
      message: 'Action externe refusée en mode simulation : envoi e-mail',
    });
  });

  it('renvoie 503 DATABASE_UNAVAILABLE quand la base est injoignable', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await request(appThrowing({ code: 'P1001' })).get('/boom');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    } finally {
      console.error = original;
    }
  });

  it('masque le détail des erreurs imprévues', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await request(appThrowing(new Error('secret interne'))).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne du serveur',
      });
    } finally {
      console.error = original;
    }
  });
});

describe('protection contre les requêtes venues d’ailleurs', () => {
  it.each(['evil.example', 'evil.example:3001', '127.0.0.1.evil.example', ''])(
    'refuse l’adresse %j (DNS rebinding)',
    async (host) => {
      const res = await request(makeApp(upDb)).get('/api/health').set('Host', host);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
    },
  );

  it.each(['localhost:5173', '127.0.0.1:3001', 'LOCALHOST'])('accepte %j', async (host) => {
    const res = await request(makeApp(upDb)).get('/api/health').set('Host', host);
    expect(res.status).toBe(200);
  });

  it('accepte un nom d’hôte ajouté explicitement (n8n plus tard)', async () => {
    const app = makeApp(upDb, { allowedHosts: ['host.docker.internal'] });
    const res = await request(app).get('/api/health').set('Host', 'host.docker.internal:3001');
    expect(res.status).toBe(200);
  });

  const write = (origin: string | null) => {
    const req = request(makeApp(upDb))
      .post('/api/inexistant')
      .set('Host', 'localhost:5173')
      .set('Cookie', SESSION_COOKIE);
    return origin === null ? req : req.set('Origin', origin);
  };

  it.each([
    ['sans Origin', null],
    ['autre site', 'http://evil.example'],
    ['autre application locale (autre port)', 'http://localhost:8080'],
    ['autre schéma', 'https://localhost:5173'],
  ])('refuse une écriture avec la session : %s', async (_label, origin) => {
    const res = await write(origin);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('accepte une écriture venant de l’interface (même origine)', async () => {
    const res = await write('http://localhost:5173');
    expect(res.status).toBe(404); // passée les contrôles : route inexistante
  });

  it('les lectures avec la session ne demandent pas d’Origin', async () => {
    const res = await request(makeApp(upDb))
      .get('/api/inexistant')
      .set('Host', 'localhost:5173')
      .set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(404);
  });
});
