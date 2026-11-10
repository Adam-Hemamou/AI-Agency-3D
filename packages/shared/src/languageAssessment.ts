import { z } from 'zod';
import { INSIGHT_KINDS } from './prospects';

/**
 * Évaluation linguistique d'un créateur YouTube : contrat du moteur déterministe du CRM
 * (apps/server/src/language). Le moteur calcule, à partir de données PUBLIQUES de la YouTube Data
 * API v3, la langue du contenu puis, pour CHACUNE des deux directions (FR → EN et EN → FR), un score
 * de potentiel, un niveau de confiance et les signaux qui les justifient.
 *
 * Trois notions à ne jamais confondre :
 * - le pays DÉCLARÉ par la chaîne (snippet.country) : ni une nationalité, ni une audience ;
 * - la langue du CONTENU (ce que le créateur publie) : estimée à partir des métadonnées et des textes ;
 * - la langue de l'AUDIENCE : jamais connue par l'API publique. Le moteur n'en donne que des indices
 *   (langue des commentaires échantillonnés) et des HYPOTHÈSES, jamais un fait.
 *
 * Niveaux de preuve (INSIGHT_KINDS, communs au CRM) :
 * - fact : valeur lue telle quelle dans un champ de l'API (souvent une DÉCLARATION du créateur) ;
 * - observation : indice calculé par le moteur sur des données publiques ;
 * - hypothesis : conclusion sur l'audience ou le potentiel, jamais certaine.
 *
 * Qwen3 ne calcule aucun de ces nombres : il n'intervient qu'ensuite, pour l'analyse qualitative.
 */

// ---------------------------------------------------------------------------
// Langues, directions, niveaux
// ---------------------------------------------------------------------------

/** Langues que le moteur sait reconnaître et évaluer. */
export const ASSESSED_LANGUAGES = ['fr', 'en'] as const;
export type AssessedLanguage = (typeof ASSESSED_LANGUAGES)[number];

export const ASSESSED_LANGUAGE_LABELS: Record<AssessedLanguage, string> = {
  fr: 'français',
  en: 'anglais',
};

/** Résultat de la détection sur UN texte : « unknown » dès que les données ne suffisent pas. */
export const DETECTED_LANGUAGES = ['fr', 'en', 'other', 'unknown'] as const;
export type DetectedLanguage = (typeof DETECTED_LANGUAGES)[number];

/** Langue du contenu d'une chaîne : « mixed » pour un créateur qui publie en français ET en anglais. */
export const CONTENT_LANGUAGES = ['fr', 'en', 'mixed', 'other', 'unknown'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

export const LANGUAGE_DIRECTIONS = ['fr-en', 'en-fr'] as const;
export type LanguageDirection = (typeof LANGUAGE_DIRECTIONS)[number];

/** Langue du contenu recherché (source) et langue de l'audience à développer (cible). */
export const LANGUAGE_DIRECTION_LANGUAGES: Record<
  LanguageDirection,
  { source: AssessedLanguage; target: AssessedLanguage }
> = {
  'fr-en': { source: 'fr', target: 'en' },
  'en-fr': { source: 'en', target: 'fr' },
};

export const LANGUAGE_DIRECTION_LABELS: Record<LanguageDirection, string> = {
  'fr-en': 'Contenu français → audience anglophone',
  'en-fr': 'Contenu anglais → audience francophone',
};

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
};

/** Pourquoi une direction n'est pas évaluée (score null). */
export const INELIGIBILITY_REASONS = [
  /** Le contenu n'est pas dans la langue source de la direction. */
  'content_language_mismatch',
  /** Langue du contenu inconnue ou estimée avec une confiance faible : pas de conclusion forcée. */
  'content_language_uncertain',
] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

// ---------------------------------------------------------------------------
// Méthode de score : VERSIONNÉE. Les pondérations sont des valeurs INITIALES à tester sur des
// données réelles, pas des vérités établies : toute modification crée une nouvelle version.
// ---------------------------------------------------------------------------

export const SCORE_COMPONENTS = [
  /** Part des commentaires échantillonnés détectés dans la langue cible. */
  'target_comments',
  /** Ouverture déjà visible vers la langue cible : traductions, sous-titres. */
  'target_openness',
  /** Régularité du contenu dans la langue source. */
  'source_consistency',
  /** Publication récente et régulière. */
  'recent_activity',
  /** Vues des vidéos récentes rapportées aux abonnés. */
  'traction',
] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

export const SCORE_COMPONENT_LABELS: Record<ScoreComponent, string> = {
  target_comments: 'Langue cible dans les commentaires',
  target_openness: 'Ouverture visible vers la langue cible',
  source_consistency: 'Contenu régulier dans la langue source',
  recent_activity: 'Activité récente',
  traction: 'Traction des vidéos récentes',
};

