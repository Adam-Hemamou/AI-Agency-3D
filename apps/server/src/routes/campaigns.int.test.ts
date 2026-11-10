import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_ROLE_PERMISSIONS,
  PIPELINE_MISSION_TYPES,
  agentCampaignContextSchema,
  campaignSchema,
  channelLookupResponseSchema,
  claimRunResponseSchema,
  issuedAgentKeyResponseSchema,
  type AgentPermission,
  type Campaign,
  type ClaimRunResponse,
  type CreateCampaignRequest,
  type RoomId,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { quotaDay } from '../agents/quotas.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createRunService } from '../agents/runService.ts';
import { createApp } from '../app.ts';
import { createCampaignService } from '../campaigns/campaignService.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Campagnes de prospection, missions de recherche du jour et mémoire des chaînes écartées,
 * contre la base de test (ai_agency_test). L'horloge des campagnes est pilotée.
 */

const prisma = createTestPrisma();
let now = new Date('2026-11-09T09:00:00.000Z'); // 10 h à Paris
const clock = () => now;
const DAY_MS = 24 * 60 * 60 * 1000;
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const campaigns = createCampaignService({ prisma, missions, clock });
const limits = testAgentLimits(prisma);
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects,
  campaigns,
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
  room: RoomId | null = 'prospecting',
  permissions: readonly AgentPermission[] = AGENT_ROLE_PERMISSIONS.prospector,
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
const key = () => `cle-${randomUUID()}`;

