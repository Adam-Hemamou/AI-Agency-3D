import { z } from 'zod';
import { AGENT_ROLES } from './agentPolicy';
import { ROOM_IDS } from './rooms';

/**
 * Profil IA d'un agent : rôle, modèle, paramètres d'inférence (Ollama) et prompt système versionné.
 *
 * - Le profil est géré par l'utilisateur humain uniquement ; un agent ne lit que le sien.
 * - Les versions du prompt ne sont jamais modifiées ni supprimées (protégées en base) : une
 *   modification crée une nouvelle version, et une version, ancienne ou récente, peut être activée.
 * - Un agent sans profil enregistré utilise les valeurs par défaut ci-dessous.
 */

/**
 * Valeurs par défaut, adaptées à Qwen3:8b servi par Ollama pour des réponses JSON structurées :
 * - think: false : pas de bloc de raisonnement <think> dans la réponse (mode « non-thinking ») ;
 * - temperature basse : sorties stables et conformes au schéma (Qwen recommande 0,7 en conversation
 *   libre ; top_p 0,8 et top_k 20 suivent ses recommandations pour ce mode) ;
 * - num_ctx 8192 : Ollama utilise un contexte court par défaut et tronque SANS prévenir un long
 *   prompt ; 8192 laisse la place au prompt système et au dossier, dans la mémoire d'un PC ;
 * - num_predict 2048 : longueur maximale de la réponse ;
 * - timeoutSeconds : délai laissé à n8n pour un appel au modèle.
 */
export const AGENT_MODEL_DEFAULTS = {
  model: 'qwen3:8b',
  temperature: 0.2,
  topP: 0.8,
  topK: 20,
  numCtx: 8192,
  numPredict: 2048,
  think: false,
  timeoutSeconds: 180,
} as const;

/** Bornes acceptées (au-delà, la valeur est refusée plutôt que corrigée). */
export const AGENT_MODEL_LIMITS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0.01, max: 1 },
  topK: { min: 1, max: 200 },
  numCtx: { min: 2048, max: 32768 },
  numPredict: { min: 64, max: 8192 },
  timeoutSeconds: { min: 10, max: 900 },
} as const;

/**
 * Taille maximale d'un prompt système, en caractères Unicode (points de code), comme MySQL les
 * compte (CHAR_LENGTH) : un emoji, un caractère accentué ou un idéogramme comptent chacun pour 1.
 * Stockage : MEDIUMTEXT utf8mb4 (16 Mo), soit 4 octets au plus par caractère : 80 000 octets au pire.
 */
export const AGENT_PROMPT_MAX_LENGTH = 20_000;

/** Nombre de caractères Unicode (et non d'unités UTF-16, où un emoji compte double). */
export function unicodeLength(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** Nom de modèle Ollama : « qwen3:8b », « llama3.1:8b-instruct-q4_K_M »… */
export const ollamaModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/, {
    error: 'Nom de modèle Ollama invalide (ex. « qwen3:8b »)',
  });

const bounded = (limits: { min: number; max: number }) =>
  z.number().min(limits.min).max(limits.max);
const boundedInt = (limits: { min: number; max: number }) => bounded(limits).int();

/** Paramètres du modèle, tous obligatoires (forme enregistrée). */
export const agentModelSettingsSchema = z.strictObject({
  model: ollamaModelSchema,
  temperature: bounded(AGENT_MODEL_LIMITS.temperature),
  topP: bounded(AGENT_MODEL_LIMITS.topP),
  topK: boundedInt(AGENT_MODEL_LIMITS.topK),
  numCtx: boundedInt(AGENT_MODEL_LIMITS.numCtx),
  numPredict: boundedInt(AGENT_MODEL_LIMITS.numPredict),
  think: z.boolean(),
  timeoutSeconds: boundedInt(AGENT_MODEL_LIMITS.timeoutSeconds),
});
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;

// ---------------------------------------------------------------------------
// Requêtes (utilisateur humain)
// ---------------------------------------------------------------------------

/**
 * Modification du profil : seuls les champs fournis changent ; les autres gardent leur valeur
 * actuelle (ou la valeur par défaut si le profil n'existe pas encore). role: null retire le rôle.
 */
export const updateAgentProfileRequestSchema = agentModelSettingsSchema
  .partial()
  .extend({ role: z.enum(AGENT_ROLES).nullable().optional() })
  .refine((req) => Object.keys(req).length > 0, { error: 'Aucune modification demandée' });
export type UpdateAgentProfileRequest = z.infer<typeof updateAgentProfileRequestSchema>;

/** Nouvelle version du prompt. Elle n'est active que si activate vaut true (false par défaut). */
export const createAgentPromptRequestSchema = z.strictObject({
  systemPrompt: z
    .string()
    .trim()
    .min(1)
    .refine((value) => unicodeLength(value) <= AGENT_PROMPT_MAX_LENGTH, {
      error: `Prompt trop long : ${AGENT_PROMPT_MAX_LENGTH} caractères au plus`,
    }),
  /** Raison de la nouvelle version (affichée dans l'historique). */
  note: z.string().trim().min(1).max(500).nullable().default(null),
  activate: z.boolean().default(false),
});
export type CreateAgentPromptRequest = z.input<typeof createAgentPromptRequestSchema>;
export type CreateAgentPromptInput = z.output<typeof createAgentPromptRequestSchema>;

/** Numéro de version dans l'URL (entier ≥ 1). */
export const agentPromptVersionParamSchema = z.coerce.number().int().min(1).max(1_000_000);

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export const agentPromptSchema = z.object({
  agentId: z.string(),
  version: z.number().int(),
  systemPrompt: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
  /** Version actuellement utilisée par l'agent. */
  active: z.boolean(),
});
export type AgentPrompt = z.infer<typeof agentPromptSchema>;

export const agentPromptListResponseSchema = z.object({ items: z.array(agentPromptSchema) });
export type AgentPromptListResponse = z.infer<typeof agentPromptListResponseSchema>;

/** Profil vu par l'utilisateur. */
export const agentProfileSchema = z.object({
  agentId: z.string(),
  role: z.enum(AGENT_ROLES).nullable(),
  settings: agentModelSettingsSchema,
  /** Version du prompt utilisée, ou null si aucune n'est active. */
  activePromptVersion: z.number().int().nullable(),
  /** true : aucun profil enregistré, les valeurs par défaut s'appliquent. */
  isDefault: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

/**
 * GET /api/agent/profile : ce dont n8n a besoin pour faire travailler l'agent authentifié.
 * prompt est null tant qu'aucune version n'est active (l'agent ne doit alors rien exécuter).
 */
export const agentSelfProfileResponseSchema = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    room: z.enum(ROOM_IDS).nullable(),
    role: z.enum(AGENT_ROLES).nullable(),
  }),
  settings: agentModelSettingsSchema,
  prompt: z
    .object({ version: z.number().int(), systemPrompt: z.string(), createdAt: z.string() })
    .nullable(),
});
export type AgentSelfProfileResponse = z.infer<typeof agentSelfProfileResponseSchema>;
