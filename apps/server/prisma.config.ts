import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Un seul fichier .env, à la racine du projet.
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // process.env (et non env()) : "prisma generate" doit fonctionner sans base configurée.
  // Les commandes qui touchent la base (migrate, studio) échoueront clairement si l'URL manque.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