export const LANGUAGE_METHOD_VERSION = 'lang-v1';

/** Paramètres de la version lang-v1 (pondérations sur 100 et seuils), à ajuster après le pilote. */
export const LANGUAGE_METHOD_V1 = {
  version: LANGUAGE_METHOD_VERSION,
  status: 'initial',
  weights: {
    target_comments: 30,
    target_openness: 25,
    source_consistency: 20,
    recent_activity: 15,
    traction: 10,
  } satisfies Record<ScoreComponent, number>,
} as const;

// ---------------------------------------------------------------------------
// Entrée : réponses BRUTES de la YouTube Data API v3, transmises telles quelles par n8n. Seuls les
// champs utiles sont lus, les autres sont ignorés. Les nombres de YouTube sont des chaînes.
// ---------------------------------------------------------------------------

/** Au-delà, la requête est refusée (taille raisonnable, coût YouTube maîtrisé). */
export const LANGUAGE_INPUT_LIMITS = {
  videos: 50,
  comments: 100,
  /** Longueur maximale d'un texte reçu (une description YouTube fait au plus 5 000 caractères). */
  textChars: 10_000,
} as const;

const ytText = z.string().max(LANGUAGE_INPUT_LIMITS.textChars).optional();
const ytCount = z.union([z.string().max(32), z.number()]).optional();
/** Traductions déclarées par le créateur : seules les CLÉS (codes de langue) sont utilisées. */
const ytLocalizations = z.record(z.string().max(35), z.unknown()).optional();

export const youtubeChannelItemSchema = z.object({
  id: z.string().min(1).max(64),
  snippet: z
    .object({
      title: ytText,
      description: ytText,
      defaultLanguage: z.string().max(35).optional(),
      country: z.string().max(8).optional(),
    })
    .optional(),
  statistics: z
    .object({
      subscriberCount: ytCount,
      hiddenSubscriberCount: z.boolean().optional(),
      videoCount: ytCount,
      viewCount: ytCount,
    })
    .optional(),
  localizations: ytLocalizations,
});
export type YoutubeChannelItem = z.infer<typeof youtubeChannelItemSchema>;

export const youtubeVideoItemSchema = z.object({
  id: z.string().min(1).max(64),
  snippet: z
    .object({
      title: ytText,
      description: ytText,
      publishedAt: z.string().max(40).optional(),
      defaultLanguage: z.string().max(35).optional(),
      defaultAudioLanguage: z.string().max(35).optional(),
    })
    .optional(),
  /** caption : "true" si le créateur a publié des sous-titres. */
  contentDetails: z.object({ caption: z.string().max(8).optional() }).optional(),
  statistics: z.object({ viewCount: ytCount }).optional(),
  localizations: ytLocalizations,
});
export type YoutubeVideoItem = z.infer<typeof youtubeVideoItemSchema>;

/**
 * Fil de commentaires (commentThreads.list). Le texte ne sert QU'À compter des langues : il n'est
 * jamais conservé, ni renvoyé, ni écrit dans un journal ou un message d'erreur.
 */
