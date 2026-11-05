import { describe, expect, it } from 'vitest';
import { nextQuotaReset, quotaDay } from './quotas.ts';

describe('jour des quotas (heure de Paris)', () => {
  it.each([
    ['2026-11-06T10:00:00.000Z', '2026-11-06'],
    ['2026-11-06T22:59:59.999Z', '2026-11-06'], // 23 h 59 à Paris (UTC+1)
    ['2026-11-06T23:00:00.000Z', '2026-11-07'], // minuit à Paris
    ['2026-07-01T21:59:59.999Z', '2026-07-01'], // été (UTC+2)
    ['2026-07-01T22:00:00.000Z', '2026-07-02'],
  ])('%s → %s', (at, day) => {
    expect(quotaDay(new Date(at))).toBe(day);
  });

  it.each([
    ['2026-11-06T10:00:00.000Z', '2026-11-06T23:00:00.000Z'],
    ['2026-07-01T10:00:00.000Z', '2026-07-01T22:00:00.000Z'],
    // Passage à l'heure d'été (journée de 23 h) et à l'heure d'hiver (journée de 25 h).
    ['2026-03-29T10:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    ['2026-10-25T10:00:00.000Z', '2026-10-25T23:00:00.000Z'],
    ['2026-11-06T22:59:59.999Z', '2026-11-06T23:00:00.000Z'],
  ])('après %s, remise à zéro à %s', (at, reset) => {
    expect(nextQuotaReset(new Date(at)).toISOString()).toBe(reset);
  });
});
