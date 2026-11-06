import { Router, type Response } from 'express';
import {
  AGENT_ANALYSIS_STAGES,
  AGENT_STAGE_TRANSITIONS,
  ERROR_CODES,
  PROSPECT_STAGE_LABELS,
  PROSPECT_STAGE_ROOMS,
  ROOM_LABELS,
  agentEventRequestSchema,
  agentProductionsAt,
  agentStageRequestSchema,
  CLAIM_ONLY_MISSION_ACTIONS,
  canAgentSeeMission,
  claimRunRequestSchema,
  runFailureRequestSchema,
  runHeartbeatRequestSchema,
  PRODUCTION_READ_PERMISSION,
  checkAgentProduction,
  missionListQuerySchema,
  createAnalysisRequestSchema,
  createProductionRequestSchema,
  createProspectRequestSchema,
  enrichProspectRequestSchema,
  hasChannelIdentifier,
  missionTransitionRequestSchema,
  prospectLookupQuerySchema,
  type AgentMissionScope,
  type AgentProspectContext,
  type AgentQuotaAction,
  type ProductionKind,
  type ProductionStatus,
  type ProspectStage,
  type RoomId,
} from '@agency/shared';
import type { AuthenticatedAgent } from '../agents/agentService.ts';
import type { AgentControl } from '../agents/agentControl.ts';
import type { AgentProfileService } from '../agents/agentProfileService.ts';
import type { RunService } from '../agents/runService.ts';
import { toAgentDossier } from '../agents/agentView.ts';
import type { QuotaService } from '../agents/quotas.ts';
import {
  idempotentCommand,
  type IdempotencyStore,
  type IdempotentCommand,
} from '../agents/idempotency.ts';
import type { WriteResource } from '../db/transactionHook.ts';
import { AppError } from '../errors/AppError.ts';
import { parseOrThrow } from '../lib/validate.ts';
import type { MissionService } from '../missions/missionService.ts';
import type { ProspectService } from '../prospects/prospectService.ts';

/**
 * API réservée aux agents IA (/api/agent/…).
 *
 * - L'auteur de chaque action est l'agent authentifié par sa clé (jamais une valeur de la requête).
 * - La permission exigée par chaque route est vérifiée en amont (agentAccessGuard).
 * - Les règles propres aux agents (étapes, productions, salle, missions attribuées) sont
 *   vérifiées ici, dans la transaction du service quand c'est possible.
 * - Toute écriture exige un en-tête Idempotency-Key : une requête répétée n'est exécutée qu'une fois.
 * - Aucune route ne valide, ne décide ni n'envoie : ces actions restent à l'utilisateur.
 */

export interface AgentApiDeps {
  prospects: ProspectService;
  missions: MissionService;
  idempotency: IdempotencyStore;
  /** Quotas journaliers globaux. */
  quotas: QuotaService;
  /** Arrêt d'urgence, revérifié dans la transaction de chaque écriture. */
  control: AgentControl;
  /** Profils IA (GET /profile). Facultatif : sans lui, la route n'existe pas (404). */
  profiles?: AgentProfileService;
  /** Exécutions (POST /runs/claim). Facultatif : sans lui, les routes n'existent pas (404). */
  runs?: RunService;
}

