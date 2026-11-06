import { Router } from 'express';
import {
  ERROR_CODES,
  agentPromptVersionParamSchema,
  agentsSwitchRequestSchema,
  createAgentPromptRequestSchema,
  createAgentRequestSchema,
  issueAgentKeyRequestSchema,
  updateAgentProfileRequestSchema,
  updateAgentRequestSchema,
  type AgentIdentityResponse,
} from '@agency/shared';
import type { AgentProfileService } from '../agents/agentProfileService.ts';
import type { AgentService } from '../agents/agentService.ts';
import { toAgentIdentityDto, toAgentKeyDto } from '../agents/serializers.ts';
import type { AgentControl } from '../agents/agentControl.ts';
import type { QuotaService } from '../agents/quotas.ts';
import { assertHumanActor } from '../auth/actors.ts';
import { actorOf } from '../auth/requestActor.ts';
import { AppError } from '../errors/AppError.ts';
import { parseOrThrow } from '../lib/validate.ts';

/**
 * Gestion des agents et de leurs clés : réservée à l'utilisateur humain
 * (le service le vérifie, et agentAccessGuard refuse déjà ces routes aux agents).
 * Seule exception : GET /me, par lequel un agent vérifie l'identité associée à sa clé.
 */
export interface AgentsRouterOptions {
  quotas?: QuotaService;
  control?: AgentControl;
  /** Profils IA et prompts versionnés (sans lui, ces routes répondent 404). */
  profiles?: AgentProfileService;
}

export function agentsRouter(
  agents: AgentService,
  { quotas, control, profiles }: AgentsRouterOptions = {},
): Router {
  const router = Router();

  // Déclarées avant "/:id" pour ne pas être prises pour un identifiant d'agent.
  // Réservées à l'utilisateur : agentAccessGuard les refuse à tout agent.
  router.get('/quotas', async (_req, res) => {
    if (!quotas) throw AppError.notFound('Quotas non configurés');
    res.json(await quotas.status());
  });

  /** Arrêt d'urgence des agents : état. */
  router.get('/emergency-stop', (_req, res) => {
    if (!control) throw AppError.notFound('Arrêt d’urgence non configuré');
    res.json(control.status());
  });

  /** Arrêt d'urgence : { enabled: false } arrête immédiatement tous les agents. */
  router.post('/emergency-stop', async (req, res) => {
    if (!control) throw AppError.notFound('Arrêt d’urgence non configuré');
    assertHumanActor(actorOf(res), 'déclencher ou lever l’arrêt d’urgence des agents');
    const { enabled } = parseOrThrow(agentsSwitchRequestSchema, req.body, 'Arrêt d’urgence');
    res.json(await control.setEnabled(enabled));
  });

  // Déclarée avant "/:id" pour ne pas être prise pour un identifiant.
  router.get('/me', (_req, res) => {
    const authenticated = res.locals.agent;
    if (!authenticated) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN_ACTOR,
        'Route réservée aux agents : présentez une clé API (Authorization: Bearer <clé>)',
        403,
      );
    }
    const body: AgentIdentityResponse = {
      agent: toAgentIdentityDto({
        ...authenticated.agent,
        permissions: [...authenticated.permissions].map((permission) => ({ permission })),
      }),
      key: toAgentKeyDto(authenticated.key),
    };
    res.json(body);
  });

  router.get('/', async (_req, res) => {
    res.json(await agents.list());
  });

  router.post('/', async (req, res) => {
    const input = parseOrThrow(createAgentRequestSchema, req.body, 'Agent');
    res.status(201).json(await agents.create(input, actorOf(res)));
  });

  router.get('/:id', async (req, res) => {
    res.json(await agents.get(req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const request = parseOrThrow(updateAgentRequestSchema, req.body, 'Modification de l’agent');
    res.json(await agents.update(req.params.id, request, actorOf(res)));
  });

  router.post('/:id/keys', async (req, res) => {
    const input = parseOrThrow(issueAgentKeyRequestSchema, req.body ?? {}, 'Clé API');
    // La clé complète n'apparaît que dans cette réponse : elle ne doit pas être mise en cache.
    res.set('Cache-Control', 'no-store');
    res.status(201).json(await agents.issueKey(req.params.id, input, actorOf(res)));
  });

  router.post('/:id/keys/:keyId/revoke', async (req, res) => {
    res.json(await agents.revokeKey(req.params.id, req.params.keyId, actorOf(res)));
  });

  // ---------------------------------------------------------------------------
  // Profil IA et prompts versionnés (utilisateur uniquement ; un agent lit le sien par
  // GET /api/agent/profile). Les versions ne sont jamais modifiées : on en crée une nouvelle.
  // ---------------------------------------------------------------------------
  const profilesOf = (): AgentProfileService => {
    if (!profiles) throw AppError.notFound('Profils des agents non configurés');
    return profiles;
  };
  const versionOf = (value: unknown) =>
    parseOrThrow(agentPromptVersionParamSchema, value, 'Version du prompt');

  router.get('/:id/profile', async (req, res) => {
    res.json(await profilesOf().getProfile(req.params.id));
  });

  router.patch('/:id/profile', async (req, res) => {
    const request = parseOrThrow(updateAgentProfileRequestSchema, req.body, 'Profil de l’agent');
    res.json(await profilesOf().updateProfile(req.params.id, request, actorOf(res)));
  });

  router.get('/:id/prompts', async (req, res) => {
    res.json(await profilesOf().listPrompts(req.params.id));
  });

  router.post('/:id/prompts', async (req, res) => {
    const input = parseOrThrow(createAgentPromptRequestSchema, req.body, 'Prompt de l’agent');
    res.status(201).json(await profilesOf().createPrompt(req.params.id, input, actorOf(res)));
  });

  router.get('/:id/prompts/:version', async (req, res) => {
    res.json(await profilesOf().getPrompt(req.params.id, versionOf(req.params.version)));
  });

  router.post('/:id/prompts/:version/activate', async (req, res) => {
    res.json(
      await profilesOf().activatePrompt(req.params.id, versionOf(req.params.version), actorOf(res)),
    );
  });

  return router;
}
