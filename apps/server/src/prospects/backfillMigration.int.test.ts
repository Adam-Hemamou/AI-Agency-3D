import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { channelHandleKey, channelUrlKey } from '@agency/shared';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';

/**
 * La migration du lot B remplit les compteurs et les clés des dossiers EXISTANTS.
 * La base de test est créée vide : on rejoue ici ses instructions de remplissage (lues dans le
 * fichier de migration lui-même) sur des dossiers « anciens », dont des doublons.
 */

const MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261106100000_security_hardening/migration.sql',
    import.meta.url,
  ),
);

function section(name: string): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`-- lot-b:${name}:begin`);
  const end = sql.indexOf(`-- lot-b:${name}:end`);
  if (start < 0 || end < 0) throw new Error(`section ${name} introuvable dans la migration`);
  return sql
    .slice(start, end)
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

const prisma = createTestPrisma();
const at = (iso: string) => new Date(iso);

/** Dossier tel qu'il existait avant la migration : sans clé. */
async function legacy(
  reference: string,
  fields: { channelHandle?: string; channelUrl?: string },
  created: string,
) {
  return prisma.prospect.create({
    data: {
      reference,
      creatorName: reference,
      channelName: reference,
      ...fields,
      discoveredAt: at(created),
      lastActivityAt: at(created),
      createdAt: at(created),
      updatedAt: at(created),
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('migration du lot B sur des données existantes', () => {
  it('donne à chaque dossier les mêmes clés que le code', async () => {
    const cases = [
      { channelHandle: '@LaCuisineDeLea' },
      { channelHandle: ' @@Double' },
      { channelUrl: 'https://www.youtube.com/@ParAdresse/videos' },
      { channelUrl: 'https://m.youtube.com/channel/UC777?x=1#y' },
      { channelHandle: '@Prime', channelUrl: 'https://youtube.example/@autre/' },
      {},
    ];
    const rows = [];
    for (const [i, fields] of cases.entries()) {
      rows.push(
        await legacy(
          `P-2026-${String(i + 1).padStart(4, '0')}`,
          fields,
          `2026-10-0${i + 1}T00:00:00Z`,
        ),
      );
    }
    for (const statement of section('keys')) await prisma.$executeRawUnsafe(statement);

    for (const [i, fields] of cases.entries()) {
      const row = await prisma.prospect.findUniqueOrThrow({ where: { id: rows[i]!.id } });
      expect(row.channelHandleKey, JSON.stringify(fields)).toBe(
        channelHandleKey(fields.channelHandle, fields.channelUrl),
      );
      expect(row.channelUrlKey, JSON.stringify(fields)).toBe(channelUrlKey(fields.channelUrl));
    }
  });

  it('doublons déjà présents : rien n’est supprimé, seul le plus ancien reçoit la clé', async () => {
    const recent = await legacy('P-2026-0002', { channelHandle: 'lea' }, '2026-10-05T00:00:00Z');
    const oldest = await legacy('P-2026-0001', { channelHandle: '@Lea' }, '2026-10-01T00:00:00Z');
    const sameUrl = await legacy(
      'P-2026-0003',
      { channelUrl: 'https://youtube.com/@lea/' },
      '2026-10-09T00:00:00Z',
    );
    for (const statement of section('keys')) await prisma.$executeRawUnsafe(statement);

    const keys = Object.fromEntries(
      (await prisma.prospect.findMany()).map((r) => [r.id, [r.channelHandleKey, r.channelUrlKey]]),
    );
    expect(await prisma.prospect.count()).toBe(3);
    expect(keys[oldest.id]).toEqual(['lea', null]);
    expect(keys[recent.id]).toEqual([null, null]);
    // Même chaîne par son adresse : la clé d'adresse est posée, celle du nom reste au plus ancien.
    expect(keys[sameUrl.id]).toEqual([null, 'youtube.com/@lea']);
  });

  it('les compteurs repartent du plus grand numéro de chaque année', async () => {
    await legacy('P-2025-0007', { channelHandle: '@a' }, '2025-06-01T00:00:00Z');
    await legacy('P-2026-0003', { channelHandle: '@b' }, '2026-02-01T00:00:00Z');
    await legacy('P-2026-0012', { channelHandle: '@c' }, '2026-03-01T00:00:00Z');
    await legacy('ANCIEN-FORMAT', { channelHandle: '@d' }, '2026-04-01T00:00:00Z');
    for (const statement of section('counters')) await prisma.$executeRawUnsafe(statement);
    expect(await prisma.prospectCounter.findMany({ orderBy: { year: 'asc' } })).toEqual([
      { year: 2025, lastNumber: 7 },
      { year: 2026, lastNumber: 12 },
    ]);
  });
});
