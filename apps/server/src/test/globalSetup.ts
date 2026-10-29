import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import mariadb, { type Connection } from 'mariadb';
import type { TestProject } from 'vitest/node';
import { resolveTestDatabaseUrl, testDatabaseName } from './testDatabaseUrl.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

/**
 * Exécuté une fois avant les tests d'intégration :
 * recrée la base de test à vide puis y applique les migrations.
 */
export default async function setup(project: TestProject): Promise<void> {
  loadDotenv({ path: ROOT_ENV_FILE, quiet: true });
  const testUrl = resolveTestDatabaseUrl(process.env);
  const dbName = testDatabaseName(testUrl);
  const url = new URL(testUrl);

  let connection: Connection;
  try {
    connection = await mariadb.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      allowPublicKeyRetrieval: true,
      connectTimeout: 5000,
    });
  } catch (error) {
    throw new Error(
      `MySQL est injoignable pour les tests d'intégration. Démarrez Docker Desktop puis "npm run db:up".\n` +
        `Détail : ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.query(
      `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }

  execSync('npx prisma migrate deploy', {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  project.provide('testDatabaseUrl', testUrl);
}
