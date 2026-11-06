import {
  ERROR_CODES,
  VALIDATION_TRANSITIONS,
  checkAgentMissionAccess,
  checkMissionAction,
  isAgentMissionAction,
  checkValidationDecision,
  getAvailableActions,
  getAvailableDecisions,
  type ActionCheck,
  type ActorType,
  type AgentMissionScope,
  type CreateMissionInput,
  type Mission,
  type MissionCommandResponse,
  type MissionEvent,
  type MissionEventAction,
  type MissionListQuery,
  type MissionListResponse,
  type MissionStatus,
  type MissionTransitionRequest,
  type ValidationDecisionRequest,
} from '@agency/shared';
import { Prisma, type Mission as MissionRow } from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import type { TransactionHook } from '../db/transactionHook.ts';
import { assertHumanActor } from '../auth/actors.ts';
import { AppError } from '../errors/AppError.ts';
import {
  PROSPECT_SUMMARY_SELECT,
  toMissionDto,
  toMissionEventDto,
  toProspectSummaryDto,
} from './serializers.ts';

/** Client Prisma utilisable dans une transaction (permet de composer avec d'autres services). */
export type Db = Prisma.TransactionClient;

/** Source de l'heure courante (remplaçable pour dater un scénario de démonstration). */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export interface MissionServiceOptions {
  clock?: Clock;
}

/** Auteur d'une action : l'utilisateur, un agent ou le système. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

/** Champs dont l'historique conserve l'ancienne et la nouvelle valeur. */
const TRACKED_FIELDS = [
  'status',
  'agentId',
  'attemptCount',
  'output',
  'validationOutcome',
  'validatedAt',
  'validatedBy',
  'lastErrorCode',
  'lastErrorMessage',
  'startedAt',
  'finishedAt',
] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];
type MissionPatch = Partial<Pick<MissionRow, TrackedField>> & { status: string };

type JsonValue = Prisma.InputJsonValue | null;

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
}

