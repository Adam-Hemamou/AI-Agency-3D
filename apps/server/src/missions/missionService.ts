import {
  ERROR_CODES,
  VALIDATION_ACTOR,
  VALIDATION_TRANSITIONS,
  checkMissionAction,
  checkValidationDecision,
  getAvailableActions,
  getAvailableDecisions,
  type ActionCheck,
  type ActorType,
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
import { AppError } from '../errors/AppError.ts';
import { toMissionDto, toMissionEventDto } from './serializers.ts';

/** Auteur d'une action : l'utilisateur, un agent ou le système. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

/** Champs dont l'historique conserve l'ancienne et la nouvelle valeur. */
const TRACKED_FIELDS = [
  'status',
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

function missionNotFound(id: string): AppError {
  return AppError.notFound(`Mission introuvable : ${id}`);
}

/**
 * Moteur de missions : SEUL point d'entrée pour créer ou faire évoluer une mission.
 * Chaque modification et l'événement d'historique correspondant sont écrits
 * dans une même transaction : soit les deux sont enregistrés, soit aucun.
 */
export function createMissionService(prisma: AppPrismaClient) {
  /**
   * Applique un changement à une mission dans une transaction :
   * lecture → vérification des règles → mise à jour conditionnée à la version → événement.
   */
  async function mutate(
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    build: (current: MissionRow) => {
      action: MissionEventAction;
      patch: MissionPatch;
      reason: string | null;
    },
  ): Promise<MissionCommandResponse> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.mission.findUnique({ where: { id } });
      if (!current) throw missionNotFound(id);
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw concurrentModification(id);
      }

      const { action, patch, reason } = build(current);
      const changes = diff(current, patch);

      // Mise à jour conditionnée à la version lue : si une autre requête est passée entre-temps,
      // aucune ligne n'est modifiée et la transaction est annulée.
      const updated = await tx.mission.updateMany({
        where: { id, version: current.version },
        data: { ...toPrismaData(patch), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw concurrentModification(id);

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
        },
      });

      const mission = await tx.mission.findUniqueOrThrow({ where: { id } });
      return { mission: toMissionDto(mission), event: toMissionEventDto(event) };
    });
  }

  return {
    async create(input: CreateMissionInput, actor: Actor): Promise<MissionCommandResponse> {
      return prisma.$transaction(async (tx) => {
        const mission = await tx.mission.create({
          data: {
            type: input.type,
            room: input.room,
            priority: input.priority,
            input: input.input,
            requiresValidation: input.requiresValidation,
            agentId: input.agentId,
            maxAttempts: input.maxAttempts,
          },
        });
        const initial = {
          type: input.type,
          room: input.room,
          priority: input.priority,
          requiresValidation: input.requiresValidation,
          agentId: input.agentId,
          maxAttempts: input.maxAttempts,
        };
        const changes = Object.fromEntries(
          Object.entries(initial).map(([key, value]) => [key, { from: null, to: value }]),
        );
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
          },
        });
        return { mission: toMissionDto(mission), event: toMissionEventDto(event) };
      });
    },

    async get(id: string): Promise<Mission> {
      const row = await prisma.mission.findUnique({ where: { id } });
      if (!row) throw missionNotFound(id);
      return toMissionDto(row);
    },

    async list(query: MissionListQuery): Promise<MissionListResponse> {
      const where: Prisma.MissionWhereInput = {
        ...(query.status && { status: { in: query.status } }),
        ...(query.room && { room: { in: query.room } }),
        ...(query.type && { type: { in: query.type } }),
      };
      const orderBy: Prisma.MissionOrderByWithRelationInput[] =
        query.sort === 'priority'
          ? [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }];

      const [rows, total] = await prisma.$transaction([
        prisma.mission.findMany({ where, orderBy, take: query.limit, skip: query.offset }),
        prisma.mission.count({ where }),
      ]);
      return { items: rows.map(toMissionDto), total, limit: query.limit, offset: query.offset };
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

    /** Action de cycle de vie : démarrer, mettre en pause, bloquer, terminer… */
    async applyAction(id: string, request: MissionTransitionRequest, actor: Actor) {
      return mutate(id, request.expectedVersion, actor, (current) => {
        const check = checkMissionAction(toState(current), request.action);
        if (!check.allowed) throw refusal(check, current, request.action);

        const now = new Date();
        const patch: MissionPatch = { status: check.to };
        switch (request.action) {
          case 'start':
            patch.attemptCount = current.attemptCount + 1;
            patch.startedAt = current.startedAt ?? now;
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
    },

    /** Décision humaine sur un résultat soumis à validation. */
    async decide(id: string, request: ValidationDecisionRequest, actor: Actor) {
      if (actor.type !== VALIDATION_ACTOR) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN_ACTOR,
          'Seul un utilisateur humain peut rendre une décision de validation',
          403,
        );
      }
      return mutate(id, request.expectedVersion, actor, (current) => {
        const check = checkValidationDecision(toState(current), request.decision);
        if (!check.allowed) throw refusal(check, current, request.decision);

        const now = new Date();
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
    },
  };
}

export type MissionService = ReturnType<typeof createMissionService>;
