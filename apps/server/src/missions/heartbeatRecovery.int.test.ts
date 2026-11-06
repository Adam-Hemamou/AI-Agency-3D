import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  claimRunResponseSchema,
  createMissionRequestSchema,
  issuedAgentKeyResponseSchema,
  type ClaimRunResponse,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createRunService } from '../agents/runService.ts';
import { createApp } from '../app.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import {
  createMissionService,
  INTERRUPTED_ERROR_CODE,
  ORPHANED_RUN_ERROR_CODE,
} from './missionService.ts';

/**
 * Récupération des missions interrompues et signal de vie des exécutions (Phase 2, étape 2g).
 * Une seule horloge pilotée pour la prise de mission, le signal de vie et la récupération.
 * Base de test uniquement (ai_agency_test).
 */

const prisma = createTestPrisma();
let now = new Date();
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
const STALE = { staleAfterMs: 60 * MINUTE }; // MISSION_STALE_MINUTES par défaut
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

let owner: OwnerClient;
interface TestAgent {
  id: string;
  key: string;
}
let analyst: TestAgent;
let counter = 0;

async function createAgent(id: string): Promise<TestAgent> {
  await owner
    .post('/api/agents')
    .send({ id, name: id, room: 'analysis', permissions: AGENT_PERMISSIONS })
    .expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  await owner
    .post(`/api/agents/${id}/prompts`)
    .send({ systemPrompt: `Prompt de test de ${id}`, activate: true })
    .expect(201);
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

const auth = (agent: TestAgent) => ({ Authorization: `Bearer ${agent.key}` });

/** Crée une mission libre et la fait prendre par l'analyste (exécution « started »). */
async function claimedMission() {
  const input = createMissionRequestSchema.parse({ type: 'test.tache', room: 'analysis' });
  const { mission } = await missions.create(input, HUMAN_ACTOR);
  const n8nExecutionId = `n8n-exec-${++counter}`;
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(analyst))
    .send({ n8nExecutionId })
    .expect(201);
  const claimed = claimRunResponseSchema.parse(res.body) as ClaimRunResponse;
  expect(claimed.mission.id).toBe(mission.id);
  return { missionId: mission.id, runId: claimed.run.id, n8nExecutionId };
}

const heartbeat = (runId: string, n8nExecutionId: string) =>
  request(app)
    .post(`/api/agent/runs/${runId}/heartbeat`)
    .set(auth(analyst))
    .send({ n8nExecutionId });

/** n8n : un signal toutes les 5 minutes pendant `minutes`. */
async function workFor(minutes: number, runId: string, n8nExecutionId: string) {
  for (let elapsed = 5; elapsed <= minutes; elapsed += 5) {
    later(5 * MINUTE);
    await heartbeat(runId, n8nExecutionId).expect(200);
  }
}

const runRow = (id: string) => prisma.agentRun.findUniqueOrThrow({ where: { id } });

