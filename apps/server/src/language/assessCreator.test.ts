import {
  LANGUAGE_METHOD_V1,
  languageAssessmentSchema,
  type DirectionAssessment,
  type LanguageAssessment,
} from '@agency/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/AppError.ts';
import { assessCreator, countCommentLanguages } from './assessCreator.ts';
import { COMMENT_POOLS, channel, comment, comments, request, videos } from './fixtures.ts';

const direction = (result: LanguageAssessment, code: 'fr-en' | 'en-fr') =>
  result.directions.find((d) => d.direction === code) as DirectionAssessment;
const component = (d: DirectionAssessment, code: string) =>
  d.components.find((c) => c.code === code);

/**
 * Créateur francophone : 10 vidéos (audio déclaré en français, une tous les 7 jours, la dernière il
 * y a 3 jours), 4 traduites en anglais, 8 sous-titrées, 20 000 vues chacune, 100 000 abonnés.
 */
function frenchCreator(overrides: { comments?: ReturnType<typeof comments> } = {}) {
  return request({
    channel: channel({ text: 'fr', defaultLanguage: 'fr', country: 'FR' }),
    videos: videos(10, { text: 'fr', audio: 'fr', captions: true, views: 20_000 }).map((v, i) => ({
      ...v,
      ...(i < 4 ? { localizations: { en: { title: 'Traduction fictive' } } } : {}),
      ...(i >= 8 ? { contentDetails: { caption: 'false' } } : {}),
    })),
    comments: overrides.comments ?? comments({ fr: 31, en: 21, es: 2, noise: 6 }),
  });
}

describe('moteur : créateur francophone avec indices d’audience anglophone', () => {
  const result = assessCreator(frenchCreator());
  const frEn = direction(result, 'fr-en');
  const enFr = direction(result, 'en-fr');

  it('respecte le contrat partagé', () => {
    expect(() => languageAssessmentSchema.parse(result)).not.toThrow();
    expect(result.method).toEqual({
      version: 'lang-v1',
      status: 'initial',
      weights: LANGUAGE_METHOD_V1.weights,
    });
  });

  it('contenu français, échantillon de commentaires compté', () => {
    expect(result.content).toMatchObject({ language: 'fr', confidence: 'high', bilingual: false });
    expect(result.commentSample).toEqual({ analyzed: 60, fr: 31, en: 21, other: 2, unknown: 6 });
  });

  it('FR → EN : score calculé composante par composante', () => {
    expect(frEn).toMatchObject({ eligible: true, coverage: 100, confidence: 'high' });
    // Commentaires : 21/54 = 39 % ≥ 30 % → 1. Ouverture : 0,6 × 4/10 + 0,2 × 0 + 0,2 × 8/10 = 0,40.
    // Langue source : 10/10 → 1. Activité : dernière vidéo il y a 3 jours → 1 ; 10 vidéos sur 90 jours
    // → 10/12 ; (1 + 0,833) / 2 = 0,917. Traction : 20 000 / 100 000 = 0,2 ÷ 0,5 → 0,4.
    expect(component(frEn, 'target_comments')).toMatchObject({ value: 1, points: 30 });
    expect(component(frEn, 'target_openness')).toMatchObject({ value: 0.4, points: 10 });
    expect(component(frEn, 'source_consistency')).toMatchObject({ value: 1, points: 20 });
    expect(component(frEn, 'recent_activity')).toMatchObject({ value: 0.917, points: 13.8 });
    expect(component(frEn, 'traction')).toMatchObject({ value: 0.4, points: 4 });
    // 30 + 10 + 20 + 13,75 + 4 = 77,75 → 78.
    expect(frEn.score).toBe(78);
  });

  it('EN → FR : non évaluée, le contenu n’est pas en anglais', () => {
    expect(enFr).toMatchObject({
      eligible: false,
      ineligibleReason: 'content_language_mismatch',
      score: null,
      coverage: 0,
      components: [],
      confidence: 'high',
    });
  });

  it('l’audience reste une hypothèse, avec sa limite', () => {
    const audience = result.signals.find((s) => s.code === 'audience_target_presence');
    expect(audience).toMatchObject({ kind: 'hypothesis', direction: 'fr-en', effect: 'positive' });
    expect(audience?.text).toContain('Hypothèse');
    expect(frEn.limitations.map((l) => l.code)).toContain('audience_demographics_unavailable');
  });

  it('traductions en anglais : un fait propre à la direction FR → EN', () => {
    expect(result.signals.find((s) => s.code === 'video_target_localizations')).toMatchObject({
      kind: 'fact',
      direction: 'fr-en',
      value: 4,
      source: { resource: 'videos', field: 'localizations' },
    });
  });
});

