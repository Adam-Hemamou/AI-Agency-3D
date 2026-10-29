import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import { createDatabaseProbe, createPrismaClient } from './db/prisma.ts';
import { logger } from './lib/logger.ts';
import { createMissionService } from './missions/missionService.ts';

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const prisma = createPrismaClient(config.DATABASE_URL);
const app = createApp({
  db: createDatabaseProbe(prisma),
  missions: createMissionService(prisma),
  version: pkg.version,
  simulationMode: config.MODE_SIMULATION,
});

const server = app.listen(config.SERVER_PORT, '127.0.0.1', () => {
  logger.info(`API démarrée sur http://127.0.0.1:${config.SERVER_PORT}`);
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
