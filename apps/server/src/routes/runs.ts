import { Router } from 'express';
import { runListQuerySchema } from '@agency/shared';
import type { RunService } from '../agents/runService.ts';
import { parseOrThrow } from '../lib/validate.ts';

/**
 * Journal des exécutions des agents, pour l'utilisateur (lecture seule).
 * - Réservé à la session humaine : la liste blanche refuse ces routes à tout agent, et l'écoute
 *   Tailscale ne les expose pas.
 * - Aucune route ne modifie ni ne supprime une exécution.
 * - La sortie brute du modèle n'est jamais renvoyée (seul hasRawOutput indique qu'elle existe).
 */
export function runsRouter(runs: RunService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseOrThrow(runListQuerySchema, req.query, 'Filtres du journal des exécutions');
    res.json(await runs.list(query));
  });

  return router;
}
