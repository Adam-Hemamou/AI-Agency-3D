import { Router } from 'express';
import {
  createMissionRequestSchema,
  missionListQuerySchema,
  missionTransitionRequestSchema,
  validationDecisionRequestSchema,
} from '@agency/shared';
import { parseOrThrow } from '../lib/validate.ts';
import { actorOf } from '../auth/requestActor.ts';
import type { MissionService } from '../missions/missionService.ts';

/**
 * L'auteur de chaque action est celui identifié par identifyRequest (humain ou agent),
 * jamais une valeur fournie dans la requête.
 *
 * Routes des missions. Aucune ne modifie la base directement :
 * tout passe par le moteur de missions, qui applique les règles du cycle de vie.
 */
export function missionsRouter(missions: MissionService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parseOrThrow(createMissionRequestSchema, req.body, 'Mission');
    res.status(201).json(await missions.create(input, actorOf(res)));
  });

  router.get('/', async (req, res) => {
    const query = parseOrThrow(missionListQuerySchema, req.query, 'Filtres de recherche');
    res.json(await missions.list(query));
  });

  router.get('/:id', async (req, res) => {
    res.json(await missions.get(req.params.id));
  });

  router.get('/:id/events', async (req, res) => {
    res.json({ items: await missions.events(req.params.id) });
  });

  router.post('/:id/transitions', async (req, res) => {
    const request = parseOrThrow(missionTransitionRequestSchema, req.body, 'Demande de transition');
    res.json(await missions.applyAction(req.params.id, request, actorOf(res)));
  });

  router.post('/:id/validation', async (req, res) => {
    const request = parseOrThrow(
      validationDecisionRequestSchema,
      req.body,
      'Décision de validation',
    );
    res.json(await missions.decide(req.params.id, request, actorOf(res)));
  });

  return router;
}