async function createCampaign(overrides: Partial<CreateCampaignRequest> = {}): Promise<Campaign> {
  const res = await owner
    .post('/api/campaigns')
    .send({ name: `Campagne ${randomUUID()}`, keywords: ['recette facile'], ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return campaignSchema.parse(res.body);
}

async function patchCampaign(campaign: Campaign, changes: Record<string, unknown>) {
  const res = await owner
    .patch(`/api/campaigns/${campaign.id}`)
    .send({ expectedVersion: campaign.version, ...changes });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return campaignSchema.parse(res.body);
}

async function claim(agent: TestAgent): Promise<ClaimRunResponse | null> {
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(agent))
    .send({ n8nExecutionId: `n8n-${randomUUID()}` });
  if (res.status === 204) return null;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return claimRunResponseSchema.parse(res.body);
}

const prospectBody = (missionId: string, channelId: string) => ({
  missionId,
  creatorName: channelId,
  channelName: channelId,
  youtubeChannelId: channelId,
  discovery: {
    source: 'Recherche YouTube',
    reason: 'Critères de la campagne',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
});

function createProspect(agent: TestAgent, missionId: string, channelId: string) {
  return request(app)
    .post('/api/agent/prospects')
    .set(auth(agent))
    .set('Idempotency-Key', key())
    .send(prospectBody(missionId, channelId));
}

function reject(
  agent: TestAgent,
  missionId: string,
  items: Record<string, unknown>[],
  idem = key(),
) {
  return request(app)
    .post('/api/agent/channels/rejections')
    .set(auth(agent))
    .set('Idempotency-Key', idem)
    .send({ missionId, items });
}

const context = async (agent: TestAgent, missionId: string) =>
  agentCampaignContextSchema.parse(
    (
      await request(app)
        .get(`/api/agent/missions/${missionId}/campaign`)
        .set(auth(agent))
        .expect(200)
    ).body,
  );

const lookup = async (agent: TestAgent, missionId: string, channelIds: string[]) =>
  channelLookupResponseSchema.parse(
    (
      await request(app)
        .get('/api/agent/channels/lookup')
        .query({ missionId, channelIds: channelIds.join(',') })
        .set(auth(agent))
        .expect(200)
    ).body,
  ).items;

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

/** Campagne active du prospecteur, mission du jour générée et prise. */
async function workingOn(agent: TestAgent, overrides: Partial<CreateCampaignRequest> = {}) {
  const campaign = await createCampaign({ agentId: agent.id, enabled: true, ...overrides });
  await campaigns.generateDailyMissions();
  const taken = (await claim(agent))!;
  expect(taken.mission.input).toMatchObject({ campaignId: campaign.id });
  return { campaign, missionId: taken.mission.id };
}

beforeEach(async () => {
  now = new Date('2026-11-09T09:00:00.000Z');
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('campagnes : gestion par l’utilisateur', () => {
  it('création désactivée par défaut, modification versionnée, activation', async () => {
    await createAgent('agent-prospecteur');
    const created = await createCampaign({
      name: 'Cuisine francophone',
      themes: ['cuisine'],
      languages: ['fr'],
      countries: ['FR', 'BE'],
      minSubscribers: 10_000,
      maxSubscribers: 500_000,
      agentId: 'agent-prospecteur',
    });
    expect(created).toMatchObject({ enabled: false, version: 0, updatedBy: 'owner' });

    const updated = await patchCampaign(created, { keywords: ['pâtisserie'], enabled: true });
    expect(updated).toMatchObject({ keywords: ['pâtisserie'], enabled: true, version: 1 });
    // Version périmée : refusée, rien n'est écrasé.
    const stale = await owner
      .patch(`/api/campaigns/${created.id}`)
      .send({ expectedVersion: 0, enabled: false });
    expectError(stale, 409, 'CONCURRENT_MODIFICATION');
    expect((await owner.get(`/api/campaigns/${created.id}`).expect(200)).body.enabled).toBe(true);
    expect((await owner.get('/api/campaigns').expect(200)).body.items).toHaveLength(1);
  });

  it('refuse un nom déjà pris, un agent d’une autre salle, des abonnés incohérents', async () => {
    await createAgent('agent-analyste', 'analysis');
    const first = await createCampaign({ name: 'Voyage' });
    expectError(
      await owner.post('/api/campaigns').send({ name: 'Voyage', keywords: ['x'] }),
      409,
      'ALREADY_EXISTS',
    );
    expectError(
      await owner
        .post('/api/campaigns')
        .send({ name: 'Autre', keywords: ['x'], agentId: 'agent-analyste' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await owner
        .patch(`/api/campaigns/${first.id}`)
        .send({ expectedVersion: 0, minSubscribers: 1_000_000, maxSubscribers: 10 }),
      400,
      'VALIDATION_ERROR',
    );
    // Seul le maximum change, sous le minimum existant : refusé aussi.
    const withMin = await patchCampaign(first, { minSubscribers: 5_000 });
    expectError(
      await owner
        .patch(`/api/campaigns/${first.id}`)
        .send({ expectedVersion: withMin.version, maxSubscribers: 100 }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('réservée à l’utilisateur : un agent n’y accède pas', async () => {
    const agent = await createAgent('agent-prospecteur');
    const campaign = await createCampaign();
    for (const res of [
      await request(app).get('/api/campaigns').set(auth(agent)),
      await request(app)
        .post('/api/campaigns')
        .set(auth(agent))
        .send({ name: 'x', keywords: ['x'] }),
      await request(app)
        .patch(`/api/campaigns/${campaign.id}`)
        .set(auth(agent))
        .send({ expectedVersion: 0, enabled: true }),
    ]) {
      expectError(res, 403, 'FORBIDDEN_ACTOR');
    }
  });
});

describe('missions de recherche générées par le CRM', () => {
  it('une mission par campagne active et par jour, attribuée à son agent', async () => {
    await createAgent('agent-prospecteur');
    const active = await createCampaign({
      agentId: 'agent-prospecteur',
      enabled: true,
      priority: 4,
    });
    await createCampaign({ agentId: 'agent-prospecteur' }); // désactivée
    const free = await createCampaign({ enabled: true }); // sans agent : mission libre

    const first = await campaigns.generateDailyMissions();
    expect(first.created).toHaveLength(2);
    const rows = await prisma.mission.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.find((m) => m.campaignId === active.id)).toMatchObject({
      type: PIPELINE_MISSION_TYPES.search,
      room: 'prospecting',
      status: 'pending',
      agentId: 'agent-prospecteur',
      priority: 4,
      campaignDay: quotaDay(now),
    });
    expect(rows.find((m) => m.campaignId === free.id)?.agentId).toBeNull();

    // Rejouer le passage, même en parallèle : rien de plus.
    await Promise.all([campaigns.generateDailyMissions(), campaigns.generateDailyMissions()]);
    expect(await prisma.mission.count()).toBe(2);
  });

  it('le lendemain : nouvelle mission ; celle de la veille jamais prise est annulée', async () => {
    await createAgent('agent-prospecteur');
    const campaign = await createCampaign({ agentId: 'agent-prospecteur', enabled: true });
    await campaigns.generateDailyMissions();
    const yesterday = await prisma.mission.findFirstOrThrow({ where: { campaignId: campaign.id } });

    now = new Date(now.getTime() + DAY_MS);
    const next = await campaigns.generateDailyMissions();
    expect(next.cancelled.map((m) => m.missionId)).toEqual([yesterday.id]);
    expect(next.created).toHaveLength(1);
    expect((await missions.get(yesterday.id)).status).toBe('cancelled');
  });

  it('campagne désactivée : sa mission n’est plus proposée ; réactivée, elle l’est de nouveau', async () => {
    const agent = await createAgent('agent-prospecteur');
    const campaign = await createCampaign({ agentId: agent.id, enabled: true });
    await campaigns.generateDailyMissions();
    const off = await patchCampaign(campaign, { enabled: false });
    expect(await claim(agent)).toBeNull();
    await patchCampaign(off, { enabled: true });
    expect((await claim(agent))?.mission.input).toMatchObject({ campaignId: campaign.id });
  });
});

describe('travail du Prospecteur dans sa mission', () => {
  it('lit les critères ACTUELS de la campagne (modifiés sans toucher au workflow)', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { campaign, missionId } = await workingOn(agent, {
      keywords: ['cuisine'],
      dailyTarget: 3,
    });
    expect((await context(agent, missionId)).campaign.keywords).toEqual(['cuisine']);
    await patchCampaign(campaign, { keywords: ['pâtisserie'], languages: ['fr'] });
    const ctx = await context(agent, missionId);
    expect(ctx.campaign).toMatchObject({ keywords: ['pâtisserie'], languages: ['fr'], version: 1 });
    expect(ctx.progress).toEqual({ created: 0, remaining: 3, rejected: 0 });
  });

  it('objectif quotidien : au-delà, refusé sans rien écrire ni consommer', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { missionId } = await workingOn(agent, { dailyTarget: 2 });
    await createProspect(agent, missionId, 'UC-1').expect(201);
    await createProspect(agent, missionId, 'UC-2').expect(201);
    expectError(await createProspect(agent, missionId, 'UC-3'), 409, 'CAMPAIGN_TARGET_REACHED');
    expect(await prisma.prospect.count()).toBe(2);
    expect((await prisma.agentQuotaUsage.findFirstOrThrow()).used).toBe(2);
    const created = await prisma.prospect.findMany();
    expect(created.every((p) => p.discoveryMissionId === missionId)).toBe(true);
    expect((await context(agent, missionId)).progress).toMatchObject({ created: 2, remaining: 0 });
  });

  it('objectif quotidien exact même en créations simultanées', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { missionId } = await workingOn(agent, { dailyTarget: 3 });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createProspect(agent, missionId, `UC-${i}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.prospect.count()).toBe(3);
  });

  it('campagne désactivée pendant le travail : plus aucune écriture', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { campaign, missionId } = await workingOn(agent);
    await patchCampaign(campaign, { enabled: false });
    expect((await context(agent, missionId)).campaign.enabled).toBe(false);
    expectError(await createProspect(agent, missionId, 'UC-1'), 409, 'CAMPAIGN_DISABLED');
    expectError(
      await reject(agent, missionId, [{ channelId: 'UC-2', reasonCode: 'inactive' }]),
      409,
      'CAMPAIGN_DISABLED',
    );
  });

  it('jamais deux prospects pour la même chaîne, même depuis deux campagnes', async () => {
    const a = await createAgent('agent-prospecteur-a');
    const b = await createAgent('agent-prospecteur-b');
    const { missionId: missionA } = await workingOn(a, { themes: ['cuisine'] });
    const { missionId: missionB } = await workingOn(b, { themes: ['pâtisserie'] });
    const [first, second] = await Promise.all([
      createProspect(a, missionA, 'UC-COMMUNE'),
      createProspect(b, missionB, 'UC-COMMUNE'),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect([first, second].find((r) => r.status === 409)!.body.error.code).toBe('ALREADY_EXISTS');
    expect(await prisma.prospect.count()).toBe(1);
    // L'autre campagne voit la chaîne comme prospect existant.
    const [state] = await lookup(b, missionB, ['UC-COMMUNE']);
    expect(state).toMatchObject({ status: 'prospect' });
  });
});

describe('mémoire des chaînes écartées', () => {
  it('enregistre motif, date et réévaluation ; un nouveau rejet met à jour la ligne', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { missionId } = await workingOn(agent, { reevaluationDays: 30 });
    const res = await reject(agent, missionId, [
      { channelId: 'UC-PETITE', channelTitle: 'Petite chaîne', reasonCode: 'audience_too_small' },
      { channelId: 'UC-AUTRE', reasonCode: 'other', reason: 'Contenu sponsorisé uniquement' },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(agentCampaignContextSchema.parse(res.body).progress.rejected).toBe(2);
    const row = await prisma.rejectedChannel.findFirstOrThrow({
      where: { channelId: 'UC-PETITE' },
    });
    expect(row).toMatchObject({
      platform: 'youtube',
      reasonCode: 'audience_too_small',
      rejectionCount: 1,
      missionId,
      agentId: agent.id,
    });
    expect(row.reevaluateAfter.getTime() - row.rejectedAt.getTime()).toBe(30 * DAY_MS);

    now = new Date(now.getTime() + 60_000);
    await reject(agent, missionId, [{ channelId: 'UC-PETITE', reasonCode: 'inactive' }]).expect(
      201,
    );
    const again = await prisma.rejectedChannel.findFirstOrThrow({
      where: { channelId: 'UC-PETITE' },
    });
    expect(again).toMatchObject({ reasonCode: 'inactive', rejectionCount: 2 });
    expect(again.firstRejectedAt).toEqual(row.firstRejectedAt);
    expect(await prisma.rejectedChannel.count()).toBe(2);
  });

  it('vérification : prospect, écartée (cette campagne), nouvelle ; réévaluable après le délai', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { missionId } = await workingOn(agent, { reevaluationDays: 7 });
    await createProspect(agent, missionId, 'UC-PROSPECT').expect(201);
    await reject(agent, missionId, [{ channelId: 'UC-ECARTEE', reasonCode: 'off_target' }]).expect(
      201,
    );
    const states = await lookup(agent, missionId, ['UC-PROSPECT', 'UC-ECARTEE', 'UC-NOUVELLE']);
    expect(states.map((s) => [s.channelId, s.status])).toEqual([
      ['UC-PROSPECT', 'prospect'],
      ['UC-ECARTEE', 'rejected'],
      ['UC-NOUVELLE', 'new'],
    ]);
    expect(states[0]!.prospect?.reference).toMatch(/^P-\d{4}-\d{4}$/);

    now = new Date(now.getTime() + 8 * DAY_MS); // délai de réévaluation dépassé
    const [later] = await lookup(agent, missionId, ['UC-ECARTEE']);
    expect(later).toMatchObject({ status: 'new', rejection: { reasonCode: 'off_target' } });
  });

  it('une chaîne écartée pour une campagne reste à évaluer pour une autre', async () => {
    const a = await createAgent('agent-prospecteur-a');
    const b = await createAgent('agent-prospecteur-b');
    const { missionId: missionA } = await workingOn(a);
    const { missionId: missionB } = await workingOn(b);
    await reject(a, missionA, [{ channelId: 'UC-1', reasonCode: 'language_mismatch' }]).expect(201);
    expect((await lookup(a, missionA, ['UC-1']))[0]!.status).toBe('rejected');
    expect((await lookup(b, missionB, ['UC-1']))[0]).toMatchObject({
      status: 'new',
      rejection: null,
    });
  });

  it('requête rejouée : aucun second enregistrement', async () => {
    const agent = await createAgent('agent-prospecteur');
    const { missionId } = await workingOn(agent);
    const idem = key();
    const items = [{ channelId: 'UC-1', reasonCode: 'inactive' }];
    await reject(agent, missionId, items, idem).expect(201);
    const replay = await reject(agent, missionId, items, idem).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await prisma.rejectedChannel.findFirstOrThrow()).rejectionCount).toBe(1);
  });

  it('exige channels:reject, et une mission de campagne en cours de l’agent', async () => {
    const agent = await createAgent(
      'agent-prospecteur',
      'prospecting',
      AGENT_ROLE_PERMISSIONS.prospector.filter((p) => p !== 'channels:reject'),
    );
    const { missionId } = await workingOn(agent);
    const items = [{ channelId: 'UC-1', reasonCode: 'inactive' }];
    expectError(await reject(agent, missionId, items), 403, 'FORBIDDEN_ACTOR');
    const other = await createAgent('agent-autre');
    expectError(await reject(other, missionId, items), 403, 'FORBIDDEN_ACTOR');
    expect(await prisma.rejectedChannel.count()).toBe(0);
  });
});

describe('planification : agent attribué hors d’état de travailler', () => {
  it('agent désactivé : aucune mission, signalée ; réactivé, mission créée au passage suivant', async () => {
    const agent = await createAgent('agent-prospecteur');
    const campaign = await createCampaign({ agentId: agent.id, enabled: true });
    await owner.patch(`/api/agents/${agent.id}`).send({ status: 'disabled' }).expect(200);
    const first = await campaigns.generateDailyMissions();
    expect(first.created).toEqual([]);
    expect(first.skipped).toEqual([
      { campaignId: campaign.id, day: quotaDay(now), reason: `agent ${agent.id} désactivé` },
    ]);
    expect(await prisma.mission.count()).toBe(0);

    await owner.patch(`/api/agents/${agent.id}`).send({ status: 'active' }).expect(200);
    const second = await campaigns.generateDailyMissions();
    expect(second.created).toHaveLength(1);
    expect(second.skipped).toEqual([]);
  });

  it('agent déplacé dans une autre salle : aucune mission, signalée', async () => {
    const agent = await createAgent('agent-prospecteur');
    const campaign = await createCampaign({ agentId: agent.id, enabled: true });
    await owner.patch(`/api/agents/${agent.id}`).send({ room: 'analysis' }).expect(200);
    const run = await campaigns.generateDailyMissions();
    expect(run.skipped.map((s) => s.campaignId)).toEqual([campaign.id]);
    expect(await prisma.mission.count()).toBe(0);
  });
});

describe('quota global et objectifs de plusieurs campagnes', () => {
  // Même application, avec le VRAI quota global de créations (10 par jour, tous agents confondus).
  const real = testAgentLimits(prisma, { prospect_create: 10 });
  const realApp = createApp({
    ...real,
    owner: createOwnerAuthService({ prisma }),
    db: createDatabaseProbe(prisma),
    missions,
    prospects,
    campaigns,
    agents: createAgentService({ prisma }),
    profiles: createAgentProfileService({ prisma }),
    runs: createRunService({ prisma, missions, control: real.agentControl }),
    idempotency: createIdempotencyStore(prisma),
    version: 'test',
    simulationMode: true,
  });
  const createIn = (agent: TestAgent, missionId: string, channelId: string) =>
    request(realApp)
      .post('/api/agent/prospects')
      .set(auth(agent))
      .set('Idempotency-Key', key())
      .send(prospectBody(missionId, channelId));

  it('refuse une activation ou un objectif qui ferait dépasser le quota global (10)', async () => {
    const a = await createCampaign({ dailyTarget: 8, enabled: true });
    // Création active au-delà : refusée, avec l'objectif encore possible.
    const tooMuch = await owner
      .post('/api/campaigns')
      .send({ name: 'Trop', keywords: ['x'], dailyTarget: 3, enabled: true });
    expectError(tooMuch, 409, 'CAMPAIGN_TARGETS_EXCEED_QUOTA');
    expect(tooMuch.body.error.details).toEqual({
      globalQuota: 10,
      activeTargets: 8,
      requested: 3,
      available: 2,
    });
    // Créée désactivée : acceptée ; activée avec 3 : refusée ; avec 2 : acceptée (8 + 2 = 10).
    const b = await createCampaign({ dailyTarget: 3 });
    expectError(
      await owner.patch(`/api/campaigns/${b.id}`).send({ expectedVersion: 0, enabled: true }),
      409,
      'CAMPAIGN_TARGETS_EXCEED_QUOTA',
    );
    const bOn = await patchCampaign(b, { enabled: true, dailyTarget: 2 });
    // Augmenter un objectif actif : refusé ; le baisser, ou désactiver : toujours possible.
    expectError(
      await owner.patch(`/api/campaigns/${a.id}`).send({ expectedVersion: 0, dailyTarget: 9 }),
      409,
      'CAMPAIGN_TARGETS_EXCEED_QUOTA',
    );
    const aLower = await patchCampaign(a, { dailyTarget: 6 });
    await patchCampaign(bOn, { enabled: false });
    await patchCampaign(aLower, { name: 'Autre nom' }); // sans effet sur les objectifs
    expect((await owner.get(`/api/campaigns/${b.id}`).expect(200)).body.enabled).toBe(false);
  });

  it('deux activations simultanées ne dépassent jamais le quota ensemble', async () => {
    const one = await createCampaign({ dailyTarget: 6 });
    const two = await createCampaign({ dailyTarget: 6 });
    const results = await Promise.all(
      [one, two].map((c) =>
        owner.patch(`/api/campaigns/${c.id}`).send({ expectedVersion: 0, enabled: true }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      'CAMPAIGN_TARGETS_EXCEED_QUOTA',
    );
    expect(await prisma.prospectingCampaign.count({ where: { enabled: true } })).toBe(1);
  });

  it('objectifs dont la somme tient dans le quota : chaque campagne atteint le sien', async () => {
    await real.agentControl.load();
    const a = await createAgent('agent-prospecteur-a');
    const b = await createAgent('agent-prospecteur-b');
    const { missionId: missionA } = await workingOn(a, { dailyTarget: 6 });
    const { missionId: missionB } = await workingOn(b, { dailyTarget: 4 });
    // Créations entremêlées et simultanées des deux campagnes.
    const results = await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => createIn(a, missionA, `UC-A${i}`)),
      ...Array.from({ length: 6 }, (_, i) => createIn(b, missionB, `UC-B${i}`)),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    // Les 4 refus : objectif de la campagne atteint, ou quota global déjà consommé (contrôlé en
    // premier) selon l'ordre d'arrivée ; jamais une écriture de trop.
    const refusals = results.filter((r) => r.status !== 201).map((r) => r.body.error.code);
    expect(refusals).toHaveLength(4);
    for (const code of refusals) {
      expect(['CAMPAIGN_TARGET_REACHED', 'QUOTA_EXCEEDED']).toContain(code);
    }
    expect((await context(a, missionA)).progress.created).toBe(6);
    expect((await context(b, missionB)).progress.created).toBe(4);
    expect((await prisma.agentQuotaUsage.findFirstOrThrow()).used).toBe(10);
  });
});
