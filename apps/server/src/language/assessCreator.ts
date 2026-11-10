import {
  LANGUAGE_DIRECTIONS,
  LANGUAGE_METHOD_V1,
  languageAssessmentInputSchema,
  type LanguageAssessment,
  type LanguageLimitationCode,
  type LanguageSignal,
} from '@agency/shared';
import { parseOrThrow } from '../lib/validate.ts';
import { assessContentLanguage } from './contentLanguage.ts';
import { detectLanguage } from './detectLanguage.ts';
import { assessDirection, type CommentCounts } from './score.ts';
import { fact, limitation, observation, plural } from './signals.ts';
import { normalizeInput, type NormalizedInput } from './youtubeInput.ts';

/**
 * Moteur d'évaluation linguistique d'un créateur YouTube (méthode versionnée, LANGUAGE_METHOD_V1).
 * Point d'entrée UNIQUE : réponses brutes de la YouTube Data API v3 → langue du contenu, puis score
 * et confiance pour les DEUX directions (un créateur bilingue peut être pertinent dans les deux).
 *
 * Fonction pure et déterministe : aucune base de données, aucun appel externe, aucune horloge
 * (la date de référence est observedAt), aucun journal.
 *
 * Commentaires : leurs textes ne servent qu'à compter des langues. Ils ne figurent jamais dans le
 * résultat ; une entrée invalide est refusée avec le seul chemin du champ fautif (parseOrThrow),
 * jamais avec sa valeur.
 */
export function assessCreator(request: unknown): LanguageAssessment {
  const input = parseOrThrow(languageAssessmentInputSchema, request, 'Données YouTube');
  const data = normalizeInput(input);
  const content = assessContentLanguage(data);
  const comments = countCommentLanguages(data.commentTexts);

  const signals: LanguageSignal[] = [...content.signals, ...sampleSignals(data, comments)];
  const directions = LANGUAGE_DIRECTIONS.map((direction) => {
    const result = assessDirection(direction, content, data, comments);
    signals.push(...result.signals);
    return result.assessment;
  });

  const codes = new Set<LanguageLimitationCode>(['audience_demographics_unavailable']);
  if (comments.analyzed > 0) codes.add('comment_sample_bias');
  for (const item of content.limitations) codes.add(item.code);
  if (data.channel.subscribersHidden) codes.add('subscribers_hidden');

  return {
    method: {
      version: LANGUAGE_METHOD_V1.version,
      status: LANGUAGE_METHOD_V1.status,
      weights: { ...LANGUAGE_METHOD_V1.weights },
    },
    observedAt: data.observedAt.toISOString(),
    channelId: data.channel.id,
    content: {
      language: content.language,
      confidence: content.confidence,
      bilingual: content.bilingual,
      shares: content.shares,
      decidedVideos: content.decidedVideos,
      videos: content.videos,
    },
    commentSample: comments,
    directions,
    signals,
    limitations: [...codes].map(limitation),
  };
}

/** Langue de chaque commentaire, comptée puis oubliée : seuls les totaux sortent d'ici. */
export function countCommentLanguages(texts: readonly string[]): CommentCounts {
  const counts: CommentCounts = { analyzed: texts.length, fr: 0, en: 0, other: 0, unknown: 0 };
  for (const text of texts) counts[detectLanguage(text).language]++;
  return counts;
}

/** Signaux communs aux deux directions : échantillon de commentaires, sous-titres, abonnés. */
function sampleSignals(data: NormalizedInput, comments: CommentCounts): LanguageSignal[] {
  const signals: LanguageSignal[] = [];
  if (comments.analyzed > 0) {
    signals.push(
      observation(
        {
          code: 'comment_languages',
          value: comments.analyzed,
          text: `Sur ${plural(comments.analyzed, 'commentaire analysé', 'commentaires analysés')} : ${comments.fr} en français, ${comments.en} en anglais, ${comments.other} dans une autre langue, ${comments.unknown} indéterminés.`,
        },
        { resource: 'commentThreads', field: 'snippet.topLevelComment.snippet.textOriginal' },
      ),
    );
  }
  const captionKnown = data.videos.filter((v) => v.hasCaptions !== null);
  if (captionKnown.length > 0) {
    const withCaptions = captionKnown.filter((v) => v.hasCaptions).length;
    signals.push(
      fact(
        {
          code: 'video_captions',
          value: withCaptions,
          text: `${plural(withCaptions, 'vidéo')} sur ${captionKnown.length} déclarent des sous-titres publiés par le créateur (langue non précisée par l’API).`,
        },
        'videos',
        'contentDetails.caption',
      ),
    );
  }
  if (data.channel.subscribersHidden) {
    signals.push(
      fact(
        {
          code: 'subscribers_hidden',
          effect: 'negative',
          value: true,
          text: 'Le créateur masque son nombre d’abonnés.',
        },
        'channels',
        'statistics.hiddenSubscriberCount',
      ),
    );
  }
  return signals;
}
