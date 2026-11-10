import mariadb from 'mariadb';
import { inject } from 'vitest';
import { AGENT_MODEL_DEFAULTS, type RoomId } from '@agency/shared';
import { createPrismaClient, type AppPrismaClient } from '../db/prisma.ts';

/** URL de la base de test fournie par globalSetup. */
export function testDatabaseUrl(): string {
  return inject('testDatabaseUrl');
}

export function createTestPrisma() {
  return createPrismaClient(testDatabaseUrl());
}

/**
 * Vide les tables entre deux tests : TOUTES les tables de la base de test (lues dans
 * information_schema), sauf l'historique des migrations. Une table ajoutée par une migration est
 * donc vidée sans liste à tenir à jour (oubli des campagnes : données d'un test à l'autre).
 * TRUNCATE (et non DELETE) : il ne déclenche pas la protection de l'historique,
 * qui reste active pour l'application.
 */
export async function resetDatabase(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const database = url.pathname.replace(/^\//, '');
  // Garde-fou : jamais une autre base que celle des tests.
  if (!database.endsWith('_test')) {
    throw new Error(`resetDatabase : base « ${database} » refusée (nom en _test attendu)`);
  }
  const connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    allowPublicKeyRetrieval: true,
  });
  try {
    const tables: { name: string }[] = await connection.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'`,
    );
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) {
      await connection.query(`TRUNCATE TABLE \`${name}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
}

/**
 * Crée un agent directement en base de test (sans clé ni permission), pour les tests de services :
 * une mission ne peut être attribuée qu'à un agent existant, et un agent n'agit que dans sa salle.
 */
export async function createTestAgent(
  prisma: AppPrismaClient,
  id: string,
  room: RoomId | null = null,
): Promise<void> {
  const now = new Date();
  await prisma.agent.create({ data: { id, name: id, room, createdAt: now, updatedAt: now } });
}

/** Prompt système des agents de test (base de test uniquement, jamais les bases réelles). */
export const TEST_SYSTEM_PROMPT =
  'Prompt de test : réponds uniquement en JSON conforme au schéma demandé.';

/**
 * Crée un agent de test avec un profil et un PROMPT ACTIF (version 1), directement en base de test :
 * nécessaire pour qu'un agent puisse prendre une mission (refusé sans prompt actif).
 */
export async function createTestAgentWithPrompt(
  prisma: AppPrismaClient,
  id: string,
  room: RoomId | null = null,
  systemPrompt: string = TEST_SYSTEM_PROMPT,
): Promise<void> {
  const now = new Date();
  await createTestAgent(prisma, id, room);
  await prisma.agentPrompt.create({
    data: { agentId: id, version: 1, systemPrompt, createdAt: now, createdBy: 'owner' },
  });
  await prisma.agentProfile.create({
    data: {
      agentId: id,
      ...AGENT_MODEL_DEFAULTS,
      activePromptVersion: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: 'owner',
    },
  });
}
