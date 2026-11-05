import { describe, expect, it } from 'vitest';
import { channelHandleKey, channelUrlKey, hasChannelIdentifier } from './agentApi';

describe('clés de comparaison des chaînes', () => {
  it.each([
    ['@LaCuisineDeLea', null, 'lacuisinedelea'],
    [' @@lacuisinedelea ', null, 'lacuisinedelea'],
    [null, 'https://www.youtube.com/@LaCuisineDeLea/videos', 'lacuisinedelea'],
    ['', 'https://youtube.example/@Lea', 'lea'],
    ['@nom', 'https://youtube.example/@autre', 'nom'], // le nom déclaré prime
    [null, 'https://youtube.com/channel/UC123', null],
    ['@', null, null],
    [null, null, null],
  ])('nom %j + adresse %j → %j', (handle, url, expected) => {
    expect(channelHandleKey(handle, url)).toBe(expected);
  });

  it.each([
    ['https://www.youtube.com/@Lea/', 'youtube.com/@lea'],
    ['http://youtube.com/@lea', 'youtube.com/@lea'],
    ['https://m.youtube.com/@lea?feature=share#top', 'youtube.com/@lea'],
    ['HTTPS://YOUTUBE.COM/channel/UC123//', 'youtube.com/channel/uc123'],
    ['https://', null],
  ])('adresse %j → %j', (url, expected) => {
    expect(channelUrlKey(url)).toBe(expected);
  });

  it('les variantes d’une même adresse donnent la même clé', () => {
    const keys = new Set(
      [
        'https://www.youtube.com/@Lea',
        'https://youtube.com/@lea/',
        'http://m.youtube.com/@LEA?x=1',
      ].map(channelUrlKey),
    );
    expect(keys.size).toBe(1);
  });

  it('exige au moins un identifiant de chaîne', () => {
    expect(hasChannelIdentifier({})).toBe(false);
    expect(hasChannelIdentifier({ channelHandle: '@' })).toBe(false);
    expect(hasChannelIdentifier({ youtubeChannelId: 'UC1' })).toBe(true);
    expect(hasChannelIdentifier({ channelHandle: '@lea' })).toBe(true);
    expect(hasChannelIdentifier({ channelUrl: 'https://youtube.com/channel/UC1' })).toBe(true);
  });
});
