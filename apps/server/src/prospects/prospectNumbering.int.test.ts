import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateProspectRequest } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';
import { createMissionService, type Actor } from '../missions/missionService.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { createProspectService } from './prospectService.ts';

const prisma = createTestPrisma();
const agent: Actor = { type: 'agent', id: 'agent-prospecteur' };

let now = new Date('2026-11-06T10:00:00.000Z');
const missions = createMissionService(prisma, { clock: () => now });
const service = createProspectService({ prisma, missions, simulationMode: true, clock: () => now });

const prospect = (overrides: Partial<CreateProspectRequest> = {}): CreateProspectRequest => ({
  creatorName: 'Créateur',
  channelName: 'Chaîne',
  discovery: {
    source: 'Test',
    reason: 'Test',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
  ...overrides,
});

/** Résultat de chaque création : référence, ou code d'erreur. */
async function settle(promises: Promise<{ prospect: { reference: string } }>[]) {
  const results = await Promise.allSettled(promises);
  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value.prospect.reference
      : r.reason instanceof AppError
        ? r.reason.code
        : `inattendu : ${String(r.reason)}`,
  );
}

beforeEach(async () => {
  now = new Date('2026-11-06T10:00:00.000Z');
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('numérotation des dossiers', () => {
  it('attribue des numéros consécutifs', async () => {
    const refs = [];
    for (const n of [1, 2, 3]) {
      refs.push(
        (await service.createProspect(prospect({ channelHandle: `@c${n}` }), agent)).prospect
          .reference,
      );
    }
    expect(refs).toEqual(['P-2026-0001', 'P-2026-0002', 'P-2026-0003']);
  });

  it('ne perd aucune création simultanée (8 chaînes différentes, 5 fois)', async () => {
    const all: string[] = [];
    for (let round = 0; round < 5; round++) {
      all.push(
        ...(await settle(
          Array.from({ length: 8 }, (_, k) =>
            service.createProspect(prospect({ channelHandle: `@r${round}-c${k}` }), agent),
          ),
        )),
      );
    }
    expect(all.filter((r) => !r.startsWith('P-'))).toEqual([]);
    expect(new Set(all).size).toBe(40);
    expect(await prisma.prospect.count()).toBe(40);
  });

  it('repart de zéro chaque année', async () => {
    await service.createProspect(prospect({ channelHandle: '@a' }), agent);
    now = new Date('2027-01-01T00:00:01.000Z');
    const d = await service.createProspect(prospect({ channelHandle: '@b' }), agent);
    expect(d.prospect.reference).toBe('P-2027-0001');
  });

  it('ne recule jamais derrière un numéro existant (dossier importé, compteur absent)', async () => {
    await prisma.prospect.create({
      data: {
        reference: 'P-2026-0042',
        creatorName: 'Importé',
        channelName: 'Importé',
        discoveredAt: now,
        lastActivityAt: now,
        updatedAt: now,
      },
    });
    const d = await service.createProspect(prospect({ channelHandle: '@nouveau' }), agent);
    expect(d.prospect.reference).toBe('P-2026-0043');
    expect(await prisma.prospectCounter.findUnique({ where: { year: 2026 } })).toEqual({
      year: 2026,
      lastNumber: 43,
    });
  });
});

describe('doublons lors de créations simultanées', () => {
  it.each([
    [
      'même nom de chaîne',
      [{ channelHandle: '@Lea' }, { channelHandle: 'lea' }, { channelHandle: ' @LEA' }],
    ],
    [
      'même adresse sous plusieurs formes',
      [
        { channelUrl: 'https://www.youtube.com/@lea' },
        { channelUrl: 'https://youtube.com/@lea/' },
        { channelUrl: 'https://m.youtube.com/@LEA?x=1' },
      ],
    ],
    [
      'nom d’un côté, adresse de l’autre',
      [{ channelHandle: '@lea' }, { channelUrl: 'https://youtube.example/@lea' }],
    ],
  ])('%s, au milieu d’autres créations : un seul dossier', async (_label, variants) => {
    for (let round = 0; round < 3; round++) {
      await resetDatabase();
      const others = Array.from({ length: 5 }, (_, k) =>
        service.createProspect(prospect({ channelHandle: `@autre-${k}` }), agent),
      );
      const same = variants.map((v) => service.createProspect(prospect(v), agent));
      const results = await settle([...same, ...others]);
      const forSame = results.slice(0, variants.length);
      expect(forSame.filter((r) => r.startsWith('P-'))).toHaveLength(1);
      expect(forSame.filter((r) => !r.startsWith('P-'))).toEqual(
        Array(variants.length - 1).fill('ALREADY_EXISTS'),
      );
      expect(results.slice(variants.length).every((r) => r.startsWith('P-'))).toBe(true);
    }
  });

  it('la base elle-même refuse deux dossiers avec la même clé', async () => {
    const d = await service.createProspect(prospect({ channelHandle: '@lea' }), agent);
    expect(d.prospect.channelHandle).toBe('@lea');
    // Écriture directe, sans passer par le service : refusée par l'index unique.
    await expect(
      prisma.prospect.create({
        data: {
          reference: 'P-2026-9999',
          creatorName: 'Contournement',
          channelName: 'Contournement',
          channelHandleKey: 'lea',
          discoveredAt: now,
          lastActivityAt: now,
          updatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('enrichissement et clés', () => {
  it('recalcule les clés quand le nom ou l’adresse change', async () => {
    const d = await service.createProspect(prospect({ channelHandle: '@ancien' }), agent);
    await service.enrichProspect(
      d.prospect.id,
      { channelHandle: '@Nouveau', channelUrl: 'https://www.youtube.com/@Nouveau/' },
      agent,
    );
    const row = await prisma.prospect.findUniqueOrThrow({ where: { id: d.prospect.id } });
    expect(row).toMatchObject({
      channelHandleKey: 'nouveau',
      channelUrlKey: 'youtube.com/@nouveau',
    });
    // L'ancien nom est libéré.
    await service.createProspect(prospect({ channelHandle: '@ancien' }), agent);
  });

  it('deux enrichissements simultanés vers le même nom : un seul passe', async () => {
    const a = await service.createProspect(prospect({ channelHandle: '@a' }), agent);
    const b = await service.createProspect(prospect({ channelHandle: '@b' }), agent);
    const results = await Promise.allSettled([
      service.enrichProspect(a.prospect.id, { channelHandle: '@cible' }, agent),
      service.enrichProspect(b.prospect.id, { channelHandle: '@cible' }, agent),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect((rejected.reason as AppError).code).toBe('ALREADY_EXISTS');
    expect(await prisma.prospect.count({ where: { channelHandleKey: 'cible' } })).toBe(1);
  });

  it('la recherche reconnaît les variantes d’adresse', async () => {
    const d = await service.createProspect(
      prospect({ channelUrl: 'https://www.youtube.com/channel/UC123' }),
      agent,
    );
    const found = await service.findDuplicates({
      channelUrl: 'https://youtube.com/channel/uc123/',
    });
    expect(found.matches.map((m) => m.prospect.id)).toEqual([d.prospect.id]);
    expect(found.matches[0]!.matchedOn).toContain('channelUrl');
  });
});
