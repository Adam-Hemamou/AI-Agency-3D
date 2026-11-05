import { describe, expect, it } from 'vitest';
import { duplicateReport, type ProspectIdentityRow } from './duplicateReport.ts';

const row = (reference: string, day: number, fields: Partial<ProspectIdentityRow> = {}) => ({
  id: reference,
  reference,
  channelHandle: null,
  channelUrl: null,
  youtubeChannelId: null,
  createdAt: new Date(Date.UTC(2026, 9, day)),
  ...fields,
});

describe('rapport des doublons existants', () => {
  it('ne signale rien quand chaque chaîne est unique', () => {
    expect(
      duplicateReport([
        row('P-1', 1, { channelHandle: '@a' }),
        row('P-2', 2, { channelHandle: '@b' }),
      ]),
    ).toEqual([]);
  });

  it('regroupe les variantes d’une même chaîne, du plus ancien au plus récent', () => {
    const report = duplicateReport([
      row('P-3', 3, { channelUrl: 'https://youtube.com/@lea/' }),
      row('P-2', 2, { channelHandle: 'LEA' }),
      row('P-1', 1, { channelHandle: '@lea', channelUrl: 'https://www.youtube.com/@lea' }),
      row('P-4', 4, {}),
    ]);
    expect(report).toEqual([
      { field: 'channelHandle', key: 'lea', references: ['P-1', 'P-2', 'P-3'] },
      { field: 'channelUrl', key: 'youtube.com/@lea', references: ['P-1', 'P-3'] },
    ]);
  });
});
