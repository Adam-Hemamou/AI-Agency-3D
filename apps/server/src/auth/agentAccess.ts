import type { RequestHandler } from 'express';
import { AGENT_PERMISSION_LABELS, ERROR_CODES, type AgentPermission } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';

/**
 * Ce qu'un agent authentifié peut appeler, par liste blanche, et la permission exigée pour
 * chaque route. Toute route absente de cette table lui est refusée, y compris les routes
 * ajoutées plus tard : ouvrir une route aux agents est toujours une décision explicite, prise ici.
 *
 * Les validations, décisions humaines et envois n'y figureront jamais ; ils sont en outre
 * refusés par les services eux-mêmes (assertHumanActor).
 */
interface AgentRoute {
  methods: readonly string[];
  pattern: RegExp;
  /** null : accessible à tout agent authentifié. */
  permission: AgentPermission | null;
}

const READ = ['GET', 'HEAD'] as const;
const SEG = '[^/]+';

export const AGENT_ROUTES: readonly AgentRoute[] = [
  { methods: READ, pattern: /^\/api\/health\/?$/, permission: null },
  { methods: READ, pattern: /^\/api\/agents\/me\/?$/, permission: null },
  // Aucune route de l'interface n'est ouverte aux agents, pas même en lecture : elles renvoient
  // des données non filtrées (dossier complet, motifs des décisions dans l'historique des missions).
  // Les agents lisent UNIQUEMENT par /api/agent/…, où toute réponse est filtrée (agentView).
  // API des agents.
  // Quotas globaux du jour : utiles à tout agent pour savoir s'il peut continuer.
  { methods: READ, pattern: /^\/api\/agent\/quotas\/?$/, permission: null },
  // Son propre profil IA (rôle, paramètres, prompt actif) : nécessaire pour travailler.
  { methods: READ, pattern: /^\/api\/agent\/profile\/?$/, permission: null },
  // Prise de mission par n8n : démarre une mission et crée son exécution.
  { methods: ['POST'], pattern: /^\/api\/agent\/runs\/claim\/?$/, permission: 'missions:update' },
  // Consultation de SON exécution (la propriété est vérifiée par le service), en lecture seule.
  {
    methods: READ,
    pattern: new RegExp(`^/api/agent/runs/(?!claim/?$)${SEG}/?$`),
    permission: 'missions:read',
  },
  // Signal de vie et échec de SON exécution (la propriété est vérifiée par le service).
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/runs/(?!claim/?$)${SEG}/heartbeat/?$`),
    permission: 'missions:update',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/runs/(?!claim/?$)${SEG}/failure/?$`),
    permission: 'missions:update',
  },
  { methods: READ, pattern: /^\/api\/agent\/missions\/?$/, permission: 'missions:read' },
  {
    methods: READ,
    pattern: new RegExp(`^/api/agent/missions/${SEG}/?$`),
    permission: 'missions:read',
  },
  {
    methods: READ,
    pattern: /^\/api\/agent\/prospects\/lookup\/?$/,
    permission: 'prospects:read',
  },
  {
    methods: READ,
    pattern: new RegExp(`^/api/agent/prospects/${SEG}/context/?$`),
    permission: 'prospects:read',
  },
  { methods: ['POST'], pattern: /^\/api\/agent\/prospects\/?$/, permission: 'prospects:create' },
  {
    methods: ['PATCH'],
    pattern: new RegExp(`^/api/agent/prospects/(?!lookup/?$)${SEG}/?$`),
    permission: 'prospects:enrich',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/prospects/${SEG}/analyses/?$`),
    permission: 'analyses:write',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/prospects/${SEG}/productions/?$`),
    permission: 'productions:write',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/prospects/${SEG}/stage/?$`),
    permission: 'stages:advance',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/prospects/${SEG}/events/?$`),
    permission: 'events:write',
  },
  {
    methods: ['POST'],
    pattern: new RegExp(`^/api/agent/missions/${SEG}/transitions/?$`),
    permission: 'missions:update',
  },
];

/** Route de la liste blanche correspondant à la requête, ou null (route fermée aux agents). */
export function findAgentRoute(method: string, path: string): AgentRoute | null {
  const verb = method.toUpperCase();
  return AGENT_ROUTES.find((r) => r.methods.includes(verb) && r.pattern.test(path)) ?? null;
}

export function isAgentRequestAllowed(
  method: string,
  path: string,
  permissions: ReadonlySet<AgentPermission>,
): boolean {
  const route = findAgentRoute(method, path);
  return route !== null && (route.permission === null || permissions.has(route.permission));
}

function forbidden(message: string, details?: unknown): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403, details);
}

/** Refuse à un agent toute route hors liste blanche, ou dont il n'a pas la permission (403). */
export const agentAccessGuard: RequestHandler = (req, res, next) => {
  // Requête anonyme : déjà refusée par requireAuthentication (sauf routes publiques).
  if (res.locals.actor?.type !== 'agent') {
    next();
    return;
  }
  const route = findAgentRoute(req.method, req.path);
  if (!route) {
    throw forbidden(`Action non autorisée pour un agent : ${req.method} ${req.path}`);
  }
  const permissions = res.locals.agent?.permissions ?? new Set<AgentPermission>();
  if (route.permission && !permissions.has(route.permission)) {
    throw forbidden(
      `Permission manquante : « ${route.permission} » (${AGENT_PERMISSION_LABELS[route.permission]})`,
      { requiredPermission: route.permission },
    );
  }
  next();
};
