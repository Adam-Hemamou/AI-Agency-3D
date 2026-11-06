import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
import type { TransactionHook } from '../db/transactionHook.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService, INTERRUPTED_ERROR_CODE } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Clôture automatique des exécutions (Phase 2, étape 2f) : une exécution est toujours cohérente
 * avec le statut de sa mission. Base de test uniquement (ai_agency_test).
 */

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

async function createAgent(
  id: string,
  room: RoomId | null = 'analysis',
  permissions: readonly AgentPermission[] = AGENT_PERMISSIONS,
): Promise<TestAgent> {
  await owner.post('/api/agents').send({ id, name: id, room, permissions }).expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  await owner
    .post(`/api/agents/${id}/prompts`)
    .send({ systemPrompt: `Prompt de test de ${id}`, activate: true })
    .expect(201);
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

const auth = (agent: TestAgent) => ({ Authorization: `Bearer ${agent.key}` });
let counter = 0;

async function claim(agent: TestAgent) {
  const n8nExecutionId = `n8n-exec-${++counter}`;
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(agent))
    .send({ n8nExecutionId })
    .expect(201);
  return { ...(claimRunResponseSchema.parse(res.body) as ClaimRunResponse), n8nExecutionId };
}

/** Transition par la route des agents (écriture idempotente : clé nouvelle à chaque appel). */
function transition(agent: TestAgent, missionId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/agent/missions/${missionId}/transitions`)
    .set(auth(agent))
    .set('Idempotency-Key', `test-${++counter}-transition`)
    .send(body);
}

async function newMission(
  overrides: { agentId?: string | null; requiresValidation?: boolean; maxAttempts?: number } = {},
) {
  const input = createMissionRequestSchema.parse({
    type: 'test.tache',
    room: 'analysis',
    ...overrides,
  });
  return (await missions.create(input, HUMAN_ACTOR)).mission;
}

const runRow = (id: string) => prisma.agentRun.findUniqueOrThrow({ where: { id } });
const lastEvent = async (missionId: string) => (await missions.events(missionId)).at(-1)!;

/** Invariant de l'étape 2f : aucune exécution active pour une mission qui n'est plus en cours. */
async function orphanRuns(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM agent_runs r JOIN missions m ON m.id = r.mission_id
    WHERE r.status = 'started' AND m.status <> 'in_progress'`;
  return Number(row!.n);
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

afterEach(async () => {
  expect(await orphanRuns()).toBe(0);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('clôture automatique selon la sortie de la mission', () => {
  it('mission terminée : exécution « succeeded », dans la même transaction', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await transition(analyst, mission.id, { action: 'complete', output: { score: 80 } }).expect(
      200,
    );
    const closed = await runRow(run.id);
    const event = await lastEvent(mission.id);
    expect(closed).toMatchObject({ status: 'succeeded', failureCode: null });
    // Même instant que la transition : écrites ensemble.
    expect(closed.finishedAt?.toISOString()).toBe(event.createdAt);
  });

  it('mission soumise à validation : « succeeded »', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission({ requiresValidation: true });
    const { run } = await claim(analyst);
    await transition(analyst, mission.id, {
      action: 'submit_for_validation',
      output: { score: 80 },
    }).expect(200);
    expect((await runRow(run.id)).status).toBe('succeeded');
  });

  it('mission bloquée par l’agent : « stopped », avec le code et le motif', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await transition(analyst, mission.id, {
      action: 'block',
      reason: 'Chaîne supprimée',
      errorCode: 'SOURCE_GONE',
    }).expect(200);
    expect(await runRow(run.id)).toMatchObject({
      status: 'stopped',
      failureCode: 'SOURCE_GONE',
      failureMessage: 'Chaîne supprimée',
    });
  });

  it('mission mise en pause : « stopped »', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await transition(analyst, mission.id, { action: 'pause' }).expect(200);
    expect(await runRow(run.id)).toMatchObject({ status: 'stopped', failureCode: null });
  });

  it('mission annulée par l’utilisateur : « stopped »', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await owner
      .post(`/api/missions/${mission.id}/transitions`)
      .send({ action: 'cancel', reason: 'Prospect abandonné' })
      .expect(200);
    expect((await runRow(run.id)).status).toBe('stopped');
  });

  it('mission remise en attente par le système : « released »', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await missions.applyAction(
      mission.id,
      { action: 'release', reason: 'Maintenance' },
      { type: 'system', id: null },
    );
    expect((await runRow(run.id)).status).toBe('released');
  });

  it('mission bloquée par la récupération : « abandoned »', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    const future = createMissionService(prisma, {
      clock: () => new Date(Date.now() + 2 * 3600_000),
    });
    expect(await future.recoverStale({ staleAfterMs: 3600_000 })).toHaveLength(1);
    expect(await runRow(run.id)).toMatchObject({
      status: 'abandoned',
      failureCode: INTERRUPTED_ERROR_CODE,
    });
    expect((await missions.get(mission.id)).status).toBe('blocked');
  });
});

