import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_DAILY_QUOTAS,
  AGENT_PERMISSIONS,
  agentQuotaStatusSchema,
  agentsSwitchStatusSchema,
  issuedAgentKeyResponseSchema,
} from '@agency/shared';
import { createAgentControl, type AgentControl } from '../agents/agentControl.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createQuotaService } from '../agents/quotas.ts';
import { createAgentRateLimiter } from '../agents/rateLimit.ts';
import { createApp } from '../app.ts';
import { HUMAN_ACTOR, agentActor } from '../auth/actors.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * Lot E : quotas journaliers GLOBAUX (valeurs réelles : 10 / 200 / 100), débit par agent,
 * taille des requêtes et arrêt d'urgence.
 */

const prisma = createTestPrisma();
let now = new Date('2026-11-06T10:00:00.000Z'); // 11 h à Paris
const clock = () => now;
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const idempotency = createIdempotencyStore(prisma);

let control: AgentControl;
let owner: OwnerClient;

function makeApp(options: { envEnabled?: boolean; perMinute?: number } = {}) {
  control = createAgentControl({ prisma, envEnabled: options.envEnabled ?? true });
  return createApp({
    owner: createOwnerAuthService({ prisma }),
    db: createDatabaseProbe(prisma),
    missions,
    prospects,
    agents: createAgentService({ prisma }),
    idempotency,
    // Valeurs RÉELLES des quotas ; seule l'horloge est réglable.
    quotas: createQuotaService({ prisma, clock }),
    agentControl: control,
    agentRateLimiter: createAgentRateLimiter({ perMinute: options.perMinute ?? 100_000, clock }),
    version: 'test',
    simulationMode: true,
  });
}
let app = makeApp();

async function createAgent(id: string, keys = 1) {
  await owner
    .post('/api/agents')
    .send({ id, name: id, permissions: AGENT_PERMISSIONS })
    .expect(201);
  const out: string[] = [];
  for (let i = 0; i < keys; i++) {
    const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
    out.push(issued_key(issued.body));
  }
  return out;
}
const issued_key = (body: unknown) => issuedAgentKeyResponseSchema.parse(body).apiKey;

