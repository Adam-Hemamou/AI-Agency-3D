import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { DEMO_SERVER_PORT, isDemoDataset, resolveDemoDatabaseUrl } from './config/demo.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import { createDatabaseProbe, createPrismaClient } from './db/prisma.ts';
import { logger } from './lib/logger.ts';
import { createMissionService } from './missions/missionService.ts';
import { createProspectService } from './prospects/prospectService.ts';

let config: AppConfig;
/** Démonstration : base séparée (…_demo) et port dédié, données fictives uniquement. */
const demoMode = isDemoDataset(process.env);
try {
  config = loadConfig();
  if (demoMode) {
    config = {
      ...config,
      DATABASE_URL: resolveDemoDatabaseUrl(process.env),
      SERVER_PORT: DEMO_SERVER_PORT,
      // La démonstration ne peut jamais déclencher d'action externe réelle.
      MODE_SIMULATION: true,
    };
  }
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const prisma = createPrismaClient(config.DATABASE_URL);
const missions = createMissionService(prisma);
const app = createApp({
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: config.MODE_SIMULATION }),
  version: pkg.version,
  simulationMode: config.MODE_SIMULATION,
  demoMode,
});

const server = app.listen(config.SERVER_PORT, '127.0.0.1', () => {
  logger.info(`API démarrée sur http://127.0.0.1:${config.SERVER_PORT}`);
  if (demoMode) logger.info('DÉMONSTRATION : base séparée, données fictives uniquement.');
  if (config.MODE_SIMULATION) {
    logger.info('Mode simulation ACTIF : aucune action externe réelle ne sera effectuée.');
  } else {
    logger.warn('Mode simulation DÉSACTIVÉ : les actions externes réelles sont autorisées.');
  }
});

server.on('error', (error) => {
  logger.error('Impossible de démarrer le serveur', error);
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} reçu, arrêt en cours…`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
