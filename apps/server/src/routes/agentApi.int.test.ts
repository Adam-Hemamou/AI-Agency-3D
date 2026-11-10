import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  agentProspectContextSchema,
  issuedAgentKeyResponseSchema,
  missionListQuerySchema,
  missionListResponseSchema,
  missionSchema,
  createMissionRequestSchema,
  agentDossierSchema,
  prospectDossierSchema,
  prospectLookupResponseSchema,
  type AgentPermission,
  type AgentDossier,
  type RoomId,
} from '@agency/shared';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { searchMissions } from '../test/searchMission.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const app = createApp({
  ...testAgentLimits(prisma),
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects,
  agents: createAgentService({ prisma }),
  idempotency: createIdempotencyStore(prisma),
  version: 'test',
  simulationMode: true,
});

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

interface TestAgent {
  id: string;
  key: string;
}

/** Crée un agent (par l'API, comme l'utilisateur) avec ses permissions, et lui remet une clé. */
async function createAgent(
  id: string,
  permissions: readonly AgentPermission[] = AGENT_PERMISSIONS,
  room: RoomId | null = null,
): Promise<TestAgent> {
  await owner.post('/api/agents').send({ id, name: id, room, permissions }).expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

type Method = 'get' | 'post' | 'patch';

/** Requête d'un agent. Les écritures reçoivent une clé d'idempotence nouvelle, sauf précision. */
function call(
  agent: TestAgent,
  method: Method,
  path: string,
  body?: unknown,
  idempotencyKey: string | null = method === 'get' ? null : `test-${randomUUID()}`,
) {
  let req = request(app)[method](path).set('Authorization', `Bearer ${agent.key}`);
  if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
  return body === undefined ? req : req.send(body as object);
}

const prospectBody = (overrides: Record<string, unknown> = {}) => ({
  creatorName: 'Léa Martin',
  channelName: 'La cuisine de Léa',
  channelHandle: '@LaCuisineDeLea',
  youtubeChannelId: 'UC-LEA-001',
  channelUrl: 'https://youtube.example/@LaCuisineDeLea',
  contactEmail: 'contact@lea.example',
  contactSource: 'https://youtube.example/@LaCuisineDeLea/about',
  discovery: {
    source: 'Recherche YouTube (simulée)',
    reason: 'Recettes adaptables à l’international',
    discoveredBy: 'owner',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
  ...overrides,
});

/** Prospect sans coordonnées (agent sans prospects:read_contact). */
const NO_CONTACT = { contactEmail: null, contactSource: null };

/** Mission de recherche en cours de chaque agent (un prospect n'est créé que dans ce cadre). */
const search = searchMissions(prisma, missions);

/** Corps de création d'un prospect par CET agent, rattaché à sa mission de recherche en cours. */
async function prospectFor(agent: TestAgent, overrides: Record<string, unknown> = {}) {
  return prospectBody({ missionId: await search.of(agent), ...overrides });
}

const analysisBody = (missionId: string | null = null) => ({
  missionId,
  summary: 'Chaîne culinaire en croissance',
  conclusion: 'Bon potentiel international',
  priority: 4,
  scoreCriteria: [
    { label: 'Audience', weight: 60, value: 8, justification: 'Croissance régulière' },
    { label: 'Adaptabilité', weight: 40, value: 7, justification: 'Peu de texte à l’écran' },
  ],
  content: {
    international: { mainLanguage: 'Français' },
    activity: {},
    commercial: { potential: 'Bon', dubbingInterest: 'Fort', offerFit: 'Oui' },
  },
});

const dubbingBody = (status = 'generated') => ({
  kind: 'dubbing',
  status,
  title: 'Doublage anglais',
  content: {
    sourceLanguage: 'Français',
    targetLanguage: 'Anglais',
    voice: 'Voix simulée',
    tool: 'HeyGen (simulé)',
    generationStatus: 'simulated',
  },
});

const emailBody = (status = 'pending_review') => ({
  kind: 'email',
  status,
  content: { to: 'contact@lea.example', subject: 'Votre chaîne en anglais', body: 'Bonjour Léa…' },
});

const proposalBody = (status = 'draft') => ({
  kind: 'proposal',
  status,
  content: {
    profileSummary: 'Cuisine familiale',
    valueProposition: 'Toucher un public anglophone',
    serviceType: 'Doublage',
    offerDescription: 'Pilote de trois vidéos',
  },
});

const dossierOf = (res: request.Response) => agentDossierSchema.parse(res.body);

function openMission(d: Pick<AgentDossier, 'missions'>, room: RoomId) {
  const m = [...d.missions]
    .reverse()
    .find((x) => x.room === room && !['completed', 'cancelled'].includes(x.status));
  if (!m) throw new Error(`pas de mission ouverte en ${room}`);
  return m;
}

/**
 * Mission ouverte d'un dossier, lue par le service (vue complète) : un agent ne voit pas les
 * missions libres hors de sa salle, ni celles des autres agents.
 */
async function openMissionIn(prospectId: string, room: RoomId) {
  const { items } = await missions.list(missionListQuerySchema.parse({ prospectId, limit: 200 }));
  return openMission({ missions: items }, room);
}

/**
 * Démarre une mission au nom d'un agent par le moteur de missions (mêmes règles que la prise de
 * mission : visibilité, salle, attribution). La route des transitions refuse « start » aux agents.
 */
function startAs(agent: TestAgent, missionId: string) {
  return missions.applyAction(missionId, { action: 'start' }, { type: 'agent', id: agent.id });
}

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

/** Prospect créé par l'agent puis passé en analyse. */
async function prospectInAnalysis(agent: TestAgent) {
  const created = dossierOf(
    await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
  );
  const res = await call(agent, 'post', `/api/agent/prospects/${created.prospect.id}/stage`, {
    to: 'analysis',
  });
  expect(res.status).toBe(200);
  return dossierOf(res);
}

/** Prospect analysé, transmis à Mon bureau et validé par l'utilisateur : étape doublage. */
async function prospectInDubbing(agent: TestAgent) {
  const d = await prospectInAnalysis(agent);
  const id = d.prospect.id;
  await call(agent, 'post', `/api/agent/prospects/${id}/analyses`, analysisBody()).expect(201);
  const review = dossierOf(
    await call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to: 'review' }).expect(200),
  );
  // Mon bureau est la salle de l'utilisateur : la mission de revue n'est visible d'aucun agent.
  expect(review.missions.some((m) => m.room === 'director')).toBe(false);
  // Soumise à l'utilisateur dès sa création : la décision est possible immédiatement.
  const mission = await openMissionIn(id, 'director');
  expect(mission.status).toBe('awaiting_validation');
  return prospects.decideProspect(id, { missionId: mission.id, decision: 'approve' }, HUMAN_ACTOR);
}

