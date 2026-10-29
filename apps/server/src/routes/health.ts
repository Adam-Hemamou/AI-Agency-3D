import { Router } from 'express';
import type { HealthResponse } from '@agency/shared';
import type { DatabaseProbe } from '../db/prisma.ts';

const DB_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai dépassé (${ms} ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface HealthDeps {
  db: DatabaseProbe;
  version: string;
  simulationMode: boolean;
}

/** GET /api/health : état de l'API et de la base. 200 si tout va bien, 503 sinon. */
export function healthRouter({ db, version, simulationMode }: HealthDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const started = performance.now();
    let database: HealthResponse['checks']['database'];
    try {
      await withTimeout(db.ping(), DB_TIMEOUT_MS);
      database = { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      database = {
        status: 'down',
        error: error instanceof Error ? error.message : 'erreur inconnue',
      };
    }

    const body: HealthResponse = {
      status: database.status === 'up' ? 'ok' : 'degraded',
      version,
      simulationMode,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
      timestamp: new Date().toISOString(),
    };
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });

  return router;
}
