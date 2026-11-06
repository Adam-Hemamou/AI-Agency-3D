import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  agentRunDetailResponseSchema,
  claimRunResponseSchema,
  createMissionRequestSchema,
  issuedAgentKeyResponseSchema,
  runListResponseSchema,
  type AgentPermission,
  type RunListResponse,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createRunService } from '../agents/runService.ts';
import { createApp } from '../app.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Consultation des exécutions (Phase 2, étape 2h) : GET /api/agent/runs/:id et GET /api/runs.
 * Jeu de données fixe, préparé une fois (lecture seule ensuite). Base de test uniquement.
 */

const prisma = createTestPrisma();
const T0 = new Date('2026-11-07T08:00:00.000Z');
let now = T0;
const clock = () => now;
const missions = createMissionService(prisma, { clock });
const limits = testAgentLimits(prisma);
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: true, clock }),
  agents: createAgentService({ prisma }),
  profiles: createAgentProfileService({ prisma }),
  runs: createRunService({ prisma, missions, control: limits.agentControl, clock }),
  idempotency: createIdempotencyStore(prisma),
  version: 'test',
  simulationMode: true,
});

const MINUTE = 60_000;
const RAW_OUTPUT = 'SORTIE-BRUTE-CONFIDENTIELLE {"score": 9';
const PROMPT_TEXT = 'Texte du prompt système, jamais renvoyé par ces routes';

interface TestAgent {
  id: string;
  key: string;
}
let owner: OwnerClient;
let a: TestAgent;
let b: TestAgent;
let counter = 0;
/** Exécutions du jeu de données, dans l'ordre de démarrage. */
const runs: {
  id: string;
  agentId: string;
  missionId: string;
  status: string;
  startedAt: Date;
  n8nExecutionId: string;
}[] = [];
let m1 = '';

async function createAgent(
  id: string,
  permissions: readonly AgentPermission[] = AGENT_PERMISSIONS,
): Promise<TestAgent> {
  await owner
    .post('/api/agents')
    .send({ id, name: `Agent ${id}`, room: 'analysis', permissions })
    .expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  await owner
    .post(`/api/agents/${id}/prompts`)
    .send({ systemPrompt: PROMPT_TEXT, activate: true })
    .expect(201);
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

const auth = (agent: TestAgent) => ({ Authorization: `Bearer ${agent.key}` });

async function newMission(agentId: string) {
  const input = createMissionRequestSchema.parse({
    type: 'analysis.score',
    room: 'analysis',
    agentId,
  });
  return (await missions.create(input, HUMAN_ACTOR)).mission.id;
}

/** Prise de mission à l'instant courant, puis avance de 10 minutes. */
async function claim(agent: TestAgent) {
  const n8nExecutionId = `n8n-exec-${++counter}`;
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(agent))
    .send({ n8nExecutionId })
    .expect(201);
  const claimed = claimRunResponseSchema.parse(res.body);
  const entry = {
    id: claimed.run.id,
    agentId: agent.id,
    missionId: claimed.mission.id,
    status: 'started',
    startedAt: new Date(now),
    n8nExecutionId,
  };
  runs.push(entry);
  return entry;
}

