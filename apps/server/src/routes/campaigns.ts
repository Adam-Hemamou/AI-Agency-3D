import { Router } from 'express';
import { createCampaignRequestSchema, updateCampaignRequestSchema } from '@agency/shared';
import { actorOf } from '../auth/requestActor.ts';
import type { CampaignService } from '../campaigns/campaignService.ts';
import { parseOrThrow } from '../lib/validate.ts';

/**
 * Campagnes de prospection : réservées à l'utilisateur (agentAccessGuard refuse ces routes aux
 * agents, et le service le vérifie). Activer ou désactiver = PATCH { enabled }. Pas de suppression :
 * une campagne citée par des missions est conservée (désactivée) pour l'historique.
 */
export function campaignsRouter(campaigns: CampaignService): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await campaigns.list());
  });

  router.post('/', async (req, res) => {
    const input = parseOrThrow(createCampaignRequestSchema, req.body, 'Campagne');
    res.status(201).json(await campaigns.create(input, actorOf(res)));
  });

  router.get('/:id', async (req, res) => {
    res.json(await campaigns.get(req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const request = parseOrThrow(
      updateCampaignRequestSchema,
      req.body,
      'Modification de la campagne',
    );
    res.json(await campaigns.update(req.params.id, request, actorOf(res)));
  });

  return router;
}