/** Utilisateur humain connecté (session recréée après chaque remise à zéro). */
let owner: OwnerClient;

beforeEach(async () => {
  await resetDatabase();
  search.forget();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('accès à l’API des agents', () => {
  it('refuse l’utilisateur humain : ces routes parlent au nom d’un agent', async () => {
    const res = await owner.post('/api/agent/prospects').send(prospectBody());
    expectError(res, 403, 'FORBIDDEN_ACTOR');
  });

  it('chaque action exige sa permission', async () => {
    const reader = await createAgent('agent-lecteur', ['prospects:read']);
    const res = await call(reader, 'post', '/api/agent/prospects', await prospectFor(reader));
    expectError(res, 403, 'FORBIDDEN_ACTOR');
    expect(res.body.error.details).toEqual({ requiredPermission: 'prospects:create' });
    expect((await prospects.list({})).total).toBe(0);

    const creator = await createAgent('agent-createur', ['prospects:create']);
    // Sans prospects:read_contact, il ne peut pas enregistrer de coordonnées.
    const created = await call(
      creator,
      'post',
      '/api/agent/prospects',
      await prospectFor(creator, NO_CONTACT),
    );
    expect(created.status).toBe(201);
    const id = dossierOf(created).prospect.id;
    // Créer n'autorise ni à lire, ni à enrichir, ni à analyser.
    expectError(
      await call(creator, 'get', `/api/agent/prospects/${id}/context`),
      403,
      'FORBIDDEN_ACTOR',
    );
    expectError(
      await call(creator, 'patch', `/api/agent/prospects/${id}`, { country: 'France' }),
      403,
      'FORBIDDEN_ACTOR',
    );
    expectError(
      await call(creator, 'post', `/api/agent/prospects/${id}/analyses`, analysisBody()),
      403,
      'FORBIDDEN_ACTOR',
    );
  });

  it('les permissions retirées par l’utilisateur cessent aussitôt de fonctionner', async () => {
    const agent = await createAgent('agent-a', ['prospects:read', 'prospects:create']);
    await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent, NO_CONTACT)).expect(
      201,
    );
    await owner
      .patch('/api/agents/agent-a')
      .send({ permissions: ['prospects:read'] })
      .expect(200);
    const res = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, {
        youtubeChannelId: 'UC-AUTRE',
        channelHandle: null,
        channelUrl: null,
      }),
    );
    expectError(res, 403, 'FORBIDDEN_ACTOR');
  });
});

describe('création d’un prospect et doublons', () => {
  it('crée le dossier au nom de l’agent, rattaché à sa mission de recherche, sans nouvelle mission', async () => {
    const agent = await createAgent('agent-prospecteur');
    const searchMissionId = await search.of(agent);
    const missionsBefore = await prisma.mission.count();
    const res = await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent));
    expect(res.status).toBe(201);
    const d = dossierOf(res);
    expect(d.prospect).toMatchObject({
      stage: 'prospecting',
      reference: /^P-\d{4}-0001$/,
      isDemo: false,
    });
    // La découverte est attribuée à l'agent réel, pas à la valeur envoyée ("owner").
    expect(d.prospect.discovery?.discoveredBy).toBe('agent-prospecteur');
    expect(d.events[0]).toMatchObject({
      type: 'discovered',
      actorType: 'agent',
      actorId: 'agent-prospecteur',
      missionId: searchMissionId,
    });
    // Aucune mission de découverte : rien qui passerait avant ses recherches à la prise suivante.
    expect(d.missions).toEqual([]);
    expect(await prisma.mission.count()).toBe(missionsBefore);
    const searchMission = await missions.get(searchMissionId);
    expect(searchMission).toMatchObject({ status: 'in_progress', agentId: 'agent-prospecteur' });
  });

  it('refuse de marquer un prospect comme donnée de démonstration', async () => {
    const agent = await createAgent('agent-prospecteur');
    const res = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, { isDemo: true }),
    );
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('refuse un prospect sans aucun identifiant de chaîne (doublon indétectable)', async () => {
    const agent = await createAgent('agent-prospecteur');
    const res = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, { youtubeChannelId: null, channelHandle: null, channelUrl: null }),
    );
    expectError(res, 400, 'VALIDATION_ERROR');
    expect((await prospects.list({})).total).toBe(0);
  });

  it('refuse une adresse web qui n’est pas http(s) (lien piégé dans l’interface)', async () => {
    const agent = await createAgent('agent-prospecteur');
    const res = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, { channelUrl: 'javascript:fetch("/api/prospects")' }),
    );
    expectError(res, 400, 'VALIDATION_ERROR');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    expectError(
      await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
        avatarUrl: 'data:text/html,<script>1</script>',
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('trouve un dossier existant par identifiant, nom de chaîne, adresse ou e-mail', async () => {
    const agent = await createAgent('agent-prospecteur');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    const lookup = async (query: Record<string, string>) =>
      prospectLookupResponseSchema.parse(
        (await call(agent, 'get', '/api/agent/prospects/lookup').query(query).expect(200)).body,
      );

    for (const [query, field] of [
      [{ youtubeChannelId: 'UC-LEA-001' }, 'youtubeChannelId'],
      [{ channelHandle: 'lacuisinedelea' }, 'channelHandle'],
      [{ channelHandle: '@LACUISINEDELEA' }, 'channelHandle'],
      [{ channelUrl: 'https://youtube.example/@LaCuisineDeLea/' }, 'channelUrl'],
      [{ channelUrl: 'https://www.youtube.com/@lacuisinedelea/videos' }, 'channelHandle'],
      [{ contactEmail: 'CONTACT@lea.example' }, 'contactEmail'],
    ] as const) {
      const found = await lookup(query);
      expect(found.exists, JSON.stringify(query)).toBe(true);
      expect(found.matches[0]!.prospect.id).toBe(d.prospect.id);
      expect(found.matches[0]!.matchedOn).toContain(field);
    }
    expect(await lookup({ channelHandle: 'autre-chaine' })).toEqual({ exists: false, matches: [] });
    expectError(await call(agent, 'get', '/api/agent/prospects/lookup'), 400, 'VALIDATION_ERROR');
  });

  it.each([
    ['même identifiant YouTube', { channelHandle: null, channelUrl: null }],
    [
      'même nom de chaîne (casse et @ ignorés)',
      { youtubeChannelId: null, channelHandle: 'lacuisinedelea', channelUrl: null },
    ],
    ['même adresse de chaîne', { youtubeChannelId: null, channelHandle: null }],
  ])('refuse un doublon : %s', async (_label, overrides) => {
    const agent = await createAgent('agent-prospecteur');
    const first = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    const res = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, overrides),
    );
    expectError(res, 409, 'ALREADY_EXISTS');
    expect(res.body.error.details.matches[0].prospect.reference).toBe(first.prospect.reference);
    expect((await prospects.list({})).total).toBe(1);
  });

  it('deux créations simultanées de chaînes différentes reçoivent chacune leur numéro', async () => {
    const agent = await createAgent('agent-prospecteur');
    const results = await Promise.all(
      [1, 2, 3].map(async (n) =>
        call(
          agent,
          'post',
          '/api/agent/prospects',
          await prospectFor(agent, {
            youtubeChannelId: `UC-${n}`,
            channelHandle: `@c${n}`,
            channelUrl: null,
          }),
        ),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const refs = results.map((r) => dossierOf(r).prospect.reference);
    expect(new Set(refs).size).toBe(3);
  });
});

