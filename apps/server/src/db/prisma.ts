import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.ts';

/** Ce dont l'API a besoin pour vérifier la base. Permet de tester sans vraie base. */
export interface DatabaseProbe {
  ping(): Promise<void>;
}

/**
 * Crée le client Prisma connecté à MySQL via l'adaptateur MariaDB (compatible MySQL).
 * Prisma 7 exige un adaptateur de pilote explicite.
 */
export function createPrismaClient(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 5,
    connectTimeout: 3000,
    // MySQL 8.4 utilise caching_sha2_password : nécessaire sans TLS, en local uniquement.
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;

export function createDatabaseProbe(prisma: AppPrismaClient): DatabaseProbe {
  return {
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    },
  };
}
