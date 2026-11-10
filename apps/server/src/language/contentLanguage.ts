import {
  ASSESSED_LANGUAGE_LABELS,
  CONFIDENCE_LABELS,
  type ConfidenceLevel,
  type ContentLanguage,
  type LanguageLimitation,
  type LanguageSignal,
} from '@agency/shared';
import { detectLanguage } from './detectLanguage.ts';
import { toAssessedLanguage } from './languageCodes.ts';
import { fact, limitation, observation, plural } from './signals.ts';
import type { NormalizedInput } from './youtubeInput.ts';

/**
 * Langue du CONTENU d'une chaîne (ce que le créateur publie), par vote sur ses vidéos récentes et
 * sur la chaîne. Ce n'est ni sa nationalité, ni la langue de son audience.
 *
 * Vote d'une vidéo :
 * - langue de l'audio déclarée ET langue détectée des titres et descriptions concordantes : 3 ;
 * - une seule des deux connue : 2 ;
 * - les deux connues mais différentes : CONFLIT, pas de vote.
 * Vote de la chaîne : langue par défaut déclarée 1, langue détectée du titre et de la description 1.
 *
 * Prudence : « unknown » s'il y a moins de 3 vidéos exploitables, si au moins la moitié des vidéos
 * sont en conflit, ou si aucune langue ne domine nettement.
 */

/** Paramètres de la version lang-v1 : valeurs initiales, à ajuster après le pilote. */
export const CONTENT_V1 = {
  minDecidedVideos: 3,
  /** Part des votes pour retenir une langue. */
  winnerShare: 0.6,
  /** Français ET anglais au-dessus de cette part : contenu bilingue. */
  bilingualShare: 0.35,
  /** Part des vidéos en conflit à partir de laquelle aucune langue n'est retenue. */
  conflictUnknown: 0.5,
  high: { share: 0.8, audioCoverage: 0.5, agreement: 0.5 },
  medium: { share: 0.7 },
  votes: { agreed: 3, single: 2, channel: 1 },
} as const;

type Lang = 'fr' | 'en' | 'other';

export interface ContentResult {
  language: ContentLanguage;
  confidence: ConfidenceLevel;
  bilingual: boolean;
  shares: Record<Lang, number>;
  decidedVideos: number;
  videos: number;
  /** Langue retenue pour chaque vidéo reçue (null : indéterminée ou en conflit). */
  videoLanguages: (Lang | null)[];
  signals: LanguageSignal[];
  limitations: LanguageLimitation[];
}