describe('requêtes répétées (idempotence)', () => {
  it('exige une clé d’idempotence sur toute écriture', async () => {
    const agent = await createAgent('agent-prospecteur');
    const res = await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent), null);
    expectError(res, 400, 'VALIDATION_ERROR');
    expect((await prospects.list({})).total).toBe(0);
  });

  it('une requête rejouée avec la même clé renvoie la même réponse sans rien refaire', async () => {
    const agent = await createAgent('agent-prospecteur');
    const first = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent),
      'n8n-exec-1',
    );
    const replay = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent),
      'n8n-exec-1',
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(replay.body).toEqual(first.body);
    expect((await prospects.list({})).total).toBe(1);
  });

  it('l’ordre des champs n’empêche pas de reconnaître une répétition', async () => {
    const agent = await createAgent('agent-prospecteur');
    const body = await prospectFor(agent);
    const reversed = Object.fromEntries(Object.entries(body).reverse());
    await call(agent, 'post', '/api/agent/prospects', body, 'n8n-exec-2').expect(201);
    const replay = await call(agent, 'post', '/api/agent/prospects', reversed, 'n8n-exec-2');
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('refuse de réutiliser une clé pour une autre requête', async () => {
    const agent = await createAgent('agent-prospecteur');
    await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent),
      'n8n-exec-3',
    ).expect(201);
    const other = await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent, {
        youtubeChannelId: 'UC-AUTRE',
        channelHandle: null,
        channelUrl: null,
      }),
      'n8n-exec-3',
    );
    expectError(other, 409, 'IDEMPOTENCY_CONFLICT');
    expect((await prospects.list({})).total).toBe(1);
  });

  it('une requête en échec libère sa clé : corrigée, elle peut être renvoyée', async () => {
    const agent = await createAgent('agent-prospecteur');
    const bad = await call(
      agent,
      'post',
      '/api/agent/prospects',
      { creatorName: 'X' },
      'n8n-exec-4',
    );
    expectError(bad, 400, 'VALIDATION_ERROR');
    await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent),
      'n8n-exec-4',
    ).expect(201);
  });

  it('deux répétitions simultanées n’exécutent la requête qu’une fois, et reçoivent la même réponse', async () => {
    const agent = await createAgent('agent-prospecteur');
    const results = await Promise.all(
      [1, 2, 3].map(async () =>
        call(agent, 'post', '/api/agent/prospects', await prospectFor(agent), 'n8n-exec-5'),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
    expect((await prospects.list({})).total).toBe(1);
  });

  it('les clés sont propres à chaque agent', async () => {
    const a = await createAgent('agent-a');
    const b = await createAgent('agent-b');
    await call(a, 'post', '/api/agent/prospects', await prospectFor(a), 'meme-cle-01').expect(201);
    const res = await call(
      b,
      'post',
      '/api/agent/prospects',
      await prospectFor(b, { youtubeChannelId: 'UC-B', channelHandle: '@b', channelUrl: null }),
      'meme-cle-01',
    );
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });

  it('chaque écriture est journalisée au nom de l’agent', async () => {
    const agent = await createAgent('agent-prospecteur');
    await call(
      agent,
      'post',
      '/api/agent/prospects',
      await prospectFor(agent),
      'n8n-exec-6',
    ).expect(201);
    const rows = await prisma.agentRequest.findMany();
    expect(rows).toMatchObject([
      {
        agentId: 'agent-prospecteur',
        idempotencyKey: 'n8n-exec-6',
        method: 'POST',
        status: 'completed',
        responseStatus: 201,
      },
    ]);
  });
});

