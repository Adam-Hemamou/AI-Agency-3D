import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAgentRequestSchema, issueAgentKeyRequestSchema } from '@agency/shared';
import { HUMAN_ACTOR, agentActor } from '../auth/actors.ts';
import { AppError } from '../errors/AppError.ts';
import type { Actor } from '../missions/missionService.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { hashAgentKey } from './agentKeys.ts';
import { createAgentService } from './agentService.ts';

const prisma = createTestPrisma();

/** Horloge réglable : permet de tester l'expiration des clés. */
let now = new Date('2026-11-05T10:00:00.000Z');
const service = createAgentService({ prisma, clock: () => now });

const human = HUMAN_ACTOR;
const agent = agentActor('agent-analyste');
const system: Actor = { type: 'system', id: null };
const impostor: Actor = { type: 'user', id: 'agent-analyste' };

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function createAgent(id = 'agent-analyste') {
  return service.create(
    createAgentRequestSchema.parse({ id, name: 'Analyste', room: 'analysis' }),
    human,
  );
}

const keyInput = (overrides: Record<string, unknown> = {}) =>
  issueAgentKeyRequestSchema.parse({ label: 'n8n', ...overrides });

beforeEach(async () => {
  now = new Date('2026-11-05T10:00:00.000Z');
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('identité des agents', () => {
  it('crée un agent actif, sans clé', async () => {
    const created = await createAgent();
    expect(created).toMatchObject({
      id: 'agent-analyste',
      name: 'Analyste',
      room: 'analysis',
      status: 'active',
      keys: [],
    });
    expect(await service.list()).toEqual({ items: [created] });
  });

  it('refuse un identifiant déjà utilisé', async () => {
    await createAgent();
    await expectAppError(createAgent(), 'ALREADY_EXISTS');
  });

  it('seul l’humain gère les agents et leurs clés', async () => {
    await createAgent();
    const input = createAgentRequestSchema.parse({ id: 'agent-autre', name: 'Autre' });
    const { key } = await service.issueKey('agent-analyste', keyInput(), human);
    for (const actor of [agent, system, impostor]) {
      await expectAppError(service.create(input, actor), 'FORBIDDEN_ACTOR');
      await expectAppError(
        service.update('agent-analyste', { status: 'active' }, actor),
        'FORBIDDEN_ACTOR',
      );
      await expectAppError(
        service.issueKey('agent-analyste', keyInput(), actor),
        'FORBIDDEN_ACTOR',
      );
      await expectAppError(service.revokeKey('agent-analyste', key.id, actor), 'FORBIDDEN_ACTOR');
    }
    const after = await service.get('agent-analyste');
    expect(after.keys).toHaveLength(1);
    expect(after.keys[0]!.revokedAt).toBeNull();
    expect((await service.list()).items).toHaveLength(1);
  });

  it('la base refuse un agent dont l’identifiant ne commence pas par "agent-"', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO agents (id, name, status, created_at, updated_at) VALUES ('owner', 'Faux', 'active', NOW(3), NOW(3))",
      ),
    ).rejects.toThrow();
  });
});