async function orphanRuns(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM agent_runs r JOIN missions m ON m.id = r.mission_id
    WHERE r.status = 'started' AND m.status <> 'in_progress'`;
  return Number(row!.n);
}

beforeEach(async () => {
  now = new Date();
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
  analyst = await createAgent('agent-analyste');
});

afterEach(async () => {
  expect(await orphanRuns()).toBe(0);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('signal de vie récent : la mission est protégée', () => {
  it('une exécution qui envoie un signal toutes les 5 minutes n’est jamais récupérée', async () => {
    const { missionId, runId, n8nExecutionId } = await claimedMission();
    // 3 heures de travail : la mission n'a pas été modifiée depuis, mais les signaux continuent.
    await workFor(180, runId, n8nExecutionId);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(missionId)).status).toBe('in_progress');
    expect((await runRow(runId)).status).toBe('started');
  });

  it('dernier signal il y a 59 minutes : toujours protégée', async () => {
    const { missionId, runId, n8nExecutionId } = await claimedMission();
    later(30 * MINUTE);
    await heartbeat(runId, n8nExecutionId).expect(200);
    later(59 * MINUTE);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(missionId)).status).toBe('in_progress');
  });

  it('signal actualisé juste avant la récupération : aucune interruption', async () => {
    const { missionId, runId, n8nExecutionId } = await claimedMission();
    later(61 * MINUTE); // silencieuse depuis plus d'une heure…
    await heartbeat(runId, n8nExecutionId).expect(200); // … mais un signal arrive à l'instant
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await runRow(runId)).status).toBe('started');
    expect((await missions.get(missionId)).status).toBe('in_progress');
  });
});

describe('signal de vie expiré : la mission est récupérée', () => {
  it('exécution close en « abandoned », mission bloquée avec INTERRUPTED', async () => {
    const { missionId, runId, n8nExecutionId } = await claimedMission();
    await workFor(10, runId, n8nExecutionId); // deux signaux, puis plus rien
    const lastSignal = new Date(now);
    later(61 * MINUTE);

    const recovered = await missions.recoverStale(STALE);
    expect(recovered).toEqual([
      {
        missionId,
        agentId: 'agent-analyste',
        runId,
        effects: { analyses: 0, productions: 0, decisions: 0, events: 0, output: false },
      },
    ]);
    const mission = await missions.get(missionId);
    expect(mission).toMatchObject({ status: 'blocked', lastErrorCode: INTERRUPTED_ERROR_CODE });
    expect(mission.lastErrorMessage).toContain('aucun signal de vie de l’exécution n8n');
    expect(mission.lastErrorMessage).toContain(lastSignal.toISOString());
    expect(await runRow(runId)).toMatchObject({
      status: 'abandoned',
      failureCode: INTERRUPTED_ERROR_CODE,
      finishedAt: now,
    });
    // Un signal tardif est refusé : l'exécution est close.
    const late = await heartbeat(runId, n8nExecutionId);
    expect(late.status).toBe(409);
  });

  it('respecte le seuil configuré', async () => {
    const { missionId } = await claimedMission();
    later(90 * MINUTE);
    expect(await missions.recoverStale({ staleAfterMs: 120 * MINUTE })).toEqual([]);
    expect((await missions.get(missionId)).status).toBe('in_progress');
    expect(await missions.recoverStale(STALE)).toHaveLength(1);
  });
});

describe('exécution sans signal de vie', () => {
  it('sans aucun signal : le démarrage de l’exécution compte, puis récupération', async () => {
    const { missionId, runId } = await claimedMission();
    await prisma.agentRun.update({ where: { id: runId }, data: { heartbeatAt: null } });
    later(30 * MINUTE);
    expect(await missions.recoverStale(STALE)).toEqual([]); // démarrée il y a 30 min
    later(31 * MINUTE);
    const [recovered] = await missions.recoverStale(STALE);
    expect(recovered).toMatchObject({ missionId, runId });
    expect((await runRow(runId)).status).toBe('abandoned');
  });
});

describe('mission sans exécution active : comportement historique conservé', () => {
  it('mission démarrée par l’utilisateur pour un agent, sans exécution : récupérée au seuil', async () => {
    const input = createMissionRequestSchema.parse({
      type: 'test.tache',
      room: 'analysis',
      agentId: 'agent-analyste',
    });
    const { mission } = await missions.create(input, HUMAN_ACTOR);
    await missions.applyAction(mission.id, { action: 'start' }, HUMAN_ACTOR);
    later(59 * MINUTE);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    later(2 * MINUTE);
    const [recovered] = await missions.recoverStale(STALE);
    expect(recovered).toMatchObject({ missionId: mission.id, runId: null });
    const blocked = await missions.get(mission.id);
    expect(blocked.lastErrorMessage).toContain('aucune activité depuis plus de 60 min');
  });

  it('les signaux d’une exécution ne protègent que SA mission', async () => {
    const live = await claimedMission();
    const silent = await claimedMission();
    for (let i = 0; i < 14; i++) {
      later(5 * MINUTE);
      await heartbeat(live.runId, live.n8nExecutionId).expect(200);
    }
    const recovered = await missions.recoverStale(STALE);
    expect(recovered.map((r) => r.missionId)).toEqual([silent.missionId]);
    expect((await runRow(live.runId)).status).toBe('started');
    expect((await runRow(silent.runId)).status).toBe('abandoned');
  });
});

describe('concurrence entre signal de vie et récupération', () => {
  it('signal en cours de validation : la récupération l’attend, le voit et n’interrompt pas', async () => {
    const { missionId, runId } = await claimedMission();
    later(61 * MINUTE);

    // Un signal de vie en cours : exécution verrouillée et actualisée, pas encore validé.
    let locked!: () => void;
    const lockedP = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const releaseP = new Promise<void>((resolve) => (release = resolve));
    const inFlight = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM agent_runs WHERE id = ${runId} FOR UPDATE`;
        await tx.agentRun.update({ where: { id: runId }, data: { heartbeatAt: now } });
        locked();
        await releaseP;
      },
      { timeout: 20_000 },
    );
    await lockedP;

    const recovery = missions.recoverStale(STALE);
    let settled = false;
    recovery.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false); // elle attend le verrou de l'exécution

    release();
    await inFlight;
    expect(await recovery).toEqual([]); // le signal, validé entre-temps, a été vu
    expect((await runRow(runId)).status).toBe('started');
    expect((await missions.get(missionId)).status).toBe('in_progress');
  });

  it('signal et récupération simultanés (10 essais) : jamais d’interruption d’une exécution vivante', async () => {
    for (let round = 0; round < 10; round++) {
      const { missionId, runId, n8nExecutionId } = await claimedMission();
      later(61 * MINUTE);
      const [hb, recovered] = await Promise.all([
        heartbeat(runId, n8nExecutionId),
        missions.recoverStale(STALE),
      ]);
      const run = await runRow(runId);
      const mission = await missions.get(missionId);
      if (recovered.some((r) => r.missionId === missionId)) {
        // La récupération est passée la première : le signal, arrivé après, est refusé.
        expect(hb.status).toBe(409);
        expect([run.status, mission.status]).toEqual(['abandoned', 'blocked']);
      } else {
        // Le signal est passé le premier : la récupération l'a vu.
        expect(hb.status).toBe(200);
        expect([run.status, mission.status]).toEqual(['started', 'in_progress']);
        await missions.applyAction(
          missionId,
          { action: 'cancel', reason: 'Fin du tour' },
          HUMAN_ACTOR,
        );
      }
      expect(await orphanRuns()).toBe(0);
    }
  });
});