function forbidden(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

function agentOf(res: Response): AuthenticatedAgent {
  const agent = res.locals.agent;
  if (!agent) {
    throw forbidden(
      'Route réservée aux agents : présentez une clé API (Authorization: Bearer <clé>)',
    );
  }
  return agent;
}

/** Identité et salle de l'agent, pour décider des missions qu'il voit (canAgentSeeMission). */
function missionScopeOf(agent: AuthenticatedAgent): AgentMissionScope {
  return { id: agent.agent.id, room: agent.agent.room };
}

/** Étapes vers lesquelles CET agent peut faire passer un dossier (salle de l'agent comprise). */
function allowedStagesFor(agent: AuthenticatedAgent, stage: ProspectStage): ProspectStage[] {
  if (!agent.permissions.has('stages:advance')) return [];
  if (agent.agent.room && PROSPECT_STAGE_ROOMS[stage] !== agent.agent.room) return [];
  return [...(AGENT_STAGE_TRANSITIONS[stage] ?? [])];
}

export function agentApiRouter({
  prospects,
  missions,
  idempotency,
  quotas,
  control,
  profiles,
  runs,
}: AgentApiDeps): Router {
  const router = Router();
  /**
   * Écriture d'agent : idempotente, et contrôlée DANS sa transaction (arrêt d'urgence, puis quota
   * global éventuel). Un refus annule tout : aucune donnée ni aucun compteur n'est modifié.
   */
  const command = (definition: IdempotentCommand, quota?: AgentQuotaAction) =>
    idempotentCommand(idempotency, {
      ...definition,
      beforeWrite: async (tx) => {
        control.assertEnabled();
        if (quota) await quotas.consume(tx, quota);
      },
    });
  /**
   * Réponse des écritures sur un dossier : son état actuel, filtré selon les permissions
   * actuelles de l'agent (première réponse comme répétition).
   */
  const renderDossier = async (resource: WriteResource, res: Response) =>
    toAgentDossier(await prospects.getDossier(resource.id), agentOf(res).permissions, {
      missionsOf: missionScopeOf(agentOf(res)),
    });

  // Aucune de ces routes n'est accessible à l'utilisateur humain : elles parlent au nom d'un agent.
  router.use((_req, res, next) => {
    agentOf(res);
    next();
  });

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Profil IA de l'agent authentifié : rôle, paramètres du modèle et prompt actif. Toujours le
   * sien : l'identité vient de la clé, aucun paramètre ne permet de lire celui d'un autre agent.
   */
  if (profiles) {
    router.get('/profile', async (_req, res) => {
      res.json(await profiles.selfProfile(agentOf(res).agent));
    });
  }

  /**
   * Prise de mission par n8n : la prochaine mission de l'agent est démarrée (ou reprise après une
   * demande de modification) et son exécution créée, en une transaction.
   * 201 : nouvelle prise ; 200 : même exécution n8n rejouée (identifiant n8n = clé d'idempotence) ;
   * 204 : aucune mission disponible ; 409 AGENT_PROMPT_MISSING : aucun prompt actif.
   */
  if (runs) {
    router.post('/runs/claim', async (req, res) => {
      const { n8nExecutionId } = parseOrThrow(claimRunRequestSchema, req.body, 'Prise de mission');
      const claimed = await runs.claim(agentOf(res), n8nExecutionId);
      if (!claimed) {
        res.status(204).end();
        return;
      }
      res.status(claimed.replayed ? 200 : 201).json(claimed);
    });

    /** Signal de vie de l'exécution en cours (au moins toutes les 5 minutes pendant le travail). */
    router.post('/runs/:id/heartbeat', async (req, res) => {
      const { n8nExecutionId } = parseOrThrow(
        runHeartbeatRequestSchema,
        req.body ?? {},
        'Signal de vie',
      );
      res.json(await runs.heartbeat(agentOf(res), String(req.params.id), n8nExecutionId));
    });

    /**
     * Échec de l'exécution : elle est close, et le CRM décide de la suite (remise en attente sans
     * effet et avec une tentative restante, sinon blocage). Le même échec renvoyé ne change rien.
     */
    router.post('/runs/:id/failure', async (req, res) => {
      const request = parseOrThrow(runFailureRequestSchema, req.body, 'Échec de l’exécution');
      res.json(await runs.fail(agentOf(res), String(req.params.id), request));
    });

    /** Une de SES exécutions et sa mission, en lecture seule (jamais la sortie brute). */
    router.get('/runs/:id', async (req, res) => {
      res.json(await runs.getForAgent(agentOf(res), String(req.params.id)));
    });
  }

  router.get('/prospects/lookup', async (req, res) => {
    const query = parseOrThrow(prospectLookupQuerySchema, req.query, 'Recherche de doublons');
    // Chercher par e-mail révèle à qui appartient une adresse : réservé aux coordonnées.
    if (query.contactEmail && !agentOf(res).permissions.has('prospects:read_contact')) {
      throw forbidden(
        'Recherche par e-mail réservée aux agents autorisés à lire les coordonnées (prospects:read_contact)',
      );
    }
    res.json(await prospects.findDuplicates(query));
  });

  /**
   * Missions, pour les agents : sans historique (les événements portent les motifs des décisions
   * humaines). Uniquement celles que l'agent peut voir (canAgentSeeMission) : les siennes et,
   * s'il est rattaché à une salle, les missions libres de cette salle. Jamais celles d'un autre agent.
   */
  router.get('/missions', async (req, res) => {
    const agent = agentOf(res);
    const query = parseOrThrow(missionListQuerySchema, req.query, 'Filtres de recherche');
    const room = agent.agent.room as RoomId | null;
    if (room && query.room && query.room.some((r) => r !== room)) {
      throw forbidden(`Cet agent ne voit que les missions de sa salle (${ROOM_LABELS[room]})`);
    }
    res.json(await missions.list(query, { visibleTo: missionScopeOf(agent) }));
  });

  router.get('/missions/:id', async (req, res) => {
    const agent = agentOf(res);
    const mission = await missions.get(req.params.id);
    if (!canAgentSeeMission(mission, missionScopeOf(agent))) {
      throw forbidden(
        mission.agentId !== null && mission.agentId !== agent.agent.id
          ? 'Cette mission est attribuée à un autre agent'
          : agent.agent.room
            ? 'Cette mission appartient à une autre salle'
            : 'Un agent sans salle ne voit que les missions qui lui sont attribuées',
      );
    }
    res.json(mission);
  });

  router.get('/prospects/:id/context', async (req, res) => {
    const agent = agentOf(res);
    const dossier = await prospects.getDossier(req.params.id);
    const { stage } = dossier.prospect;
    const body: AgentProspectContext = {
      dossier: toAgentDossier(dossier, agent.permissions, { missionsOf: missionScopeOf(agent) }),
      workflow: {
        stage,
        room: PROSPECT_STAGE_ROOMS[stage],
        allowedStages: allowedStagesFor(agent, stage),
        canAddAnalysis:
          agent.permissions.has('analyses:write') && AGENT_ANALYSIS_STAGES.includes(stage),
        allowedProductions: agent.permissions.has('productions:write')
          ? agentProductionsAt(stage).filter((x) =>
              agent.permissions.has(PRODUCTION_READ_PERMISSION[x.kind]),
            )
          : [],
        doNotContact: dossier.prospect.doNotContact,
      },
    };
    res.json(body);
  });

  /** Consommation des quotas globaux du jour (pour que n8n sache s'il peut continuer). */
  router.get('/quotas', async (_req, res) => {
    res.json(await quotas.status());
  });

  // ---------------------------------------------------------------------------
  // Écritures (toutes rejouables sans effet grâce à Idempotency-Key)
  // ---------------------------------------------------------------------------

  /** Agents : un prospect n'est jamais une donnée de démonstration. */
  const agentProspectSchema = createProspectRequestSchema
    .omit({ isDemo: true })
    // Sans identifiant de chaîne, impossible de détecter un doublon : refusé.
    .refine(hasChannelIdentifier, {
      error: 'Indiquez au moins youtubeChannelId, channelHandle ou channelUrl',
      path: ['channelHandle'],
    });

  router.post(
    '/prospects',
    command(
      {
        status: 201,
        render: renderDossier,
        execute: async (req, res, hook) => {
          const agent = agentOf(res);
          const input = parseOrThrow(agentProspectSchema, req.body, 'Prospect');
          // L'auteur de la découverte est fixé par le serveur, pas déclaré par l'agent.
          const request = {
            ...input,
            discovery: { ...input.discovery, discoveredBy: agent.agent.id },
          };
          await prospects.createProspect(request, agent.actor, { hook });
        },
      },
      'prospect_create',
    ),
  );

  router.patch(
    '/prospects/:id',
    command(
      {
        status: 200,
        render: renderDossier,
        execute: async (req, res, hook) => {
          const request = parseOrThrow(enrichProspectRequestSchema, req.body, 'Enrichissement');
          const touchesContact = ['contactEmail', 'contactName', 'contactSource'].some(
            (field) => field in request,
          );
          if (touchesContact && !agentOf(res).permissions.has('prospects:read_contact')) {
            throw forbidden(
              'Modifier les coordonnées exige de pouvoir les lire (prospects:read_contact)',
            );
          }
          await prospects.enrichProspect(String(req.params.id), request, agentOf(res).actor, {
            hook,
          });
        },
      },
      'prospect_enrich',
    ),
  );

  router.post(
    '/prospects/:id/analyses',
    command({
      status: 201,
      render: renderDossier,
      execute: async (req, res, hook) => {
        const request = parseOrThrow(createAnalysisRequestSchema, req.body, 'Analyse');
        await prospects.addAnalysis(String(req.params.id), request, agentOf(res).actor, {
          hook,
          guard: (row) => {
            if (!AGENT_ANALYSIS_STAGES.includes(row.stage as ProspectStage)) {
              throw forbidden(
                `Analyse impossible à l'étape « ${PROSPECT_STAGE_LABELS[row.stage as ProspectStage]} »`,
              );
            }
          },
        });
      },
    }),
  );

  router.post(
    '/prospects/:id/productions',
    command(
      {
        status: 201,
        render: renderDossier,
        execute: async (req, res, hook) => {
          const request = parseOrThrow(createProductionRequestSchema, req.body, 'Production');
          const kind = request.kind as ProductionKind;
          const status = request.status as ProductionStatus;
          const readPermission = PRODUCTION_READ_PERMISSION[kind];
          if (!agentOf(res).permissions.has(readPermission)) {
            throw forbidden(
              `Production « ${kind} » réservée aux agents autorisés à la lire (${readPermission})`,
            );
          }
          await prospects.addProduction(String(req.params.id), request, agentOf(res).actor, {
            hook,
            guard: (row) => {
              const check = checkAgentProduction(row.stage as ProspectStage, kind, status);
              if (!check.allowed) throw forbidden(check.reason);
            },
          });
        },
      },
      'production_create',
    ),
  );

  router.post(
    '/prospects/:id/stage',
    command({
      status: 200,
      render: renderDossier,
      execute: async (req, res, hook) => {
        const agent = agentOf(res);
        const request = parseOrThrow(agentStageRequestSchema, req.body, 'Changement d’étape');
        await prospects.advanceStage(String(req.params.id), request, agent.actor, {
          hook,
          guard: (row) => {
            const room = PROSPECT_STAGE_ROOMS[row.stage as ProspectStage];
            if (agent.agent.room && room !== agent.agent.room) {
              throw forbidden(
                `Cet agent travaille en « ${ROOM_LABELS[agent.agent.room as RoomId] ?? agent.agent.room} » : il ne peut pas faire avancer un dossier d'une autre salle`,
              );
            }
          },
        });
      },
    }),
  );

  router.post(
    '/prospects/:id/events',
    command({
      status: 201,
      render: renderDossier,
      execute: async (req, res, hook) => {
        const request = parseOrThrow(agentEventRequestSchema, req.body, 'Activité');
        await prospects.logActivity(String(req.params.id), request, agentOf(res).actor, { hook });
      },
    }),
  );

  /**
   * Transitions de mission. Le moteur vérifie, dans sa transaction : mission de l'agent ; ni annuler
   * ni débloquer. Démarrer et reprendre (entrer « en cours ») passent OBLIGATOIREMENT par
   * POST /runs/claim, qui crée l'exécution : un agent ne travaille jamais sans exécution tracée.
   */
  router.post(
    '/missions/:id/transitions',
    command({
      status: 200,
      render: async (resource) => ({
        mission: await missions.get(resource.id),
        event: await missions.event(resource.id, resource.eventId!),
      }),
      execute: async (req, res, hook) => {
        const request = parseOrThrow(missionTransitionRequestSchema, req.body, 'Transition');
        if (CLAIM_ONLY_MISSION_ACTIONS.includes(request.action)) {
          throw forbidden(
            `Un agent ne peut pas effectuer l'action « ${request.action} » ici : la mission doit être prise par POST /api/agent/runs/claim (qui crée son exécution)`,
          );
        }
        await missions.applyAction(String(req.params.id), request, agentOf(res).actor, { hook });
      },
    }),
  );

  return router;
}
