import { languageAssessmentInputSchema } from '@agency/shared';
import { describe, expect, it } from 'vitest';
import { OBSERVED_AT } from './fixtures.ts';
import { normalizeInput } from './youtubeInput.ts';

const parse = (raw: unknown) => normalizeInput(languageAssessmentInputSchema.parse(raw));

describe('lecture des réponses brutes de YouTube', () => {
  it('nombres en chaînes, codes de langue, traductions, sous-titres, champs inconnus ignorés', () => {
    const data = parse({
      observedAt: OBSERVED_AT,
      channel: {
        kind: 'youtube#channel',
        etag: 'ignoré',
        id: 'UCtestChaineFictive0001',
        snippet: { title: 'Chaîne', defaultLanguage: 'fr-FR', country: 'fr', thumbnails: {} },
        statistics: { subscriberCount: '12500', hiddenSubscriberCount: false, viewCount: '9' },
        localizations: { 'en-US': {}, 'en-GB': {}, es: {} },
      },
      videos: [
        {
          id: 'vidTest0001',
          snippet: {
            title: 'Titre',
            publishedAt: '2026-11-01T10:00:00Z',
            defaultAudioLanguage: 'fr-CA',
          },
          contentDetails: { caption: 'true', duration: 'PT10M' },
          statistics: { viewCount: '3400', likeCount: '12' },
        },
        { id: 'vidTest0002', contentDetails: { caption: 'false' } },
        { id: 'vidTest0002' }, // doublon : ignoré
      ],
    });
    expect(data.channel).toMatchObject({
      country: 'FR',
      defaultLanguage: 'fr',
      localizationLanguages: ['en', 'es'],
      subscriberCount: 12500,
      subscribersHidden: false,
    });
    expect(data.videos).toHaveLength(2);
    expect(data.videos[0]).toMatchObject({
      audioLanguage: 'fr',
      hasCaptions: true,
      viewCount: 3400,
      publishedAt: new Date('2026-11-01T10:00:00Z'),
    });
    expect(data.videos[1]).toMatchObject({
      hasCaptions: false,
      viewCount: null,
      publishedAt: null,
      audioLanguage: null,
    });
  });

  it('abonnés masqués : aucun nombre', () => {
    const data = parse({
      observedAt: OBSERVED_AT,
      channel: { id: 'UCx', statistics: { subscriberCount: '0', hiddenSubscriberCount: true } },
    });
    expect(data.channel.subscriberCount).toBeNull();
    expect(data.channel.subscribersHidden).toBe(true);
  });

  it('commentaires : texte brut de préférence, HTML retiré sinon, vides écartés', () => {
    const data = parse({
      observedAt: OBSERVED_AT,
      channel: { id: 'UCx' },
      comments: [
        { snippet: { topLevelComment: { snippet: { textOriginal: 'brut', textDisplay: 'x' } } } },
        { snippet: { topLevelComment: { snippet: { textDisplay: 'a<br>b <b>c</b>' } } } },
        { snippet: {} },
      ],
    });
    expect(data.commentTexts).toEqual(['brut', 'a b  c ']);
  });

  it('textes coupés à 500 caractères', () => {
    const data = parse({
      observedAt: OBSERVED_AT,
      channel: { id: 'UCx', snippet: { description: 'a'.repeat(4000) } },
    });
    expect(data.channel.description).toHaveLength(500);
  });
});
