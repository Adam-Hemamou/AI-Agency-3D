import { z } from 'zod';
import { agentIdSchema } from './agents';
import { MISSION_PRIORITY, MISSION_STATUSES } from './missions';

/**
 * Campagnes de prospection et mémoire des chaînes écartées.
 *
 * - Une campagne décrit CE QUE le Prospecteur recherche (thématiques, mots-clés, langues, pays,
 *   audience, activité récente, objectif quotidien). Elle est définie et modifiée dans le CRM par
 *   l'utilisateur ; n8n lit les critères ACTUELS au moment du travail : aucun workflow à modifier.
 * - Chaque jour (heure de Paris), le CRM crée UNE mission de recherche par campagne active, attribuée
 *   à l'agent de la campagne (ou libre en salle de prospection). La base garantit l'unicité.
 * - Les chaînes écartées sont mémorisées par campagne, avec leur motif et une date de réévaluation :
 *   le Prospecteur ne réévalue pas chaque jour les mêmes chaînes. Les doublons de PROSPECTS, eux,
 *   restent impossibles quelle que soit la campagne (index uniques de la table des prospects).
 */

// ---------------------------------------------------------------------------
// Critères
// ---------------------------------------------------------------------------

/** Bornes des critères (au-delà, la valeur est refusée). */
export const CAMPAIGN_LIMITS = {
  themes: 20,
  keywords: 50,
  languages: 10,
  countries: 30,
  /** Jours depuis la dernière vidéo publiée (« activité récente »). */
  maxDaysSinceLastVideo: { min: 1, max: 365, default: 30 },
  /** Nouveaux prospects par jour pour la campagne (le quota global des agents s'applique aussi). */
  dailyTarget: { min: 1, max: 50, default: 5 },
  /** Délai avant qu'une chaîne écartée puisse être réévaluée. */
  reevaluationDays: { min: 7, max: 730, default: 90 },
  subscribers: { max: 2_000_000_000 },
} as const;

/** Langue : code ISO 639-1 en minuscules (« fr », « en », « es »…). */
export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2}$/, { error: 'Langue : code ISO 639-1 en minuscules (ex. « fr »)' });

/** Pays : code ISO 3166-1 alpha-2 en majuscules (« FR », « US »…), comme regionCode de YouTube. */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, { error: 'Pays : code ISO 3166-1 alpha-2 en majuscules (ex. « FR »)' });

const uniqueList = <T extends z.ZodType<string>>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((list) => new Set(list).size === list.length, { error: 'Valeur en double' });

const textItem = (max: number) => z.string().trim().min(1).max(max);
const subscriberCount = z.number().int().nonnegative().max(CAMPAIGN_LIMITS.subscribers.max);
const bounded = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

/** Champs d'une campagne modifiables par l'utilisateur. */
const campaignFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000).nullable(),
  /** Thématiques visées (ex. « cuisine », « voyage »), pour l'évaluation par le modèle. */
  themes: uniqueList(textItem(80), CAMPAIGN_LIMITS.themes),
  /** Mots-clés des recherches YouTube : au moins un. */
  keywords: uniqueList(textItem(100), CAMPAIGN_LIMITS.keywords).min(1, {
    error: 'Indiquez au moins un mot-clé de recherche',
  }),
  /** Langues des contenus recherchés (vide : toutes). */
  languages: uniqueList(languageCodeSchema, CAMPAIGN_LIMITS.languages),
  /** Pays ciblés (vide : tous). */
  countries: uniqueList(countryCodeSchema, CAMPAIGN_LIMITS.countries),
  minSubscribers: subscriberCount.nullable(),
  maxSubscribers: subscriberCount.nullable(),
  maxDaysSinceLastVideo: bounded(CAMPAIGN_LIMITS.maxDaysSinceLastVideo),
  dailyTarget: bounded(CAMPAIGN_LIMITS.dailyTarget),
  reevaluationDays: bounded(CAMPAIGN_LIMITS.reevaluationDays),
  priority: z.number().int().min(MISSION_PRIORITY.MIN).max(MISSION_PRIORITY.MAX),
  /** Agent qui reçoit les missions (null : missions libres de la salle de prospection). */
  agentId: agentIdSchema.nullable(),
  /** false : aucune nouvelle mission ; les missions en attente sont annulées. */
  enabled: z.boolean(),
};

const subscribersInOrder = (c: {
  minSubscribers?: number | null;
  maxSubscribers?: number | null;
}) => c.minSubscribers == null || c.maxSubscribers == null || c.minSubscribers <= c.maxSubscribers;
const SUBSCRIBERS_ERROR = {
  error: 'Le nombre minimum d’abonnés doit être inférieur ou égal au maximum',
  path: ['maxSubscribers'],
};

