import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionResponseSchema } from '@agency/shared';
import { createAgentService } from '../agents/agentService.ts';
import { createIdempotencyStore } from '../agents/idempotency.ts';
import { createApp } from '../app.ts';
import { createLoginThrottle } from '../auth/loginThrottle.ts';
import { createOwnerAuthService, hashSessionToken } from '../auth/ownerAuth.ts';
import { createDatabaseProbe } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { TEST_HOST, TEST_ORIGIN } from '../test/ownerSession.ts';
import { testAgentLimits } from '../test/agentLimits.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

const prisma = createTestPrisma();
const PASSWORD = 'un mot de passe solide';

/** Horloge réglable : expiration des sessions et délais de freinage. */
let now = new Date('2026-11-06T08:00:00.000Z');
const clock = () => now;
const owner = createOwnerAuthService({ prisma, clock });
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });

function makeApp() {
  return createApp({
    ...testAgentLimits(prisma),
    db: createDatabaseProbe(prisma),
    missions,
    prospects,
    agents: createAgentService({ prisma }),
    idempotency: createIdempotencyStore(prisma),
    owner,
    loginThrottle: createLoginThrottle({ clock }),
    version: 'test',
    simulationMode: true,
  });
}
let app = makeApp();

const fromUi = (test: request.Test) => test.set('Host', TEST_HOST).set('Origin', TEST_ORIGIN);
const login = (password = PASSWORD) =>
  fromUi(request(app).post('/api/auth/login')).send({ password });

function sessionCookie(res: request.Response): string {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = header.find((c) => c.startsWith('agency_session='));
  if (!cookie) throw new Error('aucun cookie de session');
  return cookie.split(';')[0]!;
}

const withSession = (test: request.Test, cookie: string) => fromUi(test).set('Cookie', cookie);

beforeAll(async () => {
  await resetDatabase();
  // Une seule empreinte scrypt pour tout le fichier (calcul volontairement lent).
  await owner.setPassword(PASSWORD);
});

beforeEach(async () => {
  now = new Date('2026-11-06T08:00:00.000Z');
  app = makeApp(); // remet le freinage à zéro
  await prisma.ownerSession.deleteMany();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('refus par défaut', () => {
  it.each([
    ['get', '/api/missions'],
    ['get', '/api/prospects'],
    ['get', '/api/agents'],
    ['post', '/api/missions/x/validation'],
    ['post', '/api/prospects/x/decisions'],
    ['post', '/api/prospects/x/email/simulated-send'],
    ['post', '/api/agents'],
  ] as const)('sans session ni clé : %s %s → 401', async (method, path) => {
    const res = await fromUi(request(app)[method](path)).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('la santé et l’état de session restent publics', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    const res = await request(app).get('/api/auth/session');
    expect(sessionResponseSchema.parse(res.body)).toEqual({
      authenticated: false,
      expiresAt: null,
    });
  });
});

describe('connexion', () => {
  it('ouvre une session de 12 heures avec un cookie protégé', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true, expiresAt: '2026-11-06T20:00:00.000Z' });
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api/);
    expect(raw).toMatch(/Max-Age=43200/);
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = sessionCookie(res);
    expect((await withSession(request(app).get('/api/missions'), cookie)).status).toBe(200);
    const session = await withSession(request(app).get('/api/auth/session'), cookie);
    expect(session.body).toEqual({ authenticated: true, expiresAt: '2026-11-06T20:00:00.000Z' });
  });

  it('ne stocke que l’empreinte du jeton', async () => {
    const token = sessionCookie(await login()).split('=')[1]!;
    const rows = await prisma.ownerSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('refuse un mauvais mot de passe', async () => {
    const res = await login('pas le bon mot de passe');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuse une connexion qui ne vient pas de l’interface', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', 'http://evil.example')
      .send({ password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('la session expire au bout de 12 heures', async () => {
    const cookie = sessionCookie(await login());
    now = new Date('2026-11-06T19:59:00.000Z');
    expect((await withSession(request(app).get('/api/missions'), cookie)).status).toBe(200);
    now = new Date('2026-11-06T20:00:00.000Z');
    expect((await withSession(request(app).get('/api/missions'), cookie)).status).toBe(401);
  });

  it('la déconnexion ferme la session', async () => {
    const cookie = sessionCookie(await login());
    const out = await withSession(request(app).post('/api/auth/logout'), cookie);
    expect(out.status).toBe(200);
    expect(([] as string[]).concat(out.headers['set-cookie'] ?? []).join(';')).toMatch(
      /agency_session=;/,
    );
    expect((await withSession(request(app).get('/api/missions'), cookie)).status).toBe(401);
  });

  it('changer le mot de passe ferme toutes les sessions', async () => {
    const cookie = sessionCookie(await login());
    await owner.setPassword(PASSWORD); // même valeur : nouvelle empreinte, sessions fermées
    expect((await withSession(request(app).get('/api/missions'), cookie)).status).toBe(401);
  });

  it('une écriture avec la session doit venir de l’interface', async () => {
    const cookie = sessionCookie(await login());
    const res = await request(app)
      .post('/api/missions')
      .set('Host', TEST_HOST)
      .set('Origin', 'http://localhost:8080')
      .set('Cookie', cookie)
      .send({ type: 'search_creators', room: 'prospecting' });
    expect(res.status).toBe(403);
    expect((await missions.list({ limit: 10, offset: 0, sort: 'recent' })).total).toBe(0);
  });
});

describe('freinage des essais de mot de passe', () => {
  it('après 5 échecs, impose un délai, même pour le bon mot de passe', async () => {
    for (let i = 0; i < 5; i++) expect((await login('mauvais')).status).toBe(401);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBe('60');

    now = new Date(now.getTime() + 61_000);
    expect((await login()).status).toBe(200);
  });

  it('le délai double à chaque nouvel échec', async () => {
    for (let i = 0; i < 5; i++) await login('mauvais');
    now = new Date(now.getTime() + 61_000);
    await login('mauvais'); // 6e échec : 2 minutes
    expect((await login()).headers['retry-after']).toBe('120');
  });
});

describe('sans mot de passe défini', () => {
  it('explique comment le définir', async () => {
    await prisma.ownerCredential.deleteMany();
    const res = await login();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWNER_PASSWORD_NOT_SET');
    expect(res.body.error.message).toContain('npm run owner:password');
    await owner.setPassword(PASSWORD);
  });

  it('refuse un mot de passe trop court', async () => {
    await expect(owner.setPassword('court')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
