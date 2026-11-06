import express, { type Express, type RequestHandler } from 'express';
import { AGENT_MAX_BODY } from '@agency/shared';
import type { AgentService } from './agents/agentService.ts';
import { agentKillSwitch, agentsDisabledError, type AgentControl } from './agents/agentControl.ts';
import type { IdempotencyStore } from './agents/idempotency.ts';
import type { QuotaService } from './agents/quotas.ts';
import {
  agentRateLimit,
  createAgentRateLimiter,
  type AgentRateLimiter,
} from './agents/rateLimit.ts';
import { agentAccessGuard } from './auth/agentAccess.ts';
import { createLoginThrottle, type LoginThrottle } from './auth/loginThrottle.ts';
import type { OwnerAuthService } from './auth/ownerAuth.ts';
import { hasSessionCookie, identifyRequest } from './auth/requestActor.ts';
import { hostGuard, originGuard, requireAuthentication } from './auth/requestGuards.ts';
import type { DatabaseProbe } from './db/prisma.ts';
import { errorHandler, notFoundHandler } from './errors/errorHandler.ts';
import type { MissionService } from './missions/missionService.ts';
import type { ProspectService } from './prospects/prospectService.ts';
import type { AgentProfileService } from './agents/agentProfileService.ts';
import type { RunService } from './agents/runService.ts';
import { agentApiRouter } from './routes/agentApi.ts';
import { agentsRouter } from './routes/agents.ts';
import { authRouter } from './routes/auth.ts';
import { healthRouter } from './routes/health.ts';
import { missionsRouter } from './routes/missions.ts';
import { runsRouter } from './routes/runs.ts';
import { prospectsRouter } from './routes/prospects.ts';

export interface AppDeps {
  db: DatabaseProbe;
  missions: MissionService;
  /** Facultatif : les tests de l'API de santé n'en ont pas besoin. */
  prospects?: ProspectService;
  /** Facultatif : sans lui, aucune clé d'agent n'est acceptée (toute clé présentée → 401). */
  agents?: AgentService;
  /** Profils IA et prompts versionnés des agents. */
  profiles?: AgentProfileService;
  /** Exécutions des agents (prise de mission). */
  runs?: RunService;
  /** Requêtes répétées des agents. Requis (avec agents et prospects) pour ouvrir /api/agent. */
  idempotency?: IdempotencyStore;
  /**
   * Connexion de l'utilisateur humain. Sans lui, aucune session n'est possible :
   * seules les routes publiques et les agents munis d'une clé sont acceptés.
   */
  owner?: OwnerAuthService;
  /** Freinage des essais de mot de passe (un par défaut). */
  loginThrottle?: LoginThrottle;
  /** Quotas journaliers globaux des agents. Requis (avec agentControl) pour ouvrir /api/agent. */
  quotas?: QuotaService;
  /**
   * Arrêt d'urgence des agents. ABSENT = agents refusés (503) : jamais d'agent sans ce contrôle.
   */
  agentControl?: AgentControl;
  /** Débit maximal par agent (un par défaut : AGENT_REQUESTS_PER_MINUTE). */
  agentRateLimiter?: AgentRateLimiter;
  /** Noms d'hôte acceptés en plus de la machine locale (ex. host.docker.internal pour n8n). */
  allowedHosts?: readonly string[];
  version: string;
  simulationMode: boolean;
  /** Base de démonstration (données fictives). */
  demoMode?: boolean;
}

/**
 * Construit l'application Express. Les dépendances sont injectées,
 * ce qui permet de la tester sans démarrer de serveur ni de base.
 */
/** Sans contrôle d'arrêt d'urgence configuré : toute requête qui porte une clé est refusée. */
const refuseAgents: RequestHandler = (req, _res, next) => {
  if (req.headers.authorization !== undefined) throw agentsDisabledError();
  next();
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Adresse de l'API : la machine locale uniquement (protection contre le « DNS rebinding »).
  app.use(hostGuard(deps.allowedHosts));

  // Appliqués à TOUTES les routes, y compris celles ajoutées plus tard, dans cet ordre :
  // arrêt d'urgence (avant même de lire une clé) → identité de l'auteur → débit des agents →
  // écritures humaines venant de l'interface uniquement → refus de toute requête sans identité →
  // liste blanche des routes ouvertes aux agents.
  app.use(deps.agentControl ? agentKillSwitch(deps.agentControl) : refuseAgents);
  app.use(identifyRequest(deps.agents, deps.owner));
  app.use(agentRateLimit(deps.agentRateLimiter ?? createAgentRateLimiter()));
  // Corps des requêtes : plus petit pour les agents.
  const agentJson = express.json({ limit: AGENT_MAX_BODY });
  const humanJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => (res.locals.agent ? agentJson : humanJson)(req, res, next));
  // La connexion elle-même doit aussi venir de l'interface (pas d'essais depuis une autre page).
  app.use(originGuard((req) => hasSessionCookie(req) || req.path === '/api/auth/login'));
  app.use(requireAuthentication);
  app.use(agentAccessGuard);

  if (deps.owner) {
    app.use('/api/auth', authRouter(deps.owner, deps.loginThrottle ?? createLoginThrottle()));
  }

  app.use('/api/health', healthRouter(deps));
  app.use('/api/missions', missionsRouter(deps.missions));
  // Journal des exécutions des agents (utilisateur, lecture seule).
  if (deps.runs) app.use('/api/runs', runsRouter(deps.runs));
  if (deps.prospects) app.use('/api/prospects', prospectsRouter(deps.prospects));
  if (deps.agents) {
    app.use(
      '/api/agents',
      agentsRouter(deps.agents, {
        quotas: deps.quotas,
        control: deps.agentControl,
        profiles: deps.profiles,
      }),
    );
  }
  if (deps.agents && deps.prospects && deps.idempotency && deps.quotas && deps.agentControl) {
    app.use(
      '/api/agent',
      agentApiRouter({
        prospects: deps.prospects,
        missions: deps.missions,
        idempotency: deps.idempotency,
        quotas: deps.quotas,
        control: deps.agentControl,
        profiles: deps.profiles,
        runs: deps.runs,
      }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
