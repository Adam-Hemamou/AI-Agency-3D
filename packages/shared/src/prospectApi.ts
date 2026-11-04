import { z } from 'zod';
import { missionSchema } from './missionApi';
import { prospectSummarySchema } from './prospectSummary';
import { ACTOR_TYPES, MISSION_PRIORITY } from './missions';
import {
  DECISION_KINDS,
  EMAIL_DECISIONS,
  INSIGHT_KINDS,
  MESSAGE_DELIVERY,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  PRODUCTION_STATUSES,
  PROSPECT_DECISIONS,
  PROSPECT_EVENT_TYPES,
  PROSPECT_STAGES,
  RELATIONSHIP_STATUSES,
} from './prospects';
import { ROOM_IDS } from './rooms';

/**
 * Contrat de l'API du CRM. Les contenus JSON (découverte, analyses, productions)
 * ont un schéma précis : le serveur les valide à l'écriture ET à la lecture.
 */

const isoDate = z.iso.datetime();
const text = z.string().trim().min(1);
const longText = z.string().trim().min(1).max(20_000);
const versionSchema = z.number().int().nonnegative();
const idSchema = z.string().min(1).max(36);

// ---------------------------------------------------------------------------
// Contenus structurés
// ---------------------------------------------------------------------------

/** Une information d'analyse, toujours qualifiée : fait vérifié, observation ou hypothèse. */
export const insightSchema = z.object({
  kind: z.enum(INSIGHT_KINDS),
  text,
  source: z.string().nullable().default(null),
});
export type Insight = z.infer<typeof insightSchema>;

export const discoverySchema = z.object({
  source: text,
  reason: text,
  keywords: z.array(text).default([]),
  criteria: z.array(text).default([]),
  discoveredBy: z.string().nullable().default(null),
  qualification: z.object({
    targetFit: text,
    potentialInterest: text,
    firstObservation: text,
    missingInfo: z.array(text).default([]),
    transferReason: z.string().nullable().default(null),
  }),
});
export type Discovery = z.infer<typeof discoverySchema>;

export const videoRefSchema = z.object({
  title: text,
  url: z.string().nullable().default(null),
  publishedAt: isoDate,
  views: z.number().int().nonnegative().nullable().default(null),
  durationSeconds: z.number().int().positive().nullable().default(null),
  contentType: z.string().nullable().default(null),
});
export type VideoRef = z.infer<typeof videoRefSchema>;

export const scoreCriterionSchema = z.object({
  label: text,
  /** Poids du critère dans le score (somme des poids = 100). */
  weight: z.number().min(0).max(100),
  /** Note du critère sur 10. */
  value: z.number().min(0).max(10),
  justification: text,
});
export type ScoreCriterion = z.infer<typeof scoreCriterionSchema>;

export const sourceRefSchema = z.object({
  label: text,
  url: z.string().nullable().default(null),
});

export const analysisContentSchema = z.object({
  international: z.object({
    mainLanguage: text,
    otherLanguages: z.array(text).default([]),
    signals: z.array(insightSchema).default([]),
    markets: z.array(insightSchema).default([]),
    adaptableContent: z.array(insightSchema).default([]),
  }),
  activity: z.object({
    publishingFrequency: z.string().nullable().default(null),
    recentVideos: z.array(videoRefSchema).default([]),
    contentTypes: z.array(text).default([]),
    trend: insightSchema.nullable().default(null),
  }),
  commercial: z.object({
    potential: text,
    dubbingInterest: text,
    offerFit: text,
    strengths: z.array(insightSchema).default([]),
    weaknesses: z.array(insightSchema).default([]),
    opportunities: z.array(insightSchema).default([]),
    risks: z.array(insightSchema).default([]),
    recommendations: z.array(text).default([]),
  }),
  uncertainties: z.array(text).default([]),
});
export type AnalysisContent = z.infer<typeof analysisContentSchema>;

export const videoExcerptContentSchema = z.object({
  videoUrl: z.string().nullable().default(null),
  title: text,
  publishedAt: isoDate.nullable().default(null),
  durationSeconds: z.number().int().positive().nullable().default(null),
  excerptStart: z.number().int().nonnegative(),
  excerptEnd: z.number().int().positive(),
  reason: z.string().nullable().default(null),
  rightsNote: z.string().nullable().default(null),
});

