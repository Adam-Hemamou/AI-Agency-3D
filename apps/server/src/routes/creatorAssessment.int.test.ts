import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ROLE_PERMISSIONS,
  issuedAgentKeyResponseSchema,
  languageAssessmentSchema,
  type AgentPermission,
} from '@agency/shared';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { assessCreator } from '../language/assessCreator.ts';
import {
  channel,
  comment,
  comments,
  request as youtubeRequest,
  videos,
} from '../language/fixtures.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * POST /api/agent/creators/assess : évaluation linguistique d'un créateur par le moteur du CRM.
 * Calcul seul : aucune écriture en base ; aucun texte de commentaire dans la réponse, les erreurs
 * ou les journaux.
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const limits = testAgentLimits(prisma);
const app = createApp({
  ...limits,
  owner: createOwnerAuthService({ prisma }),
  db: createDatabaseProbe(prisma),
  missions,
  prospects: createProspectService({ prisma, missions, simulationMode: true }),
  agents: createAgentService({ prisma }),
  idempotency: createIdempotencyStore(prisma),
  version: 'test',
  simulationMode: true,
});

const ROUTE = '/api/agent/creators/assess';
/** Marqueur placé dans des commentaires : il ne doit apparaître NULLE PART en sortie. */
const MARKER = 'COMMENTAIRE-CONFIDENTIEL-7f3a';

let owner: OwnerClient;
const keys: Record<string, string> = {};

async function createAgent(id: string, permissions: readonly AgentPermission[]) {
  await owner
    .post('/api/agents')
    .send({ id, name: id, room: 'prospecting', permissions })
    .expect(201);
  const issued = await owner.post(`/api/agents/${id}/keys`).send({}).expect(201);
  keys[id] = issuedAgentKeyResponseSchema.parse(issued.body).apiKey;
}

const assess = (body: unknown, agent = 'agent-prospecteur-fr-en') =>
  request(app)
    .post(ROUTE)
    .set('Authorization', `Bearer ${keys[agent]}`)
    .send(body as object);

/** Créateur francophone : 15 vidéos (échantillon recommandé), commentaires FR et EN. */
function frenchCreator() {
  return youtubeRequest({
    channel: channel({ text: 'fr', defaultLanguage: 'fr', country: 'FR' }),
    videos: videos(15, { text: 'fr', audio: 'fr', captions: true, views: 20_000 }),
    comments: comments({ fr: 30, en: 20 }),
  });
}

/** Empreinte de CHAQUE table de la base de test : toute écriture la modifie. */
async function databaseFingerprint(): Promise<Record<string, string>> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() ORDER BY table_name`;
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ Checksum: bigint | number | null }[]>(
      `CHECKSUM TABLE \`${name}\``,
    );
    result[name] = String(row?.Checksum);
  }
  return result;
}

