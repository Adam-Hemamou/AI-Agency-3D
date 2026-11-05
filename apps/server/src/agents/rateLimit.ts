import type { RequestHandler } from 'express';
import { AGENT_REQUESTS_PER_MINUTE, ERROR_CODES } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock } from '../missions/missionService.ts';

/**
 * Débit maximal par agent (toutes routes, lectures comprises) : protège le serveur d'un
 * workflow qui tourne en boucle. Fenêtre glissante d'une minute, en mémoire : suffisant pour
 * un serveur local unique (à placer en base si l'API tourne un jour sur plusieurs processus).
 * Ce n'est pas un quota : les quotas journaliers, eux, sont comptés en base (quotas.ts).
 */
export function createAgentRateLimiter({
  perMinute = AGENT_REQUESTS_PER_MINUTE,
  clock = systemClock,
}: { perMinute?: number; clock?: Clock } = {}) {
  const hits = new Map<string, number[]>();
  const WINDOW_MS = 60_000;

  return {
    /** Lève RATE_LIMITED (429) si l'agent a dépassé son débit. */
    hit(agentId: string): void {
      const now = clock().getTime();
      const recent = (hits.get(agentId) ?? []).filter((t) => now - t < WINDOW_MS);
      if (recent.length >= perMinute) {
        hits.set(agentId, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000));
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          `Trop de requêtes pour cet agent (${perMinute} par minute) : réessayez dans ${retryAfterSeconds} s`,
          429,
          { retryAfterSeconds },
        );
      }
      recent.push(now);
      hits.set(agentId, recent);
    },
  };
}

export type AgentRateLimiter = ReturnType<typeof createAgentRateLimiter>;

export function agentRateLimit(limiter: AgentRateLimiter): RequestHandler {
  return (_req, res, next) => {
    const agentId = res.locals.agent?.agent.id;
    if (agentId) limiter.hit(agentId);
    next();
  };
}
