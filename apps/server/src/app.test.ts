import request from 'supertest';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@agency/shared';
import { createApp } from './app.ts';
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

function makeApp(db: DatabaseProbe) {
  return createApp({ db, missions: unusedMissions, version: '0.1.0', simulationMode: true });
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
  it('renvoie une 404 au format standard pour une route inconnue', async () => {
    const res = await request(makeApp(upDb)).get('/api/inexistant');
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
