import { z } from 'zod';
import { agentIdSchema } from './agents';
import {
  ACTIONS_REQUIRING_REASON,
  ACTIONS_WITH_OUTPUT,
  DECISIONS_REQUIRING_REASON,
  MISSION_ACTIONS,
  MISSION_EVENT_ACTIONS,
  VALIDATION_DECISIONS,
  VALIDATION_OUTCOMES,
} from './missionLifecycle';
import { ACTOR_TYPES, MISSION_ATTEMPTS, MISSION_PRIORITY, MISSION_STATUSES } from './missions';
import { prospectSummarySchema } from './prospectSummary';
import { ROOM_IDS } from './rooms';

/**
 * Contrat de l'API des missions : schémas de requête et de réponse,
 * utilisés pour valider côté serveur et typer côté interface.
 */

/** Objet JSON libre (données d'entrée, résultat). */
export const jsonObjectSchema = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof jsonObjectSchema>;

/** Type de mission : identifiant en minuscules, ex. "search_creators" ou "analysis.score". */
export const missionTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, {
    error: 'Le type doit être en minuscules (lettres, chiffres, "_" et ".")',
  });

const reasonSchema = z.string().trim().min(1).max(2000);
const versionSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

export const createMissionRequestSchema = z.strictObject({
  type: missionTypeSchema,
  room: z.enum(ROOM_IDS),
  priority: z
    .number()
    .int()
    .min(MISSION_PRIORITY.MIN)
    .max(MISSION_PRIORITY.MAX)
    .default(MISSION_PRIORITY.DEFAULT),
  input: jsonObjectSchema.default({}),
  /** Fixé à la création, non modifiable ensuite : impossible de contourner une validation. */
  requiresValidation: z.boolean().default(false),
  /** Agent responsable : identifiant « agent-… » d'un agent existant (vérifié par le serveur). */
  agentId: agentIdSchema.nullable().default(null),
  /** Prospect concerné par la mission (dossier central), si pertinent. */
  prospectId: z.string().min(1).max(36).nullable().default(null),
  maxAttempts: z
    .number()
    .int()
    .min(MISSION_ATTEMPTS.MIN)
    .max(MISSION_ATTEMPTS.MAX)
    .default(MISSION_ATTEMPTS.DEFAULT),
});
export type CreateMissionRequest = z.input<typeof createMissionRequestSchema>;
export type CreateMissionInput = z.output<typeof createMissionRequestSchema>;

export const missionTransitionRequestSchema = z
  .strictObject({
    action: z.enum(MISSION_ACTIONS),
    reason: reasonSchema.optional(),
    /** Résultat produit (uniquement pour "submit_for_validation" et "complete"). */
    output: jsonObjectSchema.optional(),
    /** Code de l'erreur à l'origine d'un blocage (uniquement pour "block"). */
    errorCode: z.string().trim().min(1).max(64).optional(),
    /** Si fourni, l'action est refusée si la mission a changé depuis cette version. */
    expectedVersion: versionSchema.optional(),
  })
  .superRefine((req, ctx) => {
    if (ACTIONS_REQUIRING_REASON.includes(req.action) && !req.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Un motif est obligatoire pour l'action « ${req.action} »`,
      });
    }
    if (req.output !== undefined && !ACTIONS_WITH_OUTPUT.includes(req.action)) {
      ctx.addIssue({
        code: 'custom',
        path: ['output'],
        message: `Un résultat ne peut pas être transmis avec l'action « ${req.action} »`,
      });
    }
    if (req.errorCode !== undefined && req.action !== 'block') {
      ctx.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Un code d’erreur ne peut être transmis qu’avec l’action « block »',
      });
    }
  });
export type MissionTransitionRequest = z.infer<typeof missionTransitionRequestSchema>;

export const validationDecisionRequestSchema = z
  .strictObject({
    decision: z.enum(VALIDATION_DECISIONS),
    reason: reasonSchema.optional(),
    expectedVersion: versionSchema.optional(),
  })
  .superRefine((req, ctx) => {
    if (DECISIONS_REQUIRING_REASON.includes(req.decision) && !req.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Un motif est obligatoire pour la décision « ${req.decision} »`,
      });
    }
  });
export type ValidationDecisionRequest = z.infer<typeof validationDecisionRequestSchema>;

/** Accepte "a,b" ou des paramètres répétés (?status=a&status=b). */
function listParam<T extends z.ZodType<string>>(itemSchema: T) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value : [value];
    return raw
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
  }, z.array(itemSchema).min(1));
}

export const MISSION_LIST_SORTS = ['recent', 'priority'] as const;

export const missionListQuerySchema = z.strictObject({
  status: listParam(z.enum(MISSION_STATUSES)).optional(),
  room: listParam(z.enum(ROOM_IDS)).optional(),
  type: listParam(missionTypeSchema).optional(),
  prospectId: z.string().min(1).max(36).optional(),
  /** "recent" : plus récentes d'abord. "priority" : plus prioritaires, puis plus anciennes. */
  sort: z.enum(MISSION_LIST_SORTS).default('recent'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MissionListQuery = z.output<typeof missionListQuerySchema>;

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

const isoDate = z.iso.datetime();

export const missionSchema = z.object({
  id: z.string(),
  type: z.string(),
  room: z.enum(ROOM_IDS),
  status: z.enum(MISSION_STATUSES),
  priority: z.number().int(),
  input: jsonObjectSchema,
  output: jsonObjectSchema.nullable(),
  requiresValidation: z.boolean(),
  validationOutcome: z.enum(VALIDATION_OUTCOMES).nullable(),
  validatedAt: isoDate.nullable(),
  validatedBy: z.string().nullable(),
  agentId: z.string().nullable(),
  prospectId: z.string().nullable(),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  /** Incrémentée à chaque modification (contrôle des modifications concurrentes). */
  version: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type Mission = z.infer<typeof missionSchema>;

/** Valeur avant / après d'un champ modifié. */
export const fieldChangeSchema = z.object({ from: z.json(), to: z.json() });

export const missionEventSchema = z.object({
  id: z.number().int(),
  missionId: z.string(),
  action: z.enum(MISSION_EVENT_ACTIONS),
  actorType: z.enum(ACTOR_TYPES),
  actorId: z.string().nullable(),
  fromStatus: z.enum(MISSION_STATUSES).nullable(),
  toStatus: z.enum(MISSION_STATUSES),
  changes: z.record(z.string(), fieldChangeSchema),
  reason: z.string().nullable(),
  createdAt: isoDate,
});
export type MissionEvent = z.infer<typeof missionEventSchema>;

export const missionCommandResponseSchema = z.object({
  mission: missionSchema,
  event: missionEventSchema,
});
export type MissionCommandResponse = z.infer<typeof missionCommandResponseSchema>;

/** Mission dans une liste : accompagnée du résumé de son prospect. */
export const missionListItemSchema = missionSchema.extend({
  prospect: prospectSummarySchema.nullable(),
});
export type MissionListItem = z.infer<typeof missionListItemSchema>;

export const missionListResponseSchema = z.object({
  items: z.array(missionListItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type MissionListResponse = z.infer<typeof missionListResponseSchema>;

export const missionEventsResponseSchema = z.object({
  items: z.array(missionEventSchema),
});
export type MissionEventsResponse = z.infer<typeof missionEventsResponseSchema>;