const LABEL: Record<Lang, string> = { ...ASSESSED_LANGUAGE_LABELS, other: 'une autre langue' };
const CONTENT_LABEL: Record<ContentLanguage, string> = {
  ...LABEL,
  mixed: 'français et anglais (bilingue)',
  unknown: 'indéterminée',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function textLanguage(...texts: string[]): Lang | null {
  const detected = detectLanguage(texts.filter(Boolean).join('\n')).language;
  return detected === 'unknown' ? null : detected;
}

export function assessContentLanguage(data: NormalizedInput): ContentResult {
  const { channel, videos } = data;
  const votes: Record<Lang, number> = { fr: 0, en: 0, other: 0 };
  const signals: LanguageSignal[] = [];
  const limitations: LanguageLimitation[] = [];

  let conflicts = 0;
  let withBoth = 0;
  let agreements = 0;
  let withAudio = 0;
  const audioCounts: Record<Lang, number> = { fr: 0, en: 0, other: 0 };
  const textCounts: Record<Lang | 'unknown', number> = { fr: 0, en: 0, other: 0, unknown: 0 };

  const videoLanguages = videos.map((video): Lang | null => {
    const audio = toAssessedLanguage(video.audioLanguage);
    const text = textLanguage(video.title, video.description);
    if (audio) {
      withAudio++;
      audioCounts[audio]++;
    }
    textCounts[text ?? 'unknown']++;
    if (audio && text) {
      withBoth++;
      if (audio !== text) {
        conflicts++;
        return null;
      }
      agreements++;
      votes[audio] += CONTENT_V1.votes.agreed;
      return audio;
    }
    const single = audio ?? text;
    if (single) votes[single] += CONTENT_V1.votes.single;
    return single;
  });

  const channelDeclared = toAssessedLanguage(channel.defaultLanguage);
  if (channelDeclared) votes[channelDeclared] += CONTENT_V1.votes.channel;
  const channelText = textLanguage(channel.title, channel.description);
  if (channelText) votes[channelText] += CONTENT_V1.votes.channel;

  const total = votes.fr + votes.en + votes.other;
  const shares: Record<Lang, number> = {
    fr: total ? round2(votes.fr / total) : 0,
    en: total ? round2(votes.en / total) : 0,
    other: total ? round2(votes.other / total) : 0,
  };
  const decidedVideos = videoLanguages.filter((l) => l !== null).length;
  const conflictShare = withBoth ? conflicts / withBoth : 0;

  // --- Faits : ce que le créateur DÉCLARE -------------------------------------------------
  if (channel.country) {
    signals.push(
      fact(
        {
          code: 'channel_country',
          value: channel.country,
          text: `La chaîne déclare le pays ${channel.country} (pays déclaré : ni une nationalité, ni une audience ; sans effet sur le score).`,
        },
        'channels',
        'snippet.country',
      ),
    );
  }
  if (channel.defaultLanguage) {
    signals.push(
      fact(
        {
          code: 'channel_default_language',
          value: channel.defaultLanguage,
          text: `La chaîne déclare la langue par défaut « ${channel.defaultLanguage} ».`,
        },
        'channels',
        'snippet.defaultLanguage',
      ),
    );
  }
  for (const lang of ['fr', 'en', 'other'] as const) {
    if (audioCounts[lang] === 0) continue;
    signals.push(
      fact(
        {
          code: 'video_audio_language',
          value: audioCounts[lang],
          text: `${plural(audioCounts[lang], 'vidéo')} sur ${videos.length} déclarent l’audio en ${LABEL[lang]}.`,
        },
        'videos',
        'snippet.defaultAudioLanguage',
      ),
    );
  }

  // --- Indices : ce que le moteur détecte ---------------------------------------------------
  if (videos.length > 0) {
    signals.push(
      observation(
        {
          code: 'video_text_language',
          value: videos.length - textCounts.unknown,
          text: `Titres et descriptions détectés sur ${plural(videos.length, 'vidéo')} : ${textCounts.fr} en français, ${textCounts.en} en anglais, ${textCounts.other} dans une autre langue, ${textCounts.unknown} indéterminés.`,
        },
        { resource: 'videos', field: 'snippet.title, snippet.description' },
      ),
    );
  }
  if (channelText) {
    signals.push(
      observation(
        {
          code: 'channel_text_language',
          value: channelText,
          text: `Titre et description de la chaîne détectés en ${LABEL[channelText]}.`,
        },
        { resource: 'channels', field: 'snippet.title, snippet.description' },
      ),
    );
  }
  if (conflicts > 0) {
    signals.push(
      observation({
        code: 'metadata_conflict',
        effect: 'negative',
        value: conflicts,
        text: `${plural(conflicts, 'vidéo')} sur ${withBoth} : la langue de l’audio déclarée contredit celle des titres et descriptions.`,
      }),
    );
    limitations.push(limitation('metadata_conflict'));
  }

  // --- Décision prudente -------------------------------------------------------------------
  let language: ContentLanguage;
  if (decidedVideos < CONTENT_V1.minDecidedVideos) {
    language = 'unknown';
    limitations.push(limitation('few_videos'));
  } else if (conflictShare >= CONTENT_V1.conflictUnknown) {
    language = 'unknown';
  } else if (shares.fr >= CONTENT_V1.bilingualShare && shares.en >= CONTENT_V1.bilingualShare) {
    language = 'mixed';
  } else {
    const top = (['fr', 'en', 'other'] as const).reduce((a, b) => (shares[b] > shares[a] ? b : a));
    language = shares[top] >= CONTENT_V1.winnerShare ? top : 'unknown';
  }

  let confidence: ConfidenceLevel = 'low';
  if (language !== 'unknown') {
    const share = language === 'mixed' ? shares.fr + shares.en : shares[language as Lang];
    const audioCoverage = videos.length ? withAudio / videos.length : 0;
    const agreement = decidedVideos ? agreements / decidedVideos : 0;
    if (
      conflicts === 0 &&
      share >= CONTENT_V1.high.share &&
      audioCoverage >= CONTENT_V1.high.audioCoverage &&
      agreement >= CONTENT_V1.high.agreement
    ) {
      confidence = 'high';
    } else if (share >= CONTENT_V1.medium.share) {
      confidence = 'medium';
    }
  }

  signals.push(
    observation({
      code: 'content_language',
      value: language,
      text: `Langue du contenu estimée : ${CONTENT_LABEL[language]} (confiance ${CONFIDENCE_LABELS[confidence].toLowerCase()}, ${decidedVideos} vidéo(s) exploitable(s) sur ${videos.length}).`,
    }),
  );

  return {
    language,
    confidence,
    bilingual: language === 'mixed',
    shares,
    decidedVideos,
    videos: videos.length,
    videoLanguages,
    signals,
    limitations,
  };
}
