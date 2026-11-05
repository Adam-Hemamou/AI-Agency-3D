/**
 * Environnement de démonstration : données FICTIVES, dans une base séparée.
 * - DEMO_DATABASE_URL si défini ;
 * - sinon DATABASE_URL avec le nom de base suffixé par "_demo" (ai_agency → ai_agency_demo).
 * Refuse toute base dont le nom ne se termine pas par "_demo" : impossible
 * d'écrire des données fictives dans la base réelle par erreur.
 */

/**
 * Mot de passe de la démonstration (données fictives uniquement, base séparée).
 * Il est public par nature : ne jamais l'utiliser pour la base réelle.
 */
export const DEMO_OWNER_PASSWORD = 'demonstration-agence';

/** Ports dédiés : la démo peut tourner en même temps que l'application réelle. */
export const DEMO_SERVER_PORT = 3101;

export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

export function resolveDemoDatabaseUrl(env: Record<string, string | undefined>): string {
  let url: URL;
  if (env.DEMO_DATABASE_URL) {
    url = new URL(env.DEMO_DATABASE_URL);
  } else if (env.DATABASE_URL) {
    url = new URL(env.DATABASE_URL);
    url.pathname = `${url.pathname.replace(/^\//, '')}_demo`;
  } else {
    throw new Error('DATABASE_URL ou DEMO_DATABASE_URL doit être défini dans le fichier .env');
  }

  const name = databaseName(url.toString());
  if (!/^[A-Za-z0-9_]+_demo$/.test(name)) {
    throw new Error(
      `Base de démonstration refusée : « ${name} ». Son nom doit se terminer par "_demo" (sécurité).`,
    );
  }
  return url.toString();
}

/** L'API est-elle lancée sur les données de démonstration ? */
export function isDemoDataset(env: Record<string, string | undefined>): boolean {
  return env.AGENCY_DATASET === 'demo';
}
