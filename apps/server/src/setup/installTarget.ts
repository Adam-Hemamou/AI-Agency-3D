import { parseEnv } from '../config/env.ts';
import { resolveTestDatabaseUrl, testDatabaseName } from '../test/testDatabaseUrl.ts';

/**
 * Base visée par l'installateur des prospecteurs, à partir des arguments et du .env.
 *
 * - Par défaut : la base de TEST (même calcul que les tests d'intégration, nom en « _test »).
 * - Production : uniquement avec --target=production ET --confirm=<nom exact de la base>.
 * - Simulation par défaut : --apply est nécessaire pour écrire.
 * - Refus si MODE_SIMULATION n'est pas actif, ou si un argument est inconnu.
 */

export interface InstallTarget {
  kind: 'test' | 'production';
  databaseUrl: string;
  /** Nom de la base (sans identifiant ni mot de passe). */
  database: string;
  apply: boolean;
  updatePrompts: boolean;
}

export const INSTALL_USAGE = [
  'Usage (depuis apps/server) : npx tsx src/setup/installProspectors.ts [options]',
  '  (aucune option)                   simulation sur la base de test : rien n’est écrit',
  '  --apply                           écrit réellement (base de test par défaut)',
  '  --target=production --confirm=ai_agency',
  '                                    vise la base de production (nom exact exigé)',
  '  --update-prompts                  prompt du dépôt modifié : créer ou réactiver sa version',
].join('\n');

export function resolveInstallTarget(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): InstallTarget {
  let apply = false;
  let updatePrompts = false;
  let kind: InstallTarget['kind'] = 'test';
  let confirm: string | null = null;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--update-prompts') updatePrompts = true;
    else if (arg === '--target=test') kind = 'test';
    else if (arg === '--target=production') kind = 'production';
    else if (arg.startsWith('--confirm=')) confirm = arg.slice('--confirm='.length);
    else throw new Error(`Argument inconnu : ${arg}\n${INSTALL_USAGE}`);
  }

  if (!parseEnv(env).MODE_SIMULATION) {
    throw new Error('MODE_SIMULATION doit rester actif (true) pour installer les prospecteurs.');
  }

  if (kind === 'test') {
    if (confirm !== null) {
      throw new Error('--confirm ne sert qu’avec --target=production.');
    }
    const databaseUrl = resolveTestDatabaseUrl(env);
    return { kind, databaseUrl, database: testDatabaseName(databaseUrl), apply, updatePrompts };
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL absent du fichier .env.');
  const database = testDatabaseName(databaseUrl);
  if (database.endsWith('_test')) {
    throw new Error(`La base « ${database} » est une base de test : utilisez --target=test.`);
  }
  if (confirm !== database) {
    throw new Error(
      `Production : confirmez le nom exact de la base avec --confirm=${database}` +
        (confirm === null ? '' : ` (reçu : « ${confirm} »)`),
    );
  }
  return { kind, databaseUrl, database, apply, updatePrompts };
}
