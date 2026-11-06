import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MODEL_DEFAULTS, createMissionRequestSchema } from '@agency/shared';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createMissionService } from '../missions/missionService.ts';
import {
  TEST_SYSTEM_PROMPT,
  createTestAgent,
  createTestAgentWithPrompt,
  createTestPrisma,
  resetDatabase,
} from '../test/testDb.ts';
import { createAgentProfileService } from './agentProfileService.ts';

/**
 * Table agent_runs (Phase 2, étape 2c) : garanties assurées par la base elle-même, et agents de
 * test avec prompt actif. Base de test uniquement (ai_agency_test).
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const profiles = createAgentProfileService({ prisma });

async function newMission(agentId: string | null = 'agent-analyste') {
  const input = createMissionRequestSchema.parse({
    type: 'analysis.score',
    room: 'analysis',
    agentId,
  });
  return (await missions.create(input, HUMAN_ACTOR)).mission;
}

let sequence = 0;
/** Insère une exécution directement (le service des exécutions viendra à l'étape 2d). */
function insertRun(
  missionId: string,
  overrides: Partial<{
    agentId: string;
    status: string;
    promptVersion: number;
    attempt: number;
    n8nExecutionId: string | null;
    finishedAt: Date | null;
  }> = {},
) {
  const status = overrides.status ?? 'started';
  return prisma.agentRun.create({
    data: {
      missionId,
      agentId: overrides.agentId ?? 'agent-analyste',
      attempt: overrides.attempt ?? 1,
      status,
      n8nExecutionId:
        overrides.n8nExecutionId === undefined ? `exec-${++sequence}` : overrides.n8nExecutionId,
      promptVersion: overrides.promptVersion ?? 1,
      settings: { ...AGENT_MODEL_DEFAULTS },
      startedAt: new Date(),
      finishedAt:
        overrides.finishedAt === undefined
          ? status === 'started'
            ? null
            : new Date()
          : overrides.finishedAt,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await createTestAgentWithPrompt(prisma, 'agent-analyste', 'analysis');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('agents de test avec prompt actif (base de test uniquement)', () => {
  it('l’agent créé a un profil par défaut et un prompt actif en version 1', async () => {
    const self = await profiles.selfProfile({ id: 'agent-analyste', name: 'x', room: 'analysis' });
    expect(self.settings).toEqual({ ...AGENT_MODEL_DEFAULTS });
    expect(self.prompt).toMatchObject({ version: 1, systemPrompt: TEST_SYSTEM_PROMPT });
  });

  it('l’utilitaire ne vise que la base de test', async () => {
    const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT DATABASE() AS db`;
    expect(row!.db).toBe('ai_agency_test');
  });
});

describe('index et migrations', () => {
  it('le journal dispose de l’index (started_at, id), créé par sa migration dédiée', async () => {
    const columns = await prisma.$queryRaw<{ name: string }[]>`
      SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_runs'
        AND INDEX_NAME = 'agent_runs_started_at_id_idx'
      ORDER BY SEQ_IN_INDEX`;
    expect(columns.map((c) => c.name)).toEqual(['started_at', 'id']);
    const [applied] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM _prisma_migrations
      WHERE migration_name = '20261107160000_agent_runs_started_at_index'
        AND finished_at IS NOT NULL`;
    expect(Number(applied!.n)).toBe(1);
  });
});

describe('une seule exécution en cours par mission (garanti par la base)', () => {
  it('refuse une deuxième exécution « started » sur la même mission', async () => {
    const mission = await newMission();
    await insertRun(mission.id);
    await expect(insertRun(mission.id)).rejects.toThrow(/agent_runs_one_active_per_mission/);
    expect(await prisma.agentRun.count()).toBe(1);
  });

  it('autorise une nouvelle exécution une fois la précédente terminée', async () => {
    const mission = await newMission();
    const first = await insertRun(mission.id);
    await prisma.agentRun.update({
      where: { id: first.id },
      data: { status: 'released', finishedAt: new Date(), failureCode: 'LLM_TIMEOUT' },
    });
    await insertRun(mission.id, { attempt: 2 });
    await insertRun(mission.id, { attempt: 3, status: 'failed' }); // terminées : sans limite
    expect(await prisma.agentRun.count({ where: { missionId: mission.id } })).toBe(3);
  });

  it('deux missions différentes peuvent avoir chacune leur exécution en cours', async () => {
    await insertRun((await newMission()).id);
    await insertRun((await newMission()).id);
    expect(await prisma.agentRun.count({ where: { status: 'started' } })).toBe(2);
  });

  it('insertions simultanées sur une même mission : une seule réussit', async () => {
    const mission = await newMission();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => insertRun(mission.id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.agentRun.count({ where: { missionId: mission.id } })).toBe(1);
  });
});

describe('traçabilité des exécutions (protégée par la base)', () => {
  it('une exécution en cours accepte un signal de vie, mais pas un changement d’identité', async () => {
    const mission = await newMission();
    const run = await insertRun(mission.id);
    await prisma.agentRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date() } });
    for (const data of [
      { attempt: 2 },
      { settings: { ...AGENT_MODEL_DEFAULTS, temperature: 1 } },
      { startedAt: new Date(0) },
      { n8nExecutionId: 'autre' },
    ]) {
      await expect(prisma.agentRun.update({ where: { id: run.id }, data })).rejects.toThrow(
        /identité de l.exécution non modifiable/,
      );
    }
  });

  it('une exécution terminée ne peut plus être modifiée, même en SQL', async () => {
    const mission = await newMission();
    const run = await insertRun(mission.id, { status: 'succeeded' });
    await expect(
      prisma.agentRun.update({
        where: { id: run.id },
        data: { status: 'started', finishedAt: null },
      }),
    ).rejects.toThrow(/terminée ne peut plus être modifiée/);
    await expect(
      prisma.$executeRaw`UPDATE agent_runs SET failure_message = 'x' WHERE id = ${run.id}`,
    ).rejects.toThrow(/terminée ne peut plus être modifiée/);
  });

  it('aucune exécution ne peut être supprimée', async () => {
    const mission = await newMission();
    const run = await insertRun(mission.id, { status: 'failed' });
    await expect(prisma.agentRun.delete({ where: { id: run.id } })).rejects.toThrow(
      /suppression interdite/,
    );
  });

  it('statut inconnu, date de fin incohérente et tentative nulle sont refusés', async () => {
    const mission = await newMission();
    await expect(insertRun(mission.id, { status: 'done' })).rejects.toThrow();
    await expect(
      insertRun(mission.id, { status: 'succeeded', finishedAt: null }),
    ).rejects.toThrow();
    await expect(insertRun(mission.id, { finishedAt: new Date() })).rejects.toThrow();
    await expect(insertRun(mission.id, { attempt: 0 })).rejects.toThrow();
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('la version du prompt existe forcément, et appartient au même agent', async () => {
    await createTestAgent(prisma, 'agent-sans-prompt', 'analysis');
    const mission = await newMission();
    await expect(insertRun(mission.id, { promptVersion: 2 })).rejects.toThrow();
    await expect(insertRun(mission.id, { agentId: 'agent-sans-prompt' })).rejects.toThrow();
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('une exécution n8n ne prend qu’une mission par agent', async () => {
    const m1 = await newMission();
    const m2 = await newMission();
    await insertRun(m1.id, { n8nExecutionId: 'exec-unique' });
    await expect(insertRun(m2.id, { n8nExecutionId: 'exec-unique' })).rejects.toThrow();
    // Sans identifiant n8n, pas de contrainte d'unicité.
    await insertRun(m2.id, { n8nExecutionId: null });
  });
});
