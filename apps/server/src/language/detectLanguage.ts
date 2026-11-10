import type { DetectedLanguage } from '@agency/shared';

/**
 * Détection PRUDENTE de la langue d'un texte court (titre, description, commentaire), limitée au
 * français et à l'anglais. Déterministe, sans dépendance, sans appel externe.
 *
 * Principe : on compte des mots-outils propres à chaque langue. Les mots ambigus — partagés entre le
 * français et l'anglais (« on », « pour », « comment »…) ou avec l'espagnol, l'italien, le portugais
 * (« de », « que », « la », « mais »…) — sont volontairement exclus.
 *
 * Règle de prudence : « unknown » dès que les données ne suffisent pas (texte trop court, trop peu
 * de mots reconnus, ou mélange sans langue nettement dominante). « other » seulement pour un texte
 * assez long qui ne contient aucun mot-outil français ou anglais.
 */

/** Paramètres du détecteur (version lang-v1 de la méthode). */
export const DETECTOR_V1 = {
  /** Moins de mots : « unknown ». */
  minWords: 3,
  /** Mots-outils reconnus au minimum pour conclure. */
  minHits: 2,
  /** Part minimale de la langue dominante parmi les mots reconnus. */
  dominance: 0.75,
  /** Texte sans aucun mot-outil reconnu : « other » à partir de ce nombre de mots. */
  otherMinWords: 8,
  /** Seuls les premiers caractères d'un texte sont analysés. */
  maxChars: 500,
} as const;

const FRENCH_WORDS = new Set([
  'les',
  'des',
  'est',
  'une',
  'dans',
  'avec',
  'pas',
  'sur',
  'très',
  'nous',
  'vous',
  'je',
  'elle',
  'ils',
  'elles',
  'sont',
  'cette',
  'ces',
  'aussi',
  'comme',
  'tout',
  'tous',
  'toute',
  'fait',
  'faire',
  'merci',
  'bonjour',
  'voici',
  'voilà',
  "c'est",
  "j'ai",
  "aujourd'hui",
  "n'est",
  "qu'il",
  'aux',
  'mon',
  'notre',
  'votre',
  'leur',
  'leurs',
  'être',
  'avoir',
  'ça',
  'où',
  'quand',
  'chez',
  'rien',
  'déjà',
  'alors',
  'donc',
  'trop',
  'vraiment',
  'beaucoup',
  'toujours',
  'jamais',
  'depuis',
  'après',
  'vers',
  'sans',
  'peut',
  'faut',
  'ont',
  'était',
  'génial',
  'moi',
  'toi',
  'lui',
  'eux',
  'quoi',
  'parce',
  'pourquoi',
  'avez',
  'avons',
  'suis',
  'sommes',
  'êtes',
  'vidéos',
  'chaîne',
  'abonnés',
  'abonnez',
]);

const ENGLISH_WORDS = new Set([
  'the',
  'and',
  'is',
  'are',
  'were',
  'you',
  'your',
  'this',
  'that',
  'with',
  'have',
  'has',
  'had',
  'what',
  'which',
  'they',
  'their',
  'there',
  'about',
  'from',
  'just',
  'not',
  'but',
  'would',
  'can',
  'could',
  'should',
  'how',
  'why',
  'when',
  'where',
  'who',
  'been',
  'because',
  'really',
  'love',
  'thanks',
  'thank',
  'great',
  'very',
  'much',
  'it',
  'of',
  'to',
  'be',
  'for',
  'if',
  'at',
  'by',
  'we',
  'he',
  'she',
  'his',
  'her',
  'them',
  'these',
  'those',
  'one',
  'more',
  'some',
  'out',
  'up',
  'get',
  'got',
  'like',
  'know',
  'think',
  'today',
  'here',
  'my',
  'our',
  'all',
  'make',
  'made',
  'watch',
  'watching',
  'subscribe',
  'please',
  'awesome',
  'amazing',
  'easy',
  'best',
]);

/** Contractions anglaises (I'm, it's, don't, you're, we've, I'll, I'd). */
const ENGLISH_CONTRACTION = /^[a-z]+(?:'(?:m|s|re|ve|ll|d)|n't)$/;
/** Élisions françaises sans équivalent ailleurs (j'adore, qu'elle, n'importe). */
const FRENCH_ELISION = /^(?:j|qu|n)'\p{L}+$/u;
/** Lettres propres au français (absentes de l'espagnol et du portugais). */
const FRENCH_LETTERS = /[èùûîœëï]/;
/** Lettres et signes propres à l'espagnol ou au portugais. */
const IBERIAN_LETTERS = /[ñãõ¿¡]/;

export interface Detection {
  language: DetectedLanguage;
  /** Nombre de mots du texte nettoyé. */
  words: number;
  frenchHits: number;
  englishHits: number;
}

/** Retire adresses web, mentions et hashtags : ils ne disent rien de la langue du texte. */
function clean(text: string): string {
  return text
    .slice(0, DETECTOR_V1.maxChars)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, ' ')
    .replace(/[’`]/g, "'");
}

export function detectLanguage(text: string | null | undefined): Detection {
  const cleaned = clean(typeof text === 'string' ? text : '');
  const words = cleaned.toLowerCase().match(/\p{L}+(?:'\p{L}+)*/gu) ?? [];
  let frenchHits = 0;
  let englishHits = 0;
  for (const word of words) {
    if (FRENCH_WORDS.has(word) || FRENCH_ELISION.test(word)) frenchHits++;
    else if (ENGLISH_WORDS.has(word) || ENGLISH_CONTRACTION.test(word)) englishHits++;
  }
  // Une lettre propre au français vaut un indice de plus (une fois par texte).
  if (FRENCH_LETTERS.test(cleaned.toLowerCase())) frenchHits++;

  const result = (language: DetectedLanguage): Detection => ({
    language,
    words: words.length,
    frenchHits,
    englishHits,
  });

  if (words.length < DETECTOR_V1.minWords) return result('unknown');
  const hits = frenchHits + englishHits;
  if (hits < DETECTOR_V1.minHits) {
    const iberian = IBERIAN_LETTERS.test(cleaned) && words.length >= 5;
    return result(
      iberian || (hits === 0 && words.length >= DETECTOR_V1.otherMinWords) ? 'other' : 'unknown',
    );
  }
  if (frenchHits / hits >= DETECTOR_V1.dominance) return result('fr');
  if (englishHits / hits >= DETECTOR_V1.dominance) return result('en');
  return result('unknown');
}
