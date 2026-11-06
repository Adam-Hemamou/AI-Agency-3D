import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { isTailscaleAddress } from '../network/tailnet.ts';

/** Fichier .env unique, à la racine du monorepo. */
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

/** "true" / "false" uniquement : toute autre valeur est une erreur de configuration. */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z
  .object({
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
    /**
     * Deuxième écoute, EN PLUS de 127.0.0.1 : l'adresse Tailscale de ce PC (100.64.0.0/10).
     * Vide par défaut : API locale uniquement. 0.0.0.0 et toute adresse hors Tailscale sont refusées.
     */
    TAILSCALE_BIND_ADDRESS: z.string().trim().default(''),
    /** Seule machine acceptée sur l'écoute Tailscale (l'IP Tailscale du VPS). */
    TAILSCALE_ALLOWED_PEER: z.string().trim().default(''),
  })
  .superRefine((env, ctx) => {
    const bind = env.TAILSCALE_BIND_ADDRESS;
    const peer = env.TAILSCALE_ALLOWED_PEER;
    if (!bind && !peer) return;
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (!bind || !peer) {
      issue(
        bind ? 'TAILSCALE_ALLOWED_PEER' : 'TAILSCALE_BIND_ADDRESS',
        'TAILSCALE_BIND_ADDRESS et TAILSCALE_ALLOWED_PEER vont ensemble : renseignez les deux ou aucun',
      );
      return;
    }
    if (bind === '0.0.0.0' || bind === '::') {
      issue(
        'TAILSCALE_BIND_ADDRESS',
        `${bind} est interdit : il ouvrirait l'API sur tout le réseau`,
      );
    } else if (!isTailscaleAddress(bind)) {
      issue('TAILSCALE_BIND_ADDRESS', 'doit être une adresse IPv4 Tailscale (100.64.0.0/10)');
    }
    if (!isTailscaleAddress(peer)) {
      issue('TAILSCALE_ALLOWED_PEER', 'doit être une adresse IPv4 Tailscale (100.64.0.0/10)');
    } else if (peer === bind) {
      issue('TAILSCALE_ALLOWED_PEER', 'doit être l’adresse du VPS, pas celle de ce PC');
    }
    // Pas d'ajout implicite à hostGuard : l'autorisation de l'en-tête Host reste explicite.
    if (!env.ALLOWED_HOSTS.includes(bind)) {
      issue(
        'ALLOWED_HOSTS',
        `doit contenir ${bind} pour que les requêtes reçues via Tailscale soient acceptées`,
      );
    }
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
