import { Router } from 'express';
import {
  emailDecisionRequestSchema,
  emailDraftRequestSchema,
  followupMessageRequestSchema,
  followupUpdateRequestSchema,
  noteRequestSchema,
  prospectDecisionRequestSchema,
  prospectListQuerySchema,
  replyRequestSchema,
  simulatedSendRequestSchema,
} from '@agency/shared';
import { parseOrThrow } from '../lib/validate.ts';
import type { Actor } from '../missions/missionService.ts';
import type { ProspectService } from '../prospects/prospectService.ts';

/** Les requêtes HTTP proviennent de l'interface, donc de l'utilisateur humain. */
const HTTP_ACTOR: Actor = { type: 'user', id: 'owner' };

/**
 * Routes du CRM. Lecture du dossier complet et actions humaines uniquement :
 * chaque action passe par le service des prospects, qui applique les règles métier
 * et fait évoluer les missions via le moteur de missions.
 */
export function prospectsRouter(prospects: ProspectService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseOrThrow(prospectListQuerySchema, req.query, 'Filtres de recherche');
    res.json(await prospects.list(query));
  });

  router.get('/:id/dossier', async (req, res) => {
    res.json(await prospects.getDossier(req.params.id));
  });

  router.post('/:id/decisions', async (req, res) => {
    const body = parseOrThrow(prospectDecisionRequestSchema, req.body, 'Décision');
    res.json(await prospects.decideProspect(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/email/decisions', async (req, res) => {
    const body = parseOrThrow(emailDecisionRequestSchema, req.body, 'Décision sur l’e-mail');
    res.json(await prospects.decideEmail(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/email/drafts', async (req, res) => {
    const body = parseOrThrow(emailDraftRequestSchema, req.body, 'Brouillon');
    res.json(await prospects.editEmailDraft(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/email/simulated-send', async (req, res) => {
    const body = parseOrThrow(simulatedSendRequestSchema, req.body, 'Envoi simulé');
    res.json(await prospects.simulateSend(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/replies', async (req, res) => {
    const body = parseOrThrow(replyRequestSchema, req.body, 'Réponse');
    res.json(await prospects.recordReply(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/followups', async (req, res) => {
    const body = parseOrThrow(followupMessageRequestSchema, req.body, 'Relance');
    res.json(await prospects.sendFollowup(req.params.id, body, HTTP_ACTOR));
  });

  router.patch('/:id/followup', async (req, res) => {
    const body = parseOrThrow(followupUpdateRequestSchema, req.body, 'Suivi');
    res.json(await prospects.updateFollowup(req.params.id, body, HTTP_ACTOR));
  });

  router.post('/:id/notes', async (req, res) => {
    const body = parseOrThrow(noteRequestSchema, req.body, 'Note');
    res.json(await prospects.addNote(req.params.id, body, HTTP_ACTOR));
  });

  return router;
}
