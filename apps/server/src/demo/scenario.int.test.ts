import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { seedDemo } from './scenario.ts';

const prisma = createTestPrisma();

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

/**
 * Le scénario de démonstration passe par les vrais services : il doit respecter les règles
 * imposées aux agents (étapes, envois, actions de mission) sans aucune exception.
 */
describe('scénario de démonstration', () => {
  it('se joue entièrement en respectant les règles des agents', async () => {
    const counts = await seedDemo(prisma);
    expect(counts.prospects).toBeGreaterThan(0);

    // Aucune décision ni aucun envoi au nom d'un agent.
    expect(await prisma.prospectDecision.count({ where: { actorType: { not: 'user' } } })).toBe(0);
    const sends = await prisma.prospectEvent.findMany({
      where: { type: { in: ['email_sent', 'followup_sent'] } },
      select: { actorType: true },
    });
    expect(sends.every((e) => e.actorType !== 'agent')).toBe(true);
    // Aucune validation, annulation ou déblocage de mission par un agent.
    expect(
      await prisma.missionEvent.count({
        where: {
          actorType: 'agent',
          action: { in: ['approve', 'reject', 'request_changes', 'cancel', 'unblock'] },
        },
      }),
    ).toBe(0);
  }, 120_000);
});
