import {
  ASSESSED_LANGUAGE_LABELS,
  LANGUAGE_DIRECTION_LANGUAGES,
  LANGUAGE_METHOD_V1,
  SCORE_COMPONENTS,
  type ConfidenceLevel,
  type DirectionAssessment,
  type IneligibilityReason,
  type LanguageDirection,
  type LanguageLimitation,
  type LanguageLimitationCode,
  type LanguageSignal,
  type ScoreComponent,
  type ScoreComponentResult,
} from '@agency/shared';
import type { ContentResult } from './contentLanguage.ts';
import { fact, hypothesis, limitation, plural } from './signals.ts';
import type { NormalizedInput } from './youtubeInput.ts';

/**
 * Score de potentiel d'UNE direction (FR → EN ou EN → FR), sur 100, et sa confiance.
 *
 * - Direction évaluée seulement si le contenu est dans sa langue source (ou bilingue) avec une
 *   confiance au moins moyenne ; sinon score null et raison explicite.
 * - Chaque composante vaut de 0 à 1, ou null si la donnée manque : elle est alors EXCLUE (jamais
 *   comptée zéro) et la couverture (coverage) baisse. Sous 50 % de couverture : pas de score.
 * - Le pays déclaré n'intervient pas : il n'indique ni la nationalité ni l'audience.
 * - Le score dit « combien », la confiance « à quel point s'y fier » : un score faible peut être sûr.
 */

/** Seuils de la version lang-v1 : valeurs initiales, à ajuster après le pilote. */
export const SCORE_V1 = {
  /** Part de commentaires dans la langue cible qui donne la note maximale. */
  commentShareForMax: 0.3,
  /** En dessous, l'échantillon est trop petit : composante non mesurée. */
  minDetectedComments: 10,
  openness: { videos: 0.6, channel: 0.2, captions: 0.2 },
  activity: { freshDays: 14, staleDays: 90, windowDays: 90, videosForMax: 12 },
  /** Vues médianes / abonnés donnant la note maximale. */
  tractionRatioForMax: 0.5,
  minCoverage: 50,
  confidence: {
    high: { comments: 50, coverage: 85 },
    medium: { comments: 20, coverage: 60 },
  },
  /** Seuils des hypothèses sur l'audience (part des commentaires dans la langue cible). */
  audience: { notable: 0.1, weak: 0.02 },
} as const;