export const createCampaignRequestSchema = z
  .strictObject({
    name: campaignFields.name,
    description: campaignFields.description.default(null),
    themes: campaignFields.themes.default([]),
    keywords: campaignFields.keywords,
    languages: campaignFields.languages.default([]),
    countries: campaignFields.countries.default([]),
    minSubscribers: campaignFields.minSubscribers.default(null),
    maxSubscribers: campaignFields.maxSubscribers.default(null),
    maxDaysSinceLastVideo: campaignFields.maxDaysSinceLastVideo.default(
      CAMPAIGN_LIMITS.maxDaysSinceLastVideo.default,
    ),
    dailyTarget: campaignFields.dailyTarget.default(CAMPAIGN_LIMITS.dailyTarget.default),
    reevaluationDays: campaignFields.reevaluationDays.default(
      CAMPAIGN_LIMITS.reevaluationDays.default,
    ),
    priority: campaignFields.priority.default(MISSION_PRIORITY.DEFAULT),
    agentId: campaignFields.agentId.default(null),
    /** Créée désactivée par défaut : l'activation est une décision explicite. */
    enabled: campaignFields.enabled.default(false),
  })
  .refine(subscribersInOrder, SUBSCRIBERS_ERROR);
export type CreateCampaignRequest = z.input<typeof createCampaignRequestSchema>;
export type CreateCampaignInput = z.output<typeof createCampaignRequestSchema>;

/** Modification : seuls les champs fournis changent. expectedVersion protège des écrasements. */
export const updateCampaignRequestSchema = z
  .strictObject({
    expectedVersion: z.number().int().nonnegative(),
    name: campaignFields.name.optional(),
    description: campaignFields.description.optional(),
    themes: campaignFields.themes.optional(),
    keywords: campaignFields.keywords.optional(),
    languages: campaignFields.languages.optional(),
    countries: campaignFields.countries.optional(),
    minSubscribers: campaignFields.minSubscribers.optional(),
    maxSubscribers: campaignFields.maxSubscribers.optional(),
    maxDaysSinceLastVideo: campaignFields.maxDaysSinceLastVideo.optional(),
    dailyTarget: campaignFields.dailyTarget.optional(),
    reevaluationDays: campaignFields.reevaluationDays.optional(),
    priority: campaignFields.priority.optional(),
    agentId: campaignFields.agentId.optional(),
    enabled: campaignFields.enabled.optional(),
  })
  .refine((req) => Object.keys(req).length > 1, { error: 'Aucune modification demandée' });
export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

/** Critères de recherche d'une campagne (ce que n8n utilise). */
export const campaignCriteriaSchema = z.object({
  themes: z.array(z.string()),
  keywords: z.array(z.string()),
  languages: z.array(z.string()),
  countries: z.array(z.string()),
  minSubscribers: z.number().int().nullable(),
  maxSubscribers: z.number().int().nullable(),
  maxDaysSinceLastVideo: z.number().int(),
  dailyTarget: z.number().int(),
  reevaluationDays: z.number().int(),
});
export type CampaignCriteria = z.infer<typeof campaignCriteriaSchema>;

