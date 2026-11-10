import type { Server } from 'node:http';
import pkg from '../package.json' with { type: 'json' };
import { createAgentProfileService } from './agents/agentProfileService.ts';
import { createAgentService } from './agents/agentService.ts';
import { createRunService } from './agents/runService.ts';
import { startCampaignScheduler } from './campaigns/campaignScheduler.ts';
import { createCampaignService } from './campaigns/campaignService.ts';
import { createAgentControl } from './agents/agentControl.ts';
import { createIdempotencyStore } from './agents/idempotency.ts';
import { createQuotaService } from './agents/quotas.ts';
import { createApp } from './app.ts';
import { createOwnerAuthService } from './auth/ownerAuth.ts';
import { DEMO_SERVER_PORT, isDemoDataset, resolveDemoDatabaseUrl } from './config/demo.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import {
  compareMigrations,
  describeDatabase,
  listRepositoryMigrations,
  migrationProblem,
  readAppliedMigrations,
} from './db/migrationCheck.ts';
import { createDatabaseProbe, createPrismaClient } from './db/prisma.ts';
import { logger } from './lib/logger.ts';
import { createMissionService, hasEffects } from './missions/missionService.ts';
import { startStaleRecovery } from './missions/staleRecovery.ts';
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

/**
 * La base doit avoir reçu toutes les migrations du dépôt AVANT d'accepter une requête ou de lancer
 * les tâches planifiées : sinon chaque requête touchant une table ou colonne nouvelle échoue.
 * Base injoignable : l'API démarre quand même (état visible dans /api/health), comme avant.
 */
try {
  const database = describeDatabase(config.DATABASE_URL);
  const check = compareMigrations(listRepositoryMigrations(), await readAppliedMigrations(prisma));
  if (check.unknown.length > 0) {
    logger.warn(
      `Base ${database} : migration(s) absente(s) du dépôt (code plus ancien que la base ?) : ${check.unknown.join(', ')}.`,
    );
  }
  const problem = migrationProblem(check, database);
  if (problem) {
    logger.error(`Démarrage refusé.\n${problem}`);
    await prisma.$disconnect();
    process.exit(1);
  }
} catch (error) {
  logger.warn(
    'Migrations : vérification impossible (base injoignable ?), démarrage maintenu',
    error,
  );
}

const missions = createMissionService(prisma);
const owner = createOwnerAuthService({ prisma });
const campaigns = createCampaignService({ prisma, missions });
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
  profiles: createAgentProfileService({ prisma }),
  runs: createRunService({ prisma, missions, control: agentControl }),
  campaigns,
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

/**
 * Missions interrompues (« en cours » sans activité depuis MISSION_STALE_MINUTES) : passées en
 * « bloquée », jamais remises en attente. Désactivé en démonstration (dates fictives passées).
 */
const staleRecovery = demoMode
  ? null
  : startStaleRecovery({
      recover: async () => {
        // Exécutions incohérentes (actives, mission plus en cours) : closes avant tout.
        for (const orphan of await missions.closeOrphanRuns()) {
          logger.warn(
            `Exécution ${orphan.runId} close (abandoned) : encore active alors que la mission ${orphan.missionId} est « ${orphan.missionStatus} ».`,
          );
        }
        return missions.recoverStale({ staleAfterMs: config.MISSION_STALE_MINUTES * 60_000 });
      },
      onRecovered: (m) =>
        logger.warn(
          `Mission ${m.missionId} bloquée : traitement interrompu (agent ${m.agentId ?? 'aucun'}, ` +
            `${m.runId ? `exécution ${m.runId} abandonnée, ` : ''}` +
            `${hasEffects(m.effects) ? 'effets déjà enregistrés, à vérifier' : 'aucun effet'}).`,
        ),
      onError: (error) => logger.error('Récupération des missions interrompues : échec', error),
    });

/**
 * Missions de recherche du jour : une par campagne active, attribuée à l'agent de la campagne.
 * Désactivé en démonstration (aucune campagne réelle).
 */
const campaignScheduler = demoMode
  ? null
  : startCampaignScheduler({
      generate: () => campaigns.generateDailyMissions(),
      onCreated: (m) =>
        logger.info(
          `Campagne ${m.campaignId} : mission de recherche du ${m.day} créée (${m.missionId}).`,
        ),
      onCancelled: (m) =>
        logger.info(
          `Campagne ${m.campaignId} : mission du ${m.day} jamais prise, annulée (${m.missionId}).`,
        ),
      onSkipped: (c) =>
        logger.warn(`Campagne ${c.campaignId} : aucune mission le ${c.day} (${c.reason}).`),
      onError: (error) => logger.error('Missions des campagnes : échec de la création', error),
    });

const shutdown = createShutdown({
  // Requêtes en cours : SHUTDOWN_TIMEOUT_MS (5 s) au plus, puis connexions coupées.
  closeServers: () => {
    staleRecovery?.stop();
    campaignScheduler?.stop();
    return closeServers([server, tailnetServer], {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      onForced: () =>
        logger.warn('Arrêt : requêtes encore en cours après 5 s, connexions coupées.'),
    });
  },
  disconnect: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
  log: logger,
});

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
