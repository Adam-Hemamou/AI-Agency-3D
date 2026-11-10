import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_JSON_SCHEMA_NAMES,
  agentCapabilitiesResponseSchema,
  agentJsonSchema,
  agentJsonSchemaListResponseSchema,
  issuedAgentKeyResponseSchema,
} from '@agency/shared';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { createOwnerAuthService } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { ownerClient, type OwnerClient } from '../test/ownerSession.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/** GET /api/agent/capabilities : actions externes permises aux agents (n8n), selon le mode simulation. */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const limits = testAgentLimits(prisma);

function makeApp(simulationMode: boolean) {
  return createApp({
    ...limits,
    owner: createOwnerAuthService({ prisma }),
    db: createDatabaseProbe(prisma),
    missions,
    prospects: createProspectService({ prisma, missions, simulationMode }),
    agents: createAgentService({ prisma }),
    idempotency: createIdempotencyStore(prisma),
    version: 'test',
    simulationMode,
  });
}

let owner: OwnerClient;
let apiKey: string;

beforeEach(async () => {
  await resetDatabase();
  await limits.agentControl.load();
  const app = makeApp(true);
  owner = await ownerClient(app, prisma);
  // Aucune permission : la route est ouverte à tout agent authentifié.
  await owner
    .post('/api/agents')
    .send({ id: 'agent-prospecteur', name: 'Prospecteur' })
    .expect(201);
  const issued = await owner.post('/api/agents/agent-prospecteur/keys').send({}).expect(201);
  apiKey = issuedAgentKeyResponseSchema.parse(issued.body).apiKey;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const capabilities = (simulationMode: boolean) =>
  request(makeApp(simulationMode))
    .get('/api/agent/capabilities')
    .set('Authorization', `Bearer ${apiKey}`);

describe('capacités externes des agents', () => {
  it('mode simulation : lecture YouTube autorisée, dépenses et envois bloqués', async () => {
    const body = agentCapabilitiesResponseSchema.parse((await capabilities(true).expect(200)).body);
    expect(body.simulationMode).toBe(true);
    expect(body.publicDataSources).toEqual(['youtube_data_api']);
    expect(body.externalActions.public_read.allowed).toBe(true);
    expect(body.externalActions.spend).toMatchObject({ allowed: false });
    expect(body.externalActions.send).toMatchObject({ allowed: false });
  });

  it('hors simulation : dépenses et envois restent bloqués', async () => {
    const body = agentCapabilitiesResponseSchema.parse(
      (await capabilities(false).expect(200)).body,
    );
    expect(body.simulationMode).toBe(false);
    expect(body.externalActions.spend.allowed).toBe(false);
    expect(body.externalActions.send.allowed).toBe(false);
  });

  it('réservée aux agents, et soumise à l’arrêt d’urgence', async () => {
    const res = await owner.get('/api/agent/capabilities');
    expect(res.status).toBe(403);
    await limits.agentControl.setEnabled(false);
    const stopped = await capabilities(true);
    expect(stopped.status).toBe(503);
    expect(stopped.body.error.code).toBe('AGENTS_DISABLED');
    await limits.agentControl.setEnabled(true);
  });
});

describe('schémas JSON pour n8n', () => {
  const get = (path: string) =>
    request(makeApp(true)).get(path).set('Authorization', `Bearer ${apiKey}`);

  it('liste les schémas et renvoie chacun, identique à celui produit par le code partagé', async () => {
    const list = agentJsonSchemaListResponseSchema.parse(
      (await get('/api/agent/schemas').expect(200)).body,
    );
    expect(list.items.map((i) => i.name)).toEqual([...AGENT_JSON_SCHEMA_NAMES]);
    for (const { name } of list.items) {
      const res = await get(`/api/agent/schemas/${name}`).expect(200);
      expect(res.body).toEqual(agentJsonSchema(name));
    }
  });

  it('un corps validé par le schéma « prospect_create » a bien la forme attendue par le CRM', async () => {
    const schema = (await get('/api/agent/schemas/prospect_create').expect(200)).body;
    expect(schema.required).toEqual(expect.arrayContaining(['missionId', 'discovery']));
    expect(schema.properties.discovery.required).toEqual(
      expect.arrayContaining(['source', 'reason', 'qualification']),
    );
  });

  it('schéma inconnu : 404 ; réservé aux agents', async () => {
    expect((await get('/api/agent/schemas/inconnu')).status).toBe(404);
    expect((await owner.get('/api/agent/schemas')).status).toBe(403);
  });
});
