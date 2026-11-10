import { describe, expect, it } from 'vitest';
import { fact, hypothesis, limitation, observation } from './signals.ts';

describe('niveaux de preuve des signaux', () => {
  it('un fait porte le champ de l’API dont il vient', () => {
    expect(
      fact(
        { code: 'channel_country', value: 'FR', text: 'Pays déclaré' },
        'channels',
        'snippet.country',
      ),
    ).toEqual({
      code: 'channel_country',
      kind: 'fact',
      direction: null,
      effect: 'neutral',
      value: 'FR',
      source: { api: 'youtube_data_api', resource: 'channels', field: 'snippet.country' },
      text: 'Pays déclaré',
    });
  });

  it('l’audience ne peut être ni un fait ni un simple indice : seulement une hypothèse', () => {
    const spec = { code: 'audience_target_presence' as const, text: 'Audience' };
    expect(() => fact(spec, 'commentThreads', 'snippet')).toThrow(/ne peut pas être un fait/);
    expect(() => observation(spec)).toThrow(/hypothèse/);
    expect(hypothesis(spec)).toMatchObject({ kind: 'hypothesis', source: null });
  });

  it('chaque limite a un texte en français', () => {
    expect(limitation('audience_demographics_unavailable').text).toMatch(/hypothèse/);
  });
});
