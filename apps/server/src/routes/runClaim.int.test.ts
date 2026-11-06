import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_DEFAULTS,
  AGENT_PERMISSIONS,
  claimRunResponseSchema,
  createMissionRequestSchema,
  issuedAgentKeyResponseSchema,
  type AgentPermission,
  type ClaimRunResponse,
  type RoomId,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createRunService } from '../agents/runService.ts';
import { createApp } from '../app.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService, type Actor } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/** POST /api/agent/runs/claim (Phase 2, étape 2d), contre la base de test (ai_agency_test). */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const limits = testAgentLimits(prisma);
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: true }),
  agents: createAgentService({ prisma }),
  profiles: createAgentProfileService({ prisma }),
  runs: createRunService({ prisma, missions, control: limits.agentControl }),
  idempotency: createIdempotencyStore(prisma),
  version: 'test',
  simulationMode: true,
});

let owner: OwnerClient;

interface TestAgent {
  id: string;
  key: string;
}

/** Agent créé comme le fait l'utilisateur, avec une clé et (par défaut) un prompt actif. */
async function createAgent(
  id: string,
  room: RoomId | null,
  { permissions = AGENT_PERMISSIONS, prompt = true } = {} as {
    permissions?: readonly AgentPermission[];
    prompt?: boolean;
  },
): Promise<TestAgent> {
  await owner.post('/api/agents').send({ id, name: id, room, permissions }).expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  if (prompt) {
    await owner
      .post(`/api/agents/${id}/prompts`)
      .send({ systemPrompt: `Prompt de test de ${id}`, activate: true })
      .expect(201);
  }
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

let execution = 0;
const nextExecution = () => `n8n-exec-${++execution}`;

function claim(agent: TestAgent, n8nExecutionId: string = nextExecution()) {
  return request(app)
    .post('/api/agent/runs/claim')
    .set('Authorization', `Bearer ${agent.key}`)
    .send({ n8nExecutionId });
}

const claimed = (res: request.Response): ClaimRunResponse => claimRunResponseSchema.parse(res.body);

async function newMission(
  room: RoomId,
  overrides: { agentId?: string | null; priority?: number; maxAttempts?: number } = {},
) {
  const input = createMissionRequestSchema.parse({ type: 'test.tache', room, ...overrides });
  return (await missions.create(input, HUMAN_ACTOR)).mission;
}

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

beforeEach(async () => {
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('prise de mission', () => {
  it('démarre une mission libre de sa salle, l’attribue et crée l’exécution', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await owner.patch('/api/agents/agent-analyste/profile').send({ temperature: 0.4 }).expect(200);
    const mission = await newMission('analysis');

    const res = await claim(analyst, 'n8n-exec-a');
    expect(res.status).toBe(201);
    const body = claimed(res);
    expect(body).toMatchObject({ resumed: false, replayed: false });
    expect(body.mission).toMatchObject({
      id: mission.id,
      status: 'in_progress',
      agentId: 'agent-analyste',
      attemptCount: 1,
    });
    expect(body.run).toMatchObject({
      missionId: mission.id,
      agentId: 'agent-analyste',
      attempt: 1,
      status: 'started',
      n8nExecutionId: 'n8n-exec-a',
      promptVersion: 1,
      settings: { ...AGENT_MODEL_DEFAULTS, temperature: 0.4 }, // copie des paramètres
      finishedAt: null,
    });
    expect(body.run.heartbeatAt).not.toBeNull();
    const start = (await missions.events(mission.id)).at(-1);
    expect(start).toMatchObject({ action: 'start', actorType: 'agent', actorId: 'agent-analyste' });
  });

  it('204 sans corps quand aucune mission n’est disponible', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('dubbing'); // autre salle
    const res = await claim(analyst);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('409 sans prompt actif : rien n’est démarré ni enregistré', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis', { prompt: false });
    await owner
      .post('/api/agents/agent-analyste/prompts')
      .send({ systemPrompt: 'Brouillon non activé' })
      .expect(201);
    const mission = await newMission('analysis');
    expectError(await claim(analyst), 409, 'AGENT_PROMPT_MISSING');
    expect((await missions.get(mission.id)).status).toBe('pending');
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('la version du prompt enregistrée est celle active au moment de la prise', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await owner
      .post('/api/agents/agent-analyste/prompts')
      .send({ systemPrompt: 'Version 2', activate: true })
      .expect(201);
    await newMission('analysis');
    expect(claimed(await claim(analyst).expect(201)).run.promptVersion).toBe(2);
  });
});

describe('ordre de sélection', () => {
  it('priorité décroissante, puis la plus ancienne', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const lowOld = await newMission('analysis', { priority: 3 });
    const highOld = await newMission('analysis', { priority: 5 });
    const highNew = await newMission('analysis', { priority: 5 });
    const order: string[] = [];
    for (let i = 0; i < 3; i++) order.push(claimed(await claim(analyst).expect(201)).mission.id);
    expect(order).toEqual([highOld.id, highNew.id, lowOld.id]);
    expect((await claim(analyst)).status).toBe(204);
  });

  it('ses missions attribuées avant les missions libres, même moins prioritaires', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const free = await newMission('analysis', { priority: 5 });
    const mine = await newMission('analysis', { priority: 1, agentId: 'agent-analyste' });
    expect(claimed(await claim(analyst).expect(201)).mission.id).toBe(mine.id);
    expect(claimed(await claim(analyst).expect(201)).mission.id).toBe(free.id);
  });

  it('d’abord la mission à reprendre après une demande de modification', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const actor: Actor = { type: 'agent', id: 'agent-analyste' };
    const toRedo = await missions.create(
      createMissionRequestSchema.parse({
        type: 'test.tache',
        room: 'analysis',
        agentId: 'agent-analyste',
        requiresValidation: true,
        priority: 1,
      }),
      HUMAN_ACTOR,
    );
    await missions.applyAction(toRedo.mission.id, { action: 'start' }, actor);
    await missions.applyAction(
      toRedo.mission.id,
      { action: 'submit_for_validation', output: { score: 70 } },
      actor,
    );
    await missions.decide(
      toRedo.mission.id,
      { decision: 'request_changes', reason: 'Préciser le score' },
      HUMAN_ACTOR,
    );
    const pending = await newMission('analysis', { priority: 5, agentId: 'agent-analyste' });

    const body = claimed(await claim(analyst).expect(201));
    expect(body).toMatchObject({ resumed: true, replayed: false });
    expect(body.mission).toMatchObject({
      id: toRedo.mission.id,
      status: 'in_progress',
      attemptCount: 1, // reprise : pas de nouvelle tentative
      validationOutcome: 'changes_requested',
    });
    expect(body.run.attempt).toBe(1);
    const startEvents = (await missions.events(toRedo.mission.id)).filter(
      (e) => e.action === 'start',
    );
    expect(startEvents).toHaveLength(1); // aucun nouveau démarrage
    // Déjà reprise (exécution en cours) : la prise suivante passe à la mission en attente.
    expect(claimed(await claim(analyst).expect(201)).mission.id).toBe(pending.id);
  });

  it('ignore les missions sans tentative restante', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const exhausted = await newMission('analysis', { maxAttempts: 1, priority: 5 });
    await prisma.mission.update({ where: { id: exhausted.id }, data: { attemptCount: 1 } });
    const ok = await newMission('analysis', { priority: 1 });
    expect(claimed(await claim(analyst).expect(201)).mission.id).toBe(ok.id);
    expect((await claim(analyst)).status).toBe(204);
  });
});

