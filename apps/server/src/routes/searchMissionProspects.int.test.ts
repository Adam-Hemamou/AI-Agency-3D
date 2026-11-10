import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  AGENT_ROLE_PERMISSIONS,
  PIPELINE_MISSION_TYPES,
  agentDossierSchema,
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
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Prospects créés par un agent dans le cadre de sa mission de recherche (search_creators) :
 * rattachés à cette mission, sans mission de découverte qui passerait avant ses recherches.
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const limits = testAgentLimits(prisma);
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects,
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
let counter = 0;
const unique = (prefix: string) => `${prefix}-${++counter}-${Date.now()}`;

async function claim(agent: TestAgent): Promise<ClaimRunResponse | null> {
  const res = await request(app)
    .post('/api/agent/runs/claim')
    .set(auth(agent))
    .send({ n8nExecutionId: unique('n8n-exec') });
  if (res.status === 204) return null;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return claimRunResponseSchema.parse(res.body);
}

async function newMission(
  room: RoomId,
  type: string = PIPELINE_MISSION_TYPES.search,
  agentId: string | null = null,
) {
  const input = createMissionRequestSchema.parse({ type, room, agentId });
  return (await missions.create(input, HUMAN_ACTOR)).mission;
}

const prospectBody = (missionId: string | undefined, handle = unique('@chaine')) => ({
  ...(missionId !== undefined && { missionId }),
  creatorName: handle,
  channelName: handle,
  channelHandle: handle,
  discovery: {
    source: 'Recherche YouTube',
    reason: 'Critères de la campagne',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
});

function createProspect(agent: TestAgent, body: unknown) {
  return request(app)
    .post('/api/agent/prospects')
    .set(auth(agent))
    .set('Idempotency-Key', unique('cle'))
    .send(body as object);
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

afterAll(async () => {
  await prisma.$disconnect();
});

describe('prospects rattachés à la mission de recherche', () => {
  it('parcours réel : prospects créés sans mission parasite, la prise suivante renvoie une recherche', async () => {
    const prospector = await createAgent(
      'agent-prospecteur',
      'prospecting',
      AGENT_ROLE_PERMISSIONS.prospector,
    );
    const first = await newMission('prospecting');
    const second = await newMission('prospecting');
    const taken = (await claim(prospector))!;
    expect(taken.mission.id).toBe(first.id);

    for (let i = 0; i < 3; i++) {
      await createProspect(prospector, prospectBody(first.id)).expect(201);
    }
    // Aucune mission de découverte : seules les deux recherches existent.
    expect(await prisma.mission.count()).toBe(2);
    const events = await prisma.prospectEvent.findMany({ where: { type: 'discovered' } });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.missionId === first.id && e.actorId === prospector.id)).toBe(true);

    await request(app)
      .post(`/api/agent/missions/${first.id}/transitions`)
      .set(auth(prospector))
      .set('Idempotency-Key', unique('cle'))
      .send({ action: 'complete', output: { created: 3 } })
      .expect(200);
    // La prise suivante renvoie la recherche suivante, pas un dossier découvert.
    expect((await claim(prospector))!.mission.id).toBe(second.id);
  });

  it('passage en analyse : la mission de l’Analyste est créée et l’Analyste la prend', async () => {
    const prospector = await createAgent(
      'agent-prospecteur',
      'prospecting',
      AGENT_ROLE_PERMISSIONS.prospector,
    );
    const analyst = await createAgent('agent-analyste', 'analysis', AGENT_ROLE_PERMISSIONS.analyst);
    const search = await newMission('prospecting');
    await claim(prospector);
    const created = agentDossierSchema.parse(
      (await createProspect(prospector, prospectBody(search.id)).expect(201)).body,
    );
    await request(app)
      .post(`/api/agent/prospects/${created.prospect.id}/stage`)
      .set(auth(prospector))
      .set('Idempotency-Key', unique('cle'))
      .send({ to: 'analysis' })
      .expect(200);

    const work = (await claim(analyst))!;
    expect(work.mission).toMatchObject({
      type: PIPELINE_MISSION_TYPES.analyze,
      room: 'analysis',
      prospectId: created.prospect.id,
      agentId: 'agent-analyste',
    });
  });

  it('refuse une création sans mission de recherche', async () => {
    const prospector = await createAgent('agent-prospecteur', 'prospecting');
    await newMission('prospecting');
    await claim(prospector);
    expectError(await createProspect(prospector, prospectBody(undefined)), 400, 'VALIDATION_ERROR');
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('refuse une mission en cours qui n’est pas une recherche', async () => {
    const prospector = await createAgent('agent-prospecteur', 'prospecting');
    const other = await newMission('prospecting', 'test.tache');
    expect((await claim(prospector))!.mission.id).toBe(other.id);
    expectError(await createProspect(prospector, prospectBody(other.id)), 400, 'VALIDATION_ERROR');
  });

  it('refuse une recherche d’une autre salle que la prospection', async () => {
    const agent = await createAgent('agent-analyste', 'analysis');
    const misplaced = await newMission('analysis');
    expect((await claim(agent))!.mission.id).toBe(misplaced.id);
    expectError(await createProspect(agent, prospectBody(misplaced.id)), 400, 'VALIDATION_ERROR');
  });

  it('refuse la recherche d’un autre agent, ou une recherche libre', async () => {
    const a = await createAgent('agent-a', 'prospecting');
    const b = await createAgent('agent-b', 'prospecting');
    const search = await newMission('prospecting');
    await claim(a);
    expectError(await createProspect(b, prospectBody(search.id)), 403, 'FORBIDDEN_ACTOR');
    const free = await newMission('prospecting');
    expectError(await createProspect(b, prospectBody(free.id)), 403, 'FORBIDDEN_ACTOR');
    expectError(await createProspect(a, prospectBody('mission-inconnue')), 400, 'VALIDATION_ERROR');
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('refuse une recherche qui n’est plus en cours (en pause, terminée)', async () => {
    const prospector = await createAgent('agent-prospecteur', 'prospecting');
    const search = await newMission('prospecting');
    await claim(prospector);
    await request(app)
      .post(`/api/agent/missions/${search.id}/transitions`)
      .set(auth(prospector))
      .set('Idempotency-Key', unique('cle'))
      .send({ action: 'pause' })
      .expect(200);
    expectError(
      await createProspect(prospector, prospectBody(search.id)),
      409,
      'INVALID_TRANSITION',
    );
  });

  it('refuse une recherche en cours sans exécution active (démarrée par l’utilisateur)', async () => {
    const prospector = await createAgent('agent-prospecteur', 'prospecting');
    const search = await newMission('prospecting', PIPELINE_MISSION_TYPES.search, prospector.id);
    await missions.applyAction(search.id, { action: 'start' }, HUMAN_ACTOR);
    expectError(
      await createProspect(prospector, prospectBody(search.id)),
      409,
      'INVALID_TRANSITION',
    );
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('le service refuse un agent qui ne cite pas sa mission de recherche', async () => {
    await createAgent('agent-prospecteur', 'prospecting');
    const { missionId: _none, ...body } = prospectBody(undefined);
    await expect(
      prospects.createProspect(body, { type: 'agent', id: 'agent-prospecteur' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ACTOR' });
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('une requête rejouée après la fin de la recherche renvoie le dossier déjà créé', async () => {
    const prospector = await createAgent('agent-prospecteur', 'prospecting');
    const search = await newMission('prospecting');
    await claim(prospector);
    const body = prospectBody(search.id);
    const send = () =>
      request(app)
        .post('/api/agent/prospects')
        .set(auth(prospector))
        .set('Idempotency-Key', 'cle-rejouee')
        .send(body);
    const first = await send().expect(201);
    await request(app)
      .post(`/api/agent/missions/${search.id}/transitions`)
      .set(auth(prospector))
      .set('Idempotency-Key', unique('cle'))
      .send({ action: 'complete' })
      .expect(200);
    const replay = await send().expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.prospect.id).toBe(first.body.prospect.id);
    expect(await prisma.prospect.count()).toBe(1);
  });
});

describe('coordonnées : enregistrées sans être lues (contacts:submit)', () => {
  const SOURCE = 'https://www.youtube.com/@chaine/about';
  const withContact = (missionId: string) => ({
    ...prospectBody(missionId),
    contactEmail: 'contact@chaine.example',
    contactName: 'Équipe partenariats',
    contactSource: SOURCE,
  });
  const prospectorRole = AGENT_ROLE_PERMISSIONS.prospector;

  async function started(permissions: readonly AgentPermission[]) {
    const prospector = await createAgent('agent-prospecteur', 'prospecting', permissions);
    const search = await newMission('prospecting');
    await claim(prospector);
    return { prospector, search };
  }

  it('rôle du prospecteur : coordonnées publiques enregistrées, jamais renvoyées', async () => {
    const { prospector, search } = await started(prospectorRole);
    const res = await createProspect(prospector, withContact(search.id)).expect(201);
    const row = await prisma.prospect.findUniqueOrThrow({ where: { id: res.body.prospect.id } });
    expect(row).toMatchObject({ contactEmail: 'contact@chaine.example', contactSource: SOURCE });
    // Il ne lit pas les coordonnées, pas même celles qu'il vient d'enregistrer.
    expect(JSON.stringify(res.body)).not.toContain('contact@chaine.example');
    expect(res.body.hidden).toContain('contact');
  });

  it('source obligatoire : l’adresse http(s) de la page publique', async () => {
    const { prospector, search } = await started(prospectorRole);
    for (const contactSource of [null, 'Page À propos', 'javascript:alert(1)']) {
      const res = await createProspect(prospector, { ...withContact(search.id), contactSource });
      expectError(res, 400, 'VALIDATION_ERROR');
    }
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('sans contacts:submit ni prospects:read_contact : refusé, rien n’est écrit', async () => {
    const { prospector, search } = await started(
      prospectorRole.filter((p) => p !== 'contacts:submit'),
    );
    expectError(await createProspect(prospector, withContact(search.id)), 403, 'FORBIDDEN_ACTOR');
    expect(await prisma.prospect.count()).toBe(0);
    expect(await prisma.agentQuotaUsage.count()).toBe(0);
    await createProspect(prospector, prospectBody(search.id)).expect(201);
  });

  it('contacts:submit ne permet ni de modifier ni d’effacer des coordonnées existantes', async () => {
    const { prospector, search } = await started(prospectorRole);
    const created = await createProspect(prospector, withContact(search.id)).expect(201);
    for (const change of [
      { contactEmail: 'autre@chaine.example', contactSource: SOURCE },
      { contactEmail: null },
    ]) {
      const res = await request(app)
        .patch(`/api/agent/prospects/${created.body.prospect.id}`)
        .set(auth(prospector))
        .set('Idempotency-Key', unique('cle'))
        .send(change);
      expectError(res, 403, 'FORBIDDEN_ACTOR');
    }
    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: created.body.prospect.id },
    });
    expect(row.contactEmail).toBe('contact@chaine.example');
  });

  it('avec prospects:read_contact (accordée explicitement) : coordonnées visibles', async () => {
    const { prospector, search } = await started([...prospectorRole, 'prospects:read_contact']);
    const res = await createProspect(prospector, withContact(search.id)).expect(201);
    expect(res.body.prospect.contactEmail).toBe('contact@chaine.example');
  });
});