export const youtubeCommentThreadItemSchema = z.object({
  snippet: z
    .object({
      videoId: z.string().max(64).optional(),
      topLevelComment: z
        .object({
          snippet: z
            .object({
              textOriginal: ytText,
              textDisplay: ytText,
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
export type YoutubeCommentThreadItem = z.infer<typeof youtubeCommentThreadItemSchema>;

export const languageAssessmentInputSchema = z.object({
  /** Date du relevé (ISO 8601) : référence des calculs d'activité, jamais l'horloge du serveur. */
  observedAt: z.iso.datetime(),
  channel: youtubeChannelItemSchema,
  /** Vidéos récentes de la chaîne (videos.list). */
  videos: z.array(youtubeVideoItemSchema).max(LANGUAGE_INPUT_LIMITS.videos).default([]),
  /** Commentaires échantillonnés sur quelques vidéos récentes (commentThreads.list). */
  comments: z.array(youtubeCommentThreadItemSchema).max(LANGUAGE_INPUT_LIMITS.comments).default([]),
});
export type LanguageAssessmentRequest = z.input<typeof languageAssessmentInputSchema>;
export type LanguageAssessmentInput = z.output<typeof languageAssessmentInputSchema>;

// ---------------------------------------------------------------------------
// Sortie
// ---------------------------------------------------------------------------

export const LANGUAGE_SIGNAL_CODES = [
  'channel_country',
  'channel_default_language',
  'channel_text_language',
  'channel_target_localization',
  'video_audio_language',
  'video_text_language',
  'video_target_localizations',
  'video_captions',
  'metadata_conflict',
  'content_language',
  'comment_languages',
  /** Toujours une HYPOTHÈSE : l'API ne donne pas la langue de l'audience. */
  'audience_target_presence',
  'subscribers_hidden',
] as const;
export type LanguageSignalCode = (typeof LANGUAGE_SIGNAL_CODES)[number];

export const SIGNAL_EFFECTS = ['positive', 'negative', 'neutral'] as const;
export type SignalEffect = (typeof SIGNAL_EFFECTS)[number];

export const YOUTUBE_RESOURCES = ['channels', 'videos', 'commentThreads'] as const;

export const languageSignalSchema = z.object({
  code: z.enum(LANGUAGE_SIGNAL_CODES),
  kind: z.enum(INSIGHT_KINDS),
  /** Direction concernée, ou null pour un signal commun aux deux. */
  direction: z.enum(LANGUAGE_DIRECTIONS).nullable(),
  effect: z.enum(SIGNAL_EFFECTS),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** Champ de l'API d'où vient le signal. */
  source: z
    .object({
      api: z.literal('youtube_data_api'),
      resource: z.enum(YOUTUBE_RESOURCES),
      field: z.string(),
    })
    .nullable(),
  /** Phrase en français, sans jamais citer un commentaire. */
  text: z.string(),
});
export type LanguageSignal = z.infer<typeof languageSignalSchema>;

export const LANGUAGE_LIMITATION_CODES = [
  /** Toujours présente : la démographie de l'audience n'est pas accessible. */
  'audience_demographics_unavailable',
  'comment_sample_bias',
  'no_comments',
  'comment_sample_too_small',
  'few_videos',
  'metadata_conflict',
  'subscribers_hidden',
  'no_publication_dates',
  'insufficient_coverage',
] as const;
export type LanguageLimitationCode = (typeof LANGUAGE_LIMITATION_CODES)[number];

export const languageLimitationSchema = z.object({
  code: z.enum(LANGUAGE_LIMITATION_CODES),
  text: z.string(),
});
export type LanguageLimitation = z.infer<typeof languageLimitationSchema>;

export const scoreComponentResultSchema = z.object({
  code: z.enum(SCORE_COMPONENTS),
  weight: z.number(),
  /** 0 à 1, ou null si la donnée manque (composante exclue du score, jamais comptée zéro). */
  value: z.number().min(0).max(1).nullable(),
  /** weight × value, ou null. */
  points: z.number().nullable(),
});
export type ScoreComponentResult = z.infer<typeof scoreComponentResultSchema>;

export const directionAssessmentSchema = z.object({
  direction: z.enum(LANGUAGE_DIRECTIONS),
  sourceLanguage: z.enum(ASSESSED_LANGUAGES),
  targetLanguage: z.enum(ASSESSED_LANGUAGES),
  eligible: z.boolean(),
  ineligibleReason: z.enum(INELIGIBILITY_REASONS).nullable(),
  /** 0 à 100 sur les composantes disponibles ; null si non éligible ou données insuffisantes. */
  score: z.number().int().min(0).max(100).nullable(),
  /** Part des pondérations réellement mesurées (0 à 100). */
  coverage: z.number().int().min(0).max(100),
  confidence: z.enum(CONFIDENCE_LEVELS),
  components: z.array(scoreComponentResultSchema),
  limitations: z.array(languageLimitationSchema),
});
export type DirectionAssessment = z.infer<typeof directionAssessmentSchema>;

const share = z.number().min(0).max(1);

export const languageAssessmentSchema = z.object({
  method: z.object({
    version: z.string(),
    status: z.string(),
    weights: z.record(z.enum(SCORE_COMPONENTS), z.number()),
  }),
  observedAt: z.string(),
  channelId: z.string(),
  content: z.object({
    language: z.enum(CONTENT_LANGUAGES),
    confidence: z.enum(CONFIDENCE_LEVELS),
    bilingual: z.boolean(),
    /** Répartition des votes (vidéos et chaîne). */
    shares: z.object({ fr: share, en: share, other: share }),
    /** Vidéos dont la langue a pu être établie / vidéos reçues. */
    decidedVideos: z.number().int(),
    videos: z.number().int(),
  }),
  /** Ce qui a été OBSERVÉ dans l'échantillon de commentaires : des nombres, jamais de texte. */
  commentSample: z.object({
    analyzed: z.number().int(),
    fr: z.number().int(),
    en: z.number().int(),
    other: z.number().int(),
    unknown: z.number().int(),
  }),
  directions: z.array(directionAssessmentSchema),
  signals: z.array(languageSignalSchema),
  limitations: z.array(languageLimitationSchema),
});
export type LanguageAssessment = z.infer<typeof languageAssessmentSchema>;