beforeEach(async () => {
  await resetDatabase();
  await limits.agentControl.load();
  owner = await ownerClient(app, prisma);
  await createAgent('agent-prospecteur-fr-en', AGENT_ROLE_PERMISSIONS.prospector);
  await createAgent(
    'agent-sans-evaluation',
    AGENT_ROLE_PERMISSIONS.prospector.filter((p) => p !== 'creators:assess'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('évaluation linguistique : réponse', () => {
  it('200 : résultat conforme au contrat, identique au moteur, deux directions', async () => {
    const body = frenchCreator();
    const res = await assess(body).expect(200);
    const result = languageAssessmentSchema.parse(res.body);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(assessCreator(body))));
    expect(result.method).toMatchObject({ version: 'lang-v1', status: 'initial' });
    expect(result.directions.map((d) => d.direction)).toEqual(['fr-en', 'en-fr']);
    expect(result.directions[0]).toMatchObject({ eligible: true });
    expect(result.directions[1]).toMatchObject({
      eligible: false,
      ineligibleReason: 'content_language_mismatch',
    });
  });

  it('créateur bilingue : les deux directions sont évaluées indépendamment', async () => {
    const res = await assess(
      youtubeRequest({
        videos: [
          ...videos(8, { text: 'fr', audio: 'fr', views: 10_000 }),
          ...videos(8, { text: 'en', audio: 'en', views: 10_000 }),
        ],
        comments: comments({ fr: 20, en: 20 }),
      }),
    ).expect(200);
    const result = languageAssessmentSchema.parse(res.body);
    expect(result.content.bilingual).toBe(true);
    expect(result.directions.every((d) => d.eligible && d.score !== null)).toBe(true);
  });

  it('champs YouTube supplémentaires ignorés ; aucun en-tête Idempotency-Key exigé', async () => {
    const body = frenchCreator();
    const res = await assess({
      ...body,
      channel: { ...body.channel, kind: 'youtube#channel', etag: 'x', thumbnails: {} },
    }).expect(200);
    expect(res.body.channelId).toBe('UCtestChaineFictive0001');
  });
});

describe('évaluation linguistique : accès', () => {
  it('401 sans clé', async () => {
    const res = await request(app).post(ROUTE).send(frenchCreator());
    expect(res.status).toBe(401);
  });

  it('403 sans la permission creators:assess', async () => {
    const res = await assess(frenchCreator(), 'agent-sans-evaluation');
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual({ requiredPermission: 'creators:assess' });
  });

  it('403 pour l’utilisateur humain : route réservée aux agents', async () => {
    const res = await owner.post(ROUTE).send(frenchCreator());
    expect(res.status).toBe(403);
  });

  it('403 en lecture : seule la méthode POST est ouverte', async () => {
    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${keys['agent-prospecteur-fr-en']}`);
    expect(res.status).toBe(403);
  });

  it('503 pendant l’arrêt d’urgence', async () => {
    await limits.agentControl.setEnabled(false);
    try {
      const res = await assess(frenchCreator());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AGENTS_DISABLED');
    } finally {
      await limits.agentControl.setEnabled(true);
    }
  });
});

describe('évaluation linguistique : erreurs sans fuite de commentaires', () => {
  it('400 : seuls les chemins des champs fautifs, jamais les textes', async () => {
    const tooLong = comment(`${MARKER} `.repeat(400)); // > 10 000 caractères
    const res = await assess({ ...frenchCreator(), comments: [tooLong] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(JSON.stringify(res.body)).toContain('comments.0');
  });

  it('400 : plus de 100 commentaires', async () => {
    const tooMany = Array.from({ length: 101 }, () => comment(`${MARKER} merci beaucoup`));
    const res = await assess({ ...frenchCreator(), comments: tooMany });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it('413 au-delà de 256 Ko, sans recopie du corps', async () => {
    const big = Array.from({ length: 100 }, () => comment(`${MARKER} `.repeat(100)));
    const res = await assess({ ...frenchCreator(), comments: big });
    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it('JSON invalide : 400 sans recopie du corps', async () => {
    const res = await request(app)
      .post(ROUTE)
      .set('Authorization', `Bearer ${keys['agent-prospecteur-fr-en']}`)
      .set('Content-Type', 'application/json')
      .send(`{"comments": ["${MARKER}"`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it('aucun texte de commentaire dans les journaux, quelle que soit l’issue', async () => {
    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(
        args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '),
      );
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    const withMarker = youtubeRequest({
      channel: channel({ text: 'fr' }),
      videos: videos(15, { text: 'fr', audio: 'fr' }),
      comments: [...comments({ fr: 20 }), comment(`${MARKER} merci pour cette recette`)],
    });
    await assess(withMarker).expect(200);
    await assess({ ...withMarker, comments: [comment(`${MARKER} `.repeat(400))] }).expect(400);
    await assess({
      ...withMarker,
      comments: Array.from({ length: 100 }, () => comment(`${MARKER} `.repeat(100))),
    }).expect(413);
    expect(output.join('\n')).not.toContain(MARKER);
  });
});

describe('évaluation linguistique : aucune écriture', () => {
  it('aucune table modifiée (succès, refus et erreurs)', async () => {
    // L'authentification met à jour la date de dernier usage de la clé (au plus une fois par
    // intervalle, comme pour toute route d'agent) : un premier appel la fixe avant la comparaison.
    await request(app)
      .get('/api/agent/capabilities')
      .set('Authorization', `Bearer ${keys['agent-prospecteur-fr-en']}`)
      .expect(200);
    await request(app)
      .get('/api/agent/capabilities')
      .set('Authorization', `Bearer ${keys['agent-sans-evaluation']}`)
      .expect(200);
    const before = await databaseFingerprint();

    await assess(frenchCreator()).expect(200);
    await assess(frenchCreator()).expect(200); // même requête répétée
    await assess({ ...frenchCreator(), comments: [comment('x'.repeat(10_001))] }).expect(400);
    await assess(frenchCreator(), 'agent-sans-evaluation').expect(403);

    expect(await databaseFingerprint()).toEqual(before);

    // Contre-épreuve : une vraie écriture modifie bien l'empreinte.
    await owner.post('/api/agents').send({ id: 'agent-temoin', name: 'Témoin' }).expect(201);
    expect(await databaseFingerprint()).not.toEqual(before);
  });
});