describe('moteur : données manquantes', () => {
  it('commentaires désactivés : composante exclue (pas zéro), couverture 70 %, confiance moyenne', () => {
    const frEn = direction(assessCreator(frenchCreator({ comments: [] })), 'fr-en');
    expect(component(frEn, 'target_comments')).toMatchObject({ value: null, points: null });
    expect(frEn.coverage).toBe(70);
    // (10 + 20 + 13,75 + 4) / 70 = 68,2 → 68.
    expect(frEn.score).toBe(68);
    expect(frEn.confidence).toBe('medium');
    expect(frEn.limitations.map((l) => l.code)).toContain('no_comments');
  });

  it('moins de 10 commentaires reconnus : échantillon trop petit, composante exclue', () => {
    const frEn = direction(
      assessCreator(frenchCreator({ comments: comments({ en: 5, noise: 20 }) })),
      'fr-en',
    );
    expect(component(frEn, 'target_comments')?.value).toBeNull();
    expect(frEn.limitations.map((l) => l.code)).toContain('comment_sample_too_small');
  });

  it('couverture sous 50 % : aucun score', () => {
    const result = assessCreator(
      request({
        channel: channel({ subscribers: 'hidden' }),
        videos: videos(4, { text: 'fr', audio: 'fr' }).map((v) => ({
          ...v,
          snippet: { ...v.snippet, publishedAt: undefined },
        })),
      }),
    );
    const frEn = direction(result, 'fr-en');
    // Seules la langue source (20) et l'ouverture (25) sont mesurées : 45 %.
    expect(frEn).toMatchObject({ eligible: true, coverage: 45, score: null, confidence: 'low' });
    expect(frEn.limitations.map((l) => l.code)).toEqual(
      expect.arrayContaining([
        'insufficient_coverage',
        'no_comments',
        'no_publication_dates',
        'subscribers_hidden',
      ]),
    );
    expect(result.signals.find((s) => s.code === 'subscribers_hidden')?.kind).toBe('fact');
  });

  it('langue du contenu incertaine : aucune direction évaluée', () => {
    const result = assessCreator(request({ videos: videos(10, { text: 'fr', audio: 'en' }) }));
    for (const d of result.directions) {
      expect(d).toMatchObject({
        eligible: false,
        ineligibleReason: 'content_language_uncertain',
        score: null,
        confidence: 'low',
      });
    }
  });
});

describe('moteur : créateur anglophone', () => {
  // 10 vidéos en anglais, sans traduction ni sous-titres, 5 000 vues, 100 000 abonnés ;
  // 80 commentaires dont 1 en français.
  const result = assessCreator(
    request({
      channel: channel({ text: 'en', defaultLanguage: 'en' }),
      videos: videos(10, { text: 'en', audio: 'en-US', captions: false, views: 5_000 }),
      comments: comments({ en: 79, fr: 1 }),
    }),
  );
  const enFr = direction(result, 'en-fr');

  it('EN → FR : score faible mais confiance élevée (données suffisantes)', () => {
    // Commentaires : 1/80 = 1,25 % ÷ 30 % → 0,042 (1,25 pt). Ouverture : 0. Langue source : 20.
    // Activité : 10 vidéos sur 66 jours → 13,75. Traction : 0,05 ÷ 0,5 → 0,1 (1 pt). Total 36.
    expect(enFr).toMatchObject({ eligible: true, score: 36, coverage: 100, confidence: 'high' });
    expect(result.signals.find((s) => s.code === 'audience_target_presence')).toMatchObject({
      kind: 'hypothesis',
      direction: 'en-fr',
      effect: 'negative',
    });
  });

  it('FR → EN : non évaluée', () => {
    expect(direction(result, 'fr-en').ineligibleReason).toBe('content_language_mismatch');
  });
});

