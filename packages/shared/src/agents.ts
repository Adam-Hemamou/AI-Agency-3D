import { z } from 'zod';
import { AGENT_PERMISSIONS } from './agentPolicy';
import { ROOM_IDS } from './rooms';

/**
 * Identité des agents IA et contrat de l'API de gestion des agents.
 *
 * Règles d'identité (appliquées par le serveur) :
 * - un agent est identifié par un identifiant qui commence TOUJOURS par "agent-" ;
 * - l'utilisateur humain a un identifiant réservé ("owner") qui ne commence jamais par "agent-" ;
 * - l'origine d'une requête est déterminée par le serveur à partir de la clé API présentée,
 *   jamais à partir du contenu de la requête.
 */

/** Identifiant de l'utilisateur humain (propriétaire de l'agence). */
export const HUMAN_ACTOR_ID = 'owner';

/** Préfixe obligatoire des identifiants d'agents : impossible de confondre un agent et l'humain. */
export const AGENT_ID_PREFIX = 'agent-';

/** Préfixe des clés API d'agents (reconnaissable dans les journaux, jamais affiché en entier). */
export const AGENT_API_KEY_PREFIX = 'agk_';

/** Format complet d'une clé : agk_<identifiant public de 12 caractères>_<secret de 43 caractères>. */
export const AGENT_API_KEY_PATTERN = /^agk_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export const AGENT_STATUSES = ['active', 'disabled'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  active: 'Actif',
  disabled: 'Désactivé',
};

/** Ex. "agent-prospecteur". Minuscules, chiffres et tirets ; 64 caractères au plus (colonnes actor_id). */
export const agentIdSchema = z
  .string()
  .max(64)
  .regex(/^agent-[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: 'L’identifiant doit commencer par "agent-" (minuscules, chiffres et tirets)',
  });

export function isAgentId(value: unknown): value is string {
  return agentIdSchema.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().min(1).max(2000);
/** Permissions accordées : liste sans doublon. Vide par défaut (un nouvel agent ne peut rien faire). */
const permissionsSchema = z
  .array(z.enum(AGENT_PERMISSIONS))
  .max(AGENT_PERMISSIONS.length)
  .refine((list) => new Set(list).size === list.length, { error: 'Permission en double' });

export const createAgentRequestSchema = z.strictObject({
  id: agentIdSchema,
  name: nameSchema,
  description: descriptionSchema.nullable().default(null),
  /** Salle de rattachement, si l'agent travaille dans une salle précise. */
  room: z.enum(ROOM_IDS).nullable().default(null),
  permissions: permissionsSchema.default([]),
});
export type CreateAgentRequest = z.input<typeof createAgentRequestSchema>;
export type CreateAgentInput = z.output<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    room: z.enum(ROOM_IDS).nullable().optional(),
    /** "disabled" : toutes les clés de l'agent cessent immédiatement de fonctionner. */
    status: z.enum(AGENT_STATUSES).optional(),
    /** Remplace la liste complète des permissions. */
    permissions: permissionsSchema.optional(),
  })
  .refine((req) => Object.keys(req).length > 0, { error: 'Aucune modification demandée' });
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const issueAgentKeyRequestSchema = z.strictObject({
  /** Usage de la clé, ex. "n8n – production". */
  label: z.string().trim().min(1).max(120).nullable().default(null),
  /** Date d'expiration facultative (ISO 8601), obligatoirement dans le futur. */
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type IssueAgentKeyRequest = z.input<typeof issueAgentKeyRequestSchema>;
export type IssueAgentKeyInput = z.output<typeof issueAgentKeyRequestSchema>;

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

/** Clé API telle qu'affichée : jamais le secret, seulement son identifiant public. */
export const agentApiKeySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  /** Partie publique ("agk_xxxxxxxxxxxx") : permet de reconnaître la clé sans la révéler. */
  prefix: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AgentApiKey = z.infer<typeof agentApiKeySchema>;

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  room: z.enum(ROOM_IDS).nullable(),
  status: z.enum(AGENT_STATUSES),
  permissions: z.array(z.enum(AGENT_PERMISSIONS)),
  createdAt: z.string(),
  updatedAt: z.string(),
  keys: z.array(agentApiKeySchema),
});
export type Agent = z.infer<typeof agentSchema>;

export const agentListResponseSchema = z.object({ items: z.array(agentSchema) });
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;

/** Réponse à la création d'une clé : le secret n'est transmis qu'UNE seule fois. */
export const issuedAgentKeyResponseSchema = z.object({
  key: agentApiKeySchema,
  /** Clé complète à copier dans n8n. Elle n'est stockée nulle part et ne pourra plus être lue. */
  apiKey: z.string().regex(AGENT_API_KEY_PATTERN),
});
export type IssuedAgentKeyResponse = z.infer<typeof issuedAgentKeyResponseSchema>;

/** GET /api/agents/me : l'agent authentifié par sa clé. */
export const agentIdentityResponseSchema = z.object({
  agent: agentSchema.omit({ keys: true }),
  /** Clé utilisée pour cette requête. */
  key: agentApiKeySchema,
});
export type AgentIdentityResponse = z.infer<typeof agentIdentityResponseSchema>;
