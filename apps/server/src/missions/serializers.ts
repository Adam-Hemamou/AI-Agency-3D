import {
  ACTOR_TYPES,
  PROSPECT_STAGES,
  MISSION_EVENT_ACTIONS,
  VALIDATION_OUTCOMES,
  isMissionStatus,
  isRoomId,
  type ActorType,
  type JsonObject,
  type Mission,
  type MissionEvent,
  type MissionEventAction,
  type MissionStatus,
  type ProspectStage,
  type ProspectSummary,
  type RoomId,
  type ValidationOutcome,
} from '@agency/shared';
import type {
  Mission as MissionRow,
  MissionEvent as MissionEventRow,
} from '../generated/prisma/client.ts';

/**
 * Conversion des lignes de base en objets d'API.
 * Une valeur inconnue en base (impossible via le service) lève une erreur explicite
 * plutôt que d'être transmise silencieusement.
 */

function assertOneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Valeur inattendue en base pour ${field} : « ${value} »`);
  }
  return value as T;
}

function toStatus(value: string, field: string): MissionStatus {
  if (!isMissionStatus(value))
    throw new Error(`Statut inattendu en base (${field}) : « ${value} »`);
  return value;
}

function toRoom(value: string): RoomId {
  if (!isRoomId(value)) throw new Error(`Salle inattendue en base : « ${value} »`);
  return value;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toMissionDto(row: MissionRow): Mission {
  return {
    id: row.id,
    type: row.type,
    room: toRoom(row.room),
    status: toStatus(row.status, 'missions.status'),
    priority: row.priority,
    input: row.input as JsonObject,
    output: (row.output ?? null) as JsonObject | null,
    requiresValidation: row.requiresValidation,
    validationOutcome:
      row.validationOutcome === null
        ? null
        : assertOneOf<ValidationOutcome>(
            row.validationOutcome,
            VALIDATION_OUTCOMES,
            'missions.validation_outcome',
          ),
    validatedAt: iso(row.validatedAt),
    validatedBy: row.validatedBy,
    agentId: row.agentId,
    prospectId: row.prospectId,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

export function toMissionEventDto(row: MissionEventRow): MissionEvent {
  return {
    id: row.id,
    missionId: row.missionId,
    action: assertOneOf<MissionEventAction>(
      row.action,
      MISSION_EVENT_ACTIONS,
      'mission_events.action',
    ),
    actorType: assertOneOf<ActorType>(row.actorType, ACTOR_TYPES, 'mission_events.actor_type'),
    actorId: row.actorId,
    fromStatus:
      row.fromStatus === null ? null : toStatus(row.fromStatus, 'mission_events.from_status'),
    toStatus: toStatus(row.toStatus, 'mission_events.to_status'),
    changes: row.changes as MissionEvent['changes'],
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Colonnes nécessaires au résumé d'un prospect. */
export const PROSPECT_SUMMARY_SELECT = {
  id: true,
  reference: true,
  creatorName: true,
  channelName: true,
  stage: true,
} as const;

export function toProspectSummaryDto(row: {
  id: string;
  reference: string;
  creatorName: string;
  channelName: string;
  stage: string;
}): ProspectSummary {
  return {
    id: row.id,
    reference: row.reference,
    creatorName: row.creatorName,
    channelName: row.channelName,
    stage: assertOneOf<ProspectStage>(row.stage, PROSPECT_STAGES, 'prospects.stage'),
  };
}

export { assertOneOf };