export const campaignSchema = campaignCriteriaSchema.extend({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  agentId: z.string().nullable(),
  enabled: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const campaignListResponseSchema = z.object({ items: z.array(campaignSchema) });
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;

// ---------------------------------------------------------------------------
// Objectifs quotidiens et quota global
// ---------------------------------------------------------------------------

/** Activation et objectif d'une campagne, avant ou après une modification. */
export interface CampaignTargetState {
  enabled: boolean;
  dailyTarget: number;
}

/**
 * Règle : la somme des objectifs quotidiens des campagnes ACTIVES ne dépasse pas le quota global
 * de créations de prospects, pour que chacune puisse atteindre le sien. Est refusée uniquement
 * une modification qui ACTIVE la campagne ou AUGMENTE son objectif au-delà ; baisser un objectif
 * ou désactiver reste toujours possible (même si la somme dépasse déjà, ex. quota abaissé).
 * - otherActiveTargets : somme des objectifs des AUTRES campagnes actives ;
 * - before : état actuel (null pour une création).
 */
export function checkCampaignTargets(input: {
  otherActiveTargets: number;
  before: CampaignTargetState | null;
  after: CampaignTargetState;
  globalQuota: number;
}): { allowed: true } | { allowed: false; available: number } {
  const { otherActiveTargets, before, after, globalQuota } = input;
  // Déjà active, objectif inchangé ou baissé : jamais refusé.
  const notRaised = before !== null && before.enabled && after.dailyTarget <= before.dailyTarget;
  if (!after.enabled || notRaised) return { allowed: true };
  if (otherActiveTargets + after.dailyTarget <= globalQuota) return { allowed: true };
  return { allowed: false, available: Math.max(0, globalQuota - otherActiveTargets) };
}

// ---------------------------------------------------------------------------
// Missions de recherche générées par le CRM
// ---------------------------------------------------------------------------

/** Fréquence de la création des missions du jour. */
export const CAMPAIGN_SCHEDULER_INTERVAL_MINUTES = 5;

/**
 * GET /api/agent/missions/:id/campaign : ce que le Prospecteur doit rechercher maintenant (critères
 * ACTUELS de la campagne) et où il en est. enabled: false → la campagne a été désactivée : arrêter.
 */
export const agentCampaignContextSchema = z.object({
  mission: z.object({
    id: z.string(),
    status: z.enum(MISSION_STATUSES),
    /** Jour de la mission (AAAA-MM-JJ, heure de Paris). */
    day: z.string(),
  }),
  campaign: campaignCriteriaSchema.extend({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    version: z.number().int(),
  }),
  progress: z.object({
    /** Prospects créés dans cette mission. */
    created: z.number().int(),
    /** Prospects encore possibles dans cette mission (objectif quotidien). */
    remaining: z.number().int(),
    /** Chaînes écartées enregistrées dans cette mission. */
    rejected: z.number().int(),
  }),
});
export type AgentCampaignContext = z.infer<typeof agentCampaignContextSchema>;

// ---------------------------------------------------------------------------
// Mémoire des chaînes écartées
// ---------------------------------------------------------------------------

export const CHANNEL_PLATFORMS = ['youtube'] as const;
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export const REJECTION_REASON_CODES = [
  'off_target',
  'audience_too_small',
  'audience_too_large',
  'inactive',
  'language_mismatch',
  'country_mismatch',
  'made_for_kids',
  'no_dubbing_potential',
  'insufficient_data',
  'other',
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReasonCode, string> = {
  off_target: 'Hors des thématiques de la campagne',
  audience_too_small: 'Audience trop faible',
  audience_too_large: 'Audience trop importante',
  inactive: 'Pas d’activité récente',
  language_mismatch: 'Langue non ciblée',
  country_mismatch: 'Pays non ciblé',
  made_for_kids: 'Contenu destiné aux enfants',
  no_dubbing_potential: 'Pas de potentiel de doublage',
  insufficient_data: 'Informations insuffisantes',
  other: 'Autre motif',
};

/** Identifiant de chaîne YouTube (« UC… ») : lettres, chiffres, « - » et « _ ». */
export const youtubeChannelIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, { error: 'Identifiant de chaîne YouTube invalide' });

/** Nombre maximal de chaînes par vérification ou par enregistrement (un lot de l'API YouTube). */
export const CHANNEL_BATCH_MAX = 50;

/** Accepte "a,b" ou des paramètres répétés (?channelIds=a&channelIds=b). */
const csvList = <T extends z.ZodType<string>>(item: T, max: number) =>
  z.preprocess(
    (value) =>
      (Array.isArray(value) ? value : [value])
        .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v !== ''),
    uniqueList(item, max).min(1),
  );

/** GET /api/agent/channels/lookup : où en est chaque chaîne candidate, pour la campagne de la mission. */
export const channelLookupQuerySchema = z.strictObject({
  missionId: z.string().trim().min(1).max(36),
  channelIds: csvList(youtubeChannelIdSchema, CHANNEL_BATCH_MAX),
});
export type ChannelLookupQuery = z.output<typeof channelLookupQuerySchema>;

export const CHANNEL_LOOKUP_STATUSES = [
  /** Inconnue (ou écartée mais réévaluable) : à évaluer. */
  'new',
  /** Déjà un prospect (quelle que soit la campagne) : ne jamais le recréer. */
  'prospect',
  /** Écartée pour cette campagne, réévaluation pas encore permise. */
  'rejected',
] as const;

export const channelRejectionSchema = z.object({
  reasonCode: z.enum(REJECTION_REASON_CODES),
  reason: z.string().nullable(),
  rejectionCount: z.number().int(),
  firstRejectedAt: z.string(),
  rejectedAt: z.string(),
  reevaluateAfter: z.string(),
});
export type ChannelRejection = z.infer<typeof channelRejectionSchema>;

export const channelLookupResponseSchema = z.object({
  items: z.array(
    z.object({
      channelId: z.string(),
      status: z.enum(CHANNEL_LOOKUP_STATUSES),
      prospect: z.object({ id: z.string(), reference: z.string() }).nullable(),
      /** Dernier rejet pour CETTE campagne (même expiré : la date de réévaluation le dit). */
      rejection: channelRejectionSchema.nullable(),
    }),
  ),
});
export type ChannelLookupResponse = z.infer<typeof channelLookupResponseSchema>;

/** POST /api/agent/channels/rejections : chaînes écartées dans SA mission de recherche en cours. */
export const channelRejectionsRequestSchema = z.strictObject({
  missionId: z.string().trim().min(1).max(36),
  items: z
    .array(
      z.strictObject({
        channelId: youtubeChannelIdSchema,
        channelTitle: z.string().trim().min(1).max(160).nullable().default(null),
        reasonCode: z.enum(REJECTION_REASON_CODES),
        /** Précision libre (obligatoire pour « other »). */
        reason: z.string().trim().min(1).max(500).nullable().default(null),
      }),
    )
    .min(1)
    .max(CHANNEL_BATCH_MAX)
    .refine((items) => new Set(items.map((i) => i.channelId)).size === items.length, {
      error: 'Chaîne en double dans le lot',
    })
    .refine((items) => items.every((i) => i.reasonCode !== 'other' || i.reason !== null), {
      error: 'Précisez le motif « autre »',
    }),
});
export type ChannelRejectionsRequest = z.input<typeof channelRejectionsRequestSchema>;
export type ChannelRejectionsInput = z.output<typeof channelRejectionsRequestSchema>;
