import { z } from 'zod';

/** Réponse de GET /api/health. Le même schéma valide la réponse côté frontend. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  simulationMode: z.boolean(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: z.object({
      status: z.enum(['up', 'down']),
      latencyMs: z.number().nonnegative().optional(),
      error: z.string().optional(),
    }),
  }),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
