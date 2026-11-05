import { z } from 'zod';

/**
 * Limites d'utilisation des agents et arrêt d'urgence.
 *
 * Quotas journaliers GLOBAUX : comptés pour l'ensemble des agents, quelles que soient leurs clés.
 * Un jour = un jour calendaire à l'heure de Paris. Seules les opérations réussies sont comptées ;
 * une opération refusée (quota atteint ou autre erreur) ne modifie rien, pas même le compteur.
 */

export const AGENT_QUOTA_ACTIONS = [
  'prospect_create',
  'prospect_enrich',
  'production_create',
] as const;
export type AgentQuotaAction = (typeof AGENT_QUOTA_ACTIONS)[number];

/** Valeurs décidées par l'utilisateur (06/11/2026). */
export const AGENT_DAILY_QUOTAS: Record<AgentQuotaAction, number> = {
  prospect_create: 10,
  prospect_enrich: 200,
  production_create: 100,
};

export const AGENT_QUOTA_LABELS: Record<AgentQuotaAction, string> = {
  prospect_create: 'Nouveaux prospects',
  prospect_enrich: 'Enrichissements',
  production_create: 'Productions',
};

/** Fuseau horaire du « jour » des quotas. */
export const AGENT_QUOTA_TIME_ZONE = 'Europe/Paris';

/** Débit maximal de requêtes par agent (toutes routes confondues). */
export const AGENT_REQUESTS_PER_MINUTE = 60;

/** Taille maximale du corps d'une requête d'agent. */
export const AGENT_MAX_BODY = '256kb';

export const agentQuotaStatusSchema = z.object({
  /** Jour concerné (AAAA-MM-JJ, heure de Paris). */
  day: z.string(),
  /** Fin du jour (ISO 8601) : les compteurs repartent de zéro. */
  resetsAt: z.string(),
  quotas: z.array(
    z.object({
      action: z.enum(AGENT_QUOTA_ACTIONS),
      label: z.string(),
      limit: z.number().int(),
      used: z.number().int(),
      remaining: z.number().int(),
    }),
  ),
});
export type AgentQuotaStatus = z.infer<typeof agentQuotaStatusSchema>;

// ---------------------------------------------------------------------------
// Arrêt d'urgence
// ---------------------------------------------------------------------------

export const agentsSwitchRequestSchema = z.strictObject({
  /** false : arrêt immédiat de toutes les opérations des agents. */
  enabled: z.boolean(),
});

export const agentsSwitchStatusSchema = z.object({
  /** État effectif : les agents peuvent-ils agir ? */
  enabled: z.boolean(),
  /** AGENTS_ENABLED du fichier .env (false : arrêt impossible à lever sans modifier .env). */
  envEnabled: z.boolean(),
  /** Interrupteur de l'interface, conservé en base. */
  switchEnabled: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AgentsSwitchStatus = z.infer<typeof agentsSwitchStatusSchema>;