describe('enrichissement', () => {
  it('enregistre les champs modifiés, avec l’ancienne et la nouvelle valeur', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    const res = await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
      country: 'France',
      subscriberCount: 125_000,
      viewCount: 9_000_000_000,
      statsSource: 'YouTube Data API (simulée)',
      expectedVersion: d.prospect.version,
    });
    expect(res.status).toBe(200);
    const after = dossierOf(res);
    expect(after.prospect).toMatchObject({
      country: 'France',
      subscriberCount: 125_000,
      viewCount: 9_000_000_000,
      statsSource: 'YouTube Data API (simulée)',
      version: d.prospect.version + 1,
    });
    expect(after.prospect.statsUpdatedAt).not.toBeNull();
    const event = after.events.at(-1)!;
    expect(event).toMatchObject({
      type: 'prospect_enriched',
      actorType: 'agent',
      actorId: 'agent-analyste',
    });
    expect(event.payload.changes).toMatchObject({
      country: { from: null, to: 'France' },
      subscriberCount: { from: null, to: 125_000 },
    });
  });

  it('ne change rien si les valeurs sont déjà à jour', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    const res = await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
      creatorName: 'Léa Martin',
    });
    const after = dossierOf(res);
    expect(after.prospect.version).toBe(d.prospect.version);
    expect(after.events).toHaveLength(d.events.length);
  });

  it('refuse de changer l’identité de la chaîne ou de créer un doublon', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    expectError(
      await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
        youtubeChannelId: 'UC-X',
      }),
      409,
      'INVALID_TRANSITION',
    );
    const other = dossierOf(
      await call(
        agent,
        'post',
        '/api/agent/prospects',
        await prospectFor(agent, {
          youtubeChannelId: 'UC-2',
          channelHandle: '@deux',
          channelUrl: null,
        }),
      ),
    );
    expectError(
      await call(agent, 'patch', `/api/agent/prospects/${other.prospect.id}`, {
        channelHandle: '@lacuisinedelea',
      }),
      409,
      'ALREADY_EXISTS',
    );
  });

  it('refuse les champs réservés à l’utilisateur', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    for (const body of [
      { stage: 'review' },
      { doNotContact: false },
      { relationshipStatus: 'converted' },
    ]) {
      expectError(
        await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, body),
        400,
        'VALIDATION_ERROR',
      );
    }
  });

  it('refuse une modification basée sur une version périmée', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
      country: 'France',
    }).expect(200);
    expectError(
      await call(agent, 'patch', `/api/agent/prospects/${d.prospect.id}`, {
        country: 'Belgique',
        expectedVersion: d.prospect.version,
      }),
      409,
      'CONCURRENT_MODIFICATION',
    );
  });
});

describe('analyses, productions et étapes', () => {
  it('ajoute une analyse et calcule le score, à l’étape d’analyse seulement', async () => {
    const prospector = await createAgent('agent-prospecteur');
    const agent = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    const early = dossierOf(
      await call(prospector, 'post', '/api/agent/prospects', await prospectFor(prospector)),
    );
    expectError(
      await call(
        agent,
        'post',
        `/api/agent/prospects/${early.prospect.id}/analyses`,
        analysisBody(),
      ),
      403,
      'FORBIDDEN_ACTOR',
    );
    const d = dossierOf(
      await call(prospector, 'post', `/api/agent/prospects/${early.prospect.id}/stage`, {
        to: 'analysis',
      }),
    );
    const mission = await openMissionIn(d.prospect.id, 'analysis');
    await startAs(agent, mission.id);
    const res = await call(
      agent,
      'post',
      `/api/agent/prospects/${d.prospect.id}/analyses`,
      analysisBody(mission.id),
    );
    expect(res.status).toBe(201);
    expect(dossierOf(res).analyses![0]).toMatchObject({
      version: 1,
      score: 76,
      missionId: mission.id,
      actorType: 'agent',
      actorId: 'agent-analyste',
    });
  });

  it('refuse une analyse rattachée à la mission d’un autre dossier', async () => {
    const agent = await createAgent('agent-analyste');
    const a = await prospectInAnalysis(agent);
    const b = dossierOf(
      await call(
        agent,
        'post',
        '/api/agent/prospects',
        await prospectFor(agent, {
          youtubeChannelId: 'UC-B',
          channelHandle: '@b',
          channelUrl: null,
        }),
      ),
    );
    const otherMission = createMissionRequestSchema.parse({
      type: 'test.tache',
      room: 'analysis',
      agentId: 'agent-analyste',
      prospectId: b.prospect.id,
    });
    const { mission } = await missions.create(otherMission, HUMAN_ACTOR);
    const res = await call(
      agent,
      'post',
      `/api/agent/prospects/${a.prospect.id}/analyses`,
      analysisBody(mission.id),
    );
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('passer en revue crée une mission qui exige la validation humaine', async () => {
    const agent = await createAgent('agent-analyste');
    const d = await prospectInAnalysis(agent);
    await call(
      agent,
      'post',
      `/api/agent/prospects/${d.prospect.id}/analyses`,
      analysisBody(),
    ).expect(201);
    const res = await call(agent, 'post', `/api/agent/prospects/${d.prospect.id}/stage`, {
      to: 'review',
      details: 'Analyse terminée',
    });
    const after = dossierOf(res);
    expect(after.prospect.stage).toBe('review');
    expect(after.missions.some((m) => m.room === 'director')).toBe(false);
    const review = await openMissionIn(after.prospect.id, 'director');
    // Soumise à l'utilisateur dès sa création, par le système : visible et décidable dans Mon bureau.
    expect(review).toMatchObject({
      type: 'review_prospect',
      requiresValidation: true,
      agentId: null,
      status: 'awaiting_validation',
      output: { analysisVersion: 1, score: 76 },
    });
    const history = await missions.events(review.id);
    expect(history.map((e) => [e.action, e.actorType])).toEqual([
      ['created', 'system'],
      ['start', 'system'],
      ['submit_for_validation', 'system'],
    ]);
    expect(after.events.at(-1)).toMatchObject({
      type: 'stage_changed',
      actorType: 'agent',
      actorId: 'agent-analyste',
    });
    // Aucun agent ne la voit ni ne peut la prendre ; l'utilisateur décide sans étape manuelle.
    const visible = await call(agent, 'get', `/api/agent/missions/${review.id}`);
    expectError(visible, 403, 'FORBIDDEN_ACTOR');
    const decided = await owner
      .post(`/api/prospects/${after.prospect.id}/decisions`)
      .send({ missionId: review.id, decision: 'approve', expectedVersion: after.prospect.version });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(prospectDossierSchema.parse(decided.body).prospect.stage).toBe('dubbing');
  });

  it('un agent ne franchit jamais une étape de décision humaine', async () => {
    const agent = await createAgent('agent-analyste');
    const d = await prospectInAnalysis(agent);
    const id = d.prospect.id;
    await call(agent, 'post', `/api/agent/prospects/${id}/analyses`, analysisBody()).expect(201);
    await call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to: 'review' }).expect(200);
    for (const to of ['dubbing', 'refused', 'analysis', 'archived']) {
      expectError(
        await call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to }),
        403,
        'FORBIDDEN_ACTOR',
      );
    }
    expect((await prospects.getDossier(id)).prospect.stage).toBe('review');
  });

  it('un agent rattaché à une salle ne fait avancer que les dossiers de sa salle', async () => {
    const prospector = await createAgent('agent-prospecteur', AGENT_PERMISSIONS, 'prospecting');
    const analyst = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    const d = dossierOf(
      await call(prospector, 'post', '/api/agent/prospects', await prospectFor(prospector)),
    );
    expectError(
      await call(analyst, 'post', `/api/agent/prospects/${d.prospect.id}/stage`, {
        to: 'analysis',
      }),
      403,
      'FORBIDDEN_ACTOR',
    );
    await call(prospector, 'post', `/api/agent/prospects/${d.prospect.id}/stage`, {
      to: 'analysis',
    }).expect(200);
  });

  it('ajoute des productions à leur étape, avec des statuts limités', async () => {
    const agent = await createAgent('agent-doublage');
    const d = await prospectInDubbing(agent);
    const id = d.prospect.id;
    const res = await call(agent, 'post', `/api/agent/prospects/${id}/productions`, dubbingBody());
    expect(res.status).toBe(201);
    expect(dossierOf(res).productions.find((p) => p.kind === 'dubbing')).toMatchObject({
      status: 'generated',
      actorType: 'agent',
      actorId: 'agent-doublage',
    });
    // Mauvais statut, mauvaise étape.
    expectError(
      await call(agent, 'post', `/api/agent/prospects/${id}/productions`, dubbingBody('approved')),
      403,
      'FORBIDDEN_ACTOR',
    );
    expectError(
      await call(agent, 'post', `/api/agent/prospects/${id}/productions`, proposalBody()),
      403,
      'FORBIDDEN_ACTOR',
    );
    expectError(
      await call(agent, 'post', `/api/agent/prospects/${id}/productions`, emailBody()),
      403,
      'FORBIDDEN_ACTOR',
    );
  });
});