describe('clés API', () => {
  it('transmet la clé complète une seule fois et n’en garde que l’empreinte', async () => {
    await createAgent();
    const issued = await service.issueKey('agent-analyste', keyInput(), human);
    expect(issued.apiKey.startsWith(`${issued.key.prefix}_`)).toBe(true);

    const row = await prisma.agentApiKey.findUniqueOrThrow({ where: { id: issued.key.id } });
    expect(row.secretHash).toBe(hashAgentKey(issued.apiKey));
    expect(JSON.stringify(row)).not.toContain(issued.apiKey.slice(issued.key.prefix.length + 1));

    // Les lectures suivantes ne contiennent ni la clé ni son empreinte.
    const listed = JSON.stringify(await service.get('agent-analyste'));
    expect(listed).not.toContain(issued.apiKey);
    expect(listed).not.toContain(row.secretHash);
  });

  it('authentifie la clé comme celle de son agent, et date sa dernière utilisation', async () => {
    await createAgent();
    const { apiKey, key } = await service.issueKey('agent-analyste', keyInput(), human);
    const auth = await service.authenticate(apiKey);
    expect(auth?.actor).toEqual({ type: 'agent', id: 'agent-analyste' });
    expect(auth?.key.id).toBe(key.id);
    expect((await service.get('agent-analyste')).keys[0]!.lastUsedAt).toBe(now.toISOString());
  });

  it('chaque agent a sa propre clé : une clé n’identifie jamais un autre agent', async () => {
    await createAgent('agent-analyste');
    await createAgent('agent-redacteur');
    const a = await service.issueKey('agent-analyste', keyInput(), human);
    const b = await service.issueKey('agent-redacteur', keyInput(), human);
    expect((await service.authenticate(a.apiKey))?.actor.id).toBe('agent-analyste');
    expect((await service.authenticate(b.apiKey))?.actor.id).toBe('agent-redacteur');
  });

  it('refuse une clé falsifiée qui reprend l’identifiant public d’une vraie clé', async () => {
    await createAgent();
    const { key } = await service.issueKey('agent-analyste', keyInput(), human);
    expect(await service.authenticate(`${key.prefix}_${'A'.repeat(43)}`)).toBeNull();
    expect(await service.authenticate('owner')).toBeNull();
  });

  it('une clé révoquée est refusée, définitivement', async () => {
    await createAgent();
    const { apiKey, key } = await service.issueKey('agent-analyste', keyInput(), human);
    const revoked = await service.revokeKey('agent-analyste', key.id, human);
    expect(revoked.revokedAt).toBe(now.toISOString());
    expect(await service.authenticate(apiKey)).toBeNull();
    // Révoquer à nouveau ne change rien.
    expect((await service.revokeKey('agent-analyste', key.id, human)).revokedAt).toBe(
      revoked.revokedAt,
    );
    // La base elle-même refuse de réactiver la clé ou de la supprimer.
    await expect(
      prisma.$executeRawUnsafe('UPDATE agent_api_keys SET revoked_at = NULL WHERE id = ?', key.id),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM agent_api_keys WHERE id = ?', key.id),
    ).rejects.toThrow();
  });

  it('la base refuse de rattacher une clé à un autre agent ou de changer son empreinte', async () => {
    await createAgent('agent-analyste');
    await createAgent('agent-redacteur');
    const { key } = await service.issueKey('agent-analyste', keyInput(), human);
    await expect(
      prisma.$executeRawUnsafe(
        "UPDATE agent_api_keys SET agent_id = 'agent-redacteur' WHERE id = ?",
        key.id,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE agent_api_keys SET secret_hash = '${'0'.repeat(64)}' WHERE id = ?`,
        key.id,
      ),
    ).rejects.toThrow();
  });

  it('ne révoque pas la clé d’un autre agent', async () => {
    await createAgent('agent-analyste');
    await createAgent('agent-redacteur');
    const { key } = await service.issueKey('agent-analyste', keyInput(), human);
    await expectAppError(service.revokeKey('agent-redacteur', key.id, human), 'NOT_FOUND');
  });

  it('une clé expirée est refusée', async () => {
    await createAgent();
    const { apiKey } = await service.issueKey(
      'agent-analyste',
      keyInput({ expiresAt: '2026-11-06T10:00:00.000Z' }),
      human,
    );
    expect(await service.authenticate(apiKey)).not.toBeNull();
    now = new Date('2026-11-06T10:00:00.000Z');
    expect(await service.authenticate(apiKey)).toBeNull();
  });

  it('refuse une date d’expiration passée', async () => {
    await createAgent();
    await expectAppError(
      service.issueKey(
        'agent-analyste',
        keyInput({ expiresAt: '2026-11-01T00:00:00.000Z' }),
        human,
      ),
      'VALIDATION_ERROR',
    );
  });

  it('désactiver un agent bloque immédiatement toutes ses clés', async () => {
    await createAgent();
    const { apiKey } = await service.issueKey('agent-analyste', keyInput(), human);
    await service.update('agent-analyste', { status: 'disabled' }, human);
    expect(await service.authenticate(apiKey)).toBeNull();
    await expectAppError(
      service.issueKey('agent-analyste', keyInput(), human),
      'INVALID_TRANSITION',
    );

    await service.update('agent-analyste', { status: 'active' }, human);
    expect((await service.authenticate(apiKey))?.actor.id).toBe('agent-analyste');
  });
});