export interface CommentCounts {
  analyzed: number;
  fr: number;
  en: number;
  other: number;
  unknown: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const percent = (n: number) => `${Math.round(n * 100)} %`;
/** Adjectif de l'audience visée. */
const AUDIENCE_ADJECTIVE = { fr: 'francophone', en: 'anglophone' } as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ineligibility(
  direction: LanguageDirection,
  content: ContentResult,
): IneligibilityReason | null {
  const { source } = LANGUAGE_DIRECTION_LANGUAGES[direction];
  if (content.language === 'unknown') return 'content_language_uncertain';
  const matches = content.language === source || content.language === 'mixed';
  if (!matches) return 'content_language_mismatch';
  return content.confidence === 'low' ? 'content_language_uncertain' : null;
}

export function assessDirection(
  direction: LanguageDirection,
  content: ContentResult,
  data: NormalizedInput,
  comments: CommentCounts,
): { assessment: DirectionAssessment; signals: LanguageSignal[] } {
  const { source, target } = LANGUAGE_DIRECTION_LANGUAGES[direction];
  const targetLabel = ASSESSED_LANGUAGE_LABELS[target];
  const audience = AUDIENCE_ADJECTIVE[target];
  const limitationCodes = new Set<LanguageLimitationCode>(['audience_demographics_unavailable']);
  const limitations = (): LanguageLimitation[] => [...limitationCodes].map(limitation);
  const base = { direction, sourceLanguage: source, targetLanguage: target };

  const reason = ineligibility(direction, content);
  if (reason) {
    return {
      assessment: {
        ...base,
        eligible: false,
        ineligibleReason: reason,
        score: null,
        coverage: 0,
        // Certitude de la non-éligibilité : celle de la langue du contenu, faible si incertaine.
        confidence: reason === 'content_language_uncertain' ? 'low' : content.confidence,
        components: [],
        limitations: limitations(),
      },
      signals: [],
    };
  }

  const { channel, videos, observedAt } = data;
  const signals: LanguageSignal[] = [];
  const values = {} as Record<ScoreComponent, number | null>;

  // 1. Langue cible dans les commentaires (indice, jamais une mesure de l'audience).
  const detected = comments.fr + comments.en + comments.other;
  if (comments.analyzed === 0) {
    values.target_comments = null;
    limitationCodes.add('no_comments');
  } else if (detected < SCORE_V1.minDetectedComments) {
    values.target_comments = null;
    limitationCodes.add('comment_sample_too_small');
  } else {
    const share = comments[target] / detected;
    values.target_comments = clamp01(share / SCORE_V1.commentShareForMax);
    const level =
      share >= SCORE_V1.audience.notable
        ? 'positive'
        : share < SCORE_V1.audience.weak
          ? 'negative'
          : 'neutral';
    const lead = {
      positive: `Indice d’une audience en partie ${audience}`,
      neutral: `Présence limitée de commentaires en ${targetLabel}`,
      negative: `Peu d’indices d’une audience ${audience}`,
    }[level];
    signals.push(
      hypothesis({
        code: 'audience_target_presence',
        direction,
        effect: level,
        value: round3(share),
        text: `${lead} : ${percent(share)} des ${detected} commentaires dont la langue a pu être établie sont en ${targetLabel}. Hypothèse : un échantillon de commentaires ne représente pas l’audience.`,
      }),
    );
  }

  // 2. Ouverture déjà visible vers la langue cible (traductions et sous-titres DÉCLARÉS).
  const localized = videos.filter((v) => v.localizationLanguages.includes(target)).length;
  const channelLocalized = channel.localizationLanguages.includes(target);
  if (localized > 0) {
    signals.push(
      fact(
        {
          code: 'video_target_localizations',
          direction,
          effect: 'positive',
          value: localized,
          text: `${plural(localized, 'vidéo')} sur ${videos.length} ont un titre ou une description traduits en ${targetLabel} par le créateur.`,
        },
        'videos',
        'localizations',
      ),
    );
  }
  if (channelLocalized) {
    signals.push(
      fact(
        {
          code: 'channel_target_localization',
          direction,
          effect: 'positive',
          value: true,
          text: `La présentation de la chaîne est traduite en ${targetLabel} par le créateur.`,
        },
        'channels',
        'localizations',
      ),
    );
  }
  if (videos.length === 0) {
    values.target_openness = null;
  } else {
    const captionKnown = videos.filter((v) => v.hasCaptions !== null);
    const captions = captionKnown.length
      ? captionKnown.filter((v) => v.hasCaptions).length / captionKnown.length
      : 0;
    const { openness } = SCORE_V1;
    values.target_openness = clamp01(
      openness.videos * (localized / videos.length) +
        openness.channel * (channelLocalized ? 1 : 0) +
        openness.captions * captions,
    );
  }

  // 3. Contenu régulier dans la langue source.
  values.source_consistency = content.decidedVideos
    ? content.videoLanguages.filter((l) => l === source).length / content.decidedVideos
    : null;

  // 4. Activité récente.
  const dates = videos
    .map((v) => v.publishedAt?.getTime())
    .filter((t): t is number => t !== undefined);
  if (dates.length === 0) {
    values.recent_activity = null;
    limitationCodes.add('no_publication_dates');
  } else {
    const { activity } = SCORE_V1;
    const ageDays = Math.max(0, (observedAt.getTime() - Math.max(...dates)) / DAY_MS);
    const recency = clamp01(
      (activity.staleDays - ageDays) / (activity.staleDays - activity.freshDays),
    );
    const windowStart = observedAt.getTime() - activity.windowDays * DAY_MS;
    const recent = dates.filter((t) => t >= windowStart).length;
    values.recent_activity = clamp01(
      0.5 * recency + 0.5 * Math.min(1, recent / activity.videosForMax),
    );
  }

  // 5. Traction : vues médianes des vidéos récentes / abonnés.
  const views = videos.map((v) => v.viewCount).filter((n): n is number => n !== null);
  if (channel.subscriberCount === null || channel.subscriberCount === 0 || views.length === 0) {
    values.traction = null;
    if (channel.subscribersHidden || channel.subscriberCount === null) {
      limitationCodes.add('subscribers_hidden');
    }
  } else {
    values.traction = clamp01(
      median(views) / channel.subscriberCount / SCORE_V1.tractionRatioForMax,
    );
  }

  // --- Score sur les composantes mesurées --------------------------------------------------
  const { weights } = LANGUAGE_METHOD_V1;
  const components: ScoreComponentResult[] = SCORE_COMPONENTS.map((code) => {
    const value = values[code];
    return {
      code,
      weight: weights[code],
      value: value === null ? null : round3(value),
      points: value === null ? null : Math.round(weights[code] * value * 10) / 10,
    };
  });
  const measured = SCORE_COMPONENTS.filter((code) => values[code] !== null);
  const coverage = measured.reduce((sum, code) => sum + weights[code], 0);
  let score: number | null = null;
  if (coverage < SCORE_V1.minCoverage) {
    limitationCodes.add('insufficient_coverage');
  } else {
    const points = measured.reduce((sum, code) => sum + weights[code] * values[code]!, 0);
    score = Math.round((points / coverage) * 100);
  }

  // --- Confiance -----------------------------------------------------------------------------
  const { confidence: c } = SCORE_V1;
  let confidence: ConfidenceLevel = 'low';
  if (score !== null) {
    if (
      content.confidence === 'high' &&
      detected >= c.high.comments &&
      coverage >= c.high.coverage
    ) {
      confidence = 'high';
    } else if (
      (detected >= c.medium.comments || localized > 0 || channelLocalized) &&
      coverage >= c.medium.coverage
    ) {
      confidence = 'medium';
    }
  }

  return {
    assessment: {
      ...base,
      eligible: true,
      ineligibleReason: null,
      score,
      coverage,
      confidence,
      components,
      limitations: limitations(),
    },
    signals,
  };
}
