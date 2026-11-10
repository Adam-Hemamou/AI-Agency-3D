import { describe, expect, it } from 'vitest';
import { AGENT_PERMISSIONS, type AgentPermission } from '@agency/shared';
import { AGENT_ROUTES, findAgentRoute, isAgentRequestAllowed } from './agentAccess.ts';

const ID = '01900000-0000-7000-8000-000000000001';
const ALL = new Set<AgentPermission>(AGENT_PERMISSIONS);
const NONE = new Set<AgentPermission>();

describe('routes ouvertes aux agents : permission exigée par route', () => {
  it.each<[string, string, AgentPermission | null]>([
    ['GET', '/api/health', null],
    ['GET', '/api/agents/me', null],
    ['GET', '/api/agent/missions', 'missions:read'],
    ['GET', `/api/agent/missions/${ID}`, 'missions:read'],
    ['HEAD', '/api/agent/missions', 'missions:read'],
    ['GET', '/api/agent/prospects/lookup', 'prospects:read'],
    ['GET', `/api/agent/prospects/${ID}/context`, 'prospects:read'],
    ['POST', '/api/agent/prospects', 'prospects:create'],
    ['PATCH', `/api/agent/prospects/${ID}`, 'prospects:enrich'],
    ['POST', `/api/agent/prospects/${ID}/analyses`, 'analyses:write'],
    ['POST', `/api/agent/prospects/${ID}/productions`, 'productions:write'],
    ['POST', `/api/agent/prospects/${ID}/stage`, 'stages:advance'],
    ['POST', `/api/agent/prospects/${ID}/events`, 'events:write'],
    ['POST', `/api/agent/missions/${ID}/transitions`, 'missions:update'],
  ])('%s %s → %s', (method, path, permission) => {
    expect(findAgentRoute(method, path)?.permission).toBe(permission);
    expect(isAgentRequestAllowed(method, path, ALL)).toBe(true);
    expect(isAgentRequestAllowed(method, path, NONE)).toBe(permission === null);
    if (permission) {
      // Toutes les permissions SAUF celle exigée : refusé.
      const others = new Set(AGENT_PERMISSIONS.filter((p) => p !== permission));
      expect(isAgentRequestAllowed(method, path, others)).toBe(false);
    }
  });

  it.each([
    // Lectures de l'interface : données non filtrées (contournement des permissions de lecture).
    ['GET', '/api/missions'],
    ['GET', `/api/missions/${ID}`],
    ['GET', `/api/missions/${ID}/events`],
    ['HEAD', '/api/missions'],
    ['GET', '/api/prospects'],
    ['GET', `/api/prospects/${ID}/dossier`],
    ['GET', `/api/agent/missions/${ID}/events`],
    ['GET', `/api/agent/prospects/${ID}`],
    ['GET', `/api/agent/prospects/${ID}/dossier`],
    // Validations, décisions humaines et envois : jamais, même avec toutes les permissions.
    ['POST', `/api/missions/${ID}/validation`],
    ['POST', `/api/prospects/${ID}/decisions`],
    ['POST', `/api/prospects/${ID}/email/decisions`],
    ['POST', `/api/prospects/${ID}/email/simulated-send`],
    ['POST', `/api/prospects/${ID}/followups`],
    ['POST', `/api/prospects/${ID}/email/drafts`],
    ['PATCH', `/api/prospects/${ID}/followup`],
    ['POST', `/api/prospects/${ID}/replies`],
    ['POST', `/api/prospects/${ID}/notes`],
    // Routes de l'interface pour écrire : passer par /api/agent.
    ['POST', '/api/missions'],
    ['POST', `/api/missions/${ID}/transitions`],
    // Gestion des agents et des clés, connexion humaine.
    ['GET', '/api/agents'],
    ['GET', '/api/agents/agent-analyste'],
    ['POST', '/api/agents'],
    ['PATCH', '/api/agents/agent-analyste'],
    ['POST', '/api/agents/agent-analyste/keys'],
    ['POST', `/api/agents/agent-analyste/keys/${ID}/revoke`],
    ['POST', '/api/auth/login'],
    // Méthodes ou routes inconnues de l'API des agents.
    ['DELETE', `/api/agent/prospects/${ID}`],
    ['PUT', `/api/agent/prospects/${ID}`],
    ['PATCH', '/api/agent/prospects/lookup'],
    ['POST', `/api/agent/prospects/${ID}/decisions`],
    ['POST', `/api/agent/prospects/${ID}/send`],
    ['POST', `/api/agent/missions/${ID}/validation`],
    ['GET', '/api/agent/prospects'],
    ['GET', '/api/inconnue'],
  ])('refuse %s %s, quelles que soient les permissions', (method, path) => {
    expect(findAgentRoute(method, path)).toBeNull();
    expect(isAgentRequestAllowed(method, path, ALL)).toBe(false);
  });

  it('chaque permission de route ouvre au moins une route, et aucune écriture n’est libre', () => {
    // Les permissions fines ne protègent pas une route : elles filtrent ou autorisent des données.
    const DATA_ONLY = new Set<AgentPermission>([
      'prospects:read_contact',
      // Écriture de coordonnées à la création (contenu de POST /api/agent/prospects).
      'contacts:submit',
      'analyses:read',
      'productions:read',
      'proposals:read',
      'messages:read',
      'decisions:read',
      'notes:read',
    ]);
    for (const permission of AGENT_PERMISSIONS.filter((x) => !DATA_ONLY.has(x))) {
      expect(AGENT_ROUTES.some((r) => r.permission === permission)).toBe(true);
    }
    for (const route of AGENT_ROUTES.filter((r) =>
      r.methods.some((m) => m !== 'GET' && m !== 'HEAD'),
    )) {
      expect(route.permission).not.toBeNull();
    }
  });
});
