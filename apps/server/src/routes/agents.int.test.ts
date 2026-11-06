import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PIPELINE_MISSION_TYPES,
  agentIdentityResponseSchema,
  agentListResponseSchema,
  agentSchema,
  issuedAgentKeyResponseSchema,
  type CreateProspectRequest,
} from '@agency/shared';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { agentActor } from '../auth/actors.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { createTestAgent, createTestPrisma, resetDatabase } from '../test/testDb.ts';

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const app = createApp({
  ...testAgentLimits(prisma),
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects,
  agents: createAgentService({ prisma }),
  idempotency: createIdempotencyStore(prisma),
  version: 'test',
  simulationMode: true,
});

const pipelineAgent = agentActor('agent-analyste');

/** Crée un agent puis une clé, par l'API, comme le ferait l'utilisateur. */
async function agentWithKey(id = 'agent-analyste') {
  const created = await owner
    .post('/api/agents')
    .send({ id, name: 'Analyste', permissions: ['missions:read', 'prospects:read'] });
  expect(created.status).toBe(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({ label: 'n8n' });
  expect(issued.status).toBe(201);
  return issuedAgentKeyResponseSchema.parse(issued.body);
}

const asAgent = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

async function missionAwaitingValidation() {
  const created = await missions.create(
    {
      type: 'review',
      room: 'director',
      priority: 3,
      input: {},
      requiresValidation: true,
      agentId: 'agent-analyste',
      prospectId: null,
      maxAttempts: 3,
    },
    pipelineAgent,
  );
  await missions.applyAction(created.mission.id, { action: 'start' }, pipelineAgent);
  await missions.applyAction(
    created.mission.id,
    { action: 'submit_for_validation' },
    pipelineAgent,
  );
  return created.mission.id;
}

const baseProspect: CreateProspectRequest = {
  creatorName: 'Créateur Test',
  channelName: 'Chaîne Test',
  youtubeChannelId: 'TEST-1',
  discovery: {
    source: 'Test',
    reason: 'Prospect de test',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
};

/** Utilisateur humain connecté (session recréée après chaque remise à zéro). */
let owner: OwnerClient;

beforeEach(async () => {
  await resetDatabase();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('gestion des agents par l’utilisateur', () => {
  it('crée, liste, modifie un agent et lui remet une clé', async () => {
    const created = await owner
      .post('/api/agents')
      .send({ id: 'agent-analyste', name: 'Analyste', room: 'analysis' });
    expect(created.status).toBe(201);
    expect(agentSchema.parse(created.body)).toMatchObject({ status: 'active', keys: [] });

    const issued = await owner.post('/api/agents/agent-analyste/keys').send({});
    expect(issued.status).toBe(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    const { apiKey, key } = issuedAgentKeyResponseSchema.parse(issued.body);

    const list = agentListResponseSchema.parse((await owner.get('/api/agents')).body);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.keys.map((k) => k.id)).toEqual([key.id]);
    // La clé n'est plus jamais renvoyée.
    expect(JSON.stringify(list)).not.toContain(apiKey);

    const patched = await owner.patch('/api/agents/agent-analyste').send({ status: 'disabled' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('disabled');
  });

  it('refuse un identifiant qui ne commence pas par "agent-" (dont "owner")', async () => {
    for (const id of ['owner', 'user', 'analyste']) {
      const res = await owner.post('/api/agents').send({ id, name: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('GET /api/agents/me est réservé aux agents', async () => {
    const res = await owner.get('/api/agents/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
  });
});

describe('requêtes authentifiées par une clé d’agent', () => {
  it('l’agent connaît son identité', async () => {
    const { apiKey, key } = await agentWithKey();
    const res = await request(app).get('/api/agents/me').set(asAgent(apiKey));
    expect(res.status).toBe(200);
    const body = agentIdentityResponseSchema.parse(res.body);
    expect(body.agent.id).toBe('agent-analyste');
    expect(body.key.id).toBe(key.id);
  });

  it('l’agent lit ses missions par l’API des agents, jamais par les routes de l’interface', async () => {
    const { apiKey } = await agentWithKey();
    const id = await missionAwaitingValidation();
    expect((await request(app).get('/api/agent/missions').set(asAgent(apiKey))).status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/agent/missions/' + id)
          .set(asAgent(apiKey))
      ).status,
    ).toBe(200);
    // Routes de l'interface : données non filtrées, fermées aux agents.
    for (const path of [
      '/api/missions',
      '/api/missions/' + id,
      '/api/missions/' + id + '/events',
      '/api/prospects',
    ]) {
      const res = await request(app).get(path).set(asAgent(apiKey));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    }
  });

  it('l’agent ne peut pas valider une mission, même en se déclarant utilisateur', async () => {
    const { apiKey } = await agentWithKey();
    const id = await missionAwaitingValidation();
    for (const decision of ['approve', 'reject', 'request_changes']) {
      const res = await request(app)
        .post(`/api/missions/${id}/validation`)
        .set(asAgent(apiKey))
        .send({ decision, reason: 'Je valide', actorType: 'user', actorId: 'owner' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    }
    const mission = await missions.get(id);
    expect(mission).toMatchObject({ status: 'awaiting_validation', validatedBy: null });
    const actions = (await missions.events(id)).map((e) => e.action);
    expect(actions).toEqual(['created', 'start', 'submit_for_validation']);
  });

  it('l’agent ne peut prendre aucune décision sur un prospect ni sur un e-mail', async () => {
    const { apiKey } = await agentWithKey();
    const d = await prospects.createProspect(baseProspect, pipelineAgent);
    const id = d.prospect.id;
    const attempts: [string, string, Record<string, unknown>][] = [
      ['post', `/api/prospects/${id}/decisions`, { missionId: id, decision: 'approve' }],
      [
        'post',
        `/api/prospects/${id}/email/decisions`,
        { missionId: id, productionId: id, decision: 'approve' },
      ],
      ['post', `/api/prospects/${id}/email/simulated-send`, { productionId: id }],
      ['post', `/api/prospects/${id}/followups`, { subject: 'S', body: 'B' }],
      ['patch', `/api/prospects/${id}/followup`, { doNotContact: false }],
      ['post', `/api/prospects/${id}/notes`, { body: 'Note' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await (method === 'post' ? request(app).post(path) : request(app).patch(path))
        .set(asAgent(apiKey))
        .send(body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    }
    const after = await prospects.getDossier(id);
    expect(after.decisions).toHaveLength(0);
    expect(after.prospect.version).toBe(d.prospect.version);
  });

  it('l’agent ne peut ni créer ni faire évoluer de mission par l’API (pas encore ouvert)', async () => {
    const { apiKey } = await agentWithKey();
    const created = await request(app)
      .post('/api/missions')
      .set(asAgent(apiKey))
      .send({ type: PIPELINE_MISSION_TYPES.analyze, room: 'analysis' });
    expect(created.status).toBe(403);
    expect((await missions.list({ limit: 50, offset: 0, sort: 'recent' })).total).toBe(0);
  });

  it('l’agent ne peut ni gérer les agents ni se créer de nouvelles clés', async () => {
    const { apiKey, key } = await agentWithKey();
    const attempts = [
      request(app).get('/api/agents'),
      request(app).post('/api/agents').send({ id: 'agent-pirate', name: 'Pirate' }),
      request(app).post('/api/agents/agent-analyste/keys').send({}),
      request(app).patch('/api/agents/agent-analyste').send({ room: 'director' }),
      request(app).post(`/api/agents/agent-analyste/keys/${key.id}/revoke`),
    ];
    for (const attempt of attempts) {
      const res = await attempt.set(asAgent(apiKey));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    }
    const agent = agentSchema.parse((await owner.get('/api/agents/agent-analyste')).body);
    expect(agent.keys).toHaveLength(1);
    expect(agent.room).toBeNull();
  });

  it('une clé révoquée ou d’un agent désactivé donne 401, jamais un accès humain', async () => {
    const { apiKey, key } = await agentWithKey();
    await owner.post(`/api/agents/agent-analyste/keys/${key.id}/revoke`).expect(200);
    const revoked = await request(app).get('/api/missions').set(asAgent(apiKey));
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('UNAUTHENTICATED');

    const second = await owner.post('/api/agents/agent-analyste/keys').send({});
    const { apiKey: secondKey } = issuedAgentKeyResponseSchema.parse(second.body);
    await owner.patch('/api/agents/agent-analyste').send({ status: 'disabled' }).expect(200);
    const disabled = await request(app)
      .post('/api/missions')
      .set(asAgent(secondKey))
      .send({ type: 'search_creators', room: 'prospecting' });
    expect(disabled.status).toBe(401);
    expect((await missions.list({ limit: 50, offset: 0, sort: 'recent' })).total).toBe(0);
  });

  it('les actions de l’interface restent attribuées à l’utilisateur humain', async () => {
    await createTestAgent(prisma, pipelineAgent.id!, 'director');
    const id = await missionAwaitingValidation();
    const res = await owner.post(`/api/missions/${id}/validation`).send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.mission).toMatchObject({ status: 'completed', validatedBy: 'owner' });
    expect(res.body.event).toMatchObject({ actorType: 'user', actorId: 'owner' });
  });
});
