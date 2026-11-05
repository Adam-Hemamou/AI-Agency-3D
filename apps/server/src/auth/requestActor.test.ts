import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AgentService, AuthenticatedAgent } from '../agents/agentService.ts';
import { errorHandler } from '../errors/errorHandler.ts';
import { agentActor } from './actors.ts';
import { agentAccessGuard } from './agentAccess.ts';
import type { OwnerAuthService } from './ownerAuth.ts';
import { actorOf, identifyRequest } from './requestActor.ts';
import { requireAuthentication } from './requestGuards.ts';

const VALID_KEY = `agk_abcdefghij12_${'A'.repeat(43)}`;
const VALID_SESSION = 'S'.repeat(43);
const SESSION_COOKIE = `agency_session=${VALID_SESSION}`;

/** Seule VALID_KEY est reconnue, et elle appartient à agent-analyste. */
const fakeAgents = {
  authenticate: async (apiKey: string) =>
    apiKey === VALID_KEY
      ? ({
          actor: agentActor('agent-analyste'),
          permissions: new Set(['missions:read']),
        } as unknown as AuthenticatedAgent)
      : null,
} as unknown as AgentService;

/** Seule VALID_SESSION correspond à une session ouverte. */
const fakeOwner = {
  authenticate: async (token: string) =>
    token === VALID_SESSION
      ? { id: 'session-1', expiresAt: new Date('2026-11-06T00:00:00Z') }
      : null,
} as unknown as OwnerAuthService;

function makeApp(
  agents: AgentService | null = fakeAgents,
  owner: OwnerAuthService | null = fakeOwner,
) {
  const app = express();
  app.use(express.json());
  app.use(identifyRequest(agents ?? undefined, owner ?? undefined));
  app.use(requireAuthentication);
  app.use(agentAccessGuard);
  const echo: express.RequestHandler = (_req, res) => {
    res.json({ actor: actorOf(res) });
  };
  app.get('/api/health', (_req, res) => {
    res.json({ actor: res.locals.actor ?? null });
  });
  app.get('/api/agent/missions', echo);
  app.post('/api/missions/:id/validation', echo);
  app.use(errorHandler);
  return app;
}

describe('identification de l’auteur d’une requête', () => {
  it('sans clé ni session : refus (401), jamais l’identité humaine par défaut', async () => {
    const res = await request(makeApp()).get('/api/agent/missions');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('les routes publiques restent accessibles sans identité', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.actor).toBeNull();
  });

  it('avec une session valide : l’utilisateur humain', async () => {
    const res = await request(makeApp()).get('/api/agent/missions').set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.actor).toEqual({ type: 'user', id: 'owner' });
  });

  it.each([
    ['session inconnue', `agency_session=${'X'.repeat(43)}`],
    ['cookie vide', 'agency_session='],
    ['cookie mal encodé', 'agency_session=%E0%A4%A'],
    ['autre cookie', `autre=${VALID_SESSION}`],
  ])('%s : 401', async (_label, cookie) => {
    const res = await request(makeApp()).get('/api/agent/missions').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('sans service de connexion, aucune session n’est reconnue', async () => {
    const res = await request(makeApp(fakeAgents, null))
      .get('/api/agent/missions')
      .set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(401);
  });

  it('avec une clé valide : l’agent propriétaire de la clé', async () => {
    const res = await request(makeApp())
      .get('/api/agent/missions')
      .auth(VALID_KEY, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.actor).toEqual({ type: 'agent', id: 'agent-analyste' });
  });

  it('clé d’agent ET session humaine dans la même requête : 401 (identité ambiguë)', async () => {
    const res = await request(makeApp())
      .get('/api/agent/missions')
      .set('Cookie', SESSION_COOKIE)
      .auth(VALID_KEY, { type: 'bearer' });
    expect(res.status).toBe(401);
    expect(res.body.actor).toBeUndefined();
  });

  it('le schéma « Bearer » est reconnu sans tenir compte de la casse', async () => {
    const res = await request(makeApp())
      .get('/api/agent/missions')
      .set('Authorization', `bearer ${VALID_KEY}`);
    expect(res.body.actor.type).toBe('agent');
  });

  it.each([
    ['clé inconnue', `Bearer agk_zzzzzzzzzzzz_${'B'.repeat(43)}`],
    ['clé mal formée', 'Bearer owner'],
    ['en-tête vide', ''],
    ['schéma Basic', `Basic ${Buffer.from('owner:secret').toString('base64')}`],
    ['clé sans schéma', VALID_KEY],
    ['plusieurs valeurs', `Bearer ${VALID_KEY} ${VALID_KEY}`],
  ])('%s : 401, jamais de repli sur l’identité humaine', async (_label, value) => {
    const res = await request(makeApp()).get('/api/agent/missions').set('Authorization', value);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.actor).toBeUndefined();
  });

  it.each(['X-Api-Key', 'X-Agent-Key', 'Api-Key'])(
    'clé placée dans « %s » : 401 (même valide)',
    async (header) => {
      const res = await request(makeApp()).get('/api/agent/missions').set(header, VALID_KEY);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    },
  );

  it('sans service des agents, toute clé est refusée', async () => {
    const res = await request(makeApp(null))
      .get('/api/agent/missions')
      .auth(VALID_KEY, { type: 'bearer' });
    expect(res.status).toBe(401);
  });

  it('le contenu de la requête ne change jamais l’identité', async () => {
    const res = await request(makeApp())
      .get('/api/agent/missions?actorType=user&actorId=owner')
      .set('X-Actor-Type', 'user')
      .auth(VALID_KEY, { type: 'bearer' });
    expect(res.body.actor).toEqual({ type: 'agent', id: 'agent-analyste' });
  });
});

describe('accès des agents', () => {
  it('un agent ne peut pas atteindre une route de validation', async () => {
    const res = await request(makeApp())
      .post('/api/missions/x/validation')
      .auth(VALID_KEY, { type: 'bearer' })
      .send({ decision: 'approve', actorType: 'user', actorId: 'owner' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
  });

  it('l’humain connecté y accède normalement', async () => {
    const res = await request(makeApp())
      .post('/api/missions/x/validation')
      .set('Cookie', SESSION_COOKIE)
      .send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.actor.type).toBe('user');
  });
});
