import { z } from 'zod';
import { agentCreateProspectRequestSchema, enrichProspectRequestSchema } from './agentApi';
import { channelRejectionsRequestSchema } from './campaigns';
import { createAnalysisRequestSchema, discoverySchema } from './prospectApi';

/**
 * Schémas JSON exposés à n8n (GET /api/agent/schemas/:name), produits À PARTIR des schémas Zod qui
 * valident les requêtes : une seule définition, jamais deux versions qui divergent.
 *
 * Usages : imposer la forme de la réponse du modèle (paramètre « format » d'Ollama), puis vérifier
 * dans n8n un corps de requête avant de l'envoyer. Le CRM revalide toujours tout à la réception :
 * certaines règles (au moins un identifiant de chaîne, adresses http(s) sûres…) ne s'expriment pas
 * en schéma JSON et ne sont vérifiées que par le serveur.
 *
 * Forme « entrée » (io: 'input') : un champ qui a une valeur par défaut n'est pas obligatoire.
 */

export const AGENT_JSON_SCHEMA_NAMES = [
  'discovery',
  'prospect_create',
  'prospect_enrich',
  'analysis_create',
  'channel_rejections',
] as const;
export type AgentJsonSchemaName = (typeof AGENT_JSON_SCHEMA_NAMES)[number];

interface SchemaEntry {
  description: string;
  /** Route qui reçoit un corps de cette forme (null : partie d'un autre corps). */
  usedBy: string | null;
  schema: z.ZodType;
}

const ENTRIES: Record<AgentJsonSchemaName, SchemaEntry> = {
  discovery: {
    description:
      'Qualification initiale d’un créateur par le Prospecteur (champ « discovery » de la création)',
    usedBy: null,
    schema: discoverySchema,
  },
  prospect_create: {
    description: 'Création d’un prospect par un agent, dans sa mission de recherche en cours',
    usedBy: 'POST /api/agent/prospects',
    schema: agentCreateProspectRequestSchema,
  },
  prospect_enrich: {
    description: 'Informations complétées sur un prospect existant',
    usedBy: 'PATCH /api/agent/prospects/:id',
    schema: enrichProspectRequestSchema,
  },
  analysis_create: {
    description: 'Analyse d’un prospect par l’Analyste (faits, observations, hypothèses, score)',
    usedBy: 'POST /api/agent/prospects/:id/analyses',
    schema: createAnalysisRequestSchema,
  },
  channel_rejections: {
    description: 'Chaînes écartées par le Prospecteur dans sa mission de recherche (motif)',
    usedBy: 'POST /api/agent/channels/rejections',
    schema: channelRejectionsRequestSchema,
  },
};

export function isAgentJsonSchemaName(value: unknown): value is AgentJsonSchemaName {
  return (
    typeof value === 'string' && (AGENT_JSON_SCHEMA_NAMES as readonly string[]).includes(value)
  );
}

/** Schéma JSON (draft 2020-12) d'un des schémas exposés. */
export function agentJsonSchema(name: AgentJsonSchemaName): Record<string, unknown> {
  const entry = ENTRIES[name];
  return {
    ...z.toJSONSchema(entry.schema, { io: 'input', target: 'draft-2020-12' }),
    title: name,
    description: entry.description,
  };
}

export const agentJsonSchemaListResponseSchema = z.object({
  items: z.array(
    z.object({
      name: z.enum(AGENT_JSON_SCHEMA_NAMES),
      description: z.string(),
      usedBy: z.string().nullable(),
    }),
  ),
});
export type AgentJsonSchemaListResponse = z.infer<typeof agentJsonSchemaListResponseSchema>;

/** GET /api/agent/schemas : les schémas disponibles. */
export function agentJsonSchemaList(): AgentJsonSchemaListResponse {
  return {
    items: AGENT_JSON_SCHEMA_NAMES.map((name) => ({
      name,
      description: ENTRIES[name].description,
      usedBy: ENTRIES[name].usedBy,
    })),
  };
}
