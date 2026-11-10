import { describe, expect, it } from 'vitest';
import { detectLanguage } from './detectLanguage.ts';
import { COMMENT_POOLS } from './fixtures.ts';
import {
  normalizeCountryCode,
  normalizeLanguageCode,
  toAssessedLanguage,
} from './languageCodes.ts';

describe('détection de langue (prudente)', () => {
  it.each([
    ['Aujourd’hui je vous montre comment faire une pâte à crêpes très facile', 'fr'],
    ['Today I’m showing you how to make the easiest pancake batter', 'en'],
    ['je pense que vous avez raison, merci pour tout', 'fr'], // sans accents
    ['Check this out, the full recipe is here https://exemple.fr #recette @chef_fr', 'en'],
  ])('« %s » → %s', (text, language) => {
    expect(detectLanguage(text).language).toBe(language);
  });

  it('une autre langue n’est jamais prise pour du français ou de l’anglais', () => {
    expect(
      detectLanguage('Receta fácil de tortilla de patatas para toda la familia').language,
    ).toBe('other');
    // Italien : quelques indices ambigus, donc pas de conclusion forcée.
    expect(
      detectLanguage(
        'Questa ricetta è davvero buonissima e facile da preparare per tutta la famiglia',
      ).language,
    ).toBe('unknown');
  });

  it.each([
    ['Merci !!! 😍'],
    ['🔥🔥🔥'],
    ['First'],
    [''],
    ['Top recette'],
    ['Love this recette, c’est trop bon'], // mélange sans langue dominante
    ['https://exemple.fr #recette @chef'], // rien d'autre que des liens et des étiquettes
  ])('« %s » → unknown (données insuffisantes)', (text) => {
    expect(detectLanguage(text).language).toBe('unknown');
  });

  it('accepte null et undefined', () => {
    expect(detectLanguage(null).language).toBe('unknown');
    expect(detectLanguage(undefined).language).toBe('unknown');
  });

  it('reconnaît les contractions anglaises et les élisions françaises', () => {
    expect(detectLanguage('I’m sure you’re right, it’s done').language).toBe('en');
    expect(detectLanguage('j’adore, qu’elle vienne, n’importe quand').language).toBe('fr');
  });

  it('les mots d’une adresse web, d’une mention ou d’un hashtag ne comptent pas', () => {
    const detection = detectLanguage('regardez https://the-best-and-the-great.com #thebest @you');
    expect(detection.englishHits).toBe(0);
  });

  it('chaque phrase des fixtures est reconnue dans sa langue', () => {
    for (const text of COMMENT_POOLS.fr) expect(detectLanguage(text).language).toBe('fr');
    for (const text of COMMENT_POOLS.en) expect(detectLanguage(text).language).toBe('en');
    for (const text of COMMENT_POOLS.es) expect(detectLanguage(text).language).toBe('other');
    for (const text of COMMENT_POOLS.noise) expect(detectLanguage(text).language).toBe('unknown');
  });
});

describe('codes de langue et de pays', () => {
  it.each([
    ['fr', 'fr'],
    ['fr-CA', 'fr'],
    ['en-GB', 'en'],
    ['EN_us', 'en'],
    ['es-419', 'es'],
    ['zxx', null],
    ['und', null],
    ['', null],
    ['français', null],
    [null, null],
    [undefined, null],
  ])('%s → %s', (code, expected) => {
    expect(normalizeLanguageCode(code)).toBe(expected);
  });

  it('langue évaluée, autre langue, ou rien', () => {
    expect(toAssessedLanguage('fr-BE')).toBe('fr');
    expect(toAssessedLanguage('en-US')).toBe('en');
    expect(toAssessedLanguage('de')).toBe('other');
    expect(toAssessedLanguage('zxx')).toBeNull();
  });

  it('pays déclaré : deux lettres en majuscules, sinon null', () => {
    expect(normalizeCountryCode('fr')).toBe('FR');
    expect(normalizeCountryCode('FRA')).toBeNull();
    expect(normalizeCountryCode(undefined)).toBeNull();
  });
});
