import { z } from 'zod';
import { agentModelSettingsSchema } from './agentProfiles';
import { agentIdSchema } from './agents';
import { missionSchema } from './missionApi';
import { MISSION_STATUSES } from './missions';
import { ROOM_IDS } from './rooms';

/**
 * Exécutions des agents (Phase 2, étape 2) : une exécution = une tentative de travail d'un agent
 * sur une mission, orchestrée par n8n et tracée par le CRM.
 *
 * Règles (appliquées par le serveur) :
 * - au plus UNE exécution active (« started ») par mission, garanti par la base ;
 * - une exécution enregistre la version du prompt et une copie des paramètres utilisés ;
 * - pendant le travail, n8n envoie un signal de vie au moins toutes les
 *   AGENT_HEARTBEAT_INTERVAL_SECONDS ; sans activité depuis MISSION_STALE_MINUTES, la mission est
 *   bloquée par la récupération et l'exécution marquée « abandoned » ;
 * - en cas d'échec : remise en attente (release) seulement si la mission n'a produit aucun effet
 *   depuis son démarrage et qu'il reste des tentatives ; sinon, la mission est bloquée ;
 * - une exécution terminée n'est plus jamais modifiée (protégé en base).
 */

export const AGENT_RUN_STATUSES = [
  /** En cours : la mission est in_progress et l'agent y travaille. */
  'started',
  /** La mission a quitté in_progress normalement (terminée ou soumise à validation). */
  'succeeded',
  /** Échec signalé ; la mission a été bloquée. */
  'failed',
  /** Échec signalé ; la mission a été remise en attente pour une nouvelle tentative. */
  'released',
  /** Plus aucun signe de vie : la mission a été bloquée par la récupération. */
  'abandoned',
  /** La mission a quitté in_progress pour une autre raison (pause, blocage, annulation). */
  'stopped',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  started: 'En cours',
  succeeded: 'Réussie',
  failed: 'Échouée (mission bloquée)',
  released: 'Échouée (mission remise en attente)',
  abandoned: 'Abandonnée (sans signe de vie)',
  stopped: 'Arrêtée',
};

/** Statuts finaux : l'exécution n'évolue plus. */
export const FINAL_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = AGENT_RUN_STATUSES.filter(
  (s) => s !== 'started',
);

/** Causes d'échec signalées par n8n. */
export const AGENT_RUN_FAILURE_CODES = [
  /** Réponse du modèle non conforme au schéma attendu (après les relances de n8n). */
  'INVALID_OUTPUT',
  /** Le modèle n'a pas répondu dans le délai (timeoutSeconds). */
  'LLM_TIMEOUT',
  /** Ollama injoignable. */
  'LLM_UNAVAILABLE',
  /** Erreur renvoyée par Ollama. */
  'LLM_ERROR',
  /** Contexte trop long pour num_ctx. */
  'CONTEXT_TOO_LARGE',
  /** Erreur du workflow n8n lui-même. */
  'WORKFLOW_ERROR',
] as const;
export type AgentRunFailureCode = (typeof AGENT_RUN_FAILURE_CODES)[number];

/** Signal de vie attendu de n8n pendant une exécution (secondes). */
export const AGENT_HEARTBEAT_INTERVAL_SECONDS = 300;

/** Taille maximale de la sortie brute conservée en cas de rejet (caractères). */
export const AGENT_RUN_RAW_OUTPUT_MAX_LENGTH = 50_000;

/** Identifiant d'exécution n8n (traçabilité, et prise de mission idempotente). */
export const n8nExecutionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, {
    error: 'Identifiant d’exécution n8n invalide (lettres, chiffres, « . _ : - »)',
  });

const countSchema = z.number().int().min(0).max(10_000_000);

// ---------------------------------------------------------------------------
// Requêtes de l'agent (n8n)
// ---------------------------------------------------------------------------

/** Prise de mission : n8n transmet l'identifiant de son exécution. */
export const claimRunRequestSchema = z.strictObject({
  n8nExecutionId: n8nExecutionIdSchema,
});
export type ClaimRunRequest = z.infer<typeof claimRunRequestSchema>;

/**
 * Signal de vie. L'identifiant de l'exécution n8n doit être celui de la prise de mission : une autre
 * exécution n8n (ou un autre agent) ne peut pas maintenir en vie une exécution qui n'est pas la sienne.
 */
export const runHeartbeatRequestSchema = z.strictObject({
  n8nExecutionId: n8nExecutionIdSchema,
});
export type RunHeartbeatRequest = z.infer<typeof runHeartbeatRequestSchema>;