/** Calcule { champ: { from, to } } pour les champs réellement modifiés. */
function diff(
  before: MissionRow,
  patch: MissionPatch,
): Record<string, { from: JsonValue; to: JsonValue }> {
  const changes: Record<string, { from: JsonValue; to: JsonValue }> = {};
  for (const field of TRACKED_FIELDS) {
    if (!(field in patch)) continue;
    const from = toJsonValue(before[field]);
    const to = toJsonValue(patch[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

/** Prisma distingue "colonne JSON NULL" (DbNull) d'une valeur JSON null. */
function toPrismaData(patch: MissionPatch): Prisma.MissionUpdateManyMutationInput {
  const { output, ...rest } = patch;
  const data: Prisma.MissionUpdateManyMutationInput = { ...rest };
  if ('output' in patch) {
    data.output =
      output === null || output === undefined ? Prisma.DbNull : (output as Prisma.InputJsonValue);
  }
  return data;
}

function refusal(
  check: Extract<ActionCheck, { allowed: false }>,
  mission: MissionRow,
  attempted: string,
) {
  const state = toState(mission);
  return new AppError(check.code, check.message, 409, {
    attempted,
    currentStatus: mission.status,
    availableActions: getAvailableActions(state),
    availableDecisions: getAvailableDecisions(state),
  });
}

function toState(row: MissionRow) {
  return {
    status: row.status as MissionStatus,
    requiresValidation: row.requiresValidation,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
  };
}

function concurrentModification(id: string): AppError {
  return new AppError(
    ERROR_CODES.CONCURRENT_MODIFICATION,
    `La mission ${id} a été modifiée entre-temps : rechargez-la puis réessayez`,
    409,
  );
}

/**
 * Ce que la mission a déjà produit depuis son premier démarrage : enregistrements qui la citent
 * (analyses, productions, décisions, activités du dossier) et résultat transmis.
 */
export async function effectsSinceStartIn(tx: Db, mission: MissionRow): Promise<MissionEffects> {
  const since = {
    missionId: mission.id,
    createdAt: { gte: mission.startedAt ?? mission.createdAt },
  };
  return {
    analyses: await tx.prospectAnalysis.count({ where: since }),
    productions: await tx.prospectProduction.count({ where: since }),
    decisions: await tx.prospectDecision.count({ where: since }),
    events: await tx.prospectEvent.count({ where: since }),
    output: mission.output !== null,
  };
}

/**
 * Statut donné à l'exécution active quand sa mission quitte « en cours » (AGENT_RUN_STATUSES) :
 * - terminée ou soumise à validation → succeeded ;
 * - remise en attente → released ;
 * - bloquée par la récupération des traitements interrompus → abandoned ;
 * - mise en pause, bloquée ou annulée autrement → stopped.
 * (Un échec signalé par n8n clôt lui-même son exécution, en failed ou released, avant la transition.)
 */
function runStatusOnExit(action: MissionEventAction, patch: MissionPatch, actor: Actor) {
  switch (action) {
    case 'complete':
    case 'submit_for_validation':
      return 'succeeded';
    case 'release':
      return 'released';
    case 'block':
      return actor.type === 'system' && patch.lastErrorCode === INTERRUPTED_ERROR_CODE
        ? 'abandoned'
        : 'stopped';
    default:
      return 'stopped';
  }
}

/** Clôt l'exécution active de la mission (au plus une, garanti par la base), dans la transaction. */
async function closeActiveRunIn(
  tx: Db,
  missionId: string,
  exit: {
    action: MissionEventAction;
    patch: MissionPatch;
    actor: Actor;
    reason: string | null;
    now: Date;
  },
): Promise<void> {
  const status = runStatusOnExit(exit.action, exit.patch, exit.actor);
  const blocked = exit.action === 'block';
  await tx.agentRun.updateMany({
    where: { missionId, status: 'started' },
    data: {
      status,
      finishedAt: exit.now,
      // Un blocage garde sa cause sur l'exécution (code et motif de la mission).
      failureCode: blocked ? (exit.patch.lastErrorCode ?? null) : null,
      failureMessage: blocked ? exit.reason : null,
    },
  });
}

/** Auteur des actions automatiques (récupération des traitements interrompus). */
const SYSTEM_ACTOR: Actor = { type: 'system', id: null };

/** Action réservée à l'humain (message d'erreur FORBIDDEN_ACTOR). */
const VALIDATION_DECISION = 'rendre une décision de validation';

function missionNotFound(id: string): AppError {
  return AppError.notFound(`Mission introuvable : ${id}`);
}

function forbiddenActor(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

/** Traduction en base de canAgentSeeMission (packages/shared) : les deux doivent rester identiques. */
export function visibilityWhere(agent: AgentMissionScope): Prisma.MissionWhereInput {
  if (agent.room === null) return { agentId: agent.id };
  return { room: agent.room, OR: [{ agentId: agent.id }, { agentId: null }] };
}

/** Code enregistré sur une mission bloquée par la récupération des traitements interrompus. */
export const INTERRUPTED_ERROR_CODE = 'INTERRUPTED';

/** Mission bloquée par la récupération, avec ce qu'elle avait déjà produit. */
export interface RecoveredMission {
  missionId: string;
  agentId: string | null;
  /** Exécution active close en « abandoned » (null : la mission n'avait pas d'exécution active). */
  runId: string | null;
  effects: MissionEffects;
}

/** Exécution active alors que sa mission n'est plus en cours, close par la récupération. */
export interface ClosedOrphanRun {
  runId: string;
  missionId: string;
  missionStatus: string;
}

/** Code enregistré sur une exécution incohérente (active, mission plus en cours) close par la récupération. */
export const ORPHANED_RUN_ERROR_CODE = 'ORPHANED_RUN';

/** Ce qu'une mission a déjà laissé depuis son démarrage (informe la décision humaine). */
export interface MissionEffects {
  analyses: number;
  productions: number;
  decisions: number;
  events: number;
  /** Un résultat (output) a déjà été transmis. */
  output: boolean;
}

export function hasEffects(effects: MissionEffects): boolean {
  return (
    effects.output ||
    effects.analyses + effects.productions + effects.decisions + effects.events > 0
  );
}

function describeEffects(effects: MissionEffects): string {
  const parts = [
    effects.analyses && `${effects.analyses} analyse(s)`,
    effects.productions && `${effects.productions} production(s)`,
    effects.decisions && `${effects.decisions} décision(s)`,
    effects.events && `${effects.events} activité(s) du dossier`,
    effects.output && 'un résultat transmis',
  ].filter(Boolean);
  return parts.length === 0
    ? 'Aucun effet enregistré.'
    : `Effets déjà enregistrés : ${parts.join(', ')}. Vérifiez-les avant de débloquer.`;
}

/**
 * Moteur de missions : SEUL point d'entrée pour créer ou faire évoluer une mission.
 * Chaque modification et l'événement d'historique correspondant sont écrits
 * dans une même transaction : soit les deux sont enregistrés, soit aucun.
 */
export function createMissionService(
  prisma: AppPrismaClient,
  { clock = systemClock }: MissionServiceOptions = {},
) {
  /**
   * Applique un changement à une mission dans une transaction :
   * lecture → vérification des règles → mise à jour conditionnée à la version → événement.
   */
  async function mutateIn(
    tx: Db,
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    build: (
      current: MissionRow,
      now: Date,
    ) => {
      action: MissionEventAction;
      patch: MissionPatch;
      reason: string | null;
    },
  ): Promise<MissionCommandResponse> {
    const current = await tx.mission.findUnique({ where: { id } });
    if (!current) throw missionNotFound(id);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw concurrentModification(id);
    }

    const now = clock();
    const { action, patch, reason } = build(current, now);
    const changes = diff(current, patch);

    // Mise à jour conditionnée à la version lue : si une autre requête est passée entre-temps,
    // aucune ligne n'est modifiée et la transaction est annulée.
    const updated = await tx.mission.updateMany({
      where: { id, version: current.version },
      data: { ...toPrismaData(patch), version: { increment: 1 }, updatedAt: now },
    });
    if (updated.count !== 1) throw concurrentModification(id);

    // La mission quitte « en cours » : son exécution active est close DANS CETTE transaction
    // (jamais d'exécution « started » pour une mission qui n'est plus en cours).
    if (current.status === 'in_progress' && patch.status !== 'in_progress') {
      await closeActiveRunIn(tx, id, { action, patch, actor, reason, now });
    }

    const event = await tx.missionEvent.create({
      data: {
        missionId: id,
        action,
        actorType: actor.type,
        actorId: actor.id,
        fromStatus: current.status,
        toStatus: patch.status,
        changes,
        reason,
        createdAt: now,
      },
    });

    const mission = await tx.mission.findUniqueOrThrow({ where: { id } });
    return { mission: toMissionDto(mission), event: toMissionEventDto(event) };
  }

  /** Crée une mission et son premier événement, dans la transaction fournie. */
  async function createIn(
    tx: Db,
    input: CreateMissionInput,
    actor: Actor,
  ): Promise<MissionCommandResponse> {
    if (input.prospectId !== null) {
      const prospect = await tx.prospect.findUnique({
        where: { id: input.prospectId },
        select: { id: true },
      });
      if (!prospect) throw AppError.notFound(`Prospect introuvable : ${input.prospectId}`);
    }
    // Pas de clé étrangère (missions historiques) : l'existence de l'agent est vérifiée ici.
    if (input.agentId !== null) {
      const agent = await tx.agent.findUnique({
        where: { id: input.agentId },
        select: { id: true },
      });
      if (!agent) throw AppError.validation(`Agent inconnu : ${input.agentId}`);
    }
    const now = clock();
    const mission = await tx.mission.create({
      data: {
        type: input.type,
        room: input.room,
        priority: input.priority,
        input: input.input,
        requiresValidation: input.requiresValidation,
        agentId: input.agentId,
        maxAttempts: input.maxAttempts,
        prospectId: input.prospectId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const initial: Record<string, unknown> = {
      type: input.type,
      room: input.room,
      priority: input.priority,
      requiresValidation: input.requiresValidation,
      agentId: input.agentId,
      maxAttempts: input.maxAttempts,
    };
    if (input.prospectId !== null) initial.prospectId = input.prospectId;
    const changes = Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [key, { from: null, to: value }]),
    ) as Prisma.InputJsonObject;
    const event = await tx.missionEvent.create({
      data: {
        missionId: mission.id,
        action: 'created',
        actorType: actor.type,
        actorId: actor.id,
        fromStatus: null,
        toStatus: mission.status,
        changes,
        reason: null,
        createdAt: now,
      },
    });
    return { mission: toMissionDto(mission), event: toMissionEventDto(event) };
  }

  /** Action de cycle de vie : démarrer, mettre en pause, bloquer, terminer… */
  /** Identité et salle d'un agent, lues en base (jamais dans la requête). */
  async function agentScopeIn(tx: Db, agentId: string | null): Promise<AgentMissionScope> {
    const row = agentId
      ? await tx.agent.findUnique({ where: { id: agentId }, select: { id: true, room: true } })
      : null;
    if (!row) throw forbiddenActor(`Agent inconnu : ${agentId ?? '(sans identifiant)'}`);
    return { id: row.id, room: row.room };
  }

  /**
   * Préconditions de la remise en attente, vérifiées sous verrou de la mission (le même que celui
   * des écritures d'agents qui la citent) : réservée au système, et refusée si la mission a déjà
   * produit un effet depuis son démarrage. Indique aussi si la mission avait été prise par un
   * agent au démarrage (elle était alors libre).
   */
  async function prepareReleaseIn(tx: Db, id: string, actor: Actor) {
    if (actor.type !== 'system') {
      throw forbiddenActor('Seul le système peut remettre une mission en attente');
    }
    await tx.$queryRaw`SELECT id FROM missions WHERE id = ${id} FOR UPDATE`;
    const current = await tx.mission.findUnique({ where: { id } });
    if (!current) throw missionNotFound(id);
    if (current.status !== 'in_progress') return { claimed: false };
    const effects = await effectsSinceStartIn(tx, current);
    if (hasEffects(effects)) {
      throw new AppError(
        ERROR_CODES.INVALID_TRANSITION,
        `La mission a déjà produit des effets : elle ne peut pas être remise en attente. ${describeEffects(effects)}`,
        409,
        { attempted: 'release', currentStatus: current.status, effects },
      );
    }
    const starts = await tx.missionEvent.findMany({
      where: { missionId: id, action: 'start' },
      select: { changes: true },
    });
    const claimed = starts.some((event) => {
      const change = (event.changes as Record<string, { from?: unknown; to?: unknown }>).agentId;
      return change !== undefined && change.from === null && change.to === current.agentId;
    });
    return { claimed };
  }

  async function applyActionIn(
    tx: Db,
    id: string,
    request: MissionTransitionRequest,
    actor: Actor,
  ): Promise<MissionCommandResponse> {
    // Annuler ou débloquer une mission reste une décision humaine (ou du système).
    if (actor.type === 'agent' && !isAgentMissionAction(request.action)) {
      throw forbiddenActor(
        `Un agent ne peut pas effectuer l'action « ${request.action} » sur une mission`,
      );
    }
    const agent = actor.type === 'agent' ? await agentScopeIn(tx, actor.id) : null;
    const release = request.action === 'release' ? await prepareReleaseIn(tx, id, actor) : null;
    return mutateIn(tx, id, request.expectedVersion, actor, (current, now) => {
      // Contrôlé sur la mission lue DANS la transaction : la mise à jour, conditionnée à sa
      // version, échoue si une autre requête l'a modifiée (ou attribuée) entre-temps.
      if (agent) {
        const access = checkAgentMissionAccess(current, agent, request.action);
        if (!access.allowed) throw forbiddenActor(access.reason);
      }
      const check = checkMissionAction(toState(current), request.action);
      if (!check.allowed) throw refusal(check, current, request.action);

      const patch: MissionPatch = { status: check.to };
      switch (request.action) {
        case 'start':
          patch.attemptCount = current.attemptCount + 1;
          patch.startedAt = current.startedAt ?? now;
          // Un agent qui démarre une mission libre la prend : elle n'appartient plus qu'à lui.
          if (agent && current.agentId === null) patch.agentId = agent.id;
          break;
        case 'release':
          // Une mission prise par un agent (libre à l'origine) redevient libre ; une mission
          // attribuée à la création garde son agent.
          if (release?.claimed) patch.agentId = null;
          break;
        case 'submit_for_validation':
          if (request.output !== undefined) patch.output = request.output;
          // Nouvelle soumission : la décision précédente ne s'applique plus.
          patch.validationOutcome = null;
          patch.validatedAt = null;
          patch.validatedBy = null;
          break;
        case 'complete':
          if (request.output !== undefined) patch.output = request.output;
          patch.finishedAt = now;
          break;
        case 'block':
          patch.lastErrorCode = request.errorCode ?? 'BLOCKED';
          patch.lastErrorMessage = request.reason ?? null;
          break;
        case 'unblock':
          patch.lastErrorCode = null;
          patch.lastErrorMessage = null;
          break;
        case 'cancel':
          patch.finishedAt = now;
          break;
        case 'pause':
        case 'resume':
          break;
      }
      return { action: request.action, patch, reason: request.reason ?? null };
    });
  }

  /** Décision humaine sur un résultat soumis à validation. */
  function decideIn(tx: Db, id: string, request: ValidationDecisionRequest, actor: Actor) {
    // Un agent ou le système ne peut jamais valider, refuser ni faire corriger un résultat.
    assertHumanActor(actor, VALIDATION_DECISION);
    return mutateIn(tx, id, request.expectedVersion, actor, (current, now) => {
      const check = checkValidationDecision(toState(current), request.decision);
      if (!check.allowed) throw refusal(check, current, request.decision);

      const transition = VALIDATION_TRANSITIONS[request.decision];
      const patch: MissionPatch = {
        status: check.to,
        validationOutcome: transition.outcome,
        validatedAt: now,
        validatedBy: actor.id ?? actor.type,
      };
      if (check.to === 'completed' || check.to === 'cancelled') patch.finishedAt = now;
      return { action: request.decision, patch, reason: request.reason ?? null };
    });
  }

  return {
    /**
     * Variantes utilisables dans une transaction déjà ouverte (service des prospects) :
     * mêmes règles, et la mission évolue en même temps que le dossier.
     */
    inTransaction: { create: createIn, applyAction: applyActionIn, decide: decideIn },

    async create(input: CreateMissionInput, actor: Actor): Promise<MissionCommandResponse> {
      return prisma.$transaction((tx) => createIn(tx, input, actor));
    },

    async get(id: string): Promise<Mission> {
      const row = await prisma.mission.findUnique({ where: { id } });
      if (!row) throw missionNotFound(id);
      return toMissionDto(row);
    },

    /**
     * Liste filtrée. `visibleTo` : limite aux missions que cet agent peut voir (canAgentSeeMission),
     * appliqué en base pour que le total et la pagination restent exacts.
     */
    async list(
      query: MissionListQuery,
      { visibleTo }: { visibleTo?: AgentMissionScope } = {},
    ): Promise<MissionListResponse> {
      const filters: Prisma.MissionWhereInput = {
        ...(query.status && { status: { in: query.status } }),
        ...(query.room && { room: { in: query.room } }),
        ...(query.type && { type: { in: query.type } }),
        ...(query.prospectId && { prospectId: query.prospectId }),
      };
      const where: Prisma.MissionWhereInput = visibleTo
        ? { AND: [filters, visibilityWhere(visibleTo)] }
        : filters;
      const orderBy: Prisma.MissionOrderByWithRelationInput[] =
        query.sort === 'priority'
          ? [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }];

      const [rows, total] = await prisma.$transaction([
        prisma.mission.findMany({
          where,
          orderBy,
          take: query.limit,
          skip: query.offset,
          include: { prospect: { select: PROSPECT_SUMMARY_SELECT } },
        }),
        prisma.mission.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          ...toMissionDto(row),
          prospect: row.prospect ? toProspectSummaryDto(row.prospect) : null,
        })),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    },

    async events(id: string): Promise<MissionEvent[]> {
      const exists = await prisma.mission.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw missionNotFound(id);
      const rows = await prisma.missionEvent.findMany({
        where: { missionId: id },
        orderBy: { id: 'asc' },
      });
      return rows.map(toMissionEventDto);
    },

    async applyAction(
      id: string,
      request: MissionTransitionRequest,
      actor: Actor,
      options: { hook?: TransactionHook } = {},
    ) {
      return prisma.$transaction(async (tx) => {
        await options.hook?.begin(tx);
        const result = await applyActionIn(tx, id, request, actor);
        await options.hook?.end(tx, { type: 'mission', id, eventId: result.event.id });
        return result;
      });
    },

    /** Un événement de l'historique d'une mission (réponse rejouée d'une requête d'agent). */
    async event(missionId: string, eventId: number): Promise<MissionEvent> {
      const row = await prisma.missionEvent.findFirst({ where: { id: eventId, missionId } });
      if (!row) throw AppError.notFound(`Événement introuvable : ${eventId}`);
      return toMissionEventDto(row);
    },

    async decide(id: string, request: ValidationDecisionRequest, actor: Actor) {
      assertHumanActor(actor, VALIDATION_DECISION);
      return prisma.$transaction((tx) => decideIn(tx, id, request, actor));
    },

    /**
     * Récupération des traitements interrompus : une mission « en cours » sans AUCUNE activité
     * depuis staleAfterMs passe en « bloquée », au nom du système, avec le code INTERRUPTED.
     *
     * - Activité = la mission elle-même (toute transition) OU un enregistrement qui la cite
     *   (analyse, production, décision, activité du dossier). Un agent qui avance sur un long
     *   traitement peut donc signaler qu'il est vivant en ajoutant une activité liée à la mission.
     * - Jamais de retour automatique « en attente » : l'utilisateur décide (débloquer ou annuler).
     *   Le motif indique ce que la mission a déjà produit, pour éviter de refaire un travail.
     * - Chaque mission est revérifiée dans sa transaction, et la mise à jour est conditionnée à sa
     *   version : si l'agent la fait évoluer au même moment, c'est son action qui l'emporte.
     */
    async recoverStale({ staleAfterMs }: { staleAfterMs: number }): Promise<RecoveredMission[]> {
      const cutoff = new Date(clock().getTime() - staleAfterMs);
      // Une exécution active « vivante » : dernier signal de vie (ou, à défaut, son démarrage)
      // postérieur au seuil. Ces missions ne sont même pas candidates : une mission longuement
      // maintenue en vie n'empêche jamais l'examen des missions réellement interrompues.
      const alive: Prisma.AgentRunWhereInput = {
        status: 'started',
        OR: [{ heartbeatAt: { gte: cutoff } }, { heartbeatAt: null, startedAt: { gte: cutoff } }],
      };
      const candidates = await prisma.mission.findMany({
        where: { status: 'in_progress', updatedAt: { lt: cutoff }, runs: { none: alive } },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      const minutes = Math.round(staleAfterMs / 60_000);
      const recovered: RecoveredMission[] = [];
      for (const { id } of candidates) {
        try {
          const result = await prisma.$transaction(async (tx) => {
            // PREMIÈRES instructions : verrous de la mission PUIS de son exécution active, avant
            // toute lecture (même ordre que la prise de mission, l'échec et la clôture).
            // - Une écriture d'agent qui cite la mission (verrou partagé) passe entièrement avant
            //   ou entièrement après : les comptages ci-dessous voient tout ce qui a été enregistré.
            // - Un signal de vie en cours (qui verrouille l'exécution) se termine d'abord : le
            //   dernier signal lu ici est donc toujours le plus récent ; un signal arrivé après
            //   attend, puis trouve l'exécution close (refusé).
            await tx.$queryRaw`SELECT id FROM missions WHERE id = ${id} FOR UPDATE`;
            const [activeRun] = await tx.$queryRaw<
              { id: string; heartbeat_at: Date | null; started_at: Date }[]
            >`SELECT id, heartbeat_at, started_at FROM agent_runs
              WHERE mission_id = ${id} AND status = 'started' FOR UPDATE`;
            const current = await tx.mission.findUnique({ where: { id } });
            if (!current || current.status !== 'in_progress' || current.updatedAt >= cutoff) {
              return null;
            }
            // Exécution toujours vivante : signal de vie récent (ou démarrage récent sans signal).
            const lastSignal = activeRun ? (activeRun.heartbeat_at ?? activeRun.started_at) : null;
            if (lastSignal && new Date(lastSignal) >= cutoff) return null;

            const linked = { missionId: id };
            const recent = { ...linked, createdAt: { gte: cutoff } };
            const [recentAnalyses, recentProductions, recentDecisions, recentEvents] =
              await Promise.all([
                tx.prospectAnalysis.count({ where: recent }),
                tx.prospectProduction.count({
                  where: {
                    ...linked,
                    OR: [{ createdAt: { gte: cutoff } }, { updatedAt: { gte: cutoff } }],
                  },
                }),
                tx.prospectDecision.count({ where: recent }),
                tx.prospectEvent.count({ where: recent }),
              ]);
            // Toujours en cours de traitement : quelque chose a été enregistré récemment.
            if (recentAnalyses + recentProductions + recentDecisions + recentEvents > 0)
              return null;

            const effects = await effectsSinceStartIn(tx, current);
            const silence = activeRun
              ? `aucun signal de vie de l’exécution n8n depuis plus de ${minutes} min (dernier : ${new Date(lastSignal!).toISOString()})`
              : `aucune activité depuis plus de ${minutes} min`;
            const message = `Traitement interrompu : ${silence}. ` + describeEffects(effects);
            // Le blocage par le système avec le code INTERRUPTED clôt l'exécution active en
            // « abandoned », dans cette transaction (clôture automatique du moteur).
            await mutateIn(tx, id, current.version, SYSTEM_ACTOR, () => ({
              action: 'block',
              patch: {
                status: 'blocked',
                lastErrorCode: INTERRUPTED_ERROR_CODE,
                lastErrorMessage: message,
              },
              reason: message,
            }));
            return {
              missionId: id,
              agentId: current.agentId,
              runId: activeRun?.id ?? null,
              effects,
            };
          });
          if (result) recovered.push(result);
        } catch (error) {
          // Modifiée entre-temps (l'agent a repris la main) : la mission n'est pas touchée.
          if (error instanceof AppError && error.code === ERROR_CODES.CONCURRENT_MODIFICATION)
            continue;
          throw error;
        }
      }
      return recovered;
    },

    /**
     * Exécutions incohérentes : actives alors que leur mission n'est plus en cours (impossible par
     * le moteur depuis la clôture automatique, mais possible après une intervention directe en
     * base). Elles sont closes en « abandoned » (code ORPHANED_RUN) ; la mission n'est pas touchée.
     * Mêmes verrous que la récupération (mission puis exécution), revérifiés dans la transaction.
     */
    async closeOrphanRuns(): Promise<ClosedOrphanRun[]> {
      const orphans = await prisma.$queryRaw<{ run_id: string; mission_id: string }[]>`
        SELECT r.id AS run_id, r.mission_id FROM agent_runs r
        JOIN missions m ON m.id = r.mission_id
        WHERE r.status = 'started' AND m.status <> 'in_progress'
        ORDER BY r.started_at ASC
        LIMIT 100`;
      const closed: ClosedOrphanRun[] = [];
      for (const { run_id: runId, mission_id: missionId } of orphans) {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM missions WHERE id = ${missionId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM agent_runs WHERE id = ${runId} FOR UPDATE`;
          const mission = await tx.mission.findUnique({
            where: { id: missionId },
            select: { status: true },
          });
          const run = await tx.agentRun.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (!mission || !run || run.status !== 'started' || mission.status === 'in_progress') {
            return null;
          }
          await tx.agentRun.update({
            where: { id: runId },
            data: {
              status: 'abandoned',
              finishedAt: clock(),
              failureCode: ORPHANED_RUN_ERROR_CODE,
              failureMessage: `Exécution encore active alors que la mission est « ${mission.status} » : close par la récupération`,
            },
          });
          return { runId, missionId, missionStatus: mission.status };
        });
        if (result) closed.push(result);
      }
      return closed;
    },
  };
}

export type MissionService = ReturnType<typeof createMissionService>;
