import express, { type Express } from 'express';
import type { DatabaseProbe } from './db/prisma.ts';
import { errorHandler, notFoundHandler } from './errors/errorHandler.ts';
import type { MissionService } from './missions/missionService.ts';
import { healthRouter } from './routes/health.ts';
import { missionsRouter } from './routes/missions.ts';

export interface AppDeps {
  db: DatabaseProbe;
  missions: MissionService;
  version: string;
  simulationMode: boolean;
}

/**
 * Construit l'application Express. Les dépendances sont injectées,
 * ce qui permet de la tester sans démarrer de serveur ni de base.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter(deps));
  app.use('/api/missions', missionsRouter(deps.missions));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
