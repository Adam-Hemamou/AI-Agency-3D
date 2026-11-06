import type { Server } from 'node:http';
import pkg from '../package.json' with { type: 'json' };
import { createAgentService } from './agents/agentService.ts';
import { createAgentControl } from './agents/agentControl.ts';
import { createIdempotencyStore } from './agents/idempotency.ts';
import { createQuotaService } from './agents/quotas.ts';
import { createApp } from './app.ts';
import { createOwnerAuthService } from './auth/ownerAuth.ts';
import { DEMO_SERVER_PORT, isDemoDataset, resolveDemoDatabaseUrl } from './config/demo.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import { createDatabaseProbe, createPrismaClient } from './db/prisma.ts';
import { logger } from './lib/logger.ts';
import { createMissionService } from './missions/missionService.ts';
import { createShutdown } from './network/shutdown.ts';
import { closeServers, SHUTDOWN_TIMEOUT_MS, startTailnetListener } from './network/tailnet.ts';
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
      // Ni être joignable depuis une autre machine : écoute locale uniquement.
      TAILSCALE_BIND_ADDRESS: '',
      TAILSCALE_ALLOWED_PEER: '',
    };
  }
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const prisma = createPrismaClient(config.DATABASE_URL);
const missions = createMissionService(prisma);
const owner = createOwnerAuthService({ prisma });
const agentControl = createAgentControl({ prisma, envEnabled: config.AGENTS_ENABLED });
try {
  // L'interrupteur enregistré s'applique avant d'accepter la moindre requête.
  await agentControl.load();
} catch (error) {
  logger.warn('Arrêt d’urgence : état enregistré illisible, agents ARRÊTÉS par précaution', error);
  await agentControl.setEnabled(false).catch(() => {});
}
const app = createApp({
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: config.MODE_SIMULATION }),
  agents: createAgentService({ prisma }),
  idempotency: createIdempotencyStore(prisma),
  owner,
  quotas: createQuotaService({ prisma }),
  agentControl,
  allowedHosts: config.ALLOWED_HOSTS,
  version: pkg.version,
  simulationMode: config.MODE_SIMULATION,
  demoMode,
});

const server = app.listen(config.SERVER_PORT, '127.0.0.1', () => {
  logger.info(`API démarrée sur http://127.0.0.1:${config.SERVER_PORT}`);
  if (demoMode) logger.info('DÉMONSTRATION : base séparée, données fictives uniquement.');
  void owner.hasPassword().then(
    (defined) => {
      if (!defined) {
        logger.warn('Aucun mot de passe administrateur : lancez « npm run owner:password ».');
      }
    },
    () => logger.warn('Mot de passe administrateur : vérification impossible (base injoignable ?)'),
  );
  if (!agentControl.isEnabled()) {
    logger.warn('ARRÊT D’URGENCE ACTIF : toutes les opérations des agents sont refusées.');
  }
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

/** Deuxième écoute (Tailscale), réservée au VPS. Son échec n'arrête jamais l'API locale. */
let tailnetServer: Server | undefined;
if (config.TAILSCALE_BIND_ADDRESS) {
  const { TAILSCALE_BIND_ADDRESS: host, TAILSCALE_ALLOWED_PEER: allowedPeer } = config;
  startTailnetListener(app, {
    host,
    port: config.SERVER_PORT,
    allowedPeer,
    onRejected: (remote) => logger.warn(`Tailscale : connexion refusée depuis ${remote}`),
    onRouteRejected: (method, url) =>
      logger.warn(`Tailscale : route refusée (hors routes des agents) : ${method} ${url}`),
  }).then(
    (started) => {
      tailnetServer = started;
      started.on('error', (error) => logger.error('Écoute Tailscale : erreur', error));
      logger.info(
        `API aussi joignable via Tailscale sur http://${host}:${config.SERVER_PORT} (uniquement depuis ${allowedPeer}, routes /api/health, /api/agent/… et GET /api/agents/me seulement)`,
      );
    },
    (error: unknown) =>
      logger.error(
        `Écoute Tailscale impossible sur ${host}:${config.SERVER_PORT} (Tailscale démarré ?). API locale maintenue.`,
        error,
      ),
  );
}

const shutdown = createShutdown({
  // Requêtes en cours : SHUTDOWN_TIMEOUT_MS (5 s) au plus, puis connexions coupées.
  closeServers: () =>
    closeServers([server, tailnetServer], {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      onForced: () =>
        logger.warn('Arrêt : requêtes encore en cours après 5 s, connexions coupées.'),
    }),
  disconnect: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
  log: logger,
});

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