describe('arrêt d’urgence', () => {
  it('signaux refusés pendant l’arrêt : récupération au seuil, exécution close (jamais active indéfiniment)', async () => {
    const { missionId, runId, n8nExecutionId } = await claimedMission();
    await owner.post('/api/agents/emergency-stop').send({ enabled: false }).expect(200);
    later(30 * MINUTE);
    expect((await heartbeat(runId, n8nExecutionId)).status).toBe(503);
    expect(await missions.recoverStale(STALE)).toEqual([]); // avant le seuil : rien
    later(31 * MINUTE);
    const [recovered] = await missions.recoverStale(STALE); // la récupération continue
    expect(recovered).toMatchObject({ missionId, runId });
    expect(await runRow(runId)).toMatchObject({ status: 'abandoned' });
    expect((await missions.get(missionId)).status).toBe('blocked');
  });
});

describe('exécutions incohérentes', () => {
  it('exécution active alors que la mission n’est plus en cours : close, mission intacte', async () => {
    const { missionId, runId } = await claimedMission();
    // Intervention directe en base (hors moteur) : la mission quitte « en cours ».
    await prisma.mission.update({ where: { id: missionId }, data: { status: 'paused' } });
    const missionBefore = await missions.get(missionId);

    const closed = await missions.closeOrphanRuns();
    expect(closed).toEqual([{ runId, missionId, missionStatus: 'paused' }]);
    expect(await runRow(runId)).toMatchObject({
      status: 'abandoned',
      failureCode: ORPHANED_RUN_ERROR_CODE,
    });
    expect(await missions.get(missionId)).toEqual(missionBefore);
    expect(await missions.closeOrphanRuns()).toEqual([]); // rien de plus au passage suivant
  });
});

describe('historique et cohérence des statuts', () => {
  it('les exécutions terminées ne sont jamais modifiées par la récupération', async () => {
    const done = await claimedMission();
    await request(app)
      .post(`/api/agent/missions/${done.missionId}/transitions`)
      .set(auth(analyst))
      .set('Idempotency-Key', 'test-complete-historique')
      .send({ action: 'complete' })
      .expect(200);
    const finished = await runRow(done.runId);
    const stalled = await claimedMission();
    later(61 * MINUTE);

    await missions.closeOrphanRuns();
    expect(await missions.recoverStale(STALE)).toHaveLength(1);
    const abandoned = await runRow(stalled.runId);
    later(120 * MINUTE);
    await missions.closeOrphanRuns();
    expect(await missions.recoverStale(STALE)).toEqual([]);

    expect(await runRow(done.runId)).toEqual(finished);
    expect(await runRow(stalled.runId)).toEqual(abandoned);
  });

  it('après récupération puis déblocage, la reprise crée une nouvelle exécution et garde l’ancienne', async () => {
    const first = await claimedMission();
    later(61 * MINUTE);
    await missions.recoverStale(STALE);
    await missions.applyAction(first.missionId, { action: 'unblock' }, HUMAN_ACTOR);

    const n8nExecutionId = `n8n-exec-${++counter}`;
    const res = await request(app)
      .post('/api/agent/runs/claim')
      .set(auth(analyst))
      .send({ n8nExecutionId })
      .expect(201);
    const second = claimRunResponseSchema.parse(res.body);
    expect(second.mission.id).toBe(first.missionId);
    expect(second.run).toMatchObject({ attempt: 2, status: 'started' });

    const runs = await prisma.agentRun.findMany({
      where: { missionId: first.missionId },
      orderBy: { attempt: 'asc' },
    });
    expect(runs.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'abandoned'],
      [2, 'started'],
    ]);
    const actions = (await missions.events(first.missionId)).map((e) => e.action);
    expect(actions).toEqual(['created', 'start', 'block', 'unblock', 'start']);
  });
});