describe('transactions : jamais d’incohérence entre mission et exécution', () => {
  it('si la transaction échoue après la clôture, tout est annulé (mission et exécution)', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    const failing: TransactionHook = {
      begin: async () => {},
      end: async () => {
        throw new Error('Panne simulée en fin de transaction');
      },
    };
    await expect(
      missions.applyAction(
        mission.id,
        { action: 'complete' },
        { type: 'agent', id: analyst.id },
        { hook: failing },
      ),
    ).rejects.toThrow(/Panne simulée/);
    expect((await missions.get(mission.id)).status).toBe('in_progress');
    expect(await runRow(run.id)).toMatchObject({ status: 'started', finishedAt: null });
  });

  it('transition refusée (version périmée) : l’exécution reste active', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run, mission: started } = await claim(analyst);
    expectError(
      await transition(analyst, mission.id, {
        action: 'complete',
        expectedVersion: started.version - 1,
      }),
      409,
      'CONCURRENT_MODIFICATION',
    );
    expect((await runRow(run.id)).status).toBe('started');
  });

  it('une exécution close ne peut plus être modifiée', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const { run } = await claim(analyst);
    await transition(analyst, mission.id, { action: 'complete' }).expect(200);
    await expect(
      prisma.agentRun.update({ where: { id: run.id }, data: { failureMessage: 'x' } }),
    ).rejects.toThrow(/terminée ne peut plus être modifiée/);
  });
});

