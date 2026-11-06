import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PIPELINE_MISSION_TYPES,
  prospectDossierSchema,
  type CreateProspectRequest,
  type ProspectDossier,
  type RoomId,
} from '@agency/shared';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { ownerClient } from '../test/ownerSession.ts';
import { AppError } from '../errors/AppError.ts';
import { createMissionService, type Actor } from '../missions/missionService.ts';
import { createTestAgent, createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { createProspectService } from './prospectService.ts';

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const service = createProspectService({ prisma, missions, simulationMode: true });

const owner: Actor = { type: 'user', id: 'owner' };
const agent: Actor = { type: 'agent', id: 'agent-test' };
/** Les missions de décision humaine (Mon bureau, validation des e-mails) sont lancées par le système. */
const system: Actor = { type: 'system', id: null };
/** Agent de la salle de validation des e-mails : il prend la mission et y rattache l'e-mail. */
const reviewer: Actor = { type: 'agent', id: 'agent-relecteur' };

const baseProspect: CreateProspectRequest = {
  creatorName: 'Créateur Test',
  channelName: 'Chaîne Test',
  youtubeChannelId: 'TEST-1',
  contactEmail: 'test@exemple.example',
  discovery: {
    source: 'Test',
    reason: 'Prospect de test',
    qualification: {
      targetFit: 'Oui',
      potentialInterest: 'Élevé',
      firstObservation: 'RAS',
    },
  },
};

const analysis = {
  summary: 'Synthèse',
  conclusion: 'Conclusion',
  priority: 4,
  scoreCriteria: [
    { label: 'A', weight: 50, value: 8, justification: 'x' },
    { label: 'B', weight: 50, value: 6, justification: 'y' },
  ],
  content: {
    international: { mainLanguage: 'Français' },
    activity: {},
    commercial: { potential: 'Bon', dubbingInterest: 'Fort', offerFit: 'Oui' },
  },
};

function openMission(d: ProspectDossier, room: RoomId) {
  const m = [...d.missions]
    .reverse()
    .find((x) => x.room === room && !['completed', 'cancelled'].includes(x.status));
  if (!m) throw new Error(`pas de mission ouverte en ${room}`);
  return m;
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Amène un prospect jusqu'à Mon bureau (mission de revue en attente de validation). */
async function prospectInReview(): Promise<ProspectDossier> {
  let d = await service.createProspect(baseProspect, agent);
  d = await service.moveToStage(d.prospect.id, 'analysis', agent, {
    mission: { type: PIPELINE_MISSION_TYPES.analyze, room: 'analysis' },
  });
  d = await service.addAnalysis(d.prospect.id, analysis, agent);
  d = await service.moveToStage(d.prospect.id, 'review', agent, {
    mission: { type: PIPELINE_MISSION_TYPES.review, room: 'director', requiresValidation: true },
  });
  const review = openMission(d, 'director');
  await missions.applyAction(review.id, { action: 'start' }, system);
  await missions.applyAction(review.id, { action: 'submit_for_validation' }, system);
  return service.getDossier(d.prospect.id);
}

/** Amène un prospect jusqu'à la validation des e-mails, avec un e-mail soumis. */
async function prospectWithEmail(): Promise<ProspectDossier> {
  let d = await prospectInReview();
  d = await service.decideProspect(
    d.prospect.id,
    { missionId: openMission(d, 'director').id, decision: 'approve' },
    owner,
  );
  d = await service.moveToStage(d.prospect.id, 'proposal', agent);
  d = await service.moveToStage(d.prospect.id, 'email_review', agent, {
    mission: {
      type: PIPELINE_MISSION_TYPES.emailReview,
      room: 'email_review',
      requiresValidation: true,
    },
  });
  const mission = openMission(d, 'email_review');
  await missions.applyAction(mission.id, { action: 'start' }, reviewer);
  d = await service.addProduction(
    d.prospect.id,
    {
      kind: 'email',
      missionId: mission.id,
      status: 'pending_review',
      content: { to: 'test@exemple.example', subject: 'Objet', body: 'Corps' },
    },
    reviewer,
  );
  await missions.applyAction(mission.id, { action: 'submit_for_validation' }, reviewer);
  return service.getDossier(d.prospect.id);
}

const latestEmail = (d: ProspectDossier) => d.productions.find((p) => p.kind === 'email')!;

beforeEach(async () => {
  await resetDatabase();
  await createTestAgent(prisma, agent.id!);
  await createTestAgent(prisma, reviewer.id!, 'email_review');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dossier unique', () => {
  it('crée le dossier avec sa mission de prospection et l’événement de découverte', async () => {
    const d = await service.createProspect(baseProspect, agent);
    expect(d.prospect).toMatchObject({
      reference: expect.stringMatching(/^P-\d{4}-0001$/),
      stage: 'prospecting',
    });
    expect(d.missions).toHaveLength(1);
    expect(d.missions[0]).toMatchObject({ room: 'prospecting', prospectId: d.prospect.id });
    expect(d.events.map((e) => e.type)).toEqual(['discovered']);
    expect(prospectDossierSchema.safeParse(d).success).toBe(true);
  });

  it('refuse un second dossier pour la même chaîne', async () => {
    await service.createProspect(baseProspect, agent);
    await expectAppError(service.createProspect(baseProspect, agent), 'ALREADY_EXISTS');
  });

  it('garde le même dossier d’une salle à l’autre et refuse les étapes interdites', async () => {
    const d = await prospectInReview();
    expect(new Set(d.missions.map((m) => m.prospectId))).toEqual(new Set([d.prospect.id]));
    expect(d.missions.map((m) => m.room)).toEqual(['prospecting', 'analysis', 'director']);
    // Le système lui-même ne peut pas sauter d'étape (cycle de vie)…
    await expectAppError(
      service.moveToStage(d.prospect.id, 'followup', { type: 'system', id: null }),
      'INVALID_TRANSITION',
    );
    // … et un agent ne franchit jamais une étape de décision humaine.
    for (const to of ['dubbing', 'refused', 'analysis', 'archived'] as const) {
      await expectAppError(service.moveToStage(d.prospect.id, to, agent), 'FORBIDDEN_ACTOR');
    }
    expect((await service.getDossier(d.prospect.id)).prospect.stage).toBe('review');
  });

  it('calcule le score à partir des critères pondérés', async () => {
    const d = await prospectInReview();
    expect(d.analyses[0]).toMatchObject({ version: 1, score: 70 });
  });
});

describe('décisions de Mon bureau', () => {
  it('valider : mission approuvée, décision tracée, passage au studio de doublage', async () => {
    const d0 = await prospectInReview();
    const review = openMission(d0, 'director');
    const d = await service.decideProspect(
      d0.prospect.id,
      { missionId: review.id, decision: 'approve' },
      owner,
    );

    expect(d.prospect.stage).toBe('dubbing');
    expect(d.missions.find((m) => m.id === review.id)).toMatchObject({
      status: 'completed',
      validationOutcome: 'approved',
      validatedBy: 'owner',
    });
    expect(openMission(d, 'dubbing').type).toBe(PIPELINE_MISSION_TYPES.dubbing);
    expect(d.decisions).toMatchObject([{ kind: 'prospect_approved', actorType: 'user' }]);
  });

  it('refuser sans motif : accepté, la mission garde un motif par défaut', async () => {
    const d0 = await prospectInReview();
    const review = openMission(d0, 'director');
    const d = await service.decideProspect(
      d0.prospect.id,
      { missionId: review.id, decision: 'reject' },
      owner,
    );

    expect(d.prospect.stage).toBe('refused');
    expect(d.decisions[0]).toMatchObject({ kind: 'prospect_rejected', reason: null });
    const events = await missions.events(review.id);
    expect(events.at(-1)).toMatchObject({
      action: 'reject',
      reason: expect.stringContaining('aucun motif'),
    });
  });

  it('nouvelle analyse : nouvelle mission d’analyse avec la consigne, ancienne analyse conservée', async () => {
    const d0 = await prospectInReview();
    let d = await service.decideProspect(
      d0.prospect.id,
      {
        missionId: openMission(d0, 'director').id,
        decision: 'request_reanalysis',
        instruction: 'Vérifier le public',
      },
      owner,
    );
    expect(d.prospect.stage).toBe('analysis');
    expect(openMission(d, 'analysis').input).toMatchObject({ instruction: 'Vérifier le public' });
    expect(d.decisions[0]).toMatchObject({
      kind: 'reanalysis_requested',
      reason: 'Vérifier le public',
    });

    d = await service.addAnalysis(d.prospect.id, analysis, agent);
    expect(d.analyses.map((a) => a.version)).toEqual([2, 1]);
  });

  it('refuse une mission d’un autre dossier, et une décision hors attente de validation', async () => {
    const a = await prospectInReview();
    const b = await service.createProspect({ ...baseProspect, youtubeChannelId: 'TEST-2' }, agent);
    await expectAppError(
      service.decideProspect(
        b.prospect.id,
        { missionId: openMission(a, 'director').id, decision: 'approve' },
        owner,
      ),
      'VALIDATION_ERROR',
    );
    const review = openMission(a, 'director');
    await service.decideProspect(
      a.prospect.id,
      { missionId: review.id, decision: 'approve' },
      owner,
    );
    await expectAppError(
      service.decideProspect(a.prospect.id, { missionId: review.id, decision: 'approve' }, owner),
      'INVALID_TRANSITION',
    );
  });

  it('refuse une décision prise par un agent', async () => {
    const d = await prospectInReview();
    await expectAppError(
      service.decideProspect(
        d.prospect.id,
        { missionId: openMission(d, 'director').id, decision: 'approve' },
        agent,
      ),
      'FORBIDDEN_ACTOR',
    );
    expect((await service.getDossier(d.prospect.id)).prospect.stage).toBe('review');
  });

  it('refuse une décision prise par le système ou par un agent se déclarant « utilisateur »', async () => {
    const d = await prospectInReview();
    const missionId = openMission(d, 'director').id;
    for (const actor of [
      { type: 'system', id: null },
      { type: 'user', id: 'agent-test' },
      { type: 'user', id: null },
    ] satisfies Actor[]) {
      await expectAppError(
        service.decideProspect(d.prospect.id, { missionId, decision: 'reject' }, actor),
        'FORBIDDEN_ACTOR',
      );
    }
    const after = await service.getDossier(d.prospect.id);
    expect(after.prospect.stage).toBe('review');
    expect(after.decisions).toHaveLength(0);
  });
});

describe('validation des e-mails et suivi', () => {
  it('modification demandée → nouvelle version → validation → envoi simulé', async () => {
    let d = await prospectWithEmail();
    const mission = openMission(d, 'email_review');

    d = await service.decideEmail(
      d.prospect.id,
      {
        missionId: mission.id,
        productionId: latestEmail(d).id,
        decision: 'request_changes',
        reason: 'Plus court',
      },
      owner,
    );
    expect(latestEmail(d).status).toBe('changes_requested');
    expect(d.missions.find((m) => m.id === mission.id)?.status).toBe('in_progress');

    d = await service.editEmailDraft(
      d.prospect.id,
      { productionId: latestEmail(d).id, subject: 'Nouvel objet', body: 'Nouveau corps' },
      owner,
    );
    const emails = d.productions.filter((p) => p.kind === 'email');
    expect(emails.map((e) => [e.version, e.status])).toEqual([
      [2, 'pending_review'],
      [1, 'superseded'],
    ]);
    expect(d.missions.find((m) => m.id === mission.id)?.status).toBe('awaiting_validation');

    d = await service.decideEmail(
      d.prospect.id,
      { missionId: mission.id, productionId: latestEmail(d).id, decision: 'approve' },
      owner,
    );
    expect(latestEmail(d).status).toBe('approved');
    expect(d.prospect.stage).toBe('email_review');

    d = await service.simulateSend(d.prospect.id, { productionId: latestEmail(d).id }, owner);
    expect(d.prospect).toMatchObject({ stage: 'followup', relationshipStatus: 'awaiting_reply' });
    expect(d.messages).toMatchObject([
      { direction: 'outbound', delivery: 'simulated', subject: 'Nouvel objet' },
    ]);
    expect(openMission(d, 'followup').status).toBe('in_progress');
  });

  it('refuse qu’un agent valide, refuse ou fasse corriger un e-mail', async () => {
    const d = await prospectWithEmail();
    const missionId = openMission(d, 'email_review').id;
    const productionId = latestEmail(d).id;
    for (const decision of ['approve', 'reject', 'request_changes'] as const) {
      await expectAppError(
        service.decideEmail(
          d.prospect.id,
          { missionId, productionId, decision, reason: 'Décision d’agent' },
          agent,
        ),
        'FORBIDDEN_ACTOR',
      );
    }
    const after = await service.getDossier(d.prospect.id);
    expect(latestEmail(after).status).toBe('pending_review');
    expect(openMission(after, 'email_review').status).toBe('awaiting_validation');
  });

  it('refuse d’agir sur une ancienne version de l’e-mail', async () => {
    let d = await prospectWithEmail();
    const v1 = latestEmail(d);
    d = await service.editEmailDraft(
      d.prospect.id,
      { productionId: v1.id, subject: 'S', body: 'B' },
      owner,
    );
    await expectAppError(
      service.decideEmail(
        d.prospect.id,
        { missionId: openMission(d, 'email_review').id, productionId: v1.id, decision: 'approve' },
        owner,
      ),
      'INVALID_TRANSITION',
    );
  });

  it('n’envoie jamais hors mode simulation', async () => {
    const real = createProspectService({ prisma, missions, simulationMode: false });
    const d = await prospectWithEmail();
    await expectAppError(
      real.simulateSend(d.prospect.id, { productionId: latestEmail(d).id }, owner),
      'EXTERNAL_ACTION_BLOCKED',
    );
  });

  it('bloque toute relance si le prospect ne veut plus être contacté, et clôt le suivi', async () => {
    let d = await prospectWithEmail();
    d = await service.decideEmail(
      d.prospect.id,
      {
        missionId: openMission(d, 'email_review').id,
        productionId: latestEmail(d).id,
        decision: 'approve',
      },
      owner,
    );
    d = await service.simulateSend(d.prospect.id, { productionId: latestEmail(d).id }, owner);
    d = await service.recordReply(d.prospect.id, { body: 'Non merci' }, owner);
    expect(d.prospect.relationshipStatus).toBe('reply_received');

    d = await service.updateFollowup(
      d.prospect.id,
      {
        relationshipStatus: 'not_interested',
        doNotContact: true,
        doNotContactReason: 'Demande explicite',
      },
      owner,
    );
    expect(d.missions.filter((m) => m.room === 'followup').map((m) => m.status)).toEqual([
      'completed',
    ]);
    await expectAppError(
      service.sendFollowup(d.prospect.id, { subject: 'Relance', body: '...' }, owner),
      'CONTACT_NOT_ALLOWED',
    );
  });

  it('conversion : le prospect sort du parcours', async () => {
    let d = await prospectWithEmail();
    d = await service.decideEmail(
      d.prospect.id,
      {
        missionId: openMission(d, 'email_review').id,
        productionId: latestEmail(d).id,
        decision: 'approve',
      },
      owner,
    );
    d = await service.simulateSend(d.prospect.id, { productionId: latestEmail(d).id }, owner);
    d = await service.updateFollowup(d.prospect.id, { relationshipStatus: 'converted' }, owner);
    expect(d.prospect.stage).toBe('converted');
  });
});

describe('historique et API', () => {
  it('la timeline est inaltérable en base', async () => {
    await service.createProspect(baseProspect, agent);
    await expect(prisma.prospectEvent.updateMany({ data: { title: 'x' } })).rejects.toThrow();
    await expect(prisma.prospectEvent.deleteMany()).rejects.toThrow();
  });

  it('expose le dossier et valide les requêtes', async () => {
    const d = await prospectInReview();
    const app = createApp({
      owner: createOwnerAuthService({ prisma }),
      db: { ping: async () => {} },
      missions,
      prospects: service,
      version: 'test',
      simulationMode: true,
    });
    const owner = await ownerClient(app, prisma);
    const res = await owner.get(`/api/prospects/${d.prospect.id}/dossier`);
    expect(res.status).toBe(200);
    expect(prospectDossierSchema.parse(res.body).prospect.id).toBe(d.prospect.id);

    const list = await owner.get('/api/missions?room=director');
    expect(list.body.items[0].prospect).toMatchObject({
      id: d.prospect.id,
      reference: d.prospect.reference,
    });

    const bad = await owner
      .post(`/api/prospects/${d.prospect.id}/decisions`)
      .send({ missionId: openMission(d, 'director').id, decision: 'approve', instruction: 'x' });
    expect(bad.status).toBe(400);

    const ok = await owner
      .post(`/api/prospects/${d.prospect.id}/decisions`)
      .send({ missionId: openMission(d, 'director').id, decision: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.prospect.stage).toBe('dubbing');
  });
});
