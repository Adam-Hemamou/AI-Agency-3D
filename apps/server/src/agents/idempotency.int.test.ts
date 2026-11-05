import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSIONS,
  issuedAgentKeyResponseSchema,
  missionCommandResponseSchema,
  agentDossierSchema,
} from '@agency/shared';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { createTestPrisma, resetDatabase, testDatabaseUrl } from '../test/testDb.ts';
import { createAgentService } from './agentService.ts';
import { createIdempotencyStore, requestFingerprint } from './idempotency.ts';

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const store = createIdempotencyStore(prisma);
const app = createApp({
  ...testAgentLimits(prisma),
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects,
  agents: createAgentService({ prisma }),
  idempotency: store,
  version: 'test',
  simulationMode: true,
});

const AGENT_ID = 'agent-prospecteur';
let owner: OwnerClient;
let apiKey: string;

/** Corps identique à celui du processus interrompu (src/test/fixtures/interruptedWrite.ts). */
const INTERRUPTED_BODY = {
  creatorName: 'Interrompu',
  channelName: 'Interrompu',
  channelHandle: '@interrompu',
  discovery: {
    source: 'Test',
    reason: 'Interruption',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
};

const body = (handle: string) => ({ ...INTERRUPTED_BODY, channelHandle: handle });

function agentCall(method: 'post' | 'patch', path: string, payload: unknown, key: string) {
  const client = request(app);
  return client[method](path)
    .set('Authorization', `Bearer ${apiKey}`)
    .set('Idempotency-Key', key)
    .send(payload as object);
}

beforeEach(async () => {
  await resetDatabase();
  owner = await ownerClient(app, prisma);
  await owner
    .post('/api/agents')
    .send({ id: AGENT_ID, name: 'Prospecteur', permissions: AGENT_PERMISSIONS })
    .expect(201);
  const issued = await owner.post(`/api/agents/${AGENT_ID}/keys`).send({}).expect(201);
  apiKey = issuedAgentKeyResponseSchema.parse(issued.body).apiKey;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Interruption réelle d'un processus serveur
// ---------------------------------------------------------------------------

const FIXTURE = fileURLToPath(new URL('../test/fixtures/interruptedWrite.ts', import.meta.url));
const children: ChildProcess[] = [];

afterEach(() => {
  // Uniquement les processus lancés par ce test, par leur poignée.
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill();
});

/** Lance le processus interrompu et attend qu'il soit au point d'interruption. */
function startInterrupted(key: string, mode: 'before-commit' | 'after-commit') {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', FIXTURE, testDatabaseUrl(), AGENT_ID, key, mode],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
  return new Promise<ChildProcess>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`processus muet : ${stderr}`)), 30_000);
    child.stdout!.on('data', (chunk) => {
      if (String(chunk).includes('PRET')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`processus terminé trop tôt (${code}) : ${stderr}`));
    });
  });
}

/** Arrêt brutal (équivalent d'un plantage), puis attente de la fin effective du processus. */
async function crash(child: ChildProcess) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

describe('interruption du serveur pendant une écriture', () => {
  it('arrêt AVANT la validation : rien n’est enregistré, la répétition exécute la requête', async () => {
    const key = `n8n-${randomUUID()}`;
    const child = await startInterrupted(key, 'before-commit');
    await crash(child);

    const res = await agentCall('post', '/api/agent/prospects', INTERRUPTED_BODY, key);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await prisma.prospect.count()).toBe(1);
    expect(await prisma.agentRequest.count()).toBe(1);
  }, 60_000);

  it('arrêt APRÈS la validation, avant la réponse : la répétition renvoie le résultat sans refaire', async () => {
    const key = `n8n-${randomUUID()}`;
    const child = await startInterrupted(key, 'after-commit');
    await crash(child);
    expect(await prisma.prospect.count()).toBe(1);

    const res = await agentCall('post', '/api/agent/prospects', INTERRUPTED_BODY, key);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(agentDossierSchema.parse(res.body).prospect.channelHandle).toBe('@interrompu');
    expect(await prisma.prospect.count()).toBe(1);
  }, 60_000);
});