const prospectBody = (handle: string) => ({
  creatorName: handle,
  channelName: handle,
  channelHandle: handle,
  discovery: {
    source: 'Test',
    reason: 'Test',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
});

function agentPost(key: string, path: string, body: unknown, idem = `cle-${randomUUID()}`) {
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${key}`)
    .set('Idempotency-Key', idem)
    .send(body as object);
}
function agentPatch(key: string, path: string, body: unknown) {
  return request(app)
    .patch(path)
    .set('Authorization', `Bearer ${key}`)
    .set('Idempotency-Key', `cle-${randomUUID()}`)
    .send(body as object);
}

/** Photographie des tables qu'une requête refusée ne doit pas modifier. */
async function snapshot() {
  return {
    prospects: await prisma.prospect.count(),
    missions: await prisma.mission.count(),
    missionEvents: await prisma.missionEvent.count(),
    events: await prisma.prospectEvent.count(),
    productions: await prisma.prospectProduction.count(),
    requests: await prisma.agentRequest.count(),
    quota: await prisma.agentQuotaUsage.findMany({ orderBy: { action: 'asc' } }),
    counters: await prisma.prospectCounter.findMany(),
    versions: (await prisma.prospect.findMany({ select: { id: true, version: true } })).sort(
      (a, b) => a.id.localeCompare(b.id),
    ),
  };
}

/** Exécute des requêtes par vagues simultanées. */
async function waves<T>(count: number, size: number, run: (i: number) => Promise<T>) {
  const results: T[] = [];
  for (let start = 0; start < count; start += size) {
    results.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(size, count - start) }, (_, k) => run(start + k)),
      )),
    );
  }
  return results;
}

beforeEach(async () => {
  now = new Date('2026-11-06T10:00:00.000Z');
  await resetDatabase();
  app = makeApp();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('valeurs décidées', () => {
  it('10 prospects, 200 enrichissements, 100 productions par jour, tous agents confondus', () => {
    expect(AGENT_DAILY_QUOTAS).toEqual({
      prospect_create: 10,
      prospect_enrich: 200,
      production_create: 100,
    });
  });
});

describe('quota global de création de prospects (10 par jour)', () => {
  it('ne se contourne ni avec plusieurs agents ni avec plusieurs clés', async () => {
    const keys = [
      ...(await createAgent('agent-a', 2)),
      ...(await createAgent('agent-b', 2)),
      ...(await createAgent('agent-c', 1)),
    ];
    for (let i = 0; i < 10; i++) {
      await agentPost(
        keys[i % keys.length]!,
        '/api/agent/prospects',
        prospectBody(`@p${i}`),
      ).expect(201);
    }
    const before = await snapshot();
    for (const [i, key] of keys.entries()) {
      const res = await agentPost(key, '/api/agent/prospects', prospectBody(`@refus${i}`));
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(res.body.error.details).toMatchObject({ action: 'prospect_create', limit: 10 });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    }
    // Rien n'a bougé : ni dossier, ni mission, ni historique, ni clé, ni compteur.
    expect(await snapshot()).toEqual(before);
    expect(before.quota).toEqual([{ day: '2026-11-06', action: 'prospect_create', used: 10 }]);
  });

  it('résiste aux requêtes simultanées : exactement 10 sur 15', async () => {
    const keys = [...(await createAgent('agent-a', 2)), ...(await createAgent('agent-b', 2))];
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        agentPost(keys[i % keys.length]!, '/api/agent/prospects', prospectBody(`@simultane${i}`)),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(await prisma.prospect.count()).toBe(10);
    expect(await prisma.agentRequest.count()).toBe(10);
    expect((await prisma.agentQuotaUsage.findFirstOrThrow()).used).toBe(10);
  });

  it('une création refusée pour une autre raison (doublon) ne consomme rien', async () => {
    const [key] = await createAgent('agent-a');
    await agentPost(key!, '/api/agent/prospects', prospectBody('@meme')).expect(201);
    const dup = await agentPost(key!, '/api/agent/prospects', prospectBody('@meme'));
    expect(dup.body.error.code).toBe('ALREADY_EXISTS');
    expect((await prisma.agentQuotaUsage.findFirstOrThrow()).used).toBe(1);
  });

  it('une requête déjà traitée reste rejouable une fois le quota atteint, sans consommer', async () => {
    const [key] = await createAgent('agent-a');
    const idem = `cle-${randomUUID()}`;
    await agentPost(key!, '/api/agent/prospects', prospectBody('@premier'), idem).expect(201);
    for (let i = 1; i < 10; i++) {
      await agentPost(key!, '/api/agent/prospects', prospectBody(`@suite${i}`)).expect(201);
    }
    const replay = await agentPost(key!, '/api/agent/prospects', prospectBody('@premier'), idem);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await prisma.agentQuotaUsage.findFirstOrThrow()).used).toBe(10);
  });

  it('repart de zéro à minuit, heure de Paris', async () => {
    const [key] = await createAgent('agent-a');
    now = new Date('2026-11-06T22:59:00.000Z'); // 23 h 59 à Paris
    for (let i = 0; i < 10; i++) {
      await agentPost(key!, '/api/agent/prospects', prospectBody(`@veille${i}`)).expect(201);
    }
    const refused = await agentPost(key!, '/api/agent/prospects', prospectBody('@refuse'));
    expect(refused.status).toBe(429);
    expect(refused.body.error.details.resetsAt).toBe('2026-11-06T23:00:00.000Z');
    now = new Date('2026-11-06T23:00:30.000Z'); // 0 h 00 à Paris, le 7
    await agentPost(key!, '/api/agent/prospects', prospectBody('@lendemain')).expect(201);
  });

  it('les opérations de l’utilisateur et du système ne sont pas comptées', async () => {
    for (let i = 0; i < 12; i++) {
      await prospects.createProspect(prospectBody(`@humain${i}`), agentActor('agent-service'));
    }
    expect(await prisma.agentQuotaUsage.count()).toBe(0);
  });
});

describe('quotas globaux d’enrichissement (200) et de production (100)', () => {
  it('enrichissements : exactement 200 par jour, tous agents confondus, même en simultané', async () => {
    const keys = [...(await createAgent('agent-a')), ...(await createAgent('agent-b'))];
    const d = await prospects.createProspect(prospectBody('@enrichi'), agentActor('agent-a'));
    const path = `/api/agent/prospects/${d.prospect.id}`;
    const results = await waves(210, 15, (i) =>
      agentPatch(keys[i % 2]!, path, { description: `Description ${i}` }),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(200);
    expect(results.filter((r) => r.status === 429)).toHaveLength(10);
    expect(results.every((r) => r.status === 200 || r.body.error.code === 'QUOTA_EXCEEDED')).toBe(
      true,
    );
    expect(await prisma.prospectEvent.count({ where: { type: 'prospect_enriched' } })).toBe(200);
  }, 120_000);

  it('productions : exactement 100 par jour, tous agents confondus, même en simultané', async () => {
    const keys = [...(await createAgent('agent-a')), ...(await createAgent('agent-b'))];
    // Dossier amené à l'étape doublage (décision humaine comprise).
    const agent = agentActor('agent-a');
    let d = await prospects.createProspect(prospectBody('@produit'), agent);
    await prospects.advanceStage(d.prospect.id, { to: 'analysis' }, agent);
    d = await prospects.advanceStage(d.prospect.id, { to: 'review' }, agent);
    const review = d.missions.find((m) => m.room === 'director')!;
    await missions.applyAction(review.id, { action: 'start' }, agent);
    await missions.applyAction(review.id, { action: 'submit_for_validation' }, agent);
    await prospects.decideProspect(
      d.prospect.id,
      { missionId: review.id, decision: 'approve' },
      HUMAN_ACTOR,
    );

    const dubbing = (i: number) => ({
      kind: 'dubbing',
      status: 'draft',
      title: `Essai ${i}`,
      content: {
        sourceLanguage: 'Français',
        targetLanguage: 'Anglais',
        voice: 'Simulée',
        tool: 'Simulé',
        generationStatus: 'not_started',
      },
    });
    const results = await waves(108, 12, (i) =>
      agentPost(keys[i % 2]!, `/api/agent/prospects/${d.prospect.id}/productions`, dubbing(i)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(100);
    expect(results.filter((r) => r.status === 429)).toHaveLength(8);
    expect(await prisma.prospectProduction.count()).toBe(100);
  }, 120_000);

  it('l’état des quotas est consultable par les agents et par l’utilisateur', async () => {
    const [key] = await createAgent('agent-a');
    await agentPost(key!, '/api/agent/prospects', prospectBody('@etat')).expect(201);
    const forAgent = agentQuotaStatusSchema.parse(
      (
        await request(app)
          .get('/api/agent/quotas')
          .set('Authorization', `Bearer ${key}`)
          .expect(200)
      ).body,
    );
    expect(forAgent.quotas.find((q) => q.action === 'prospect_create')).toMatchObject({
      limit: 10,
      used: 1,
      remaining: 9,
    });
    const forOwner = agentQuotaStatusSchema.parse(
      (await owner.get('/api/agents/quotas').expect(200)).body,
    );
    expect(forOwner).toEqual(forAgent);
    // Réservé à l'utilisateur : la vue « gestion des agents ».
    expect(
      (await request(app).get('/api/agents/quotas').set('Authorization', `Bearer ${key}`)).status,
    ).toBe(403);
  });
});

describe('débit et taille des requêtes', () => {
  it('limite le débit par agent, sans pénaliser les autres', async () => {
    app = makeApp({ perMinute: 5 });
    owner = await ownerClient(app, prisma);
    const [a] = await createAgent('agent-a');
    const [b] = await createAgent('agent-b');
    const get = (key: string) =>
      request(app).get('/api/agent/quotas').set('Authorization', `Bearer ${key}`);
    for (let i = 0; i < 5; i++) await get(a!).expect(200);
    const limited = await get(a!);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await get(b!).expect(200);
    now = new Date(now.getTime() + 61_000);
    await get(a!).expect(200);
  });

  it('refuse un corps de requête trop volumineux pour un agent (413), pas pour l’utilisateur', async () => {
    const [key] = await createAgent('agent-a');
    const big = { ...prospectBody('@gros'), description: 'x'.repeat(300_000) };
    const res = await agentPost(key!, '/api/agent/prospects', big);
    expect(res.status).toBe(413);
    expect(await prisma.prospect.count()).toBe(0);
  });
});

describe('arrêt d’urgence', () => {
  const agentRoutes = (key: string, prospectId: string, missionId: string) => [
    request(app).get('/api/agents/me').set('Authorization', `Bearer ${key}`),
    request(app).get('/api/agent/quotas').set('Authorization', `Bearer ${key}`),
    request(app).get('/api/agent/missions').set('Authorization', `Bearer ${key}`),
    request(app)
      .get(`/api/agent/prospects/${prospectId}/context`)
      .set('Authorization', `Bearer ${key}`),
    agentPost(key, '/api/agent/prospects', prospectBody('@bloque')),
    agentPatch(key, `/api/agent/prospects/${prospectId}`, { country: 'France' }),
    agentPost(key, `/api/agent/prospects/${prospectId}/events`, { title: 'Activité' }),
    agentPost(key, `/api/agent/missions/${missionId}/transitions`, { action: 'start' }),
  ];

  it('AGENTS_ENABLED=false : toutes les opérations des agents sont refusées, l’utilisateur garde l’accès', async () => {
    const [key] = await createAgent('agent-a');
    const d = await prospects.createProspect(prospectBody('@arret'), agentActor('agent-a'));
    app = makeApp({ envEnabled: false });
    owner = await ownerClient(app, prisma);
    const before = await snapshot();
    const lastUsed = (await prisma.agentApiKey.findFirstOrThrow()).lastUsedAt;

    for (const res of await Promise.all(agentRoutes(key!, d.prospect.id, d.missions[0]!.id))) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AGENTS_DISABLED');
    }
    // Même une clé mal placée ou inconnue est arrêtée d'emblée ; la clé n'est même pas lue en base.
    expect((await request(app).get('/api/agent/quotas').set('X-Api-Key', key!)).status).toBe(503);
    expect(
      (await request(app).get('/api/agent/quotas').set('Authorization', 'Bearer inconnue')).status,
    ).toBe(503);
    expect(await snapshot()).toEqual(before);
    expect((await prisma.agentApiKey.findFirstOrThrow()).lastUsedAt).toEqual(lastUsed);

    // L'utilisateur, lui, travaille normalement.
    await owner.get('/api/prospects').expect(200);
    await owner.get(`/api/prospects/${d.prospect.id}/dossier`).expect(200);
    await owner
      .post(`/api/prospects/${d.prospect.id}/notes`)
      .send({ text: 'Toujours là' })
      .expect(200);
    await request(app).get('/api/health').expect(200);

    // L'interrupteur de l'interface ne peut pas lever un arrêt imposé par .env.
    const status = agentsSwitchStatusSchema.parse(
      (await owner.post('/api/agents/emergency-stop').send({ enabled: true }).expect(200)).body,
    );
    expect(status).toMatchObject({ enabled: false, envEnabled: false, switchEnabled: true });
    expect(
      (await request(app).get('/api/agents/me').set('Authorization', `Bearer ${key}`)).status,
    ).toBe(503);
  });

  it('interrupteur de l’utilisateur : effet immédiat, conservé après un redémarrage', async () => {
    const [key] = await createAgent('agent-a');
    const me = () => request(app).get('/api/agents/me').set('Authorization', `Bearer ${key}`);
    await me().expect(200);

    const stopped = agentsSwitchStatusSchema.parse(
      (await owner.post('/api/agents/emergency-stop').send({ enabled: false }).expect(200)).body,
    );
    expect(stopped).toMatchObject({ enabled: false, envEnabled: true, switchEnabled: false });
    expect((await me()).status).toBe(503);

    // Redémarrage : un nouveau serveur relit l'état enregistré et reste arrêté.
    app = makeApp();
    await control.load();
    expect(control.isEnabled()).toBe(false);
    owner = await ownerClient(app, prisma);
    expect((await me()).status).toBe(503);

    await owner.post('/api/agents/emergency-stop').send({ enabled: true }).expect(200);
    await me().expect(200);
  });

  it('un agent ne peut ni lever ni déclencher l’arrêt d’urgence', async () => {
    const [key] = await createAgent('agent-a');
    for (const enabled of [true, false]) {
      const res = await request(app)
        .post('/api/agents/emergency-stop')
        .set('Authorization', `Bearer ${key}`)
        .send({ enabled });
      expect(res.status).toBe(403);
    }
    expect(control.status()).toMatchObject({ enabled: true, switchEnabled: true });
  });

  it('une écriture déjà en cours au moment de l’arrêt n’écrit rien', async () => {
    await createAgent('agent-a');
    const run = idempotency.run(
      {
        agentId: 'agent-a',
        key: `cle-${randomUUID()}`,
        method: 'POST',
        path: '/api/agent/prospects',
        body: {},
        status: 201,
        beforeWrite: async () => control.assertEnabled(),
      },
      async (hook) => {
        // La requête a passé l'entrée du serveur ; l'utilisateur déclenche l'arrêt maintenant.
        await control.setEnabled(false);
        await prospects.createProspect(prospectBody('@encours'), agentActor('agent-a'), { hook });
      },
      async () => null,
    );
    await expect(run).rejects.toMatchObject({ code: 'AGENTS_DISABLED' });
    expect(await prisma.prospect.count()).toBe(0);
    expect(await prisma.agentRequest.count()).toBe(0);
  });

  it('sans contrôle d’arrêt configuré, les agents sont refusés par défaut', async () => {
    const [key] = await createAgent('agent-a');
    const bare = createApp({
      owner: createOwnerAuthService({ prisma }),
      db: createDatabaseProbe(prisma),
      missions,
      prospects,
      agents: createAgentService({ prisma }),
      idempotency,
      version: 'test',
      simulationMode: true,
    });
    const res = await request(bare).get('/api/agents/me').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(503);
  });
});