describe('visibilité et isolation', () => {
  it('jamais la mission d’un autre agent, ni une mission libre d’une autre salle', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await createAgent('agent-autre', 'analysis');
    await newMission('analysis', { agentId: 'agent-autre' });
    await newMission('dubbing');
    expect((await claim(analyst)).status).toBe(204);
  });

  it('agent sans salle : uniquement ses missions, jamais une mission libre', async () => {
    const roaming = await createAgent('agent-itinerant', null);
    await newMission('analysis');
    expect((await claim(roaming)).status).toBe(204);
    const mine = await newMission('dubbing', { agentId: 'agent-itinerant' });
    expect(claimed(await claim(roaming).expect(201)).mission.id).toBe(mine.id);
  });

  it('agent rattaché à une salle : pas ses missions d’une autre salle', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('dubbing', { agentId: 'agent-analyste' });
    expect((await claim(analyst)).status).toBe(204);
  });
});

describe('idempotence (identifiant d’exécution n8n)', () => {
  it('la même exécution n8n renvoie la même exécution, sans rien démarrer de plus', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const m1 = await newMission('analysis', { priority: 5 });
    const m2 = await newMission('analysis', { priority: 1 });
    const first = claimed(await claim(analyst, 'n8n-exec-r').expect(201));
    const again = await claim(analyst, 'n8n-exec-r');
    expect(again.status).toBe(200);
    expect(claimed(again)).toMatchObject({ replayed: true, run: { id: first.run.id } });
    expect((await missions.get(m1.id)).attemptCount).toBe(1);
    expect((await missions.get(m2.id)).status).toBe('pending');
    expect(await prisma.agentRun.count()).toBe(1);
  });

  it('même exécution n8n envoyée 5 fois en même temps : une seule prise, un seul démarrage', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    for (let i = 0; i < 5; i++) await newMission('analysis');
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => claim(analyst, 'n8n-exec-meme')),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const runIds = new Set(responses.map((r) => claimed(r).run.id));
    expect(runIds.size).toBe(1);
    expect(await prisma.agentRun.count()).toBe(1);
    expect(await prisma.mission.count({ where: { status: 'in_progress' } })).toBe(1);
    expect(await prisma.missionEvent.count({ where: { action: 'start' } })).toBe(1);
  });

  it('une même exécution n8n peut servir à deux agents différents', async () => {
    const a = await createAgent('agent-a', 'analysis');
    const b = await createAgent('agent-b', 'analysis');
    await newMission('analysis');
    await newMission('analysis');
    const ra = claimed(await claim(a, 'n8n-exec-partage').expect(201));
    const rb = claimed(await claim(b, 'n8n-exec-partage').expect(201));
    expect(ra.mission.id).not.toBe(rb.mission.id);
  });
});

