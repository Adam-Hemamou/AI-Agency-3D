import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppPrismaClient } from './prisma.ts';

/**
 * Vérification au démarrage : la base a-t-elle reçu toutes les migrations du dépôt ?
 *
 * Le client Prisma est généré depuis schema.prisma : si une migration manque en base, toute requête
 * qui touche une table ou une colonne nouvelle échoue (P2021, P2022). Le serveur refuse donc de
 * démarrer sur une base en retard plutôt que de répondre à moitié. Lecture seule : rien n'est appliqué.
 */

/** Dossier des migrations Prisma du serveur. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));

/** Ligne de la table _prisma_migrations utile à la vérification. */
export interface AppliedMigration {
  name: string;
  finished: boolean;
  rolledBack: boolean;
}

export interface MigrationCheck {
  /** Migrations du dépôt absentes de la base (à appliquer). */
  pending: string[];
  /** Migrations commencées mais jamais terminées (échec à résoudre à la main). */
  failed: string[];
  /** Migrations présentes en base mais pas dans le dépôt (code plus ancien que la base). */
  unknown: string[];
}

/** Noms des migrations du dépôt (dossiers contenant migration.sql), dans l'ordre. */
export function listRepositoryMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(`${dir}/${entry.name}/migration.sql`))
    .map((entry) => entry.name)
    .sort();
}

/** Compare les migrations du dépôt à celles enregistrées en base. */
export function compareMigrations(
  repository: readonly string[],
  applied: readonly AppliedMigration[],
): MigrationCheck {
  // Une migration annulée (rolled back) puis réappliquée a deux lignes : la plus favorable compte.
  const done = new Set(applied.filter((m) => m.finished && !m.rolledBack).map((m) => m.name));
  const failed = new Set(
    applied.filter((m) => !m.finished && !m.rolledBack && !done.has(m.name)).map((m) => m.name),
  );
  const known = new Set(repository);
  return {
    pending: repository.filter((name) => !done.has(name) && !failed.has(name)),
    failed: [...failed].sort(),
    unknown: [...done].filter((name) => !known.has(name)).sort(),
  };
}

/** Migrations enregistrées dans la base (aucune si la table _prisma_migrations n'existe pas). */
export async function readAppliedMigrations(prisma: AppPrismaClient): Promise<AppliedMigration[]> {
  const [table] = await prisma.$queryRaw<{ n: bigint | number }[]>`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'`;
  if (!table || Number(table.n) === 0) return [];
  const rows = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  return rows.map((row) => ({
    name: row.migration_name,
    finished: row.finished_at !== null,
    rolledBack: row.rolled_back_at !== null,
  }));
}

/** Nom de la base d'une URL de connexion, sans identifiant ni mot de passe. */
export function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.pathname.replace(/^\//, '')} (${url.hostname}:${url.port || '3306'})`;
}

/** Message d'arrêt lisible, ou null si la base est à jour. */
export function migrationProblem(check: MigrationCheck, database: string): string | null {
  const lines: string[] = [];
  if (check.failed.length > 0) {
    lines.push(
      `Base ${database} : migration(s) commencée(s) mais jamais terminée(s) : ${check.failed.join(', ')}.`,
      'À examiner à la main (état partiel possible : MySQL n’annule pas les modifications de structure).',
    );
  }
  if (check.pending.length > 0) {
    lines.push(
      `Base ${database} : ${check.pending.length} migration(s) en attente : ${check.pending.join(', ')}.`,
      'Le code attend ces tables et colonnes : l’API ne démarre pas sur une base en retard.',
      'Après une sauvegarde vérifiée, appliquez-les depuis apps/server : npx prisma migrate deploy',
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
