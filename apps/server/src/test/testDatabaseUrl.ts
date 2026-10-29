/**
 * Détermine l'URL de la base de test.
 * - TEST_DATABASE_URL si défini ;
 * - sinon DATABASE_URL avec le nom de base suffixé par "_test".
 * Refuse toute base dont le nom ne se termine pas par "_test" : impossible
 * d'effacer la base de développement par erreur.
 */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string {
  let url: URL;
  if (env.TEST_DATABASE_URL) {
    url = new URL(env.TEST_DATABASE_URL);
  } else if (env.DATABASE_URL) {
    url = new URL(env.DATABASE_URL);
    url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  } else {
    throw new Error('DATABASE_URL ou TEST_DATABASE_URL doit être défini dans le fichier .env');
  }

  const name = testDatabaseName(url.toString());
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Base de test refusée : « ${name} ». Son nom doit se terminer par "_test" (sécurité).`,
    );
  }
  return url.toString();
}

export function testDatabaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}
