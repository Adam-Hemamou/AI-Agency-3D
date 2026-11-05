import mariadb from 'mariadb';
import { inject } from 'vitest';
import { createPrismaClient } from '../db/prisma.ts';

/** URL de la base de test fournie par globalSetup. */
export function testDatabaseUrl(): string {
  return inject('testDatabaseUrl');
}

export function createTestPrisma() {
  return createPrismaClient(testDatabaseUrl());
}

/**
 * Vide les tables entre deux tests.
 * TRUNCATE (et non DELETE) : il ne déclenche pas la protection de l'historique,
 * qui reste active pour l'application.
 */
export async function resetDatabase(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    allowPublicKeyRetrieval: true,
  });
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'mission_events',
      'missions',
      'prospect_events',
      'prospect_messages',
      'prospect_decisions',
      'prospect_productions',
      'prospect_analyses',
      'prospects',
      'prospect_counters',
      'owner_sessions',
      'owner_credentials',
      'agent_requests',
      'agent_permissions',
      'agent_api_keys',
      'agents',
    ]) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
}
