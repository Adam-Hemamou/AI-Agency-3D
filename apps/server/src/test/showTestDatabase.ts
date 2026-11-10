/**
 * Affiche la base que viseront les tests d'intégration, calculée EXACTEMENT comme le fait
 * src/test/globalSetup.ts (même fichier .env, même fonction), sans jamais afficher d'identifiant
 * ni de mot de passe. Aucune connexion à MySQL.
 *
 * Usage (depuis apps/server) : npx tsx src/test/showTestDatabase.ts
 * Code de sortie : 0 uniquement si la base est « ai_agency_test » sur la machine locale.
 */
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { resolveTestDatabaseUrl, testDatabaseName } from './testDatabaseUrl.ts';

const EXPECTED_NAME = 'ai_agency_test';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

loadDotenv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

try {
  const url = new URL(resolveTestDatabaseUrl(process.env));
  const name = testDatabaseName(url.toString());
  const where = `${url.hostname}:${url.port || '3306'}`;
  console.log(`Base ciblée par les tests d'intégration : ${name} (serveur ${where})`);
  console.log(
    process.env.TEST_DATABASE_URL
      ? 'Origine : TEST_DATABASE_URL'
      : 'Origine : DATABASE_URL suffixée par « _test »',
  );
  if (name !== EXPECTED_NAME || !LOCAL_HOSTS.includes(url.hostname)) {
    console.error(`REFUS : attendu ${EXPECTED_NAME} en local. Ne pas lancer les tests.`);
    process.exit(1);
  }
  console.log(`CONFORME : seule ${EXPECTED_NAME} sera supprimée, recréée et migrée par les tests.`);
} catch (error) {
  console.error(`REFUS : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