describe('panne pendant la construction de la réponse (même processus)', () => {
  it('l’écriture et sa clé sont validées ensemble : la répétition renvoie le résultat', async () => {
    const key = `n8n-${randomUUID()}`;
    const run = (render: () => Promise<unknown>) =>
      store.run(
        {
          agentId: AGENT_ID,
          key,
          method: 'POST',
          path: '/api/agent/prospects',
          body: INTERRUPTED_BODY,
          status: 201,
        },
        (hook) =>
          prospects.createProspect(INTERRUPTED_BODY, { type: 'agent', id: AGENT_ID }, { hook }),
        render,
      );
    await expect(
      run(async () => {
        throw new Error('base injoignable au moment de répondre');
      }),
    ).rejects.toThrow('base injoignable');
    const replay = await run(async () => 'réponse');
    expect(replay).toEqual({ status: 201, body: 'réponse', replayed: true });
    expect(await prisma.prospect.count()).toBe(1);
  });

  it('échec dans la transaction : la clé reste libre et rien n’est écrit', async () => {
    const key = `n8n-${randomUUID()}`;
    const d = await prospects.createProspect(body('@cible'), { type: 'agent', id: AGENT_ID });
    const stage = { to: 'review' }; // interdit depuis « prospection »
    const bad = await agentCall('post', `/api/agent/prospects/${d.prospect.id}/stage`, stage, key);
    expect(bad.status).toBe(403); // un agent ne fait pas passer « prospection » → « à valider »
    expect(await prisma.agentRequest.count()).toBe(0);
    // Même clé, même requête, situation corrigée : exécutée cette fois.
    await prospects.moveToStage(d.prospect.id, 'analysis', { type: 'system', id: null });
    const ok = await agentCall('post', `/api/agent/prospects/${d.prospect.id}/stage`, stage, key);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(agentDossierSchema.parse(ok.body).prospect.stage).toBe('review');
  });
});