describe('e-mails : jamais envoyés sans l’utilisateur', () => {
  it('parcours complet : l’agent prépare, l’utilisateur valide et envoie', async () => {
    const agent = await createAgent('agent-commercial');
    const reviewer = await createAgent('agent-relecteur', AGENT_PERMISSIONS, 'email_review');
    const d0 = await prospectInDubbing(agent);
    const id = d0.prospect.id;
    await call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to: 'proposal' }).expect(200);
    await call(agent, 'post', `/api/agent/prospects/${id}/productions`, proposalBody()).expect(201);
    // Un e-mail ne peut jamais être « validé » ou « envoyé » par un agent.
    for (const status of ['approved', 'sent']) {
      expectError(
        await call(agent, 'post', `/api/agent/prospects/${id}/productions`, emailBody(status)),
        403,
        'FORBIDDEN_ACTOR',
      );
    }
    const staged = dossierOf(
      await call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to: 'email_review' }).expect(
        200,
      ),
    );
    // Agent sans salle : il ne voit pas la mission libre de la salle de validation des e-mails.
    expect(staged.missions.some((m) => m.room === 'email_review')).toBe(false);
    const mission = await openMissionIn(id, 'email_review');
    expect(mission.requiresValidation).toBe(true);
    await startAs(reviewer, mission.id);
    const drafted = dossierOf(
      await call(reviewer, 'post', `/api/agent/prospects/${id}/productions`, {
        ...emailBody('pending_review'),
        missionId: mission.id,
      }).expect(201),
    );
    const email = drafted.productions.find((p) => p.kind === 'email')!;

    // L'agent ne peut terminer la mission seul : la validation humaine est exigée.
    expectError(
      await call(reviewer, 'post', `/api/agent/missions/${mission.id}/transitions`, {
        action: 'complete',
      }),
      409,
      'VALIDATION_REQUIRED',
    );
    await call(reviewer, 'post', `/api/agent/missions/${mission.id}/transitions`, {
      action: 'submit_for_validation',
    }).expect(200);

    // Aucune route ne permet à l'agent de valider ou d'envoyer.
    const agentAttempts = [
      call(agent, 'post', `/api/prospects/${id}/email/decisions`, {
        missionId: mission.id,
        productionId: email.id,
        decision: 'approve',
      }),
      call(agent, 'post', `/api/prospects/${id}/email/simulated-send`, { productionId: email.id }),
      call(agent, 'post', `/api/missions/${mission.id}/validation`, { decision: 'approve' }),
      call(agent, 'post', `/api/agent/prospects/${id}/stage`, { to: 'followup' }),
    ];
    for (const res of await Promise.all(agentAttempts)) expectError(res, 403, 'FORBIDDEN_ACTOR');
    // Même en appelant le service directement.
    const agentActor = { type: 'agent', id: 'agent-commercial' } as const;
    await expect(
      prospects.simulateSend(id, { productionId: email.id }, agentActor),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_ACTOR',
    });
    expect((await prospects.getDossier(id)).messages).toHaveLength(0);

    // L'utilisateur valide puis envoie (envoi simulé).
    await owner
      .post(`/api/prospects/${id}/email/decisions`)
      .send({ missionId: mission.id, productionId: email.id, decision: 'approve' })
      .expect(200);
    const sendResponse = await owner
      .post(`/api/prospects/${id}/email/simulated-send`)
      .send({ productionId: email.id })
      .expect(200);
    // Réponse de l'interface : dossier complet (l'utilisateur voit tout).
    const sent = prospectDossierSchema.parse(sendResponse.body);
    expect(sent.messages).toMatchObject([{ direction: 'outbound', delivery: 'simulated' }]);
    expect(sent.prospect.stage).toBe('followup');
  });
});

