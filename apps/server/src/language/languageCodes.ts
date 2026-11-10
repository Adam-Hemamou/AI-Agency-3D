import { ASSESSED_LANGUAGES, type AssessedLanguage } from '@agency/shared';

/**
 * Codes de langue de YouTube (BCP 47 : « fr », « fr-CA », « en-GB », « zxx »…) ramenés à leur
 * langue principale. Les codes qui ne désignent aucune langue précise donnent null.
 */

/** zxx : sans contenu linguistique ; und : indéterminé ; mul : plusieurs ; mis : non codé. */
const NOT_A_LANGUAGE = new Set(['zxx', 'und', 'mul', 'mis']);

/** Langue principale en minuscules (« fr-CA » → « fr »), ou null. */
export function normalizeLanguageCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const primary = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (!/^[a-z]{2,3}$/.test(primary) || NOT_A_LANGUAGE.has(primary)) return null;
  return primary;
}

/** « fr » ou « en » si c'est une langue évaluée, « other » pour une autre langue, null sinon. */
export function toAssessedLanguage(
  code: string | null | undefined,
): AssessedLanguage | 'other' | null {
  const primary = normalizeLanguageCode(code);
  if (primary === null) return null;
  return (ASSESSED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as AssessedLanguage)
    : 'other';
}

/** Pays déclaré : code ISO 3166-1 alpha-2 en majuscules, ou null. */
export function normalizeCountryCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const value = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}