export const dubbingAttemptSchema = z.object({
  at: isoDate,
  status: z.enum(['simulated', 'failed', 'generated']),
  note: z.string().nullable().default(null),
});

export const dubbingContentSchema = z.object({
  sourceLanguage: text,
  targetLanguage: text,
  voice: text,
  tool: text,
  settings: z.record(z.string(), z.string()).default({}),
  generationStatus: z.enum(['not_started', 'simulated', 'failed', 'generated']),
  generatedAt: isoDate.nullable().default(null),
  resultUrl: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  attempts: z.array(dubbingAttemptSchema).default([]),
});

export const proposalContentSchema = z.object({
  profileSummary: text,
  needs: z.array(text).default([]),
  arguments: z.array(text).default([]),
  benefits: z.array(text).default([]),
  languages: z.array(text).default([]),
  valueProposition: text,
  recommendations: z.array(text).default([]),
  serviceType: text,
  offerDescription: text,
  demoUrl: z.string().nullable().default(null),
});

export const emailContentSchema = z.object({
  to: z.string().nullable().default(null),
  recipientName: z.string().nullable().default(null),
  subject: z.string().trim().min(1).max(250),
  body: longText,
  demoUrl: z.string().nullable().default(null),
});
export type EmailContent = z.infer<typeof emailContentSchema>;

/** Contenu d'une production, selon son type. */
export const productionContentSchemas = {
  video_excerpt: videoExcerptContentSchema,
  dubbing: dubbingContentSchema,
  proposal: proposalContentSchema,
  email: emailContentSchema,
} as const;

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export const prospectSchema = prospectSummarySchema.extend({
  channelHandle: z.string().nullable(),
  channelUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  country: z.string().nullable(),
  subscriberCount: z.number().int().nullable(),
  viewCount: z.number().int().nullable(),
  videoCount: z.number().int().nullable(),
  statsSource: z.string().nullable(),
  statsUpdatedAt: isoDate.nullable(),
  contactEmail: z.string().nullable(),
  contactName: z.string().nullable(),
  contactSource: z.string().nullable(),
  discovery: discoverySchema.nullable(),
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).nullable(),
  priority: z.number().int(),
  doNotContact: z.boolean(),
  doNotContactReason: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionAt: isoDate.nullable(),
  isDemo: z.boolean(),
  version: z.number().int(),
  discoveredAt: isoDate,
  lastActivityAt: isoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Prospect = z.infer<typeof prospectSchema>;

const authorSchema = {
  actorType: z.enum(ACTOR_TYPES),
  actorId: z.string().nullable(),
};

export const analysisSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  missionId: z.string().nullable(),
  version: z.number().int(),
  summary: z.string(),
  conclusion: z.string(),
  /** Score sur 100, calculé à partir des critères (null si pas de score). */
  score: z.number().int().nullable(),
  scoreCriteria: z.array(scoreCriterionSchema),
  priority: z.number().int(),
  content: analysisContentSchema,
  sources: z.array(sourceRefSchema),
  createdAt: isoDate,
  ...authorSchema,
});
export type Analysis = z.infer<typeof analysisSchema>;

const productionBase = {
  id: z.string(),
  prospectId: z.string(),
  missionId: z.string().nullable(),
  version: z.number().int(),
  status: z.enum(PRODUCTION_STATUSES),
  title: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  ...authorSchema,
};

export const productionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...productionBase,
    kind: z.literal('video_excerpt'),
    content: videoExcerptContentSchema,
  }),
  z.object({ ...productionBase, kind: z.literal('dubbing'), content: dubbingContentSchema }),
  z.object({ ...productionBase, kind: z.literal('proposal'), content: proposalContentSchema }),
  z.object({ ...productionBase, kind: z.literal('email'), content: emailContentSchema }),
]);
export type Production = z.infer<typeof productionSchema>;
export type ProductionOf<K extends Production['kind']> = Extract<Production, { kind: K }>;

