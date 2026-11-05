import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  missionCommandResponseSchema,
  missionEventsResponseSchema,
  missionListResponseSchema,
  missionSchema,
} from '@agency/shared';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

const prisma = createTestPrisma();
const app = createApp({
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions: createMissionService(prisma),
  version: 'test',
  simulationMode: true,
});

const MISSING_ID = '00000000-0000-7000-8000-000000000000';

async function createMission(body: Record<string, unknown> = {}) {
  const res = await owner
    .post('/api/missions')
    .send({ type: 'search_creators', room: 'prospecting', ...body });
  expect(res.status).toBe(201);
  return missionCommandResponseSchema.parse(res.body).mission;
}

const transition = (id: string, body: Record<string, unknown>) =>
  owner.post(`/api/missions/${id}/transitions`).send(body);

const decide = (id: string, body: Record<string, unknown>) =>
  owner.post(`/api/missions/${id}/validation`).send(body);

/** Utilisateur humain connecté (session recréée après chaque remise à zéro). */
let owner: OwnerClient;

beforeEach(async () => {
  await resetDatabase();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/missions', () => {
  it('crée une mission (201) au format du contrat partagé', async () => {
    const res = await owner
      .post('/api/missions')
      .send({ type: 'score', room: 'analysis', priority: 4, input: { channelId: 'UC123' } });
    expect(res.status).toBe(201);
    const body = missionCommandResponseSchema.parse(res.body);
    expect(body.mission).toMatchObject({
      status: 'pending',
      priority: 4,
      input: { channelId: 'UC123' },
    });
    expect(body.event).toMatchObject({ action: 'created', actorType: 'user', actorId: 'owner' });
  });

  it('renvoie 400 et la liste des champs invalides', async () => {
    const res = await owner
      .post('/api/missions')
      .send({ type: 'Mauvais Type', room: 'kitchen', priority: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['priority', 'room', 'type']);
  });

  it('refuse d’imposer un statut à la création', async () => {
    const res = await owner
      .post('/api/missions')
      .send({ type: 'x', room: 'analysis', status: 'completed' });
    expect(res.status).toBe(400);
    expect(await prisma.mission.count()).toBe(0);
  });
});

describe('GET /api/missions/:id', () => {
  it('renvoie la mission', async () => {
    const created = await createMission();
    const res = await owner.get(`/api/missions/${created.id}`);
    expect(res.status).toBe(200);
    expect(missionSchema.parse(res.body)).toEqual(created);
  });

  it('renvoie 404 pour une mission inexistante', async () => {
    const res = await owner.get(`/api/missions/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: `Mission introuvable : ${MISSING_ID}` },
    });
  });
});

describe('GET /api/missions', () => {
  beforeEach(async () => {
    await createMission({ room: 'prospecting', type: 'search_creators' });
    const b = await createMission({ room: 'analysis', type: 'score' });
    await createMission({ room: 'analysis', type: 'score' });
    await transition(b.id, { action: 'start' });
  });

  it('liste les missions', async () => {
    const res = await owner.get('/api/missions');
    expect(res.status).toBe(200);
    expect(missionListResponseSchema.parse(res.body)).toMatchObject({
      total: 3,
      limit: 50,
      offset: 0,
    });
  });

  it('filtre par statut, salle et type', async () => {
    const byStatus = await owner.get('/api/missions?status=in_progress');
    expect(byStatus.body.total).toBe(1);
    const byRoom = await owner.get('/api/missions?room=analysis&type=score');
    expect(byRoom.body.total).toBe(2);
    const repeated = await owner.get('/api/missions?status=pending&status=in_progress');
    expect(repeated.body.total).toBe(3);
  });

  it('renvoie 400 pour un filtre invalide', async () => {
    const res = await owner.get('/api/missions?status=inconnu');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('status.0');
  });
});

describe('POST /api/missions/:id/transitions', () => {
  it('applique une transition autorisée', async () => {
    const { id } = await createMission();
    const res = await transition(id, { action: 'start' });
    expect(res.status).toBe(200);
    const body = missionCommandResponseSchema.parse(res.body);
    expect(body.mission.status).toBe('in_progress');
    expect(body.event).toMatchObject({
      action: 'start',
      fromStatus: 'pending',
      toStatus: 'in_progress',
    });
  });

  it('renvoie 409 INVALID_TRANSITION avec les actions possibles', async () => {
    const { id } = await createMission();
    const res = await transition(id, { action: 'complete' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: {
        attempted: 'complete',
        currentStatus: 'pending',
        availableActions: ['start', 'block', 'cancel'],
        availableDecisions: [],
      },
    });
  });

  it('renvoie 409 VALIDATION_REQUIRED pour terminer une mission à valider', async () => {
    const { id } = await createMission({ requiresValidation: true });
    await transition(id, { action: 'start' });
    const res = await transition(id, { action: 'complete' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VALIDATION_REQUIRED');
  });

  it('renvoie 400 si le motif obligatoire manque', async () => {
    const { id } = await createMission();
    const res = await transition(id, { action: 'cancel' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'reason', message: "Un motif est obligatoire pour l'action « cancel »" },
    ]);
  });

  it('refuse d’écrire un statut directement', async () => {
    const { id } = await createMission();
    const res = await transition(id, { status: 'completed' });
    expect(res.status).toBe(400);
    expect((await owner.get(`/api/missions/${id}`)).body.status).toBe('pending');
  });

  it('renvoie 409 CONCURRENT_MODIFICATION pour une version périmée', async () => {
    const { id } = await createMission();
    await transition(id, { action: 'start' });
    const res = await transition(id, { action: 'pause', expectedVersion: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('renvoie 404 pour une mission inexistante', async () => {
    const res = await transition(MISSING_ID, { action: 'start' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/missions/:id/validation', () => {
  async function awaitingValidation() {
    const { id } = await createMission({
      room: 'email_review',
      type: 'review_email',
      requiresValidation: true,
    });
    await transition(id, { action: 'start' });
    await transition(id, { action: 'submit_for_validation', output: { subject: 'Bonjour' } });
    return id;
  }

  it('approuve un résultat soumis à validation', async () => {
    const id = await awaitingValidation();
    const res = await decide(id, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(missionCommandResponseSchema.parse(res.body).mission).toMatchObject({
      status: 'completed',
      validationOutcome: 'approved',
      validatedBy: 'owner',
    });
  });

  it('exige un motif pour refuser', async () => {
    const id = await awaitingValidation();
    const res = await decide(id, { decision: 'reject' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('renvoie 409 si la mission n’attend pas de validation', async () => {
    const { id } = await createMission({ requiresValidation: true });
    const res = await decide(id, { decision: 'approve' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('renvoie 404 pour une mission inexistante', async () => {
    expect((await decide(MISSING_ID, { decision: 'approve' })).status).toBe(404);
  });
});

describe('GET /api/missions/:id/events', () => {
  it('renvoie l’historique dans l’ordre', async () => {
    const { id } = await createMission();
    await transition(id, { action: 'start' });
    await transition(id, { action: 'block', reason: 'Chaîne introuvable', errorCode: 'NOT_FOUND' });
    const res = await owner.get(`/api/missions/${id}/events`);
    expect(res.status).toBe(200);
    const { items } = missionEventsResponseSchema.parse(res.body);
    expect(items.map((e) => e.action)).toEqual(['created', 'start', 'block']);
    expect(items[2]).toMatchObject({ reason: 'Chaîne introuvable', toStatus: 'blocked' });
  });

  it('renvoie 404 pour une mission inexistante', async () => {
    expect((await owner.get(`/api/missions/${MISSING_ID}/events`)).status).toBe(404);
  });
});