describe('concurrence : deux agents ne prennent jamais la même mission', () => {
  it('deux agents, une mission, prises simultanées (10 essais) : un seul l’obtient', async () => {
    const a = await createAgent('agent-a', 'analysis');
    const b = await createAgent('agent-b', 'analysis');
    for (let round = 0; round < 10; round++) {
      const mission = await newMission('analysis');
      const [ra, rb] = await Promise.all([claim(a), claim(b)]);
      expect([ra.status, rb.status].sort()).toEqual([201, 204]);
      const winner = (ra.status === 201 ? ra : rb).body as ClaimRunResponse;
      const runs = await prisma.agentRun.findMany({ where: { missionId: mission.id } });
      expect(runs).toHaveLength(1);
      expect(runs[0]!.agentId).toBe(winner.run.agentId);
      expect((await missions.get(mission.id)).agentId).toBe(winner.run.agentId);
    }
  });

  it('4 agents, 6 missions, 12 prises simultanées : 6 prises distinctes, aucun doublon', async () => {
    const agents = await Promise.all(
      ['agent-a', 'agent-b', 'agent-c', 'agent-d'].map((id) => createAgent(id, 'analysis')),
    );
    for (let i = 0; i < 6; i++) await newMission('analysis', { priority: (i % 5) + 1 });
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) => claim(agents[i % 4]!)),
    );
    const ok = responses.filter((r) => r.status === 201).map(claimed);
    expect(ok).toHaveLength(6);
    expect(responses.filter((r) => r.status === 204)).toHaveLength(6);
    expect(new Set(ok.map((c) => c.mission.id)).size).toBe(6);

    // En base : une exécution par mission, au nom de l'agent auquel la mission est attribuée.
    const runs = await prisma.agentRun.findMany();
    expect(runs).toHaveLength(6);
    for (const run of runs) {
      const mission = await missions.get(run.missionId);
      expect(mission).toMatchObject({
        status: 'in_progress',
        agentId: run.agentId,
        attemptCount: 1,
      });
    }
    expect(await prisma.missionEvent.count({ where: { action: 'start' } })).toBe(6);
  });

  it('prises simultanées par un même agent : chacune obtient une mission différente', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    for (let i = 0; i < 4; i++) await newMission('analysis');
    const responses = await Promise.all(Array.from({ length: 6 }, () => claim(analyst)));
    const ok = responses.filter((r) => r.status === 201).map(claimed);
    expect(ok).toHaveLength(4);
    expect(new Set(ok.map((c) => c.mission.id)).size).toBe(4);
    expect(await prisma.agentRun.count()).toBe(4);
  });
});

