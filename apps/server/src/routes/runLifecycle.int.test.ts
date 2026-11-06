import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  claimRunResponseSchema,
  createMissionRequestSchema,
  issuedAgentKeyResponseSchema,
  runFailureResponseSchema,
  runHeartbeatResponseSchema,
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
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Signal de vie et signalement d'échec des exécutions (Phase 2, étape 2e), contre la base de test
 * (ai_agency_test).
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const limits = testAgentLimits(prisma);
let now = new Date('2026-11-07T10:00:00.000Z');
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: true }),
  agents: createAgentService({ prisma }),
  profiles: createAgentProfileService({ prisma }),
  runs: createRunService({ prisma, missions, control: limits.agentControl, clock: () => now }),
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
  room: RoomId | null,
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
let execution = 0;

/** Prise de mission : renvoie l'exécution et l'identifiant n8n utilisé. */
async function claim(agent: TestAgent) {
  const n8nExecutionId = `n8n-exec-${++execution}`;
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(agent))
    .send({ n8nExecutionId })
    .expect(201);
  return { ...(claimRunResponseSchema.parse(res.body) as ClaimRunResponse), n8nExecutionId };
}

function heartbeat(agent: TestAgent, runId: string, n8nExecutionId: string) {
  return request(app)
    .post(`/api/agent/runs/${runId}/heartbeat`)
    .set(auth(agent))
    .send({ n8nExecutionId });
}

