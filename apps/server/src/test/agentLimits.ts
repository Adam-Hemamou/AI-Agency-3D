import { createAgentControl } from '../agents/agentControl.ts';
import { createQuotaService, type QuotaLimits } from '../agents/quotas.ts';
import { createAgentRateLimiter } from '../agents/rateLimit.ts';
import type { AppPrismaClient } from '../db/prisma.ts';

/**
 * Limites des agents pour les tests qui ne portent PAS sur les limites : quotas et débit
 * très larges, agents actifs. Les vraies valeurs sont vérifiées dans agentLimits.int.test.ts.
 */
export function testAgentLimits(prisma: AppPrismaClient, limits?: Partial<QuotaLimits>) {
  return {
    quotas: createQuotaService({
      prisma,
      limits: {
        prospect_create: 10_000,
        prospect_enrich: 10_000,
        production_create: 10_000,
        ...limits,
      },
    }),
    agentControl: createAgentControl({ prisma }),
    agentRateLimiter: createAgentRateLimiter({ perMinute: 100_000 }),
  };
}
