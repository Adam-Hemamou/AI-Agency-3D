import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMissionRequestSchema,
  isAgentMissionAction,
  missionListQuerySchema,
  type CreateMissionRequest,
  type MissionTransitionRequest,
} from '@agency/shared';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { createMissionService, type Actor } from './missionService.ts';

const prisma = createTestPrisma();
const service = createMissionService(prisma);

const user: Actor = { type: 'user', id: 'owner' };
const agent: Actor = { type: 'agent', id: 'agent-analyste' };
const system: Actor = { type: 'system', id: null };

async function create(overrides: Partial<CreateMissionRequest> = {}, actor: Actor = user) {
  const input = createMissionRequestSchema.parse({
    type: 'search_creators',
    room: 'prospecting',
    ...overrides,
  });
  return (await service.create(input, actor)).mission;
}

/** Par défaut, l'agent agit ; annuler et débloquer lui étant interdits, l'utilisateur s'en charge. */
function act(
  id: string,
  request: MissionTransitionRequest,
  actor: Actor = isAgentMissionAction(request.action) ? agent : user,
) {
  return service.applyAction(id, request, actor);
}

/** Attend une AppError avec le code donné. */
async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('création et lecture', () => {
  it('crée une mission en attente avec les valeurs par défaut', async () => {
    const mission = await create({ input: { query: 'cuisine', languages: ['fr'] } });
    expect(mission).toMatchObject({
      type: 'search_creators',
      room: 'prospecting',
      status: 'pending',
      priority: 3,
      input: { query: 'cuisine', languages: ['fr'] },
      output: null,
      requiresValidation: false,
      validationOutcome: null,
      agentId: null,
      attemptCount: 0,
      maxAttempts: 3,
      version: 0,
      startedAt: null,
      finishedAt: null,
    });
    expect(mission.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('relit la mission créée', async () => {
    const created = await create({ priority: 5, agentId: 'agent-1' });
    expect(await service.get(created.id)).toEqual(created);
  });

  it('enregistre un événement "created" avec les valeurs initiales', async () => {
    const created = await service.create(
      createMissionRequestSchema.parse({ type: 'score', room: 'analysis', priority: 4 }),
      system,
    );
    expect(created.event).toMatchObject({
      missionId: created.mission.id,
      action: 'created',
      actorType: 'system',
      actorId: null,
      fromStatus: null,
      toStatus: 'pending',
      reason: null,
    });
    expect(created.event.changes.priority).toEqual({ from: null, to: 4 });
    expect(created.event.changes.room).toEqual({ from: null, to: 'analysis' });
  });

  it('signale une mission inexistante', async () => {
    const missing = '00000000-0000-7000-8000-000000000000';
    await expectAppError(service.get(missing), 'NOT_FOUND');
    await expectAppError(service.events(missing), 'NOT_FOUND');
    await expectAppError(act(missing, { action: 'start' }), 'NOT_FOUND');
    await expectAppError(service.decide(missing, { decision: 'approve' }, user), 'NOT_FOUND');
  });
});

describe('recherche et filtres', () => {
  beforeEach(async () => {
    const a = await create({ type: 'search_creators', room: 'prospecting', priority: 2 });
    await create({ type: 'score', room: 'analysis', priority: 5 });
    const c = await create({ type: 'score', room: 'analysis', priority: 1 });
    await create({ type: 'write_email', room: 'copywriting', priority: 3 });
    await act(a.id, { action: 'start' });
    await act(c.id, { action: 'block', reason: 'données manquantes' });
  });

  const list = (query: Record<string, unknown>) =>
    service.list(missionListQuerySchema.parse(query));

  it('liste toutes les missions avec le total', async () => {
    const result = await list({});
    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(4);
  });

  it('filtre par statut (un ou plusieurs)', async () => {
    expect((await list({ status: 'in_progress' })).items.map((m) => m.type)).toEqual([
      'search_creators',
    ]);
    expect((await list({ status: 'in_progress,blocked' })).total).toBe(2);
  });

  it('filtre par salle et par type', async () => {
    expect((await list({ room: 'analysis' })).total).toBe(2);
    expect((await list({ type: 'write_email' })).total).toBe(1);
  });

  it('combine les filtres', async () => {
    const result = await list({ room: 'analysis', status: 'blocked' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.priority).toBe(1);
  });

  it('trie par priorité décroissante', async () => {
    expect((await list({ sort: 'priority' })).items.map((m) => m.priority)).toEqual([5, 3, 2, 1]);
  });

  it('pagine les résultats', async () => {
    const page = await list({ sort: 'priority', limit: '2', offset: '2' });
    expect(page).toMatchObject({ total: 4, limit: 2, offset: 2 });
    expect(page.items.map((m) => m.priority)).toEqual([2, 1]);
  });

  it('renvoie une liste vide si rien ne correspond', async () => {
    expect(await list({ room: 'followup' })).toMatchObject({ items: [], total: 0 });
  });
});

describe('démarrage, pause et reprise', () => {
  it('démarre une mission : statut, tentative et date de début', async () => {
    const { id } = await create();
    const { mission } = await act(id, { action: 'start' });
    expect(mission.status).toBe('in_progress');
    expect(mission.attemptCount).toBe(1);
    expect(mission.startedAt).not.toBeNull();
    expect(mission.version).toBe(1);
  });

  it('met en pause puis reprend sans compter de nouvelle tentative', async () => {
    const { id } = await create();
    const started = (await act(id, { action: 'start' })).mission;
    expect((await act(id, { action: 'pause' })).mission.status).toBe('paused');
    const resumed = (await act(id, { action: 'resume' })).mission;
    expect(resumed.status).toBe('in_progress');
    expect(resumed.attemptCount).toBe(1);
    expect(resumed.startedAt).toBe(started.startedAt);
  });

  it('refuse de reprendre une mission qui n’est pas en pause', async () => {
    const { id } = await create();
    const error = await expectAppError(act(id, { action: 'resume' }), 'INVALID_TRANSITION');
    expect(error.httpStatus).toBe(409);
    expect(error.details).toMatchObject({
      attempted: 'resume',
      currentStatus: 'pending',
      availableActions: ['start', 'block', 'cancel'],
    });
  });

  it('refuse de mettre en pause une mission en attente', async () => {
    const { id } = await create();
    await expectAppError(act(id, { action: 'pause' }), 'INVALID_TRANSITION');
  });
});

describe('fin de mission sans validation', () => {
  it('termine une mission en cours avec son résultat', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    const { mission } = await act(id, { action: 'complete', output: { creators: 12 } });
    expect(mission).toMatchObject({ status: 'completed', output: { creators: 12 } });
    expect(mission.finishedAt).not.toBeNull();
  });

  it('refuse de terminer une mission qui n’a pas démarré', async () => {
    const { id } = await create();
    await expectAppError(act(id, { action: 'complete' }), 'INVALID_TRANSITION');
  });

  it('n’autorise plus aucune action sur une mission terminée', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    await act(id, { action: 'complete' });
    for (const action of ['start', 'pause', 'resume', 'complete', 'unblock'] as const) {
      await expectAppError(act(id, { action }), 'INVALID_TRANSITION');
    }
    await expectAppError(act(id, { action: 'cancel', reason: 'trop tard' }), 'INVALID_TRANSITION');
  });
});

describe('validation humaine obligatoire', () => {
  async function awaitingValidation() {
    const { id } = await create({
      type: 'review_prospect',
      room: 'director',
      requiresValidation: true,
    });
    await act(id, { action: 'start' });
    await act(id, { action: 'submit_for_validation', output: { score: 82 } });
    return id;
  }

  it('interdit de terminer directement une mission qui exige une validation', async () => {
    const { id } = await create({ requiresValidation: true });
    await act(id, { action: 'start' });
    const error = await expectAppError(act(id, { action: 'complete' }), 'VALIDATION_REQUIRED');
    expect(error.details).toMatchObject({
      availableActions: expect.arrayContaining(['submit_for_validation']),
    });
    expect((await service.get(id)).status).toBe('in_progress');
  });

  it('soumet le résultat à validation', async () => {
    const id = await awaitingValidation();
    expect(await service.get(id)).toMatchObject({
      status: 'awaiting_validation',
      output: { score: 82 },
      validationOutcome: null,
    });
  });

  it('refuse la soumission d’une mission sans validation requise', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    await expectAppError(act(id, { action: 'submit_for_validation' }), 'INVALID_TRANSITION');
  });

  it('approuve : la mission est terminée et l’approbation est tracée', async () => {
    const id = await awaitingValidation();
    const { mission, event } = await service.decide(id, { decision: 'approve' }, user);
    expect(mission).toMatchObject({
      status: 'completed',
      validationOutcome: 'approved',
      validatedBy: 'owner',
    });
    expect(mission.validatedAt).not.toBeNull();
    expect(mission.finishedAt).not.toBeNull();
    expect(event).toMatchObject({
      action: 'approve',
      actorType: 'user',
      fromStatus: 'awaiting_validation',
      toStatus: 'completed',
    });
  });

  it('demande des modifications : retour en cours, motif conservé', async () => {
    const id = await awaitingValidation();
    const { mission, event } = await service.decide(
      id,
      { decision: 'request_changes', reason: 'Score à justifier' },
      user,
    );
    expect(mission).toMatchObject({
      status: 'in_progress',
      validationOutcome: 'changes_requested',
    });
    expect(mission.finishedAt).toBeNull();
    expect(event.reason).toBe('Score à justifier');

    // Nouvelle soumission : la décision précédente est effacée.
    const resubmitted = (await act(id, { action: 'submit_for_validation', output: { score: 75 } }))
      .mission;
    expect(resubmitted).toMatchObject({
      status: 'awaiting_validation',
      validationOutcome: null,
      validatedAt: null,
      output: { score: 75 },
    });
  });

  it('refuse : la mission est annulée avec le résultat "refusé"', async () => {
    const id = await awaitingValidation();
    const { mission } = await service.decide(
      id,
      { decision: 'reject', reason: 'Audience trop faible' },
      user,
    );
    expect(mission).toMatchObject({ status: 'cancelled', validationOutcome: 'rejected' });
  });

  it('interdit à un agent ou au système de valider', async () => {
    const id = await awaitingValidation();
    await expectAppError(service.decide(id, { decision: 'approve' }, agent), 'FORBIDDEN_ACTOR');
    await expectAppError(service.decide(id, { decision: 'approve' }, system), 'FORBIDDEN_ACTOR');
    expect((await service.get(id)).status).toBe('awaiting_validation');
  });

  it('interdit à un agent d’annuler ou de débloquer une mission', async () => {
    const { id } = await create();
    await expectAppError(
      service.applyAction(id, { action: 'cancel', reason: 'Fin' }, agent),
      'FORBIDDEN_ACTOR',
    );
    await act(id, { action: 'block', reason: 'Données manquantes' });
    await expectAppError(service.applyAction(id, { action: 'unblock' }, agent), 'FORBIDDEN_ACTOR');
    expect((await service.get(id)).status).toBe('blocked');
    await service.applyAction(id, { action: 'unblock' }, user);
    expect((await service.get(id)).status).toBe('pending');
  });

  it('refuse un agent qui se présente comme « utilisateur », pour chaque décision', async () => {
    const id = await awaitingValidation();
    const impostors: Actor[] = [
      { type: 'user', id: 'agent-analyste' },
      { type: 'user', id: null },
      { type: 'user', id: '' },
    ];
    for (const actor of impostors) {
      for (const decision of ['approve', 'reject', 'request_changes'] as const) {
        await expectAppError(
          service.decide(id, { decision, reason: 'Tentative' }, actor),
          'FORBIDDEN_ACTOR',
        );
      }
    }
    expect((await service.get(id)).status).toBe('awaiting_validation');
    // Aucune tentative refusée n'apparaît dans l'historique.
    expect((await service.events(id)).map((e) => e.action)).not.toContain('approve');
  });

  it('refuse une décision si la mission n’attend pas de validation', async () => {
    const { id } = await create({ requiresValidation: true });
    await act(id, { action: 'start' });
    await expectAppError(service.decide(id, { decision: 'approve' }, user), 'INVALID_TRANSITION');
  });

  it('refuse une seconde décision sur une mission déjà approuvée', async () => {
    const id = await awaitingValidation();
    await service.decide(id, { decision: 'approve' }, user);
    await expectAppError(
      service.decide(id, { decision: 'reject', reason: 'changement d’avis' }, user),
      'INVALID_TRANSITION',
    );
  });

  it('interdit de mettre en pause ou de bloquer une mission en attente de validation', async () => {
    const id = await awaitingValidation();
    await expectAppError(act(id, { action: 'pause' }), 'INVALID_TRANSITION');
    await expectAppError(act(id, { action: 'block', reason: 'x' }), 'INVALID_TRANSITION');
  });
});

describe('blocage, déblocage et tentatives', () => {
  it('bloque avec le motif et le code d’erreur', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    const { mission } = await act(id, {
      action: 'block',
      reason: 'Quota YouTube dépassé',
      errorCode: 'QUOTA_EXCEEDED',
    });
    expect(mission).toMatchObject({
      status: 'blocked',
      lastErrorCode: 'QUOTA_EXCEEDED',
      lastErrorMessage: 'Quota YouTube dépassé',
    });
  });

  it('débloque : retour en attente et erreur effacée', async () => {
    const { id } = await create();
    await act(id, { action: 'block', reason: 'données manquantes' });
    const { mission } = await act(id, { action: 'unblock' });
    expect(mission).toMatchObject({
      status: 'pending',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });

  it('compte une tentative à chaque démarrage et s’arrête au maximum', async () => {
    const { id } = await create({ maxAttempts: 2 });
    await act(id, { action: 'start' });
    await act(id, { action: 'block', reason: 'échec 1' });
    await act(id, { action: 'unblock' });
    expect((await act(id, { action: 'start' })).mission.attemptCount).toBe(2);
    await act(id, { action: 'block', reason: 'échec 2' });
    await act(id, { action: 'unblock' });
    await expectAppError(act(id, { action: 'start' }), 'MAX_ATTEMPTS_REACHED');
    expect((await service.get(id)).attemptCount).toBe(2);
  });

  it('refuse de débloquer une mission non bloquée', async () => {
    const { id } = await create();
    await expectAppError(act(id, { action: 'unblock' }), 'INVALID_TRANSITION');
  });
});

describe('annulation', () => {
  it.each(['pending', 'in_progress', 'paused', 'blocked'] as const)(
    'annule une mission au statut "%s"',
    async (status) => {
      const { id } = await create();
      if (status !== 'pending') {
        if (status === 'blocked') await act(id, { action: 'block', reason: 'x' });
        else await act(id, { action: 'start' });
        if (status === 'paused') await act(id, { action: 'pause' });
      }
      const { mission, event } = await act(
        id,
        { action: 'cancel', reason: 'Prospect en doublon' },
        user,
      );
      expect(mission.status).toBe('cancelled');
      expect(mission.finishedAt).not.toBeNull();
      expect(event).toMatchObject({ fromStatus: status, reason: 'Prospect en doublon' });
    },
  );

  it('annule une mission en attente de validation', async () => {
    const { id } = await create({ requiresValidation: true });
    await act(id, { action: 'start' });
    await act(id, { action: 'submit_for_validation' });
    expect((await act(id, { action: 'cancel', reason: 'abandon' })).mission.status).toBe(
      'cancelled',
    );
  });

  it('refuse d’annuler une mission déjà annulée', async () => {
    const { id } = await create();
    await act(id, { action: 'cancel', reason: 'a' });
    await expectAppError(act(id, { action: 'cancel', reason: 'b' }), 'INVALID_TRANSITION');
  });
});

describe('historique', () => {
  it('enregistre chaque étape, dans l’ordre, avec l’origine et les valeurs modifiées', async () => {
    const { id } = await create({ requiresValidation: true }, system);
    await act(id, { action: 'start' }, agent);
    await act(id, { action: 'pause' }, user);
    await act(id, { action: 'resume' }, user);
    await act(id, { action: 'submit_for_validation', output: { ok: true } }, agent);
    await service.decide(id, { decision: 'approve', reason: 'Parfait' }, user);

    const events = await service.events(id);
    expect(events.map((e) => [e.action, e.actorType, e.fromStatus, e.toStatus])).toEqual([
      ['created', 'system', null, 'pending'],
      ['start', 'agent', 'pending', 'in_progress'],
      ['pause', 'user', 'in_progress', 'paused'],
      ['resume', 'user', 'paused', 'in_progress'],
      ['submit_for_validation', 'agent', 'in_progress', 'awaiting_validation'],
      ['approve', 'user', 'awaiting_validation', 'completed'],
    ]);

    const [, start, , , submit, approve] = events;
    expect(start?.actorId).toBe('agent-analyste');
    expect(start?.changes.attemptCount).toEqual({ from: 0, to: 1 });
    expect(start?.changes.status).toEqual({ from: 'pending', to: 'in_progress' });
    expect(submit?.changes.output).toEqual({ from: null, to: { ok: true } });
    expect(approve?.changes.validationOutcome).toEqual({ from: null, to: 'approved' });
    expect(approve?.reason).toBe('Parfait');
  });

  it('n’enregistre aucun événement pour une action refusée', async () => {
    const { id } = await create();
    await expectAppError(act(id, { action: 'complete' }), 'INVALID_TRANSITION');
    expect(await service.events(id)).toHaveLength(1);
  });

  it('la base interdit de modifier ou supprimer un événement', async () => {
    const { id } = await create();
    await expect(
      prisma.missionEvent.updateMany({ where: { missionId: id }, data: { reason: 'falsifié' } }),
    ).rejects.toThrow(/ajout seul/);
    await expect(prisma.missionEvent.deleteMany({ where: { missionId: id } })).rejects.toThrow(
      /ajout seul/,
    );
    expect(await service.events(id)).toHaveLength(1);
  });
});

describe('cohérence entre mission et historique', () => {
  /** Client dont l'écriture d'événement échoue : simule une panne au milieu de la transaction. */
  function serviceWithFailingEventWrite() {
    const failing = prisma.$extends({
      query: {
        missionEvent: {
          create() {
            throw new Error('panne simulée lors de l’écriture de l’historique');
          },
        },
      },
    });
    return createMissionService(failing as unknown as AppPrismaClient);
  }

  it('annule le changement de statut si l’événement ne peut pas être écrit', async () => {
    const { id } = await create();
    const broken = serviceWithFailingEventWrite();
    await expect(broken.applyAction(id, { action: 'start' }, agent)).rejects.toThrow(
      /panne simulée/,
    );

    const mission = await service.get(id);
    expect(mission).toMatchObject({ status: 'pending', attemptCount: 0, version: 0 });
    expect(await service.events(id)).toHaveLength(1);
  });

  it('n’enregistre pas la mission si son événement de création échoue', async () => {
    const broken = serviceWithFailingEventWrite();
    await expect(
      broken.create(createMissionRequestSchema.parse({ type: 'x', room: 'analysis' }), user),
    ).rejects.toThrow(/panne simulée/);
    expect(await prisma.mission.count()).toBe(0);
  });

  it('chaque modification incrémente la version et produit exactement un événement', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    await act(id, { action: 'pause' });
    await act(id, { action: 'resume' });
    const mission = await service.get(id);
    expect(mission.version).toBe(3);
    expect(await service.events(id)).toHaveLength(1 + 3);
  });

  it('refuse une action basée sur une version périmée', async () => {
    const { id } = await create();
    await act(id, { action: 'start' });
    await expectAppError(
      act(id, { action: 'pause', expectedVersion: 0 }),
      'CONCURRENT_MODIFICATION',
    );
    expect((await service.get(id)).status).toBe('in_progress');
  });

  it('deux actions simultanées : une seule réussit', async () => {
    const { id } = await create();
    const results = await Promise.allSettled([
      act(id, { action: 'start' }),
      act(id, { action: 'start' }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const error = (failed[0] as PromiseRejectedResult).reason as AppError;
    expect(['CONCURRENT_MODIFICATION', 'INVALID_TRANSITION']).toContain(error.code);

    const mission = await service.get(id);
    expect(mission).toMatchObject({ status: 'in_progress', attemptCount: 1, version: 1 });
    expect(await service.events(id)).toHaveLength(2);
  });
});