function failure(
  agent: TestAgent,
  runId: string,
  n8nExecutionId: string,
  extra: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/agent/runs/${runId}/failure`)
    .set(auth(agent))
    .send({ n8nExecutionId, code: 'LLM_TIMEOUT', message: 'Pas de réponse en 180 s', ...extra });
}

async function newMission(
  room: RoomId,
  overrides: { agentId?: string | null; maxAttempts?: number; requiresValidation?: boolean } = {},
) {
  const input = createMissionRequestSchema.parse({ type: 'test.tache', room, ...overrides });
  return (await missions.create(input, HUMAN_ACTOR)).mission;
}

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

const runRow = (id: string) => prisma.agentRun.findUniqueOrThrow({ where: { id } });
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

beforeEach(async () => {
  now = new Date('2026-11-07T10:00:00.000Z');
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('signal de vie', () => {
  it('met à jour le dernier signal de l’exécution en cours', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    later(5 * 60_000);
    const res = await heartbeat(analyst, run.id, n8nExecutionId).expect(200);
    const body = runHeartbeatResponseSchema.parse(res.body);
    expect(body.run).toMatchObject({ id: run.id, status: 'started' });
    expect(body.run.heartbeatAt).toBe(now.toISOString());
    expect((await runRow(run.id)).heartbeatAt?.toISOString()).toBe(now.toISOString());
  });

  it('refuse l’exécution d’un autre agent, sans rien modifier', async () => {
    const a = await createAgent('agent-a', 'analysis');
    const b = await createAgent('agent-b', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(a);
    const before = await runRow(run.id);
    later(60_000);
    expectError(await heartbeat(b, run.id, n8nExecutionId), 403, 'FORBIDDEN_ACTOR');
    expect(await runRow(run.id)).toEqual(before);
  });

  it('refuse une autre exécution n8n du même agent', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run } = await claim(analyst);
    const before = await runRow(run.id);
    later(60_000);
    expectError(await heartbeat(analyst, run.id, 'n8n-exec-autre'), 403, 'FORBIDDEN_ACTOR');
    expect(await runRow(run.id)).toEqual(before);
  });

  it('exécution inconnue : 404', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    expectError(
      await heartbeat(analyst, '00000000-0000-7000-8000-000000000000', 'n8n-x'),
      404,
      'NOT_FOUND',
    );
  });

  it('refusé sur une exécution terminée, qui reste inchangée', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    await failure(analyst, run.id, n8nExecutionId).expect(200);
    const closed = await runRow(run.id);
    later(60_000);
    const res = await heartbeat(analyst, run.id, n8nExecutionId);
    expectError(res, 409, 'INVALID_TRANSITION');
    expect(res.body.error.details).toEqual({ currentStatus: 'released' });
    expect(await runRow(run.id)).toEqual(closed);
  });

  it('refusé quand la mission n’est plus en cours', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    await request(app)
      .post(`/api/agent/missions/${mission.id}/transitions`)
      .set(auth(analyst))
      .set('Idempotency-Key', 'test-pause-1')
      .send({ action: 'pause' })
      .expect(200);
    expectError(await heartbeat(analyst, run.id, n8nExecutionId), 409, 'INVALID_TRANSITION');
  });
});

describe('échec avec remise en attente', () => {
  it('sans effet et avec une tentative restante : mission en attente et libre, exécution close', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    later(3 * 60_000);
    const res = await failure(analyst, run.id, n8nExecutionId, {
      code: 'INVALID_OUTPUT',
      message: 'JSON non conforme après 2 relances',
      rawOutput: '{"score": ',
      promptTokens: 1850,
      outputTokens: 42,
      llmMs: 9100,
    }).expect(200);
    const body = runFailureResponseSchema.parse(res.body);
    expect(body).toMatchObject({ decision: 'released', replayed: false });
    expect(body.mission).toMatchObject({ id: mission.id, status: 'pending', agentId: null });
    expect(body.run).toMatchObject({
      status: 'released',
      finishedAt: now.toISOString(),
      failureCode: 'INVALID_OUTPUT',
      failureMessage: 'JSON non conforme après 2 relances',
      promptTokens: 1850,
      outputTokens: 42,
      llmMs: 9100,
    });
    expect((await runRow(run.id)).rawOutput).toBe('{"score": ');
    const release = (await missions.events(mission.id)).at(-1);
    expect(release).toMatchObject({ action: 'release', actorType: 'system', toStatus: 'pending' });
    expect(release?.reason).toContain('INVALID_OUTPUT');
  });

  it('la mission libérée peut être reprise, et la tentative est comptée', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    const first = await claim(analyst);
    await failure(analyst, first.run.id, first.n8nExecutionId).expect(200);
    const second = await claim(analyst);
    expect(second.mission.id).toBe(mission.id);
    expect(second.run).toMatchObject({ attempt: 2, status: 'started' });
  });
});

describe('échec avec blocage', () => {
  it('la mission a déjà produit un effet : bloquée avec le code et le motif', async () => {
    const prospector = await createAgent('agent-prospecteur', null);
    const created = await request(app)
      .post('/api/agent/prospects')
      .set(auth(prospector))
      .set('Idempotency-Key', 'test-prospect-1')
      .send({
        creatorName: 'Léa',
        channelName: 'Chaîne de Léa',
        youtubeChannelId: 'UC-LEA',
        discovery: {
          source: 'Test',
          reason: 'Test',
          qualification: { targetFit: 'Oui', potentialInterest: 'Oui', firstObservation: 'RAS' },
        },
      })
      .expect(201);
    const prospectId = created.body.prospect.id as string;
    later(60_000);
    const { run, mission, n8nExecutionId } = await claim(prospector); // sa mission de découverte
    later(60_000);
    await request(app)
      .post(`/api/agent/prospects/${prospectId}/events`)
      .set(auth(prospector))
      .set('Idempotency-Key', 'test-activity-1')
      .send({ title: 'Chaîne relevée', missionId: mission.id })
      .expect(201);

    const body = runFailureResponseSchema.parse(
      (
        await failure(prospector, run.id, n8nExecutionId, {
          code: 'LLM_UNAVAILABLE',
          message: 'Ollama injoignable',
        }).expect(200)
      ).body,
    );
    expect(body).toMatchObject({ decision: 'blocked', replayed: false });
    expect(body.mission).toMatchObject({
      status: 'blocked',
      lastErrorCode: 'LLM_UNAVAILABLE',
      agentId: 'agent-prospecteur',
    });
    expect(body.mission.lastErrorMessage).toContain('Ollama injoignable');
    expect(body.run).toMatchObject({ status: 'failed', failureCode: 'LLM_UNAVAILABLE' });
  });

  it('échecs répétés : remise en attente tant qu’il reste des tentatives, puis blocage', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis', { maxAttempts: 2 });

    const first = await claim(analyst);
    const r1 = runFailureResponseSchema.parse(
      (await failure(analyst, first.run.id, first.n8nExecutionId).expect(200)).body,
    );
    expect(r1.decision).toBe('released');

    const second = await claim(analyst);
    expect(second.run.attempt).toBe(2);
    const r2 = runFailureResponseSchema.parse(
      (await failure(analyst, second.run.id, second.n8nExecutionId).expect(200)).body,
    );
    expect(r2.decision).toBe('blocked'); // plus aucune tentative
    expect(r2.mission).toMatchObject({ status: 'blocked', attemptCount: 2 });

    // Plus rien à prendre ; l'historique garde les deux exécutions.
    expect(
      (
        await request(app)
          .post('/api/agent/runs/claim')
          .set(auth(analyst))
          .send({ n8nExecutionId: 'n8n-exec-fin' })
      ).status,
    ).toBe(204);
    const runs = await prisma.agentRun.findMany({
      where: { missionId: mission.id },
      orderBy: { attempt: 'asc' },
    });
    expect(runs.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'released'],
      [2, 'failed'],
    ]);
  });

  it('une mission reprise après une demande de modification est bloquée (un résultat existe)', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const actor = { type: 'agent', id: 'agent-analyste' } as const;
    const mission = await newMission('analysis', {
      agentId: 'agent-analyste',
      requiresValidation: true,
    });
    await missions.applyAction(mission.id, { action: 'start' }, actor);
    await missions.applyAction(
      mission.id,
      { action: 'submit_for_validation', output: { score: 70 } },
      actor,
    );
    await missions.decide(
      mission.id,
      { decision: 'request_changes', reason: 'Préciser' },
      HUMAN_ACTOR,
    );
    const resumed = await claim(analyst);
    expect(resumed.resumed).toBe(true);
    const body = runFailureResponseSchema.parse(
      (await failure(analyst, resumed.run.id, resumed.n8nExecutionId).expect(200)).body,
    );
    expect(body.decision).toBe('blocked');
  });
});

describe('idempotence et exécutions terminées', () => {
  it('le même échec renvoyé ne change rien', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    const first = runFailureResponseSchema.parse(
      (await failure(analyst, run.id, n8nExecutionId).expect(200)).body,
    );
    const again = runFailureResponseSchema.parse(
      (await failure(analyst, run.id, n8nExecutionId).expect(200)).body,
    );
    expect(again).toMatchObject({ decision: first.decision, replayed: true });
    expect(again.run).toEqual(first.run);
    const releases = (await missions.events(mission.id)).filter((e) => e.action === 'release');
    expect(releases).toHaveLength(1);
  });

  it('refuse un échec quand la mission n’est plus en cours (exécution inchangée)', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    const mission = await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    await request(app)
      .post(`/api/agent/missions/${mission.id}/transitions`)
      .set(auth(analyst))
      .set('Idempotency-Key', 'test-complete-1')
      .send({ action: 'complete' })
      .expect(200);
    const before = await runRow(run.id);
    expectError(await failure(analyst, run.id, n8nExecutionId), 409, 'INVALID_TRANSITION');
    expect(await runRow(run.id)).toEqual(before);
    expect((await missions.get(mission.id)).status).toBe('completed');
  });
});

describe('concurrence', () => {
  it('signal de vie et échec simultanés (10 essais) : jamais de signal après la clôture', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    for (let round = 0; round < 10; round++) {
      const mission = await newMission('analysis');
      const { run, n8nExecutionId } = await claim(analyst);
      expect(run.missionId).toBe(mission.id);
      later(60_000);
      const [hb, fail] = await Promise.all([
        heartbeat(analyst, run.id, n8nExecutionId),
        failure(analyst, run.id, n8nExecutionId),
      ]);
      expect(fail.status).toBe(200);
      expect([200, 409]).toContain(hb.status);
      const row = await runRow(run.id);
      expect(row.status).toBe('released');
      expect(row.heartbeatAt!.getTime()).toBeLessThanOrEqual(row.finishedAt!.getTime());
      // Mission remise en attente : annulée, pour que le tour suivant prenne une mission neuve.
      await missions.applyAction(
        mission.id,
        { action: 'cancel', reason: 'Fin du tour' },
        HUMAN_ACTOR,
      );
    }
  });

  it('deux échecs simultanés pour la même exécution : une seule décision', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    for (let round = 0; round < 5; round++) {
      const mission = await newMission('analysis');
      const { run, n8nExecutionId } = await claim(analyst);
      expect(run.missionId).toBe(mission.id);
      const responses = await Promise.all([
        failure(analyst, run.id, n8nExecutionId),
        failure(analyst, run.id, n8nExecutionId),
        failure(analyst, run.id, n8nExecutionId),
      ]);
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(responses.filter((r) => r.body.replayed === false)).toHaveLength(1);
      const releases = (await missions.events(mission.id)).filter((e) => e.action === 'release');
      expect(releases).toHaveLength(1);
      await missions.applyAction(
        mission.id,
        { action: 'cancel', reason: 'Fin du tour' },
        HUMAN_ACTOR,
      );
    }
  });

  it('échec et fin de mission simultanés (10 essais) : une seule issue', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    for (let round = 0; round < 10; round++) {
      const mission = await newMission('analysis');
      const { run, n8nExecutionId } = await claim(analyst);
      expect(run.missionId).toBe(mission.id);
      const [fail, complete] = await Promise.all([
        failure(analyst, run.id, n8nExecutionId),
        request(app)
          .post(`/api/agent/missions/${mission.id}/transitions`)
          .set(auth(analyst))
          .set('Idempotency-Key', `test-complete-${round}`)
          .send({ action: 'complete' }),
      ]);
      const status = (await missions.get(mission.id)).status;
      if (fail.status === 200) {
        // L'échec est passé le premier : la mission a été remise en attente, la fin refusée.
        expect(status).toBe('pending');
        expect(complete.status).toBeGreaterThanOrEqual(400);
      } else {
        expect(fail.status).toBe(409);
        expect(complete.status).toBe(200);
        expect(status).toBe('completed');
      }
      const outcomes = (await missions.events(mission.id)).filter((e) =>
        ['release', 'complete'].includes(e.action),
      );
      expect(outcomes).toHaveLength(1);
      if (status === 'pending') {
        // Remise en attente : on reprend le tour suivant sur une mission neuve.
        await missions.applyAction(
          mission.id,
          { action: 'cancel', reason: 'Fin du tour' },
          HUMAN_ACTOR,
        );
      }
    }
  });
});

describe('isolation, permissions et arrêt d’urgence', () => {
  it('un agent ne peut pas signaler l’échec de l’exécution d’un autre agent', async () => {
    const a = await createAgent('agent-a', 'analysis');
    const b = await createAgent('agent-b', 'analysis');
    const mission = await newMission('analysis');
    const { run, n8nExecutionId } = await claim(a);
    const before = await runRow(run.id);
    expectError(await failure(b, run.id, n8nExecutionId), 403, 'FORBIDDEN_ACTOR');
    expect(await runRow(run.id)).toEqual(before);
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });

  it('permission missions:update exigée (retirée en cours de route)', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    await owner
      .patch('/api/agents/agent-analyste')
      .send({ permissions: ['missions:read'] })
      .expect(200);
    expectError(await heartbeat(analyst, run.id, n8nExecutionId), 403, 'FORBIDDEN_ACTOR');
    expectError(await failure(analyst, run.id, n8nExecutionId), 403, 'FORBIDDEN_ACTOR');
    expect((await runRow(run.id)).status).toBe('started');
  });

  it('arrêt d’urgence : signal et échec refusés, rien ne change', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    const before = await runRow(run.id);
    await owner.post('/api/agents/emergency-stop').send({ enabled: false }).expect(200);
    expectError(await heartbeat(analyst, run.id, n8nExecutionId), 503, 'AGENTS_DISABLED');
    expectError(await failure(analyst, run.id, n8nExecutionId), 503, 'AGENTS_DISABLED');
    expect(await runRow(run.id)).toEqual(before);
  });

  it('refusé sans clé et pour l’utilisateur ; corps invalide refusé', async () => {
    const analyst = await createAgent('agent-analyste', 'analysis');
    await newMission('analysis');
    const { run, n8nExecutionId } = await claim(analyst);
    expectError(
      await request(app).post(`/api/agent/runs/${run.id}/heartbeat`).send({ n8nExecutionId }),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await owner.post(`/api/agent/runs/${run.id}/failure`).send({
        n8nExecutionId,
        code: 'LLM_ERROR',
        message: 'x',
      }),
      403,
      'FORBIDDEN_ACTOR',
    );
    for (const body of [
      {},
      { n8nExecutionId, code: 'INCONNU', message: 'x' },
      { n8nExecutionId, code: 'LLM_ERROR', message: 'x', decision: 'released' },
    ]) {
      expectError(
        await request(app).post(`/api/agent/runs/${run.id}/failure`).set(auth(analyst)).send(body),
        400,
        'VALIDATION_ERROR',
      );
    }
    expectError(
      await request(app).post(`/api/agent/runs/${run.id}/heartbeat`).set(auth(analyst)).send({}),
      400,
      'VALIDATION_ERROR',
    );
    expect((await runRow(run.id)).status).toBe('started');
  });
});
