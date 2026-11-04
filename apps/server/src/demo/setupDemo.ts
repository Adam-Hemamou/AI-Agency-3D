import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import mariadb from 'mariadb';
import { databaseName, resolveDemoDatabaseUrl } from '../config/demo.ts';
import { createPrismaClient } from '../db/prisma.ts';
import { seedDemo } from './scenario.ts';

/**
 * npm run demo:setup
 * (Re)crée la base de DÉMONSTRATION (…_demo), y applique les migrations puis
 * la remplit avec le scénario fictif. La base réelle n'est jamais ouverte :
 * le nom de la base cible doit obligatoirement se terminer par "_demo".
 */

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

loadDotenv({ path: ROOT_ENV_FILE, quiet: true });
const demoUrl = resolveDemoDatabaseUrl(process.env);
const name = databaseName(demoUrl);
const url = new URL(demoUrl);

console.log(`Base de démonstration : ${name}`);

const connection = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  allowPublicKeyRetrieval: true,
  connectTimeout: 5000,
});
try {
  await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await connection.query(
    `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
} finally {
  await connection.end();
}
console.log('Base recréée à vide.');

execSync('npx prisma migrate deploy', {
  cwd: SERVER_DIR,
  env: { ...process.env, DATABASE_URL: demoUrl },
  stdio: 'pipe',
});
console.log('Migrations appliquées.');

const prisma = createPrismaClient(demoUrl);
try {
  const counts = await seedDemo(prisma);
  console.log(
    `Scénario fictif chargé : ${counts.prospects} prospects, ${counts.missions} missions, ${counts.events} événements.`,
  );
  console.log('Lancez « npm run dev:demo » puis ouvrez http://localhost:5174');
} finally {
  await prisma.$disconnect();
}
