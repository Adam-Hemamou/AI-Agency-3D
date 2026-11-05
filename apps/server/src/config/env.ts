import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Fichier .env unique, à la racine du monorepo. */
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

/** "true" / "false" uniquement : toute autre valeur est une erreur de configuration. */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Garde-fou : actif par défaut. Doit être explicitement mis à "false" pour autoriser le réel. */
  MODE_SIMULATION: booleanFlag.default(true),
  /**
   * Arrêt d'urgence des agents : "false" bloque toutes leurs opérations dès le démarrage, sans que
   * l'interface puisse le lever. L'utilisateur garde un accès normal au CRM.
   */
  AGENTS_ENABLED: booleanFlag.default(true),
  /**
   * Noms d'hôte acceptés en plus de localhost / 127.0.0.1, séparés par des virgules
   * (ex. « host.docker.internal » quand n8n sera branché). Vide par défaut.
   */
  ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL est obligatoire' })
    .startsWith('mysql://', { error: 'DATABASE_URL doit commencer par mysql://' }),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Valide un ensemble de variables d'environnement. Lève une erreur lisible si invalide. */
export function parseEnv(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Configuration invalide (fichier .env) :\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Charge le .env racine puis valide la configuration. */
export function loadConfig(): AppConfig {
  loadDotenv({ path: ROOT_ENV_FILE, quiet: true });
  return parseEnv(process.env);
}