describe('missions', () => {
  it('un agent ne peut ni annuler, ni débloquer, ni toucher la mission d’un autre agent', async () => {
    const agent = await createAgent('agent-analyste');
    const other = await createAgent('agent-autre');
    const input = createMissionRequestSchema.parse({
      type: 'test.tache',
      room: 'prospecting',
      agentId: 'agent-analyste',
    });
    const { mission } = await missions.create(input, HUMAN_ACTOR); // attribuée à agent-analyste
    expectError(
      await call(agent, 'post', `/api/agent/missions/${mission.id}/transitions`, {
        action: 'cancel',
        reason: 'Stop',
      }),
      403,
      'FORBIDDEN_ACTOR',
    );
    await expect(startAs(other, mission.id)).rejects.toMatchObject({ code: 'FORBIDDEN_ACTOR' });
    const res = await startAs(agent, mission.id);
    expect(res.event).toMatchObject({
      action: 'start',
      actorType: 'agent',
      actorId: 'agent-analyste',
    });
  });

  it('un agent rattaché à une salle n’agit pas sur une mission d’une autre salle', async () => {
    const creator = await createAgent('agent-prospecteur');
    const writer = await createAgent('agent-redacteur', AGENT_PERMISSIONS, 'copywriting');
    const d = await prospectInAnalysis(creator);
    const analysisMission = await openMissionIn(d.prospect.id, 'analysis'); // libre (agentId null)
    await expect(startAs(writer, analysisMission.id)).rejects.toMatchObject({
      code: 'FORBIDDEN_ACTOR',
    });
  });

  it('démarrer ou reprendre par la route des transitions est refusé : prise de mission obligatoire', async () => {
    const analyst = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    const input = createMissionRequestSchema.parse({
      type: 'test.tache',
      room: 'analysis',
      agentId: 'agent-analyste',
    });
    const { mission } = await missions.create(input, HUMAN_ACTOR);
    const res = await call(analyst, 'post', `/api/agent/missions/${mission.id}/transitions`, {
      action: 'start',
    });
    expectError(res, 403, 'FORBIDDEN_ACTOR');
    expect(res.body.error.message).toContain('/api/agent/runs/claim');
    expect((await missions.get(mission.id)).status).toBe('pending');

    // Mise en pause (autorisée), puis reprise par la route : refusée aussi.
    await startAs(analyst, mission.id);
    await call(analyst, 'post', `/api/agent/missions/${mission.id}/transitions`, {
      action: 'pause',
    }).expect(200);
    expectError(
      await call(analyst, 'post', `/api/agent/missions/${mission.id}/transitions`, {
        action: 'resume',
      }),
      403,
      'FORBIDDEN_ACTOR',
    );
    expect((await missions.get(mission.id)).status).toBe('paused');

    // L'utilisateur garde ses usages légitimes sur ses propres routes.
    await owner
      .post(`/api/missions/${mission.id}/transitions`)
      .send({ action: 'resume' })
      .expect(200);
    expect((await missions.get(mission.id)).status).toBe('in_progress');
  });
});

