import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_DEFAULTS,
  AGENT_PERMISSIONS,
  AGENT_PROMPT_MAX_LENGTH,
  agentProfileSchema,
  agentPromptListResponseSchema,
  agentPromptSchema,
  agentSelfProfileResponseSchema,
  issuedAgentKeyResponseSchema,
  unicodeLength,
  type AgentPermission,
  type RoomId,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { agentActor, HUMAN_ACTOR } from '../auth/actors.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/** Profils IA et prompts versionnés, contre la base de test (ai_agency_test). */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const profiles = createAgentProfileService({ prisma });
const app = createApp({
  ...testAgentLimits(prisma),
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: true }),
  agents: createAgentService({ prisma }),
  profiles,
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
  permissions: readonly AgentPermission[] = [],
  room: RoomId | null = null,
): Promise<TestAgent> {
  await owner
    .post('/api/agents')
    .send({ id, name: `Agent ${id}`, room, permissions })
    .expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  return { id, key: issuedAgentKeyResponseSchema.parse(issued.body).apiKey };
}

const asAgent = (agent: TestAgent) => ({ Authorization: `Bearer ${agent.key}` });
const selfProfile = async (agent: TestAgent, path = '/api/agent/profile') =>
  agentSelfProfileResponseSchema.parse(
    (await request(app).get(path).set(asAgent(agent)).expect(200)).body,
  );

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

