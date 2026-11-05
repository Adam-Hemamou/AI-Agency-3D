import {
  AGENT_DAILY_QUOTAS,
  AGENT_QUOTA_ACTIONS,
  AGENT_QUOTA_LABELS,
  AGENT_QUOTA_TIME_ZONE,
  ERROR_CODES,
  type AgentQuotaAction,
  type AgentQuotaStatus,
} from '@agency/shared';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock, type Db } from '../missions/missionService.ts';

/**
 * Quotas journaliers GLOBAUX des agents : un seul compteur par jour et par action, partagé par
 * tous les agents et toutes leurs clés. Impossible à contourner en multipliant agents ou clés.
 *
 * consume() s'exécute DANS la transaction de l'écriture : la ligne du compteur est incrémentée
 * puis verrouillée jusqu'à la fin de la transaction. Les écritures simultanées comptent donc
 * l'une après l'autre (limite exacte), et une écriture annulée — quota dépassé compris —
 * n'est pas comptée.
 */

/** Jour calendaire (AAAA-MM-JJ) d'un instant, à l'heure de Paris. */
export function quotaDay(at: Date, timeZone = AGENT_QUOTA_TIME_ZONE): string {
  // en-CA formate en AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Prochain minuit à l'heure de Paris (changements d'heure compris). */
export function nextQuotaReset(at: Date, timeZone = AGENT_QUOTA_TIME_ZONE): Date {
  const today = quotaDay(at, timeZone);
  // Recherche dichotomique (à la milliseconde près) du premier instant du jour suivant, dans les 26 h.
  let low = at.getTime();
  let high = low + 26 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (quotaDay(new Date(mid), timeZone) === today) low = mid;
    else high = mid;
  }
  return new Date(high);
}

export type QuotaLimits = Record<AgentQuotaAction, number>;

export function createQuotaService({
  prisma,
  limits = AGENT_DAILY_QUOTAS,
  clock = systemClock,
}: {
  prisma: AppPrismaClient;
  limits?: QuotaLimits;
  clock?: Clock;
}) {
  return {
    limits,

    /**
     * Compte une opération. Lève QUOTA_EXCEEDED (429) si la limite est dépassée : la
     * transaction est alors annulée, l'incrément avec.
     * Lecture verrouillante (FOR UPDATE), jamais une lecture ordinaire : elle ne fige pas la
     * « photo » de la base avant les verrous que le service prendra ensuite.
     */
    async consume(tx: Db, action: AgentQuotaAction): Promise<void> {
      const now = clock();
      const day = quotaDay(now);
      await tx.$executeRaw`
        INSERT INTO agent_quota_usage (day, action, used) VALUES (${day}, ${action}, 1)
        ON DUPLICATE KEY UPDATE used = used + 1`;
      const [row] = await tx.$queryRaw<{ used: number | bigint }[]>`
        SELECT used FROM agent_quota_usage WHERE day = ${day} AND action = ${action} FOR UPDATE`;
      const used = Number(row?.used ?? 0);
      const limit = limits[action];
      if (used > limit) {
        const resetsAt = nextQuotaReset(now);
        throw new AppError(
          ERROR_CODES.QUOTA_EXCEEDED,
          `Quota journalier atteint : ${AGENT_QUOTA_LABELS[action].toLowerCase()} (${limit} par jour, tous agents confondus)`,
          429,
          {
            action,
            limit,
            resetsAt: resetsAt.toISOString(),
            retryAfterSeconds: Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)),
          },
        );
      }
    },

    /** Consommation du jour (lecture seule). */
    async status(): Promise<AgentQuotaStatus> {
      const now = clock();
      const day = quotaDay(now);
      const rows = await prisma.agentQuotaUsage.findMany({ where: { day } });
      const used = new Map(rows.map((r) => [r.action, r.used]));
      return {
        day,
        resetsAt: nextQuotaReset(now).toISOString(),
        quotas: AGENT_QUOTA_ACTIONS.map((action) => {
          const count = Math.min(used.get(action) ?? 0, limits[action]);
          return {
            action,
            label: AGENT_QUOTA_LABELS[action],
            limit: limits[action],
            used: count,
            remaining: limits[action] - count,
          };
        }),
      };
    },
  };
}

export type QuotaService = ReturnType<typeof createQuotaService>;