describe('attribution et visibilité des missions', () => {
  /** Mission sans prospect créée par l'utilisateur, libre ou attribuée. */
  async function newMission(room: RoomId, agentId: string | null = null) {
    const input = createMissionRequestSchema.parse({ type: 'test.tache', room, agentId });
    return (await missions.create(input, HUMAN_ACTOR)).mission;
  }
  const listIds = async (agent: TestAgent) =>
    missionListResponseSchema
      .parse((await call(agent, 'get', '/api/agent/missions').expect(200)).body)
      .items.map((m) => m.id)
      .sort();
  const transition = (agent: TestAgent, id: string, body: Record<string, unknown>) =>
    call(agent, 'post', `/api/agent/missions/${id}/transitions`, body);

  it('démarrer une mission libre de sa salle la lui attribue, et l’historique le trace', async () => {
    const analyst = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    const free = await newMission('analysis');
    const { mission, event } = await startAs(analyst, free.id);
    expect(mission).toMatchObject({ status: 'in_progress', agentId: 'agent-analyste' });
    expect(event.changes.agentId).toEqual({ from: null, to: 'agent-analyste' });
  });

  it('deux agents démarrent la même mission en même temps : un seul l’obtient', async () => {
    const a = await createAgent('agent-a', AGENT_PERMISSIONS, 'analysis');
    const b = await createAgent('agent-b', AGENT_PERMISSIONS, 'analysis');
    for (let round = 0; round < 5; round++) {
      const free = await newMission('analysis');
      const results = await Promise.allSettled([startAs(a, free.id), startAs(b, free.id)]);
      const won = results.filter((r) => r.status === 'fulfilled');
      expect(won).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected')!;
      expect(['FORBIDDEN_ACTOR', 'CONCURRENT_MODIFICATION', 'INVALID_TRANSITION']).toContain(
        (lost as PromiseRejectedResult).reason.code,
      );
      const owner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof startAs>>>).value
        .mission.agentId;
      expect(missionSchema.parse(await missions.get(free.id))).toMatchObject({
        agentId: owner,
        attemptCount: 1,
      });
      const starts = (await missions.events(free.id)).filter((e) => e.action === 'start');
      expect(starts).toHaveLength(1);
    }
  });

  it('une fois prise, la mission est inaccessible aux autres agents de la salle', async () => {
    const a = await createAgent('agent-a', AGENT_PERMISSIONS, 'analysis');
    const b = await createAgent('agent-b', AGENT_PERMISSIONS, 'analysis');
    const free = await newMission('analysis');
    await startAs(a, free.id);

    for (const body of [
      { action: 'pause' },
      { action: 'complete' },
      { action: 'block', reason: 'Je la prends' },
    ]) {
      expectError(await transition(b, free.id, body), 403, 'FORBIDDEN_ACTOR');
    }
    expectError(await call(b, 'get', `/api/agent/missions/${free.id}`), 403, 'FORBIDDEN_ACTOR');
    expect(await listIds(b)).toEqual([]);
    expect(await listIds(a)).toEqual([free.id]);
    await transition(a, free.id, { action: 'complete' }).expect(200);
  });

  it('une mission libre ne peut être que démarrée : ni bloquée ni terminée sans être prise', async () => {
    const analyst = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    const free = await newMission('analysis');
    expectError(
      await transition(analyst, free.id, { action: 'block', reason: 'Pas pour moi' }),
      403,
      'FORBIDDEN_ACTOR',
    );
    expect((await missions.get(free.id)).status).toBe('pending');
  });

  it('agent rattaché à une salle : voit ses missions et les missions libres de sa salle seulement', async () => {
    const analyst = await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    await createAgent('agent-autre', AGENT_PERMISSIONS, 'analysis');
    const mine = await newMission('analysis', 'agent-analyste');
    const freeHere = await newMission('analysis');
    await newMission('analysis', 'agent-autre');
    const freeElsewhere = await newMission('dubbing');
    const mineElsewhere = await newMission('dubbing', 'agent-analyste');

    expect(await listIds(analyst)).toEqual([mine.id, freeHere.id].sort());
    // Total et pagination calculés sur les seules missions visibles.
    const page = missionListResponseSchema.parse(
      (await call(analyst, 'get', '/api/agent/missions?limit=1').expect(200)).body,
    );
    expect(page).toMatchObject({ total: 2, limit: 1 });
    for (const hidden of [freeElsewhere, mineElsewhere]) {
      expectError(
        await call(analyst, 'get', `/api/agent/missions/${hidden.id}`),
        403,
        'FORBIDDEN_ACTOR',
      );
    }
  });

  it('agent sans salle : uniquement ses missions, et il ne peut prendre aucune mission libre', async () => {
    const roaming = await createAgent('agent-itinerant');
    const mine = await newMission('dubbing', 'agent-itinerant');
    const free = await newMission('analysis');

    expect(await listIds(roaming)).toEqual([mine.id]);
    expectError(
      await call(roaming, 'get', `/api/agent/missions/${free.id}`),
      403,
      'FORBIDDEN_ACTOR',
    );
    await expect(startAs(roaming, free.id)).rejects.toMatchObject({ code: 'FORBIDDEN_ACTOR' });
    expect((await missions.get(free.id)).agentId).toBeNull();
    // Sa propre mission, elle, peut évoluer normalement.
    await startAs(roaming, mine.id);
  });

  it('le dossier ne montre jamais les missions d’un autre agent', async () => {
    const prospector = await createAgent('agent-prospecteur');
    const d = await prospectInAnalysis(prospector);
    const own = createMissionRequestSchema.parse({
      type: 'test.tache',
      room: 'prospecting',
      agentId: 'agent-prospecteur',
      prospectId: d.prospect.id,
    });
    await missions.create(own, HUMAN_ACTOR);
    const analysisMission = await openMissionIn(d.prospect.id, 'analysis');
    await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    await missions.applyAction(
      analysisMission.id,
      { action: 'start' },
      { type: 'agent', id: 'agent-analyste' },
    );

    const ctx = agentProspectContextSchema.parse(
      (await call(prospector, 'get', `/api/agent/prospects/${d.prospect.id}/context`).expect(200))
        .body,
    );
    // Il garde sa mission de prospection ; la mission d'analyse, prise par un autre, disparaît.
    expect(ctx.dossier.missions.map((m) => m.room)).toEqual(['prospecting']);
    expect(ctx.dossier.missions.every((m) => m.agentId === 'agent-prospecteur')).toBe(true);
  });

  it('une mission ne peut être attribuée qu’à un agent existant', async () => {
    for (const agentId of ['agent-inconnu', 'owner', 'n8n']) {
      const res = await owner
        .post('/api/missions')
        .send({ type: 'test.tache', room: 'analysis', agentId });
      expectError(res, 400, 'VALIDATION_ERROR');
    }
    await createAgent('agent-analyste', AGENT_PERMISSIONS, 'analysis');
    await owner
      .post('/api/missions')
      .send({ type: 'test.tache', room: 'analysis', agentId: 'agent-analyste' })
      .expect(201);
  });
});