describe('charge', () => {
  it('6 agents, 20 missions, 30 prises simultanées (3 tours) : jamais d’erreur ni de doublon', async () => {
    const agents = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createAgent(`agent-charge-${i}`, 'analysis')),
    );
    for (let round = 0; round < 3; round++) {
      const created = [];
      for (let i = 0; i < 20; i++)
        created.push(await newMission('analysis', { priority: (i % 5) + 1 }));
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) => claim(agents[i % 6]!)),
      );
      expect(
        responses.every((r) => r.status === 201 || r.status === 204),
        JSON.stringify(responses.filter((r) => r.status >= 400).map((r) => r.body)),
      ).toBe(true);
      const ok = responses.filter((r) => r.status === 201).map(claimed);
      expect(ok).toHaveLength(20);
      expect(new Set(ok.map((c) => c.mission.id))).toEqual(new Set(created.map((m) => m.id)));
    }
    const runs = await prisma.agentRun.findMany();
    expect(runs).toHaveLength(60);
    expect(new Set(runs.map((r) => r.missionId)).size).toBe(60);
  }, 60_000);
});

describe('sécurité', () => {
  it('permission missions:update exigée', async () => {
    const reader = await createAgent('agent-lecteur', 'analysis', {
      permissions: ['missions:read'],
    });
    await newMission('analysis');
    expectError(await claim(reader), 403, 'FORBIDDEN_ACTOR');
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('refusée sans clé, et à l’utilisateur humain', async () => {
    await newMission('analysis');
    expectError(
      await request(app).post('/api/agent/runs/claim').send({ n8nExecutionId: 'x-1' }),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await owner.post('/api/agent/runs/claim').send({ n8nExecutionId: 'x-1' }),
      403,
      'FORBIDDEN_ACTOR',
    );
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('arrêt d’urgence : refusée, rien n’est démarré', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    await owner.post('/api/agents/emergency-stop').send({ enabled: false }).expect(200);
    expectError(await claim(analyst), 503, 'AGENTS_DISABLED');
    expect((await missions.get(mission.id)).status).toBe('pending');
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('corps invalide : 400, rien n’est démarré', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    for (const body of [
      {},
      { n8nExecutionId: 'a b' },
      { n8nExecutionId: 'x', agentId: 'agent-x' },
    ]) {
      const res = await request(app)
        .post('/api/agent/runs/claim')
        .set('Authorization', `Bearer ${analyst.key}`)
        .send(body);
      expectError(res, 400, 'VALIDATION_ERROR');
    }
    expect(await prisma.agentRun.count()).toBe(0);
  });
});
