import { z } from 'zod';

/**
 * Actions externes des agents (réalisées par n8n, jamais par le CRM lui-même) et ce que le mode
 * simulation (MODE_SIMULATION) en autorise. SOURCE UNIQUE : le CRM l'expose aux agents
 * (GET /api/agent/capabilities) ; n8n la consulte AVANT toute action externe et s'y conforme.
 *
 * - Lecture publique : données publiques lues par une API officielle autorisée (YouTube Data API).
 *   Autorisée, mode simulation compris : elle ne coûte rien, n'engage personne et ne contacte personne.
 * - Dépense : tout appel payant (doublage HeyGen…). Bloquée en mode simulation.
 * - Envoi : tout message à un tiers (e-mail, relance…). Bloqué en mode simulation.
 *
 * Hors mode simulation, dépenses et envois restent refusés tant qu'aucune intégration réelle, avec
 * autorisation humaine préalable de chaque action, n'existe : le mode simulation n'est jamais le
 * seul garde-fou.
 */

export const EXTERNAL_ACTION_KINDS = ['public_read', 'spend', 'send'] as const;
export type ExternalActionKind = (typeof EXTERNAL_ACTION_KINDS)[number];

export const EXTERNAL_ACTION_LABELS: Record<ExternalActionKind, string> = {
  public_read: 'Lecture de données publiques (API officielles)',
  spend: 'Dépense (service payant)',
  send: 'Envoi à un tiers (e-mail, relance)',
};

/** Sources de données publiques que les agents peuvent interroger. */
export const PUBLIC_DATA_SOURCES = ['youtube_data_api'] as const;
export type PublicDataSource = (typeof PUBLIC_DATA_SOURCES)[number];

export const PUBLIC_DATA_SOURCE_LABELS: Record<PublicDataSource, string> = {
  youtube_data_api: 'YouTube Data API v3 (lecture seule, données publiques)',
};

export interface ExternalActionRule {
  allowed: boolean;
  reason: string;
}

export function externalActionPolicy(
  simulationMode: boolean,
): Record<ExternalActionKind, ExternalActionRule> {
  return {
    public_read: {
      allowed: true,
      reason: 'Lecture de données publiques par les API officielles des sources autorisées',
    },
    spend: {
      allowed: false,
      reason: simulationMode
        ? 'Mode simulation : aucune dépense'
        : 'Aucune intégration payante disponible : toute dépense exigera une autorisation humaine préalable',
    },
    send: {
      allowed: false,
      reason: simulationMode
        ? 'Mode simulation : aucun envoi'
        : 'Aucune intégration d’envoi disponible : tout envoi exigera une autorisation humaine préalable',
    },
  };
}

export function isExternalActionAllowed(
  kind: ExternalActionKind,
  simulationMode: boolean,
): boolean {
  return externalActionPolicy(simulationMode)[kind].allowed;
}

const ruleSchema = z.object({ allowed: z.boolean(), reason: z.string() });

/** GET /api/agent/capabilities : ce que l'agent (n8n) peut faire à l'extérieur, maintenant. */
export const agentCapabilitiesResponseSchema = z.object({
  simulationMode: z.boolean(),
  externalActions: z.object({
    public_read: ruleSchema,
    spend: ruleSchema,
    send: ruleSchema,
  }),
  publicDataSources: z.array(z.enum(PUBLIC_DATA_SOURCES)),
});
export type AgentCapabilitiesResponse = z.infer<typeof agentCapabilitiesResponseSchema>;
