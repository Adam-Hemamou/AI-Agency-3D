import type {
  LanguageAssessmentRequest,
  YoutubeChannelItem,
  YoutubeCommentThreadItem,
  YoutubeVideoItem,
} from '@agency/shared';

/**
 * Données YouTube FICTIVES pour les tests du moteur linguistique : identifiants inventés, textes
 * rédigés pour l'occasion. Même forme que les réponses de la YouTube Data API v3.
 */

export const OBSERVED_AT = '2026-11-10T12:00:00.000Z';

export function daysAgo(days: number): string {
  return new Date(new Date(OBSERVED_AT).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export type FixtureLanguage = 'fr' | 'en' | 'es' | 'none';

const TEXTS: Record<FixtureLanguage, { title: string; description: string }> = {
  fr: {
    title: 'Le gâteau au chocolat de ma grand-mère',
    description:
      'Aujourd’hui je vous montre comment préparer cette recette très simple, avec toutes mes astuces pour la réussir à chaque fois. Abonnez-vous pour ne rien rater !',
  },
  en: {
    title: 'My grandma’s chocolate cake',
    description:
      'Today I’m showing you how to make this really easy recipe, with all my tips to get it right every time. Subscribe so you don’t miss the next one!',
  },
  es: {
    title: 'La tarta de chocolate de mi abuela',
    description:
      'Hoy os enseño cómo preparar esta receta muy sencilla, con todos mis trucos para que salga perfecta. ¡Suscríbete para no perderte nada!',
  },
  none: { title: '', description: '' },
};

export interface VideoOptions {
  text?: FixtureLanguage;
  /** snippet.defaultAudioLanguage (« fr », « en-US »…), absent si non fourni. */
  audio?: string;
  localizations?: string[];
  captions?: boolean;
  views?: number;
  ageDays?: number;
}

let videoCounter = 0;

export function video(options: VideoOptions = {}): YoutubeVideoItem {
  const { text = 'none', audio, localizations = [], captions, views, ageDays = 7 } = options;
  videoCounter += 1;
  return {
    id: `vidTest${String(videoCounter).padStart(4, '0')}`,
    snippet: {
      ...TEXTS[text],
      publishedAt: daysAgo(ageDays),
      ...(audio ? { defaultAudioLanguage: audio } : {}),
    },
    contentDetails: captions === undefined ? {} : { caption: captions ? 'true' : 'false' },
    statistics: views === undefined ? {} : { viewCount: String(views) },
    localizations: Object.fromEntries(
      localizations.map((code) => [code, { title: 'Traduction fictive' }]),
    ),
  };
}

/** n vidéos publiées tous les 7 jours (la plus récente il y a 3 jours). */
export function videos(count: number, options: VideoOptions = {}): YoutubeVideoItem[] {
  return Array.from({ length: count }, (_, i) => video({ ageDays: 3 + 7 * i, ...options }));
}

export interface ChannelOptions {
  text?: FixtureLanguage;
  defaultLanguage?: string;
  country?: string;
  subscribers?: number | 'hidden';
  localizations?: string[];
}

export function channel(options: ChannelOptions = {}): YoutubeChannelItem {
  const { text = 'none', defaultLanguage, country, subscribers = 100_000, localizations } = options;
  return {
    id: 'UCtestChaineFictive0001',
    snippet: {
      ...TEXTS[text],
      ...(defaultLanguage ? { defaultLanguage } : {}),
      ...(country ? { country } : {}),
    },
    statistics:
      subscribers === 'hidden'
        ? { hiddenSubscriberCount: true }
        : { subscriberCount: String(subscribers), hiddenSubscriberCount: false },
    ...(localizations
      ? {
          localizations: Object.fromEntries(
            localizations.map((code) => [code, { title: 'Traduction fictive' }]),
          ),
        }
      : {}),
  };
}

/** Commentaires fictifs, chacun reconnaissable par le détecteur dans sa langue. */
export const COMMENT_POOLS = {
  fr: [
    'Merci pour cette recette, elle est vraiment délicieuse !',
    'Je l’ai faite hier soir et toute la famille a adoré',
    'Trop bien expliqué, j’ai enfin réussi ma pâte',
    'Vous êtes génial, continuez comme ça',
    'C’est la meilleure chaîne de cuisine, merci beaucoup',
    'Est-ce que vous avez une version sans gluten ?',
  ],
  en: [
    'Thanks for this recipe, it was really delicious!',
    'I made this last night and my whole family loved it',
    'Great explanation, I finally got my dough right',
    'You are amazing, keep up the good work',
    'This is the best cooking channel, thank you so much',
    'Do you have a gluten free version of this?',
  ],
  es: [
    '¡Qué rica receta, la voy a hacer este fin de semana con mi familia!',
    'Muchas gracias por compartir esta receta, me encantó mucho la explicación del paso a paso',
  ],
  /** Trop courts ou sans mots : toujours « unknown ». */
  noise: ['😍😍😍', 'Top !', 'First', '👍'],
} as const;

export function comment(text: string): YoutubeCommentThreadItem {
  return {
    snippet: { videoId: 'vidTest0001', topLevelComment: { snippet: { textOriginal: text } } },
  };
}

/** Commentaires par langue, en parcourant chaque réserve de phrases. */
export function comments(counts: Partial<Record<keyof typeof COMMENT_POOLS, number>>) {
  return (Object.keys(counts) as (keyof typeof COMMENT_POOLS)[]).flatMap((lang) => {
    const pool = COMMENT_POOLS[lang];
    return Array.from({ length: counts[lang] ?? 0 }, (_, i) => comment(pool[i % pool.length]!));
  });
}

export function request(parts: {
  channel?: YoutubeChannelItem;
  videos?: YoutubeVideoItem[];
  comments?: YoutubeCommentThreadItem[];
}): LanguageAssessmentRequest {
  return {
    observedAt: OBSERVED_AT,
    channel: parts.channel ?? channel(),
    videos: parts.videos ?? [],
    comments: parts.comments ?? [],
  };
}