export const decisionSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  missionId: z.string().nullable(),
  productionId: z.string().nullable(),
  kind: z.enum(DECISION_KINDS),
  reason: z.string().nullable(),
  createdAt: isoDate,
  ...authorSchema,
});
export type Decision = z.infer<typeof decisionSchema>;

export const messageSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  productionId: z.string().nullable(),
  direction: z.enum(MESSAGE_DIRECTIONS),
  kind: z.enum(MESSAGE_KINDS),
  delivery: z.enum(MESSAGE_DELIVERY),
  fromAddress: z.string().nullable(),
  toAddress: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  occurredAt: isoDate,
  createdAt: isoDate,
});
export type Message = z.infer<typeof messageSchema>;

export const prospectEventSchema = z.object({
  id: z.number().int(),
  prospectId: z.string(),
  missionId: z.string().nullable(),
  type: z.enum(PROSPECT_EVENT_TYPES),
  room: z.enum(ROOM_IDS).nullable(),
  title: z.string(),
  details: z.string().nullable(),
  payload: z.record(z.string(), z.json()),
  createdAt: isoDate,
  ...authorSchema,
});
export type ProspectEvent = z.infer<typeof prospectEventSchema>;

/** Dossier complet d'un prospect : tout ce qui le concerne, en un seul appel. */
export const prospectDossierSchema = z.object({
  prospect: prospectSchema,
  missions: z.array(missionSchema),
  analyses: z.array(analysisSchema),
  productions: z.array(productionSchema),
  decisions: z.array(decisionSchema),
  messages: z.array(messageSchema),
  events: z.array(prospectEventSchema),
});
export type ProspectDossier = z.infer<typeof prospectDossierSchema>;

export const prospectListResponseSchema = z.object({
  items: z.array(prospectSummarySchema),
  total: z.number().int(),
});
export type ProspectListResponse = z.infer<typeof prospectListResponseSchema>;

// ---------------------------------------------------------------------------
// Requêtes (actions de l'interface)
// ---------------------------------------------------------------------------

const optionalReason = z.string().trim().max(2000).optional();

export const prospectDecisionRequestSchema = z
  .strictObject({
    missionId: idSchema,
    decision: z.enum(PROSPECT_DECISIONS),
    /** Motif du refus (facultatif). */
    reason: optionalReason,
    /** Consigne pour la nouvelle analyse (facultative). */
    instruction: optionalReason,
    expectedVersion: versionSchema.optional(),
  })
  .superRefine((req, ctx) => {
    if (req.instruction && req.decision !== 'request_reanalysis') {
      ctx.addIssue({
        code: 'custom',
        path: ['instruction'],
        message: 'Une consigne ne peut accompagner qu’une demande de nouvelle analyse',
      });
    }
  });
export type ProspectDecisionRequest = z.infer<typeof prospectDecisionRequestSchema>;

export const emailDecisionRequestSchema = z
  .strictObject({
    missionId: idSchema,
    productionId: idSchema,
    decision: z.enum(EMAIL_DECISIONS),
    reason: optionalReason,
    expectedVersion: versionSchema.optional(),
  })
  .superRefine((req, ctx) => {
    if (req.decision === 'request_changes' && !req.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Précisez la modification attendue',
      });
    }
  });
export type EmailDecisionRequest = z.infer<typeof emailDecisionRequestSchema>;

export const emailDraftRequestSchema = z.strictObject({
  /** Version de l'e-mail que l'on modifie (doit être la plus récente). */
  productionId: idSchema,
  subject: z.string().trim().min(1).max(250),
  body: longText,
});
export type EmailDraftRequest = z.infer<typeof emailDraftRequestSchema>;

export const simulatedSendRequestSchema = z.strictObject({ productionId: idSchema });

export const followupUpdateRequestSchema = z.strictObject({
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionAt: isoDate.nullable().optional(),
  priority: z.number().int().min(MISSION_PRIORITY.MIN).max(MISSION_PRIORITY.MAX).optional(),
  doNotContact: z.boolean().optional(),
  doNotContactReason: z.string().trim().max(500).nullable().optional(),
  expectedVersion: versionSchema.optional(),
});
export type FollowupUpdateRequest = z.infer<typeof followupUpdateRequestSchema>;