describe('missions citées dans une analyse, une production ou une activité', () => {
  /** Dossier à l'étape d'analyse, et deux analystes de la salle d'analyse. */
  async function setup() {
    const prospector = await createAgent('agent-prospecteur');
    const a = await createAgent('agent-analyste-a', AGENT_PERMISSIONS, 'analysis');
    const b = await createAgent('agent-analyste-b', AGENT_PERMISSIONS, 'analysis');
    const d = await prospectInAnalysis(prospector);
    const mission = await openMissionIn(d.prospect.id, 'analysis'); // libre
    return { a, b, prospectId: d.prospect.id, missionId: mission.id };
  }
  const addAnalysis = (agent: TestAgent, prospectId: string, missionId: string) =>
    call(agent, 'post', `/api/agent/prospects/${prospectId}/analyses`, analysisBody(missionId));
  const addActivity = (agent: TestAgent, prospectId: string, missionId: string) =>
    call(agent, 'post', `/api/agent/prospects/${prospectId}/events`, {
      title: 'Travail en cours',
      missionId,
    });
  const start = (agent: TestAgent, missionId: string) => startAs(agent, missionId);
  /** Rien n'a été enregistré au nom de cet agent sur le dossier. */
  async function expectNothingRecordedBy(agentId: string, prospectId: string) {
    const d = await prospects.getDossier(prospectId);
    expect(d.analyses.filter((x) => x.actorId === agentId)).toEqual([]);
    expect(d.productions.filter((x) => x.actorId === agentId)).toEqual([]);
    expect(d.events.filter((e) => e.actorId === agentId)).toEqual([]);
  }

  it('refuse la mission d’un autre agent du même dossier (analyse et activité)', async () => {
    const { a, b, prospectId, missionId } = await setup();
    await start(a, missionId);
    expectError(await addAnalysis(b, prospectId, missionId), 403, 'FORBIDDEN_ACTOR');
    expectError(await addActivity(b, prospectId, missionId), 403, 'FORBIDDEN_ACTOR');
    await expectNothingRecordedBy(b.id, prospectId);
    // Le propriétaire, lui, peut y rattacher ses résultats.
    await addAnalysis(a, prospectId, missionId).expect(201);
    await addActivity(a, prospectId, missionId).expect(201);
  });

  it('refuse une mission libre que l’agent n’a pas prise', async () => {
    const { a, prospectId, missionId } = await setup();
    expectError(await addAnalysis(a, prospectId, missionId), 403, 'FORBIDDEN_ACTOR');
    expectError(await addActivity(a, prospectId, missionId), 403, 'FORBIDDEN_ACTOR');
    await expectNothingRecordedBy(a.id, prospectId);
    expect((await missions.get(missionId)).agentId).toBeNull();
  });

  it('refuse sa propre mission si elle n’est pas en cours (en attente, en pause, terminée)', async () => {
    const { a, prospectId } = await setup();
    const input = createMissionRequestSchema.parse({
      type: 'analysis.extra',
      room: 'analysis',
      agentId: a.id,
      prospectId,
    });
    const { mission } = await missions.create(input, HUMAN_ACTOR);
    const expectNotInProgress = async (status: string) => {
      for (const res of [
        await addAnalysis(a, prospectId, mission.id),
        await addActivity(a, prospectId, mission.id),
      ]) {
        expectError(res, 409, 'INVALID_TRANSITION');
        expect(res.body.error.details).toMatchObject({ currentStatus: status });
      }
    };
    await expectNotInProgress('pending');
    await start(a, mission.id);
    await call(a, 'post', `/api/agent/missions/${mission.id}/transitions`, {
      action: 'pause',
    }).expect(200);
    await expectNotInProgress('paused');
    // Reprise par le moteur (la route des transitions refuse « resume » aux agents).
    await missions.applyAction(mission.id, { action: 'resume' }, { type: 'agent', id: a.id });
    await call(a, 'post', `/api/agent/missions/${mission.id}/transitions`, {
      action: 'complete',
    }).expect(200);
    await expectNotInProgress('completed');
    await expectNothingRecordedBy(a.id, prospectId);
  });

  it('production : seule la mission en cours de l’agent peut être citée', async () => {
    const creator = await createAgent('agent-commercial');
    const p = await createAgent('agent-doublage-p', AGENT_PERMISSIONS, 'dubbing');
    const q = await createAgent('agent-doublage-q', AGENT_PERMISSIONS, 'dubbing');
    const d = await prospectInDubbing(creator);
    const mission = await openMissionIn(d.prospect.id, 'dubbing');
    const produce = (agent: TestAgent) =>
      call(agent, 'post', `/api/agent/prospects/${d.prospect.id}/productions`, {
        ...dubbingBody(),
        missionId: mission.id,
      });

    expectError(await produce(p), 403, 'FORBIDDEN_ACTOR'); // pas encore prise
    await start(p, mission.id);
    expectError(await produce(q), 403, 'FORBIDDEN_ACTOR'); // celle d'un autre agent
    await expectNothingRecordedBy(q.id, d.prospect.id);
    const res = await produce(p).expect(201);
    expect(dossierOf(res).productions.at(-1)).toMatchObject({
      missionId: mission.id,
      actorId: p.id,
    });
  });

  it('l’utilisateur et le système gardent le comportement actuel', async () => {
    const { prospectId, missionId } = await setup();
    // Mission libre, non démarrée : acceptée pour l'utilisateur comme pour le système.
    await prospects.logActivity(prospectId, { title: 'Note', missionId }, HUMAN_ACTOR);
    await prospects.logActivity(
      prospectId,
      { title: 'Relevé', missionId },
      {
        type: 'system',
        id: null,
      },
    );
    const d = await prospects.addAnalysis(prospectId, analysisBody(missionId), HUMAN_ACTOR);
    expect(d.analyses[0]).toMatchObject({ missionId, actorType: 'user' });
    // La vérification du dossier, elle, s'applique toujours à tous.
    const otherCreator = await createAgent('agent-autre-createur');
    const other = dossierOf(
      await call(
        otherCreator,
        'post',
        '/api/agent/prospects',
        await prospectFor(otherCreator, {
          youtubeChannelId: 'UC-AUTRE',
          channelHandle: null,
          channelUrl: null,
        }),
      ),
    );
    await expect(
      prospects.logActivity(other.prospect.id, { title: 'x', missionId }, HUMAN_ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('historique et contexte de travail', () => {
  it('ajoute une activité au nom de l’agent, sans pouvoir choisir son type', async () => {
    const agent = await createAgent('agent-analyste');
    const d = dossierOf(
      await call(agent, 'post', '/api/agent/prospects', await prospectFor(agent)),
    );
    const res = await call(agent, 'post', `/api/agent/prospects/${d.prospect.id}/events`, {
      title: 'Statistiques relevées',
      details: '12 vidéos analysées',
      payload: { n8nExecutionId: 'exec-1' },
    });
    expect(res.status).toBe(201);
    expect(dossierOf(res).events.at(-1)).toMatchObject({
      type: 'agent_activity',
      title: 'Statistiques relevées',
      actorType: 'agent',
      actorId: 'agent-analyste',
      payload: { n8nExecutionId: 'exec-1' },
    });
    expectError(
      await call(agent, 'post', `/api/agent/prospects/${d.prospect.id}/events`, {
        title: 'E-mail validé',
        type: 'decision_recorded',
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('renvoie le dossier et ce que l’agent peut faire maintenant', async () => {
    const agent = await createAgent(
      'agent-analyste',
      ['prospects:read', 'prospects:create', 'stages:advance', 'analyses:write'],
      'analysis',
    );
    const prospector = await createAgent('agent-prospecteur');
    const d = dossierOf(
      await call(prospector, 'post', '/api/agent/prospects', await prospectFor(prospector)),
    );
    let ctx = agentProspectContextSchema.parse(
      (await call(agent, 'get', `/api/agent/prospects/${d.prospect.id}/context`).expect(200)).body,
    );
    // Étape de prospection : hors de la salle de l'agent.
    expect(ctx.workflow).toMatchObject({
      stage: 'prospecting',
      allowedStages: [],
      canAddAnalysis: false,
    });

    await prospects.moveToStage(d.prospect.id, 'analysis', { type: 'system', id: null });
    ctx = agentProspectContextSchema.parse(
      (await call(agent, 'get', `/api/agent/prospects/${d.prospect.id}/context`).expect(200)).body,
    );
    expect(ctx.workflow).toMatchObject({
      stage: 'analysis',
      room: 'analysis',
      allowedStages: ['review'],
      canAddAnalysis: true,
      allowedProductions: [],
      doNotContact: false,
    });
    expect(ctx.dossier.prospect.id).toBe(d.prospect.id);
  });
});
