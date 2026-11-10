import { languageAssessmentInputSchema } from '@agency/shared';
import { describe, expect, it } from 'vitest';
import { assessContentLanguage } from './contentLanguage.ts';
import { channel, request, video, videos } from './fixtures.ts';
import { normalizeInput } from './youtubeInput.ts';

const content = (parts: Parameters<typeof request>[0]) =>
  assessContentLanguage(normalizeInput(languageAssessmentInputSchema.parse(request(parts))));

describe('langue du contenu', () => {
  it('audio déclaré en français et titres français : français, confiance élevée', () => {
    const result = content({
      channel: channel({ text: 'fr', defaultLanguage: 'fr' }),
      videos: videos(10, { text: 'fr', audio: 'fr' }),
    });
    expect(result).toMatchObject({
      language: 'fr',
      confidence: 'high',
      bilingual: false,
      decidedVideos: 10,
      shares: { fr: 1, en: 0, other: 0 },
    });
  });

  it('aucune métadonnée, 9 titres sur 10 en français : français, confiance moyenne', () => {
    const result = content({
      channel: channel({ text: 'fr' }),
      videos: [...videos(9, { text: 'fr' }), video({ text: 'none' })],
    });
    expect(result).toMatchObject({ language: 'fr', confidence: 'medium', decidedVideos: 9 });
  });

  it('audio déclaré en anglais mais titres tous en français : unknown, conflit signalé', () => {
    const result = content({ videos: videos(10, { text: 'fr', audio: 'en' }) });
    expect(result.language).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.signals.find((s) => s.code === 'metadata_conflict')).toMatchObject({
      kind: 'observation',
      effect: 'negative',
      value: 10,
    });
    expect(result.limitations.map((l) => l.code)).toContain('metadata_conflict');
  });

  it('quelques conflits seulement : langue retenue, mais jamais une confiance élevée', () => {
    const result = content({
      channel: channel({ text: 'fr', defaultLanguage: 'fr' }),
      videos: [...videos(9, { text: 'fr', audio: 'fr' }), video({ text: 'fr', audio: 'en' })],
    });
    expect(result.language).toBe('fr');
    expect(result.confidence).toBe('medium');
  });

  it('5 vidéos en français et 5 en anglais : bilingue', () => {
    const result = content({
      videos: [
        ...videos(5, { text: 'fr', audio: 'fr' }),
        ...videos(5, { text: 'en', audio: 'en' }),
      ],
    });
    expect(result).toMatchObject({ language: 'mixed', bilingual: true, confidence: 'high' });
    expect(result.shares).toEqual({ fr: 0.5, en: 0.5, other: 0 });
  });

  it('contenu en espagnol : autre langue', () => {
    const result = content({ videos: videos(6, { text: 'es', audio: 'es' }) });
    expect(result.language).toBe('other');
  });

  it('moins de 3 vidéos exploitables : unknown, sans conclusion forcée', () => {
    const result = content({
      channel: channel({ text: 'fr', defaultLanguage: 'fr' }),
      videos: videos(2, { text: 'fr', audio: 'fr' }),
    });
    expect(result.language).toBe('unknown');
    expect(result.limitations.map((l) => l.code)).toContain('few_videos');
  });

  it('aucune vidéo : unknown', () => {
    expect(content({ channel: channel({ text: 'fr' }) }).language).toBe('unknown');
  });

  it('aucune langue nettement dominante : unknown', () => {
    // 2 vidéos en français, 1 en anglais, 1 en espagnol : aucune langue à 60 %.
    const result = content({
      videos: [
        ...videos(2, { text: 'fr', audio: 'fr' }),
        video({ text: 'en', audio: 'en' }),
        video({ text: 'es', audio: 'es' }),
      ],
    });
    expect(result.language).toBe('unknown');
  });

  it('le pays et la langue déclarés sont des faits, la langue détectée un indice', () => {
    const result = content({
      channel: channel({ text: 'fr', defaultLanguage: 'fr', country: 'CA' }),
      videos: videos(4, { text: 'fr', audio: 'fr' }),
    });
    const kinds = Object.fromEntries(result.signals.map((s) => [s.code, s.kind]));
    expect(kinds).toMatchObject({
      channel_country: 'fact',
      channel_default_language: 'fact',
      video_audio_language: 'fact',
      video_text_language: 'observation',
      channel_text_language: 'observation',
      content_language: 'observation',
    });
    expect(result.signals.find((s) => s.code === 'channel_country')?.source).toEqual({
      api: 'youtube_data_api',
      resource: 'channels',
      field: 'snippet.country',
    });
  });
});