/** Échec signalé par n8n. Le CRM décide seul de la suite (remise en attente ou blocage). */
export const runFailureRequestSchema = z.strictObject({
  /** Exécution n8n de la prise de mission (même contrôle que le signal de vie). */
  n8nExecutionId: n8nExecutionIdSchema,
  code: z.enum(AGENT_RUN_FAILURE_CODES),
  message: z.string().trim().min(1).max(2000),
  /** Sortie brute du modèle, conservée pour comprendre un rejet. */
  rawOutput: z.string().max(AGENT_RUN_RAW_OUTPUT_MAX_LENGTH).optional(),
  promptTokens: countSchema.optional(),
  outputTokens: countSchema.optional(),
  /** Durée cumulée des appels au modèle (millisecondes). */
  llmMs: countSchema.optional(),
});
export type RunFailureRequest = z.infer<typeof runFailureRequestSchema>;

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export const agentRunSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  agentId: z.string(),
  /** Numéro de tentative de la mission (attemptCount au démarrage). */
  attempt: z.number().int(),
  status: z.enum(AGENT_RUN_STATUSES),
  n8nExecutionId: z.string().nullable(),
  promptVersion: z.number().int(),
  /** Copie des paramètres utilisés pour cette exécution. */
  settings: agentModelSettingsSchema,
  startedAt: z.string(),
  heartbeatAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  promptTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  llmMs: z.number().int().nullable(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

/** Suite décidée par le CRM après un échec. */
export const RUN_FAILURE_DECISIONS = ['released', 'blocked'] as const;
export type RunFailureDecision = (typeof RUN_FAILURE_DECISIONS)[number];

/**
 * Réponse de POST /api/agent/runs/claim (201 : nouvelle prise ; 200 : même exécution n8n rejouée).
 * Aucune mission disponible : 204, sans corps.
 */
export const claimRunResponseSchema = z.object({
  run: agentRunSchema,
  mission: missionSchema,
  /** true : mission reprise après une demande de modification (déjà en cours, pas de nouveau démarrage). */
  resumed: z.boolean(),
  /** true : cette exécution n8n avait déjà pris une mission ; c'est la même qui est renvoyée. */
  replayed: z.boolean(),
});
export type ClaimRunResponse = z.infer<typeof claimRunResponseSchema>;

/** Réponse de POST /api/agent/runs/:id/heartbeat. */
export const runHeartbeatResponseSchema = z.object({ run: agentRunSchema });
export type RunHeartbeatResponse = z.infer<typeof runHeartbeatResponseSchema>;

/**
 * Réponse de POST /api/agent/runs/:id/failure : exécution close et suite décidée par le CRM.
 * replayed : le même échec avait déjà été enregistré (n8n a renvoyé sa requête) ; rien n'a changé.
 */
export const runFailureResponseSchema = z.object({
  run: agentRunSchema,
  mission: missionSchema,
  decision: z.enum(RUN_FAILURE_DECISIONS),
  replayed: z.boolean(),
});
export type RunFailureResponse = z.infer<typeof runFailureResponseSchema>;

// ---------------------------------------------------------------------------
// Consultation (étape 2h) : lecture seule, jamais la sortie brute du modèle
// ---------------------------------------------------------------------------

/** Mission d'une exécution, résumée (ce qu'il faut pour comprendre ce qui s'est passé). */
export const runMissionSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  room: z.enum(ROOM_IDS),
  status: z.enum(MISSION_STATUSES),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
});
export type RunMissionSummary = z.infer<typeof runMissionSummarySchema>;

/** GET /api/agent/runs/:id : une exécution de l'agent authentifié, et sa mission. */
export const agentRunDetailResponseSchema = z.object({
  run: agentRunSchema,
  mission: runMissionSummarySchema,
});
export type AgentRunDetailResponse = z.infer<typeof agentRunDetailResponseSchema>;

export const RUN_LIST_SORTS = ['recent', 'oldest'] as const;

/** Accepte "a,b" ou des paramètres répétés (?status=a&status=b). */
const runListParam = <T extends z.ZodType<string>>(item: T) =>
  z.preprocess(
    (value) =>
      (Array.isArray(value) ? value : [value])
        .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v !== ''),
    z.array(item).min(1),
  );

/** GET /api/runs : filtres, tri chronologique (date de début) et pagination. */
export const runListQuerySchema = z
  .strictObject({
    agentId: agentIdSchema.optional(),
    missionId: z.string().trim().min(1).max(36).optional(),
    status: runListParam(z.enum(AGENT_RUN_STATUSES)).optional(),
    /** Exécutions démarrées à partir de cette date (ISO 8601, incluse). */
    from: z.iso.datetime().optional(),
    /** Exécutions démarrées avant cette date (ISO 8601, exclue). */
    to: z.iso.datetime().optional(),
    /** "recent" : plus récentes d'abord (défaut) ; "oldest" : plus anciennes d'abord. */
    sort: z.enum(RUN_LIST_SORTS).default('recent'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from < q.to, {
    error: 'La date de début de période doit précéder la date de fin',
    path: ['to'],
  });
export type RunListQuery = z.output<typeof runListQuerySchema>;

/** Exécution dans le journal : l'exécution, sa mission et l'agent, en une ligne. */
export const runListItemSchema = agentRunSchema.extend({
  agentName: z.string(),
  mission: runMissionSummarySchema,
  /** Durée de l'exécution (fin − début), null tant qu'elle est en cours. */
  durationMs: z.number().int().nullable(),
  /** Une sortie brute a été conservée (rejet) ; elle n'est jamais renvoyée par le journal. */
  hasRawOutput: z.boolean(),
});
export type RunListItem = z.infer<typeof runListItemSchema>;

export const runListResponseSchema = z.object({
  items: z.array(runListItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type RunListResponse = z.infer<typeof runListResponseSchema>;
