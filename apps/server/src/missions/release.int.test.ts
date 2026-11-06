import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createMissionRequestSchema, type CreateProspectRequest } from '@agency/shared';
import type { TransactionHook } from '../db/transactionHook.ts';
import { AppError } from '../errors/AppError.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { createTestAgentWithPrompt, createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { createMissionService, type Actor } from './missionService.ts';

/**
 * Remise en attente (release), Phase 2 étape 2b : réservée au système, refusée si la mission a déjà
 * produit un effet depuis son démarrage ou s'il ne reste aucune tentative. Base de test uniquement.
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });

const analyst: Actor = { type: 'agent', id: 'agent-analyste' };
const prospector: Actor = { type: 'agent', id: 'agent-prospecteur' };
const SYSTEM: Actor = { type: 'system', id: null };
const OWNER: Actor = { type: 'user', id: 'owner' };
const RELEASE = { action: 'release', reason: 'Ollama injoignable' } as const;

async function newMission(overrides: Record<string, unknown> = {}) {
  const input = createMissionRequestSchema.parse({
    type: 'analysis.score',
    room: 'analysis',
    ...overrides,
  });
  return (await missions.create(input, OWNER)).mission;
}

async function expectAppError(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (status) expect((error as AppError).httpStatus).toBe(status);
  return error as AppError;
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

beforeEach(async () => {
  await resetDatabase();
  await createTestAgentWithPrompt(prisma, analyst.id!, 'analysis');
  await createTestAgentWithPrompt(prisma, prospector.id!);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('remise en attente sans effet', () => {
  it('mission libre prise par un agent : redevient en attente ET libre, historique tracé', async () => {
    const mission = await newMission();
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    const { mission: released, event } = await missions.applyAction(mission.id, RELEASE, SYSTEM);
    expect(released).toMatchObject({ status: 'pending', agentId: null, attemptCount: 1 });
    expect(event).toMatchObject({
      action: 'release',
      actorType: 'system',
      fromStatus: 'in_progress',
      toStatus: 'pending',
      reason: 'Ollama injoignable',
    });
    expect(event.changes.agentId).toEqual({ from: 'agent-analyste', to: null });
  });

  it('mission attribuée à la création : redevient en attente et garde son agent', async () => {
    const mission = await newMission({ agentId: analyst.id });
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    const { mission: released } = await missions.applyAction(mission.id, RELEASE, SYSTEM);
    expect(released).toMatchObject({ status: 'pending', agentId: 'agent-analyste' });
  });

  it('la mission peut être reprise : la nouvelle tentative est comptée', async () => {
    const mission = await newMission({ maxAttempts: 2 });
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    await missions.applyAction(mission.id, RELEASE, SYSTEM);
    const { mission: restarted } = await missions.applyAction(
      mission.id,
      { action: 'start' },
      analyst,
    );
    expect(restarted).toMatchObject({ status: 'in_progress', attemptCount: 2 });
    // Dernière tentative : une nouvelle remise en attente est refusée (la mission sera bloquée).
    await expectAppError(missions.applyAction(mission.id, RELEASE, SYSTEM), 'MAX_ATTEMPTS_REACHED');
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });
});

describe('remise en attente refusée', () => {
  it('si la mission a déjà produit un effet depuis son démarrage', async () => {
    const d = await prospects.createProspect(baseProspect, prospector);
    const mission = d.missions[0]!; // attribuée au prospecteur
    await missions.applyAction(mission.id, { action: 'start' }, prospector);
    await prospects.logActivity(
      d.prospect.id,
      { title: 'Chaîne relevée', missionId: mission.id },
      prospector,
    );
    const error = await expectAppError(
      missions.applyAction(mission.id, RELEASE, SYSTEM),
      'INVALID_TRANSITION',
      409,
    );
    expect(error.message).toContain('1 activité(s) du dossier');
    expect(error.details).toMatchObject({ attempted: 'release', effects: { events: 1 } });
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });

  it('si un résultat a déjà été transmis', async () => {
    const mission = await newMission({ agentId: analyst.id, requiresValidation: true });
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    await missions.applyAction(
      mission.id,
      { action: 'submit_for_validation', output: { score: 70 } },
      analyst,
    );
    await missions.decide(mission.id, { decision: 'request_changes', reason: 'Préciser' }, OWNER);
    // De retour en cours, mais un résultat existe déjà : pas de remise en attente.
    await expectAppError(missions.applyAction(mission.id, RELEASE, SYSTEM), 'INVALID_TRANSITION');
  });

  it('pour un agent ou l’utilisateur : réservée au système', async () => {
    const mission = await newMission({ agentId: analyst.id });
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    await expectAppError(
      missions.applyAction(mission.id, RELEASE, analyst),
      'FORBIDDEN_ACTOR',
      403,
    );
    await expectAppError(missions.applyAction(mission.id, RELEASE, OWNER), 'FORBIDDEN_ACTOR', 403);
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });

  it('hors du statut « en cours »', async () => {
    const mission = await newMission({ agentId: analyst.id });
    await expectAppError(missions.applyAction(mission.id, RELEASE, SYSTEM), 'INVALID_TRANSITION');
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    await missions.applyAction(mission.id, { action: 'pause' }, analyst);
    await expectAppError(missions.applyAction(mission.id, RELEASE, SYSTEM), 'INVALID_TRANSITION');
  });

  it('n’apparaît jamais dans les actions proposées après un refus', async () => {
    const mission = await newMission({ agentId: analyst.id });
    await missions.applyAction(mission.id, { action: 'start' }, analyst);
    const error = await expectAppError(
      missions.applyAction(mission.id, { action: 'resume' }, analyst),
      'INVALID_TRANSITION',
    );
    expect((error.details as { availableActions: string[] }).availableActions).not.toContain(
      'release',
    );
  });
});

describe('concurrence avec une écriture qui cite la mission', () => {
  it('écriture en cours de validation : la remise en attente l’attend, la voit et est refusée', async () => {
    const d = await prospects.createProspect(baseProspect, prospector);
    const mission = d.missions[0]!;
    await missions.applyAction(mission.id, { action: 'start' }, prospector);

    let reached!: () => void;
    const reachedP = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const releaseP = new Promise<void>((resolve) => (release = resolve));
    const hook: TransactionHook = {
      begin: async () => {},
      end: async () => {
        reached();
        await releaseP;
      },
    };
    const write = prospects.logActivity(
      d.prospect.id,
      { title: 'Effet simultané', missionId: mission.id },
      prospector,
      { hook },
    );
    await reachedP;

    const attempt = missions.applyAction(mission.id, RELEASE, SYSTEM);
    let settled = false;
    attempt.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false); // elle attend le verrou de la mission

    release();
    await write;
    await expectAppError(attempt, 'INVALID_TRANSITION');
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });
});
