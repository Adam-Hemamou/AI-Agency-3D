import type {
  LanguageAssessmentInput,
  YoutubeChannelItem,
  YoutubeCommentThreadItem,
  YoutubeVideoItem,
} from '@agency/shared';
import { DETECTOR_V1 } from './detectLanguage.ts';
import { normalizeCountryCode, normalizeLanguageCode } from './languageCodes.ts';

/**
 * Extraction des champs utiles des réponses brutes de la YouTube Data API v3 (déjà validées par
 * languageAssessmentInputSchema). Aucune interprétation ici : les valeurs sont seulement mises au
 * propre (codes de langue, nombres, dates).
 */

export interface NormalizedChannel {
  id: string;
  title: string;
  description: string;
  /** Pays DÉCLARÉ par la chaîne (snippet.country), ou null. */
  country: string | null;
  defaultLanguage: string | null;
  /** Langues dans lesquelles le créateur a traduit le titre ou la description de la chaîne. */
  localizationLanguages: string[];
  /** null : abonnés masqués ou non fournis. */
  subscriberCount: number | null;
  subscribersHidden: boolean;
}

export interface NormalizedVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  /** Langue de l'audio DÉCLARÉE par le créateur (snippet.defaultAudioLanguage). */
  audioLanguage: string | null;
  defaultLanguage: string | null;
  localizationLanguages: string[];
  /** contentDetails.caption ; null si non fourni. */
  hasCaptions: boolean | null;
  viewCount: number | null;
}

export interface NormalizedInput {
  observedAt: Date;
  channel: NormalizedChannel;
  videos: NormalizedVideo[];
  /**
   * Textes des commentaires, coupés. EN MÉMOIRE SEULEMENT : ils servent à compter des langues puis
   * sont abandonnés ; ils ne figurent jamais dans le résultat.
   */
  commentTexts: string[];
}

function toCount(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localizationLanguages(localizations: Record<string, unknown> | undefined): string[] {
  const codes = Object.keys(localizations ?? {})
    .map(normalizeLanguageCode)
    .filter((code): code is string => code !== null);
  return [...new Set(codes)].sort();
}

const cut = (text: string | undefined) => (text ?? '').slice(0, DETECTOR_V1.maxChars);

function normalizeChannel(item: YoutubeChannelItem): NormalizedChannel {
  const hidden = item.statistics?.hiddenSubscriberCount === true;
  return {
    id: item.id,
    title: cut(item.snippet?.title),
    description: cut(item.snippet?.description),
    country: normalizeCountryCode(item.snippet?.country),
    defaultLanguage: normalizeLanguageCode(item.snippet?.defaultLanguage),
    localizationLanguages: localizationLanguages(item.localizations),
    subscriberCount: hidden ? null : toCount(item.statistics?.subscriberCount),
    subscribersHidden: hidden,
  };
}

function normalizeVideo(item: YoutubeVideoItem): NormalizedVideo {
  const caption = item.contentDetails?.caption;
  return {
    id: item.id,
    title: cut(item.snippet?.title),
    description: cut(item.snippet?.description),
    publishedAt: toDate(item.snippet?.publishedAt),
    audioLanguage: normalizeLanguageCode(item.snippet?.defaultAudioLanguage),
    defaultLanguage: normalizeLanguageCode(item.snippet?.defaultLanguage),
    localizationLanguages: localizationLanguages(item.localizations),
    hasCaptions: caption === 'true' ? true : caption === 'false' ? false : null,
    viewCount: toCount(item.statistics?.viewCount),
  };
}

/** textOriginal (texte brut) de préférence ; textDisplay peut contenir du HTML. */
function commentText(item: YoutubeCommentThreadItem): string | null {
  const snippet = item.snippet?.topLevelComment?.snippet;
  const text = snippet?.textOriginal ?? snippet?.textDisplay?.replace(/<[^>]*>/g, ' ');
  return text ? cut(text) : null;
}

export function normalizeInput(input: LanguageAssessmentInput): NormalizedInput {
  // Une même vidéo transmise deux fois ne compte qu'une fois.
  const seen = new Set<string>();
  const videos = input.videos.filter((v) => !seen.has(v.id) && seen.add(v.id)).map(normalizeVideo);
  return {
    observedAt: new Date(input.observedAt),
    channel: normalizeChannel(input.channel),
    videos,
    commentTexts: input.comments.map(commentText).filter((t): t is string => t !== null),
  };
}