describe('reprise : nouvelle exécution, historique conservé', () => {
  it('après une demande de modification : claim reprend la mission avec une nouvelle exécution', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission({ requiresValidation: true });
    const first = await claim(analyst);
    await transition(analyst, mission.id, {
      action: 'submit_for_validation',
      output: { score: 60 },
    }).expect(200);
    const firstClosed = await runRow(first.run.id);
    expect(firstClosed.status).toBe('succeeded');

    await owner
      .post(`/api/missions/${mission.id}/validation`)
      .send({ decision: 'request_changes', reason: 'Justifier le score' })
      .expect(200);

    const second = await claim(analyst);
    expect(second).toMatchObject({ resumed: true, replayed: false });
    expect(second.mission).toMatchObject({
      id: mission.id,
      status: 'in_progress',
      validationOutcome: 'changes_requested',
      attemptCount: 1,
    });
    expect(second.run).toMatchObject({ status: 'started', attempt: 1 });
    expect(second.run.id).not.toBe(first.run.id);
    // L'exécution précédente est conservée, intacte.
    expect(await runRow(first.run.id)).toEqual(firstClosed);

    await transition(analyst, mission.id, {
      action: 'submit_for_validation',
      output: { score: 72 },
    }).expect(200);
    const runs = await prisma.agentRun.findMany({
      where: { missionId: mission.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(runs.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('après une pause, reprise décidée par l’utilisateur : claim crée une nouvelle exécution', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission();
    const first = await claim(analyst);
    await transition(analyst, mission.id, { action: 'pause' }).expect(200);
    await owner
      .post(`/api/missions/${mission.id}/transitions`)
      .send({ action: 'resume' })
      .expect(200);
    const second = await claim(analyst);
    expect(second).toMatchObject({ resumed: true, mission: { id: mission.id } });
    expect((await runRow(first.run.id)).status).toBe('stopped');
    expect(await prisma.agentRun.count({ where: { missionId: mission.id } })).toBe(2);
  });

  it('mission démarrée par l’utilisateur pour un agent : claim la reprend sans la redémarrer', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission({ agentId: 'agent-analyste' });
    await owner
      .post(`/api/missions/${mission.id}/transitions`)
      .send({ action: 'start' })
      .expect(200);
    const taken = await claim(analyst);
    expect(taken).toMatchObject({ resumed: true, mission: { id: mission.id, attemptCount: 1 } });
    const starts = (await missions.events(mission.id)).filter((e) => e.action === 'start');
    expect(starts).toHaveLength(1);
  });
});

describe('concurrence', () => {
  it('fin de mission et signal de vie simultanés (10 essais) : jamais de signal après la clôture', async () => {
    const analyst = await createAgent('agent-analyste');
    for (let round = 0; round < 10; round++) {
      const mission = await newMission();
      const { run, n8nExecutionId } = await claim(analyst);
      expect(run.missionId).toBe(mission.id);
      const [done, hb] = await Promise.all([
        transition(analyst, mission.id, { action: 'complete' }),
        request(app)
          .post(`/api/agent/runs/${run.id}/heartbeat`)
          .set(auth(analyst))
          .send({ n8nExecutionId }),
      ]);
      expect(done.status).toBe(200);
      expect([200, 409]).toContain(hb.status);
      const row = await runRow(run.id);
      expect(row.status).toBe('succeeded');
      expect(row.heartbeatAt!.getTime()).toBeLessThanOrEqual(row.finishedAt!.getTime());
      expect(await orphanRuns()).toBe(0);
    }
  });

  it('pause et signalement d’échec simultanés (10 essais) : une seule issue, exécution cohérente', async () => {
    const analyst = await createAgent('agent-analyste');
    for (let round = 0; round < 10; round++) {
      const mission = await newMission();
      const { run, n8nExecutionId } = await claim(analyst);
      expect(run.missionId).toBe(mission.id);
      const [paused, failed] = await Promise.all([
        transition(analyst, mission.id, { action: 'pause' }),
        request(app)
          .post(`/api/agent/runs/${run.id}/failure`)
          .set(auth(analyst))
          .send({ n8nExecutionId, code: 'LLM_ERROR', message: 'Erreur Ollama' }),
      ]);
      const missionStatus = (await missions.get(mission.id)).status;
      const runStatus = (await runRow(run.id)).status;
      if (failed.status === 200) {
        expect(paused.status).toBeGreaterThanOrEqual(400);
        expect([missionStatus, runStatus]).toEqual(['pending', 'released']);
      } else {
        expect(failed.status).toBe(409);
        expect(paused.status).toBe(200);
        expect([missionStatus, runStatus]).toEqual(['paused', 'stopped']);
      }
      expect(await orphanRuns()).toBe(0);
      await missions.applyAction(
        mission.id,
        { action: 'cancel', reason: 'Fin du tour' },
        HUMAN_ACTOR,
      );
    }
  });
});

describe('permissions et isolation', () => {
  it('un agent ne peut ni terminer ni mettre en pause la mission d’un autre : son exécution reste active', async () => {
    const a = await createAgent('agent-a');
    const b = await createAgent('agent-b');
    const mission = await newMission();
    const { run } = await claim(a);
    for (const body of [
      { action: 'complete' },
      { action: 'pause' },
      { action: 'block', reason: 'x' },
    ]) {
      expectError(await transition(b, mission.id, body), 403, 'FORBIDDEN_ACTOR');
    }
    expect((await runRow(run.id)).status).toBe('started');
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });

  it('un agent ne démarre ni ne reprend jamais une mission sans exécution', async () => {
    const analyst = await createAgent('agent-analyste');
    const mission = await newMission({ agentId: 'agent-analyste' });
    expectError(await transition(analyst, mission.id, { action: 'start' }), 403, 'FORBIDDEN_ACTOR');
    const taken = await claim(analyst);
    await transition(analyst, mission.id, { action: 'pause' }).expect(200);
    expectError(
      await transition(analyst, mission.id, { action: 'resume' }),
      403,
      'FORBIDDEN_ACTOR',
    );
    expect((await runRow(taken.run.id)).status).toBe('stopped');
    expect(await prisma.agentRun.count({ where: { status: 'started' } })).toBe(0);
  });
});
