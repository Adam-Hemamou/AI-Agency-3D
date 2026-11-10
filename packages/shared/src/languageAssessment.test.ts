import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_DIRECTION_LANGUAGES,
  LANGUAGE_DIRECTIONS,
  LANGUAGE_INPUT_LIMITS,
  LANGUAGE_METHOD_V1,
  SCORE_COMPONENTS,
  directionAssessmentSchema,
  languageAssessmentInputSchema,
  languageSignalSchema,
} from './languageAssessment';

const minimal = { observedAt: '2026-11-10T12:00:00.000Z', channel: { id: 'UCtest' } };

describe('évaluation linguistique : méthode', () => {
  it('pondérations initiales versionnées : une par composante, somme de 100', () => {
    expect(Object.keys(LANGUAGE_METHOD_V1.weights).sort()).toEqual([...SCORE_COMPONENTS].sort());
    const total = Object.values(LANGUAGE_METHOD_V1.weights).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(LANGUAGE_METHOD_V1).toMatchObject({ version: 'lang-v1', status: 'initial' });
  });

  it('chaque direction relie deux langues différentes', () => {
    for (const direction of LANGUAGE_DIRECTIONS) {
      const { source, target } = LANGUAGE_DIRECTION_LANGUAGES[direction];
      expect(source).not.toBe(target);
    }
  });
});

describe('évaluation linguistique : entrée', () => {
  it('réponses YouTube brutes : champs inconnus ignorés, listes vides par défaut', () => {
    const parsed = languageAssessmentInputSchema.parse({
      ...minimal,
      channel: { id: 'UCtest', kind: 'youtube#channel', etag: 'abc' },
    });
    expect(parsed).toEqual({ ...minimal, videos: [], comments: [] });
  });

  it('nombres YouTube transmis en chaînes ou en nombres', () => {
    expect(() =>
      languageAssessmentInputSchema.parse({
        ...minimal,
        channel: { id: 'UCtest', statistics: { subscriberCount: '1200' } },
        videos: [{ id: 'v1', statistics: { viewCount: 42 } }],
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'vidéos',
      {
        videos: Array.from({ length: LANGUAGE_INPUT_LIMITS.videos + 1 }, (_, i) => ({
          id: `v${i}`,
        })),
      },
    ],
    [
      'commentaires',
      { comments: Array.from({ length: LANGUAGE_INPUT_LIMITS.comments + 1 }, () => ({})) },
    ],
    ['date', { observedAt: 'hier' }],
    ['chaîne sans identifiant', { channel: {} }],
  ])('refuse : %s', (_label, change) => {
    expect(languageAssessmentInputSchema.safeParse({ ...minimal, ...change }).success).toBe(false);
  });
});

describe('évaluation linguistique : sortie', () => {
  it('un signal sans source ni direction est valide (hypothèse)', () => {
    expect(
      languageSignalSchema.safeParse({
        code: 'audience_target_presence',
        kind: 'hypothesis',
        direction: 'fr-en',
        effect: 'positive',
        value: 0.39,
        source: null,
        text: 'Hypothèse',
      }).success,
    ).toBe(true);
  });

  it('refuse une direction ou une confiance inconnue', () => {
    const valid = {
      direction: 'fr-en',
      sourceLanguage: 'fr',
      targetLanguage: 'en',
      eligible: false,
      ineligibleReason: 'content_language_mismatch',
      score: null,
      coverage: 0,
      confidence: 'high',
      components: [],
      limitations: [],
    };
    expect(directionAssessmentSchema.safeParse(valid).success).toBe(true);
    expect(directionAssessmentSchema.safeParse({ ...valid, direction: 'fr-es' }).success).toBe(
      false,
    );
    expect(directionAssessmentSchema.safeParse({ ...valid, confidence: 'certain' }).success).toBe(
      false,
    );
    expect(directionAssessmentSchema.safeParse({ ...valid, score: 120 }).success).toBe(false);
  });
});
