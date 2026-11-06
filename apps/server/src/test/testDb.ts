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
      'agent_quota_usage',
      'agent_switch',
      'owner_sessions',
      'owner_credentials',
      'agent_runs',
      'agent_profiles',
      'agent_prompts',
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