beforeEach(async () => {
  await resetDatabase();
  owner = await ownerClient(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('profil IA (utilisateur)', () => {
  it('sans profil enregistré : valeurs par défaut de Qwen3:8b', async () => {
    await createAgent('agent-analyste');
    const profile = agentProfileSchema.parse(
      (await owner.get('/api/agents/agent-analyste/profile').expect(200)).body,
    );
    expect(profile).toEqual({
      agentId: 'agent-analyste',
      role: null,
      settings: { ...AGENT_MODEL_DEFAULTS },
      activePromptVersion: null,
      isDefault: true,
      updatedAt: null,
      updatedBy: null,
    });
    expect(await prisma.agentProfile.count()).toBe(0); // lire ne crée rien
  });

  it('modification partielle : seuls les champs fournis changent', async () => {
    await createAgent('agent-analyste');
    let res = await owner
      .patch('/api/agents/agent-analyste/profile')
      .send({ temperature: 0.5, role: 'analyst' })
      .expect(200);
    expect(agentProfileSchema.parse(res.body)).toMatchObject({
      role: 'analyst',
      isDefault: false,
      updatedBy: 'owner',
      settings: { ...AGENT_MODEL_DEFAULTS, temperature: 0.5 },
    });
    res = await owner
      .patch('/api/agents/agent-analyste/profile')
      .send({ numCtx: 16384 })
      .expect(200);
    expect(agentProfileSchema.parse(res.body).settings).toEqual({
      ...AGENT_MODEL_DEFAULTS,
      temperature: 0.5,
      numCtx: 16384,
    });
    res = await owner.patch('/api/agents/agent-analyste/profile').send({ role: null }).expect(200);
    expect(res.body.role).toBeNull();
  });

  it('refuse les valeurs hors bornes, les champs inconnus et un agent inexistant', async () => {
    await createAgent('agent-analyste');
    for (const body of [
      { temperature: 3 },
      { numCtx: 1024 },
      { model: 'qwen3:8b; rm -rf /' },
      { activePromptVersion: 1 },
      {},
    ]) {
      expectError(
        await owner.patch('/api/agents/agent-analyste/profile').send(body),
        400,
        'VALIDATION_ERROR',
      );
    }
    expect(await prisma.agentProfile.count()).toBe(0);
    expectError(
      await owner.patch('/api/agents/agent-inconnu/profile').send({ temperature: 0.4 }),
      404,
      'NOT_FOUND',
    );
    expectError(await owner.get('/api/agents/agent-inconnu/profile'), 404, 'NOT_FOUND');
  });
});

describe('prompts versionnés (utilisateur)', () => {
  it('crée des versions numérotées ; seule une version activée est utilisée', async () => {
    await createAgent('agent-analyste');
    const v1 = agentPromptSchema.parse(
      (
        await owner
          .post('/api/agents/agent-analyste/prompts')
          .send({ systemPrompt: 'Version 1', note: 'Premier essai' })
          .expect(201)
      ).body,
    );
    expect(v1).toMatchObject({
      version: 1,
      active: false,
      note: 'Premier essai',
      createdBy: 'owner',
    });
    expect(
      (await owner.get('/api/agents/agent-analyste/profile')).body.activePromptVersion,
    ).toBeNull();

    const v2 = agentPromptSchema.parse(
      (
        await owner
          .post('/api/agents/agent-analyste/prompts')
          .send({ systemPrompt: 'Version 2', activate: true })
          .expect(201)
      ).body,
    );
    expect(v2).toMatchObject({ version: 2, active: true });

    const list = agentPromptListResponseSchema.parse(
      (await owner.get('/api/agents/agent-analyste/prompts').expect(200)).body,
    );
    expect(list.items.map((p) => [p.version, p.active, p.systemPrompt])).toEqual([
      [2, true, 'Version 2'],
      [1, false, 'Version 1'],
    ]);
    expect(
      (await owner.get('/api/agents/agent-analyste/prompts/1').expect(200)).body,
    ).toMatchObject({ version: 1, systemPrompt: 'Version 1', active: false });
  });

  it('retour arrière : une ancienne version peut être réactivée, sans rien perdre', async () => {
    await createAgent('agent-analyste');
    for (const systemPrompt of ['Version 1', 'Version 2']) {
      await owner
        .post('/api/agents/agent-analyste/prompts')
        .send({ systemPrompt, activate: true })
        .expect(201);
    }
    const profile = agentProfileSchema.parse(
      (await owner.post('/api/agents/agent-analyste/prompts/1/activate').expect(200)).body,
    );
    expect(profile.activePromptVersion).toBe(1);
    const list = agentPromptListResponseSchema.parse(
      (await owner.get('/api/agents/agent-analyste/prompts')).body,
    );
    expect(list.items.map((p) => [p.version, p.active])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it('refuse une version inexistante ou invalide', async () => {
    await createAgent('agent-analyste');
    expectError(await owner.get('/api/agents/agent-analyste/prompts/1'), 404, 'NOT_FOUND');
    expectError(
      await owner.post('/api/agents/agent-analyste/prompts/7/activate'),
      404,
      'NOT_FOUND',
    );
    expectError(await owner.get('/api/agents/agent-analyste/prompts/0'), 400, 'VALIDATION_ERROR');
    expectError(
      await owner.post('/api/agents/agent-analyste/prompts/abc/activate'),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await owner.post('/api/agents/agent-inconnu/prompts').send({ systemPrompt: 'x' }),
      404,
      'NOT_FOUND',
    );
    expect(await prisma.agentPrompt.count()).toBe(0);
  });

  it('les versions sont propres à chaque agent', async () => {
    await createAgent('agent-a');
    await createAgent('agent-b');
    await owner.post('/api/agents/agent-a/prompts').send({ systemPrompt: 'A1' }).expect(201);
    await owner.post('/api/agents/agent-a/prompts').send({ systemPrompt: 'A2' }).expect(201);
    const b1 = await owner.post('/api/agents/agent-b/prompts').send({ systemPrompt: 'B1' });
    expect(b1.body.version).toBe(1);
    // Impossible d'activer chez B une version qui n'existe que chez A.
    expectError(await owner.post('/api/agents/agent-b/prompts/2/activate'), 404, 'NOT_FOUND');
    const listB = agentPromptListResponseSchema.parse(
      (await owner.get('/api/agents/agent-b/prompts')).body,
    );
    expect(listB.items.map((p) => p.systemPrompt)).toEqual(['B1']);
  });

  it('créations simultanées : numéros consécutifs, sans doublon ni trou', async () => {
    await createAgent('agent-analyste');
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        owner.post('/api/agents/agent-analyste/prompts').send({ systemPrompt: `Version ${i}` }),
      ),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const versions = responses.map((r) => r.body.version as number).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('protections en base', () => {
  async function seedPrompt() {
    await createAgent('agent-analyste');
    await owner
      .post('/api/agents/agent-analyste/prompts')
      .send({ systemPrompt: 'Original', activate: true })
      .expect(201);
  }

  it('une version de prompt ne peut être ni modifiée ni supprimée, même en SQL', async () => {
    await seedPrompt();
    const where = { agentId_version: { agentId: 'agent-analyste', version: 1 } };
    await expect(
      prisma.agentPrompt.update({ where, data: { systemPrompt: 'Falsifié' } }),
    ).rejects.toThrow(/ajout seul/);
    await expect(
      prisma.$executeRaw`UPDATE agent_prompts SET note = 'x' WHERE agent_id = 'agent-analyste'`,
    ).rejects.toThrow(/ajout seul/);
    await expect(
      prisma.$executeRaw`DELETE FROM agent_prompts WHERE agent_id = 'agent-analyste'`,
    ).rejects.toThrow(/ajout seul/);
    expect((await prisma.agentPrompt.findUniqueOrThrow({ where })).systemPrompt).toBe('Original');
  });

  it('la version active existe forcément, pour le même agent', async () => {
    await seedPrompt();
    await expect(
      prisma.agentProfile.update({
        where: { agentId: 'agent-analyste' },
        data: { activePromptVersion: 99 },
      }),
    ).rejects.toThrow();
  });

  it('les paramètres hors bornes sont refusés par la base', async () => {
    await seedPrompt();
    for (const data of [{ temperature: 5 }, { numCtx: 100 }, { timeoutSeconds: 0 }]) {
      await expect(
        prisma.agentProfile.update({ where: { agentId: 'agent-analyste' }, data }),
      ).rejects.toThrow();
    }
  });

  it('le service refuse toute écriture qui ne vient pas de l’utilisateur', async () => {
    await createAgent('agent-analyste');
    const agent = agentActor('agent-analyste');
    for (const attempt of [
      profiles.updateProfile('agent-analyste', { temperature: 1 }, agent),
      profiles.createPrompt(
        'agent-analyste',
        { systemPrompt: 'x', note: null, activate: true },
        agent,
      ),
      profiles.activatePrompt('agent-analyste', 1, { type: 'system', id: null }),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: 'FORBIDDEN_ACTOR' });
    }
    expect(await prisma.agentPrompt.count()).toBe(0);
    expect(await prisma.agentProfile.count()).toBe(0);
    // L'utilisateur, lui, peut (contrôle du test).
    await profiles.updateProfile('agent-analyste', { temperature: 1 }, HUMAN_ACTOR);
  });
});

describe('GET /api/agent/profile (agent authentifié)', () => {
  it('renvoie son rôle, ses paramètres et son prompt actif', async () => {
    const analyst = await createAgent('agent-analyste', [], 'analysis');
    await owner
      .patch('/api/agents/agent-analyste/profile')
      .send({ role: 'analyst', temperature: 0.4 })
      .expect(200);
    await owner
      .post('/api/agents/agent-analyste/prompts')
      .send({ systemPrompt: 'Tu es l’analyste.', activate: true })
      .expect(201);
    await owner
      .post('/api/agents/agent-analyste/prompts')
      .send({ systemPrompt: 'Brouillon non activé' })
      .expect(201);

    const profile = await selfProfile(analyst);
    expect(profile).toEqual({
      agent: {
        id: 'agent-analyste',
        name: 'Agent agent-analyste',
        room: 'analysis',
        role: 'analyst',
      },
      settings: { ...AGENT_MODEL_DEFAULTS, temperature: 0.4 },
      prompt: { version: 1, systemPrompt: 'Tu es l’analyste.', createdAt: expect.any(String) },
    });
  });

  it('sans profil ni prompt : valeurs par défaut et prompt null', async () => {
    const agent = await createAgent('agent-neuf');
    expect(await selfProfile(agent)).toMatchObject({
      agent: { id: 'agent-neuf', role: null },
      settings: { ...AGENT_MODEL_DEFAULTS },
      prompt: null,
    });
  });

  it('chaque agent ne lit que le sien, quelle que soit la requête', async () => {
    const a = await createAgent('agent-a', AGENT_PERMISSIONS);
    const b = await createAgent('agent-b');
    await owner
      .post('/api/agents/agent-a/prompts')
      .send({ systemPrompt: 'Secret de A', activate: true })
      .expect(201);

    for (const path of [
      '/api/agent/profile',
      '/api/agent/profile?agentId=agent-a',
      '/api/agent/profile?id=agent-a',
    ]) {
      const profile = await selfProfile(b, path);
      expect(profile.agent.id).toBe('agent-b');
      expect(profile.prompt).toBeNull();
    }
    expect((await selfProfile(a)).prompt?.systemPrompt).toBe('Secret de A');
  });

  it('aucune permission n’est exigée pour lire son profil', async () => {
    const agent = await createAgent('agent-sans-droit', []);
    await selfProfile(agent);
  });

  it('refusé sans clé, avec une clé révoquée et pour l’utilisateur humain', async () => {
    const agent = await createAgent('agent-analyste');
    expectError(await request(app).get('/api/agent/profile'), 401, 'UNAUTHENTICATED');
    expectError(await owner.get('/api/agent/profile'), 403, 'FORBIDDEN_ACTOR');
    const keys = await prisma.agentApiKey.findMany({ where: { agentId: 'agent-analyste' } });
    await owner.post(`/api/agents/agent-analyste/keys/${keys[0]!.id}/revoke`).expect(200);
    expectError(
      await request(app).get('/api/agent/profile').set(asAgent(agent)),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('un agent ne peut ni lire ni modifier un profil ou un prompt par les routes de gestion', async () => {
    const agent = await createAgent('agent-a', AGENT_PERMISSIONS);
    await createAgent('agent-b');
    const attempts = [
      request(app).get('/api/agents/agent-a/profile'),
      request(app).get('/api/agents/agent-b/profile'),
      request(app).patch('/api/agents/agent-a/profile').send({ temperature: 2 }),
      request(app).get('/api/agents/agent-b/prompts'),
      request(app).get('/api/agents/agent-b/prompts/1'),
      request(app).post('/api/agents/agent-a/prompts').send({ systemPrompt: 'x', activate: true }),
      request(app).post('/api/agents/agent-a/prompts/1/activate'),
    ];
    for (const res of await Promise.all(attempts.map((r) => r.set(asAgent(agent))))) {
      expectError(res, 403, 'FORBIDDEN_ACTOR');
    }
    expect(await prisma.agentProfile.count()).toBe(0);
    expect(await prisma.agentPrompt.count()).toBe(0);
  });
});

describe('capacité de stockage du prompt (caractères Unicode)', () => {
  const MAX = AGENT_PROMPT_MAX_LENGTH;

  it('la colonne est en MEDIUMTEXT utf8mb4 dans la base de test', async () => {
    const [column] = await prisma.$queryRaw<{ db: string; type: string; charset: string }[]>`
      SELECT DATABASE() AS db, COLUMN_TYPE AS type, CHARACTER_SET_NAME AS charset
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_prompts'
        AND COLUMN_NAME = 'system_prompt'`;
    expect(column).toEqual({ db: 'ai_agency_test', type: 'mediumtext', charset: 'utf8mb4' });
  });

  it.each([
    ['emoji, 4 octets', '😀', 4],
    ['idéogrammes, 3 octets', '漢', 3],
    ['accents, 2 octets', 'é', 2],
    ['ASCII, 1 octet', 'a', 1],
  ])('stocke et relit à l’identique 20 000 caractères : %s', async (_label, char, bytes) => {
    const agent = await createAgent('agent-unicode');
    const systemPrompt = char.repeat(MAX);
    await owner
      .post('/api/agents/agent-unicode/prompts')
      .send({ systemPrompt, activate: true })
      .expect(201);

    // Relu par l'API de gestion et par l'agent : identique, caractère pour caractère.
    const stored = await owner.get('/api/agents/agent-unicode/prompts/1').expect(200);
    expect(stored.body.systemPrompt === systemPrompt).toBe(true);
    expect((await selfProfile(agent)).prompt?.systemPrompt === systemPrompt).toBe(true);

    // En base : 20 000 caractères, et la taille attendue en octets (jusqu'à 80 000, > 65 535).
    const [size] = await prisma.$queryRaw<{ chars: bigint; octets: bigint }[]>`
      SELECT CHAR_LENGTH(system_prompt) AS chars, OCTET_LENGTH(system_prompt) AS octets
      FROM agent_prompts WHERE agent_id = 'agent-unicode' AND version = 1`;
    expect(Number(size!.chars)).toBe(MAX);
    expect(Number(size!.octets)).toBe(MAX * bytes);
  });

  it('un mélange de 20 000 caractères (combinaisons comprises) passe intact', async () => {
    await createAgent('agent-unicode');
    // « é » décomposé (e + accent combinant) compte pour 2 caractères, comme dans MySQL.
    const unit = 'aé漢😀e\u0301';
    const systemPrompt = unit.repeat(MAX / 6) + 'abcd'.slice(0, MAX % 6);
    expect(unicodeLength(systemPrompt)).toBe(MAX);
    await owner.post('/api/agents/agent-unicode/prompts').send({ systemPrompt }).expect(201);
    const stored = await prisma.agentPrompt.findUniqueOrThrow({
      where: { agentId_version: { agentId: 'agent-unicode', version: 1 } },
    });
    expect(stored.systemPrompt === systemPrompt).toBe(true);
  });

  it('refuse 20 001 caractères, sans rien enregistrer', async () => {
    await createAgent('agent-unicode');
    for (const char of ['😀', 'é', 'a']) {
      expectError(
        await owner
          .post('/api/agents/agent-unicode/prompts')
          .send({ systemPrompt: char.repeat(MAX + 1) }),
        400,
        'VALIDATION_ERROR',
      );
    }
    expect(await prisma.agentPrompt.count()).toBe(0);
  });
});

describe('vérifications complémentaires', () => {
  it('activer une version ne modifie aucune version enregistrée', async () => {
    await createAgent('agent-analyste');
    for (const systemPrompt of ['Version 1', 'Version 2', 'Version 3']) {
      await owner.post('/api/agents/agent-analyste/prompts').send({ systemPrompt }).expect(201);
    }
    const before = await prisma.agentPrompt.findMany({ orderBy: { version: 'asc' } });
    for (const version of [2, 1, 3, 1, 1]) {
      const res = await owner.post(`/api/agents/agent-analyste/prompts/${version}/activate`);
      expect(res.status).toBe(200);
      expect(res.body.activePromptVersion).toBe(version);
    }
    expect(await prisma.agentPrompt.findMany({ orderBy: { version: 'asc' } })).toEqual(before);
  });

  it('activations simultanées : le profil désigne toujours une version existante', async () => {
    await createAgent('agent-analyste');
    for (const systemPrompt of ['V1', 'V2', 'V3']) {
      await owner.post('/api/agents/agent-analyste/prompts').send({ systemPrompt }).expect(201);
    }
    const responses = await Promise.all(
      [1, 2, 3, 2, 1, 3].map((v) => owner.post(`/api/agents/agent-analyste/prompts/${v}/activate`)),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const profile = await prisma.agentProfile.findUniqueOrThrow({
      where: { agentId: 'agent-analyste' },
    });
    expect([1, 2, 3]).toContain(profile.activePromptVersion);
    expect(await prisma.agentPrompt.count()).toBe(3);
  });

  it('valeurs par défaut pour un agent sans profil, même si un autre agent est personnalisé', async () => {
    await createAgent('agent-a');
    const b = await createAgent('agent-b');
    await owner
      .patch('/api/agents/agent-a/profile')
      .send({ temperature: 1.5, numCtx: 32768, model: 'llama3.1:8b', role: 'sales' })
      .expect(200);
    await owner
      .post('/api/agents/agent-a/prompts')
      .send({ systemPrompt: 'Prompt de A', activate: true })
      .expect(201);
    expect(await selfProfile(b)).toEqual({
      agent: { id: 'agent-b', name: 'Agent agent-b', room: null, role: null },
      settings: { ...AGENT_MODEL_DEFAULTS },
      prompt: null,
    });
    expect(await prisma.agentProfile.count({ where: { agentId: 'agent-b' } })).toBe(0);
  });

  it('GET /api/agent/profile est en lecture seule pour l’agent', async () => {
    const agent = await createAgent('agent-a', AGENT_PERMISSIONS);
    for (const method of ['post', 'patch', 'put', 'delete'] as const) {
      const res = await request(app)[method]('/api/agent/profile').set(asAgent(agent)).send({});
      expectError(res, 403, 'FORBIDDEN_ACTOR');
    }
    expect(await prisma.agentProfile.count()).toBe(0);
  });
});