describe('requêtes simultanées', () => {
  it('5 répétitions simultanées : une seule exécution, toutes reçoivent la même réponse', async () => {
    const key = `n8n-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        agentCall('post', '/api/agent/prospects', body('@meme'), key),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
    expect(new Set(results.map((r) => r.body.prospect.id)).size).toBe(1);
    expect(await prisma.prospect.count()).toBe(1);
    expect(await prisma.agentRequest.count()).toBe(1);
  });

  it('même clé, contenus différents, en même temps : un seul est exécuté, les autres refusés', async () => {
    const key = `n8n-${randomUUID()}`;
    const results = await Promise.all(
      ['@un', '@deux', '@trois'].map((h) =>
        agentCall('post', '/api/agent/prospects', body(h), key),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await prisma.prospect.count()).toBe(1);
  });

  it('créations simultanées de la même chaîne, clés différentes : un seul dossier (anti-doublon du lot B)', async () => {
    for (let round = 0; round < 3; round++) {
      const handle = `@chaine-${round}`;
      const results = await Promise.all([
        ...['A', 'B', 'C'].map((k) =>
          agentCall('post', '/api/agent/prospects', body(handle), `cle-${k}-${randomUUID()}`),
        ),
        ...[1, 2, 3].map((n) =>
          agentCall(
            'post',
            '/api/agent/prospects',
            body(`@autre-${round}-${n}`),
            `autre-${randomUUID()}`,
          ),
        ),
      ]);
      const same = results
        .slice(0, 3)
        .map((r) => r.status)
        .sort();
      expect(same, JSON.stringify(results.map((r) => r.body.error?.code))).toEqual([201, 409, 409]);
      expect(
        results
          .slice(0, 3)
          .filter((r) => r.status === 409)
          .map((r) => r.body.error.code),
      ).toEqual(['ALREADY_EXISTS', 'ALREADY_EXISTS']);
      expect(results.slice(3).map((r) => r.status)).toEqual([201, 201, 201]);
    }
  });

  it('clés différentes en même temps sur le même dossier : chacune est exécutée une fois', async () => {
    const d = await prospects.createProspect(body('@base'), { type: 'agent', id: AGENT_ID });
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        agentCall(
          'post',
          `/api/agent/prospects/${d.prospect.id}/events`,
          { title: `Activité ${i}` },
          `cle-${i}-${randomUUID()}`,
        ),
      ),
    );
    expect(
      results.map((r) => r.status),
      JSON.stringify(results.map((r) => r.body.error)),
    ).toEqual([201, 201, 201, 201]);
    const events = await prisma.prospectEvent.count({ where: { type: 'agent_activity' } });
    expect(events).toBe(4);
  });
});

describe('répétitions', () => {
  it('renvoie l’état ACTUEL de la ressource écrite', async () => {
    const createKey = `n8n-${randomUUID()}`;
    const created = await agentCall('post', '/api/agent/prospects', body('@etat'), createKey);
    const id = created.body.prospect.id;
    await agentCall(
      'patch',
      `/api/agent/prospects/${id}`,
      { country: 'France' },
      `n8n-${randomUUID()}`,
    ).expect(200);
    const replay = await agentCall('post', '/api/agent/prospects', body('@etat'), createKey);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.prospect.country).toBe('France');
  });

  it('transition de mission : même événement renvoyé, aucun second démarrage', async () => {
    const d = await prospects.createProspect(body('@mission'), { type: 'agent', id: AGENT_ID });
    const missionId = d.missions[0]!.id;
    const key = `n8n-${randomUUID()}`;
    const path = `/api/agent/missions/${missionId}/transitions`;
    const first = missionCommandResponseSchema.parse(
      (await agentCall('post', path, { action: 'start' }, key).expect(200)).body,
    );
    const again = await agentCall('post', path, { action: 'start' }, key).expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(missionCommandResponseSchema.parse(again.body).event.id).toBe(first.event.id);
    expect((await missions.get(missionId)).attemptCount).toBe(1);
  });

  it('n’enregistre plus la réponse complète : seulement la ressource écrite', async () => {
    const key = `n8n-${randomUUID()}`;
    const res = await agentCall('post', '/api/agent/prospects', body('@trace'), key).expect(201);
    expect(await prisma.agentRequest.findMany()).toMatchObject([
      {
        agentId: AGENT_ID,
        idempotencyKey: key,
        status: 'completed',
        responseStatus: 201,
        responseBody: null,
        resourceType: 'prospect',
        resourceId: res.body.prospect.id,
      },
    ]);
  });
});

describe('requêtes enregistrées avant le lot C', () => {
  const legacy = (key: string, data: Record<string, unknown>, payload = body('@ancien')) =>
    prisma.agentRequest.create({
      data: {
        agentId: AGENT_ID,
        idempotencyKey: key,
        requestHash: requestFingerprint('POST', '/api/agent/prospects', payload),
        method: 'POST',
        path: '/api/agent/prospects',
        createdAt: new Date(),
        status: 'processing',
        ...data,
      },
    });

  it('une requête restée « en cours » est signalée clairement, sans être exécutée', async () => {
    await legacy('ancienne-cle-1', {});
    const res = await agentCall('post', '/api/agent/prospects', body('@ancien'), 'ancienne-cle-1');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('nouvelle clé');
    expect(await prisma.prospect.count()).toBe(0);
  });

  it('une requête terminée avec sa réponse complète est encore rejouée', async () => {
    await legacy('ancienne-cle-2', {
      status: 'completed',
      responseStatus: 201,
      responseBody: { ok: true },
    });
    const res = await agentCall('post', '/api/agent/prospects', body('@ancien'), 'ancienne-cle-2');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(await prisma.prospect.count()).toBe(0);
  });
});