const transition = (agent: TestAgent, missionId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/agent/missions/${missionId}/transitions`)
    .set(auth(agent))
    .set('Idempotency-Key', `test-transition-${++counter}`)
    .send(body)
    .expect(200);

const journal = async (query = ''): Promise<RunListResponse> =>
  runListResponseSchema.parse((await owner.get(`/api/runs${query}`).expect(200)).body);
const ids = (res: RunListResponse) => res.items.map((r) => r.id);
const byStart = (direction: 'asc' | 'desc') =>
  [...runs]
    .sort(
      (x, y) => (direction === 'asc' ? 1 : -1) * (x.startedAt.getTime() - y.startedAt.getTime()),
    )
    .map((r) => r.id);

let snapshot: unknown;

beforeAll(async () => {
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
  a = await createAgent('agent-a');
  b = await createAgent('agent-b');

  // 1. A : échec, mission remise en attente (sortie brute conservée).
  m1 = await newMission('agent-a');
  const r1 = await claim(a);
  now = new Date(now.getTime() + 3 * MINUTE);
  await request(app)
    .post(`/api/agent/runs/${r1.id}/failure`)
    .set(auth(a))
    .send({
      n8nExecutionId: r1.n8nExecutionId,
      code: 'INVALID_OUTPUT',
      message: 'JSON non conforme',
      rawOutput: RAW_OUTPUT,
      promptTokens: 1500,
      outputTokens: 60,
      llmMs: 7000,
    })
    .expect(200);
  r1.status = 'released';

  // 2. A : nouvelle tentative de la même mission, terminée.
  now = new Date(T0.getTime() + 10 * MINUTE);
  const r2 = await claim(a);
  now = new Date(now.getTime() + 4 * MINUTE);
  await transition(a, m1, { action: 'complete', output: { score: 80 } });
  r2.status = 'succeeded';

  // 3. B : en cours.
  await newMission('agent-b');
  now = new Date(T0.getTime() + 20 * MINUTE);
  await claim(b);

  // 4. B : mise en pause.
  const m4 = await newMission('agent-b');
  now = new Date(T0.getTime() + 30 * MINUTE);
  const r4 = await claim(b);
  await transition(b, m4, { action: 'pause' });
  r4.status = 'stopped';

  // 5. A : en cours.
  await newMission('agent-a');
  now = new Date(T0.getTime() + 40 * MINUTE);
  await claim(a);

  snapshot = await prisma.agentRun.findMany({ orderBy: { startedAt: 'asc' } });
});

afterAll(async () => {
  // Les consultations n'ont rien modifié (exécutions terminées comprises).
  expect(await prisma.agentRun.findMany({ orderBy: { startedAt: 'asc' } })).toEqual(snapshot);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('GET /api/agent/runs/:id (agent)', () => {
  it('l’agent consulte sa propre exécution, avec toutes les informations utiles', async () => {
    const res = await request(app).get(`/api/agent/runs/${runs[0]!.id}`).set(auth(a)).expect(200);
    const body = agentRunDetailResponseSchema.parse(res.body);
    expect(body.run).toMatchObject({
      id: runs[0]!.id,
      missionId: m1,
      agentId: 'agent-a',
      status: 'released',
      attempt: 1,
      promptVersion: 1,
      n8nExecutionId: runs[0]!.n8nExecutionId,
      startedAt: T0.toISOString(),
      failureCode: 'INVALID_OUTPUT',
      failureMessage: 'JSON non conforme',
      promptTokens: 1500,
      outputTokens: 60,
      llmMs: 7000,
    });
    expect(body.run.settings).toMatchObject({ model: 'qwen3:8b', think: false });
    expect(body.run.heartbeatAt).not.toBeNull();
    expect(body.run.finishedAt).not.toBeNull();
    expect(body.mission).toEqual({
      id: m1,
      type: 'analysis.score',
      room: 'analysis',
      status: 'completed',
      attemptCount: 2,
      maxAttempts: 3,
    });
    // Ni la sortie brute, ni le prompt, ni aucune clé.
    expect(res.body.run).not.toHaveProperty('rawOutput');
    expect(res.text).not.toContain('SORTIE-BRUTE');
    expect(res.text).not.toContain(PROMPT_TEXT);
    expect(res.text).not.toMatch(/agk_|secret/i);
  });

  it('un agent ne peut pas consulter l’exécution d’un autre (rien n’est renvoyé)', async () => {
    const res = await request(app).get(`/api/agent/runs/${runs[2]!.id}`).set(auth(a));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    expect(res.text).not.toContain(runs[2]!.missionId);
  });

  it('exécution inexistante : 404', async () => {
    const res = await request(app)
      .get('/api/agent/runs/00000000-0000-7000-8000-000000000000')
      .set(auth(a));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('permission missions:read exigée ; refusée sans clé et à l’utilisateur', async () => {
    const writer = await createAgent('agent-sans-lecture', ['missions:update']);
    await newMission('agent-sans-lecture');
    now = new Date(T0.getTime() + 120 * MINUTE); // hors de la période du jeu de données principal
    const own = await claim(writer);
    runs.pop(); // hors du jeu de données comparé dans le journal
    const res = await request(app).get(`/api/agent/runs/${own.id}`).set(auth(writer));
    expect(res.status).toBe(403);
    expect((await request(app).get(`/api/agent/runs/${own.id}`)).status).toBe(401);
    expect((await owner.get(`/api/agent/runs/${own.id}`)).status).toBe(403);
    // Remise à l'état du jeu de données (exécution supplémentaire close puis ignorée par les filtres).
    await transition(writer, own.missionId, { action: 'pause' });
    snapshot = await prisma.agentRun.findMany({ orderBy: { startedAt: 'asc' } });
  });

  it('aucune écriture possible par ces routes', async () => {
    for (const method of ['post', 'patch', 'put', 'delete'] as const) {
      const client = request(app);
      const res = await client[method](`/api/agent/runs/${runs[0]!.id}`).set(auth(a)).send({});
      expect(res.status, method).toBe(403);
    }
  });
});

describe('GET /api/runs (utilisateur)', () => {
  /** Jeu de données principal : exécutions démarrées dans la première heure. */
  const AB = `?to=${new Date(T0.getTime() + 60 * MINUTE).toISOString()}`;
  const mainIds = () => runs.map((r) => r.id);

  it('journal complet, du plus récent au plus ancien, avec de quoi comprendre chaque exécution', async () => {
    const all = await journal();
    const main = all.items.filter((r) => mainIds().includes(r.id));
    expect(main.map((r) => r.id)).toEqual(byStart('desc'));

    const first = all.items.find((r) => r.id === runs[0]!.id)!;
    expect(first).toMatchObject({
      agentName: 'Agent agent-a',
      status: 'released',
      failureCode: 'INVALID_OUTPUT',
      durationMs: 3 * MINUTE,
      hasRawOutput: true,
      mission: { id: m1, type: 'analysis.score', room: 'analysis', status: 'completed' },
    });
    const active = all.items.find((r) => r.id === runs[4]!.id)!;
    expect(active).toMatchObject({ status: 'started', durationMs: null, hasRawOutput: false });
    expect(all.items.find((r) => r.id === runs[1]!.id)).toMatchObject({
      status: 'succeeded',
      durationMs: 4 * MINUTE,
      attempt: 2,
    });
  });

  it('aucune donnée sensible : ni sortie brute, ni prompt, ni clé', async () => {
    const res = await owner.get('/api/runs?limit=200').expect(200);
    expect(res.text).not.toContain('SORTIE-BRUTE');
    expect(res.text).not.toContain(PROMPT_TEXT);
    expect(res.text).not.toMatch(/agk_|secret_hash|secretHash/);
    for (const item of res.body.items) expect(item).not.toHaveProperty('rawOutput');
  });

  it('filtre par agent', async () => {
    const res = await journal('?agentId=agent-a');
    expect(res.total).toBe(3);
    expect(res.items.every((r) => r.agentId === 'agent-a')).toBe(true);
  });

  it('filtre par mission', async () => {
    const res = await journal(`?missionId=${m1}`);
    expect(res.items.map((r) => [r.attempt, r.status])).toEqual([
      [2, 'succeeded'],
      [1, 'released'],
    ]);
  });

  it('filtre par statut, un ou plusieurs', async () => {
    expect((await journal('?status=started')).total).toBe(2);
    const several = await journal('?status=started,stopped');
    expect(new Set(several.items.map((r) => r.status))).toEqual(new Set(['started', 'stopped']));
    expect((await journal('?status=released&status=succeeded')).total).toBe(2);
  });

  it('filtre par période (début inclus, fin exclue)', async () => {
    const from = new Date(T0.getTime() + 10 * MINUTE).toISOString();
    const to = new Date(T0.getTime() + 30 * MINUTE).toISOString();
    const res = await journal(`?from=${from}&to=${to}`);
    expect(ids(res)).toEqual([runs[2]!.id, runs[1]!.id]);
  });

  it('filtres combinés', async () => {
    const res = await journal(`?agentId=agent-a&status=started,succeeded&from=${T0.toISOString()}`);
    expect(ids(res)).toEqual([runs[4]!.id, runs[1]!.id]);
    const none = await journal('?agentId=agent-b&status=succeeded');
    expect(none).toMatchObject({ items: [], total: 0 });
  });

  it('pagination : pages complètes, sans doublon ni oubli, total constant', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 5; offset += 2) {
      const page = await journal(`${AB}&limit=2&offset=${offset}`);
      expect(page).toMatchObject({ total: 5, limit: 2, offset });
      seen.push(...ids(page));
    }
    expect(seen).toEqual(byStart('desc'));
    expect((await journal(`${AB}&limit=2&offset=10`)).items).toEqual([]);
  });

  it('tri chronologique ascendant', async () => {
    expect(ids(await journal(`${AB}&sort=oldest`))).toEqual(byStart('asc'));
  });

  it('filtres invalides : 400', async () => {
    for (const query of [
      '?status=done',
      '?limit=500',
      '?agentId=owner',
      `?from=${new Date(T0.getTime() + MINUTE).toISOString()}&to=${T0.toISOString()}`,
      '?includeRawOutput=true',
    ]) {
      const res = await owner.get(`/api/runs${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('permissions : refusé à un agent, même avec toutes les permissions, et sans session', async () => {
    const res = await request(app).get('/api/runs').set(auth(a));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ACTOR');
    expect((await request(app).get('/api/runs')).status).toBe(401);
  });

  it('aucune modification ni suppression possible', async () => {
    expect((await owner.post(`/api/runs/${runs[0]!.id}`).send({})).status).toBe(404);
    expect((await owner.patch(`/api/runs/${runs[0]!.id}`).send({})).status).toBe(404);
    for (const method of ['put', 'delete'] as const) {
      const client = request(app);
      const res = await client[method](`/api/runs/${runs[0]!.id}`)
        .set('Host', 'localhost:5173')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', owner.cookie);
      expect(res.status, method).toBe(404);
    }
    expect((await owner.post('/api/runs').send({})).status).toBe(404);
  });
});
