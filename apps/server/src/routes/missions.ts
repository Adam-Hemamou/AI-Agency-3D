import { Router } from 'express';
import {
  createMissionRequestSchema,
  missionListQuerySchema,
  missionTransitionRequestSchema,
  validationDecisionRequestSchema,
} from '@agency/shared';
import { parseOrThrow } from '../lib/validate.ts';
import type { Actor, MissionService } from '../missions/missionService.ts';

/**
 * Les requêtes HTTP proviennent de l'interface, donc de l'utilisateur humain.
 * Les agents et le système (phases suivantes) appelleront le service directement,
 * avec leur propre identité : ils ne passent pas par cette API.
 */
const HTTP_ACTOR: Actor = { type: 'user', id: 'owner' };

/**
 * Routes des missions. Aucune ne modifie la base directement :
 * tout passe par le moteur de missions, qui applique les règles du cycle de vie.
 */
export function missionsRouter(missions: MissionService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parseOrThrow(createMissionRequestSchema, req.body, 'Mission');
    res.status(201).json(await missions.create(input, HTTP_ACTOR));
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
    res.json(await missions.applyAction(req.params.id, request, HTTP_ACTOR));
  });

  router.post('/:id/validation', async (req, res) => {
    const request = parseOrThrow(
      validationDecisionRequestSchema,
      req.body,
      'Décision de validation',
    );
    res.json(await missions.decide(req.params.id, request, HTTP_ACTOR));
  });

  return router;
}