export const noteRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(5000) });

export const replyRequestSchema = z.strictObject({
  subject: z.string().trim().max(250).optional(),
  body: longText,
  receivedAt: isoDate.optional(),
});
export type ReplyRequest = z.infer<typeof replyRequestSchema>;

export const followupMessageRequestSchema = z.strictObject({
  subject: z.string().trim().min(1).max(250),
  body: longText,
});
export type FollowupMessageRequest = z.infer<typeof followupMessageRequestSchema>;

export const prospectListQuerySchema = z.strictObject({
  stage: z.enum(PROSPECT_STAGES).optional(),
  search: z.string().trim().max(100).optional(),
});

/** Réponse commune des actions : le dossier à jour. */
export const prospectCommandResponseSchema = prospectDossierSchema;

// ---------------------------------------------------------------------------
// Écritures réservées au pipeline (agents, puis n8n) : jamais appelées par l'interface
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
const optionalCount = z.number().int().nonnegative().nullable().default(null);

export const createProspectRequestSchema = z.strictObject({
  creatorName: z.string().trim().min(1).max(120),
  channelName: z.string().trim().min(1).max(160),
  channelHandle: optionalText(120),
  youtubeChannelId: optionalText(64),
  channelUrl: optionalText(500),
  avatarUrl: optionalText(500),
  category: optionalText(80),
  description: optionalText(5000),
  country: optionalText(80),
  subscriberCount: optionalCount,
  viewCount: optionalCount,
  videoCount: optionalCount,
  statsSource: optionalText(200),
  statsUpdatedAt: isoDate.nullable().default(null),
  contactEmail: optionalText(254),
  contactName: optionalText(120),
  contactSource: optionalText(200),
  discovery: discoverySchema,
  priority: z
    .number()
    .int()
    .min(MISSION_PRIORITY.MIN)
    .max(MISSION_PRIORITY.MAX)
    .default(MISSION_PRIORITY.DEFAULT),
  isDemo: z.boolean().default(false),
});
export type CreateProspectRequest = z.input<typeof createProspectRequestSchema>;
export type CreateProspectInput = z.output<typeof createProspectRequestSchema>;

export const createAnalysisRequestSchema = z.strictObject({
  missionId: idSchema.nullable().default(null),
  summary: longText,
  conclusion: longText,
  scoreCriteria: z.array(scoreCriterionSchema).default([]),
  priority: z.number().int().min(MISSION_PRIORITY.MIN).max(MISSION_PRIORITY.MAX),
  content: analysisContentSchema,
  sources: z.array(sourceRefSchema).default([]),
});
export type CreateAnalysisRequest = z.input<typeof createAnalysisRequestSchema>;

const productionRequestBase = {
  missionId: idSchema.nullable().default(null),
  status: z.enum(PRODUCTION_STATUSES).default('draft'),
  title: z.string().trim().max(250).nullable().default(null),
};

export const createProductionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...productionRequestBase,
    kind: z.literal('video_excerpt'),
    content: videoExcerptContentSchema,
  }),
  z.strictObject({
    ...productionRequestBase,
    kind: z.literal('dubbing'),
    content: dubbingContentSchema,
  }),
  z.strictObject({
    ...productionRequestBase,
    kind: z.literal('proposal'),
    content: proposalContentSchema,
  }),
  z.strictObject({
    ...productionRequestBase,
    kind: z.literal('email'),
    content: emailContentSchema,
  }),
]);
export type CreateProductionRequest = z.input<typeof createProductionRequestSchema>;

/**
 * Score sur 100 à partir des critères pondérés (notes sur 10).
 * Null si aucun critère : jamais de score sans critères identifiables.
 */
export function computeAnalysisScore(criteria: readonly ScoreCriterion[]): number | null {
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (criteria.length === 0 || totalWeight === 0) return null;
  const weighted = criteria.reduce((sum, c) => sum + c.weight * c.value, 0);
  return Math.round((weighted / totalWeight) * 10);
}