describe('moteur : créateur bilingue', () => {
  it('les deux directions sont évaluées, chacune avec son score', () => {
    const result = assessCreator(
      request({
        videos: [
          ...videos(5, { text: 'fr', audio: 'fr', views: 10_000 }),
          ...videos(5, { text: 'en', audio: 'en', views: 10_000 }),
        ],
        comments: comments({ fr: 20, en: 20 }),
      }),
    );
    expect(result.content).toMatchObject({ language: 'mixed', bilingual: true });
    const frEn = direction(result, 'fr-en');
    const enFr = direction(result, 'en-fr');
    expect(frEn.eligible && enFr.eligible).toBe(true);
    expect(component(frEn, 'source_consistency')?.value).toBe(0.5);
    expect(component(enFr, 'source_consistency')?.value).toBe(0.5);
    expect(frEn.score).not.toBeNull();
    expect(enFr.score).not.toBeNull();
  });
});

describe('moteur : invariants', () => {
  it('le pays déclaré n’a aucun effet sur les directions', () => {
    const inFrance = assessCreator(frenchCreator());
    const input = frenchCreator();
    const elsewhere = assessCreator({
      ...input,
      channel: { ...input.channel, snippet: { ...input.channel.snippet, country: 'US' } },
    });
    expect(elsewhere.directions).toEqual(inFrance.directions);
  });

  it('déterministe : même entrée, même résultat', () => {
    expect(assessCreator(frenchCreator())).toEqual(assessCreator(frenchCreator()));
  });

  it('pondérations initiales : somme de 100', () => {
    const total = Object.values(LANGUAGE_METHOD_V1.weights).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('aucun signal sur l’audience n’est un fait, la limite démographique est toujours présente', () => {
    const scenarios = [
      frenchCreator(),
      frenchCreator({ comments: [] }),
      request({ videos: videos(10, { text: 'en', audio: 'en' }), comments: comments({ fr: 40 }) }),
      request({}),
    ];
    for (const scenario of scenarios) {
      const result = assessCreator(scenario);
      for (const signal of result.signals.filter((s) => s.code.startsWith('audience_'))) {
        expect(signal.kind).toBe('hypothesis');
      }
      expect(result.limitations.map((l) => l.code)).toContain('audience_demographics_unavailable');
      for (const d of result.directions) {
        expect(d.limitations.map((l) => l.code)).toContain('audience_demographics_unavailable');
      }
    }
  });
});

describe('moteur : confidentialité des commentaires', () => {
  const allComments = [...COMMENT_POOLS.fr, ...COMMENT_POOLS.en, ...COMMENT_POOLS.es];

  it('aucun texte de commentaire dans le résultat', () => {
    const output = JSON.stringify(assessCreator(frenchCreator()));
    for (const text of allComments) {
      // Fragment distinctif de chaque phrase (les mots isolés peuvent figurer dans les libellés).
      expect(output).not.toContain(text.slice(0, 25));
    }
  });

  it('entrée refusée : seuls les chemins des champs fautifs, jamais les valeurs', () => {
    const marker = 'COMMENTAIRE-CONFIDENTIEL-7f3a';
    const tooLong = comment(`${marker} `.repeat(400)); // > 10 000 caractères
    const tooMany = Array.from({ length: 101 }, () => comment(`${marker} ok`));
    for (const bad of [
      { ...frenchCreator(), comments: [tooLong] },
      { ...frenchCreator(), comments: tooMany },
    ]) {
      let error: unknown;
      try {
        assessCreator(bad);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      const serialized = JSON.stringify({
        message: (error as AppError).message,
        details: (error as AppError).details,
      });
      expect(serialized).not.toContain(marker);
      expect(serialized).toContain('comments');
    }
  });

  it('comptage des langues : des nombres seulement', () => {
    expect(
      countCommentLanguages(['Merci beaucoup, c’est vraiment top', 'ok', 'Thanks, this is great']),
    ).toEqual({ analyzed: 3, fr: 1, en: 1, other: 0, unknown: 1 });
  });
});
