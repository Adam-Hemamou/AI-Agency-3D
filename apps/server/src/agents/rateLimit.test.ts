import { describe, expect, it } from 'vitest';
import type { AppError } from '../errors/AppError.ts';
import { createAgentRateLimiter } from './rateLimit.ts';

describe('débit par agent', () => {
  it('fenêtre glissante d’une minute, agent par agent', () => {
    let now = 0;
    const limiter = createAgentRateLimiter({ perMinute: 3, clock: () => new Date(now) });
    for (let i = 0; i < 3; i++) limiter.hit('a');
    let error: AppError | undefined;
    try {
      limiter.hit('a');
    } catch (e) {
      error = e as AppError;
    }
    expect(error?.code).toBe('RATE_LIMITED');
    expect(error?.details).toEqual({ retryAfterSeconds: 60 });
    expect(() => limiter.hit('b')).not.toThrow();
    now = 60_001;
    expect(() => limiter.hit('a')).not.toThrow();
  });
});
