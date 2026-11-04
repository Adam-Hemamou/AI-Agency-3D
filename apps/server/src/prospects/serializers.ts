import {
  ACTOR_TYPES,
  DECISION_KINDS,
  MESSAGE_DELIVERY,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  PRODUCTION_STATUSES,
  PROSPECT_EVENT_TYPES,
  PROSPECT_STAGES,
  RELATIONSHIP_STATUSES,
  analysisContentSchema,
  discoverySchema,
  isRoomId,
  productionSchema,
  scoreCriterionSchema,
  sourceRefSchema,
  type ActorType,
  type Analysis,
  type Decision,
  type Message,
  type Production,
  type Prospect,
  type ProspectEvent,
} from '@agency/shared';
import { z } from 'zod';
import type {
  Prospect as ProspectRow,
  ProspectAnalysis as AnalysisRow,
  ProspectDecision as DecisionRow,
  ProspectEvent as EventRow,
  ProspectMessage as MessageRow,
  ProspectProduction as ProductionRow,
} from '../generated/prisma/client.ts';
import { assertOneOf } from '../missions/serializers.ts';

/**
 * Conversion des lignes du CRM en objets d'API. Les contenus JSON sont revalidés
 * à la lecture : une donnée corrompue lève une erreur explicite au lieu d'être affichée.
 */

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

function parseJson<S extends z.ZodType>(schema: S, value: unknown, field: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Contenu inattendu en base (${field}) : ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function actor(row: { actorType: string; actorId: string | null }, table: string) {
  return {
    actorType: assertOneOf<ActorType>(row.actorType, ACTOR_TYPES, `${table}.actor_type`),
    actorId: row.actorId,
  };
}

export function toProspectDto(row: ProspectRow): Prospect {
  return {
    id: row.id,
    reference: row.reference,
    creatorName: row.creatorName,
    channelName: row.channelName,
    stage: assertOneOf(row.stage, PROSPECT_STAGES, 'prospects.stage'),
    channelHandle: row.channelHandle,
    channelUrl: row.channelUrl,
    avatarUrl: row.avatarUrl,
    category: row.category,
    description: row.description,
    country: row.country,
    subscriberCount: row.subscriberCount,
    viewCount: row.viewCount === null ? null : Number(row.viewCount),
    videoCount: row.videoCount,
    statsSource: row.statsSource,
    statsUpdatedAt: iso(row.statsUpdatedAt),
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    contactSource: row.contactSource,
    discovery:
      row.discovery === null ? null : parseJson(discoverySchema, row.discovery, 'discovery'),
    relationshipStatus:
      row.relationshipStatus === null
        ? null
        : assertOneOf(
            row.relationshipStatus,
            RELATIONSHIP_STATUSES,
            'prospects.relationship_status',
          ),
    priority: row.priority,
    doNotContact: row.doNotContact,
    doNotContactReason: row.doNotContactReason,
    nextAction: row.nextAction,
    nextActionAt: iso(row.nextActionAt),
    isDemo: row.isDemo,
    version: row.version,
    discoveredAt: row.discoveredAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAnalysisDto(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    prospectId: row.prospectId,
    missionId: row.missionId,
    version: row.version,
    summary: row.summary,
    conclusion: row.conclusion,
    score: row.score,
    scoreCriteria: parseJson(z.array(scoreCriterionSchema), row.scoreCriteria, 'score_criteria'),
    priority: row.priority,
    content: parseJson(analysisContentSchema, row.content, 'analyses.content'),
    sources: parseJson(z.array(sourceRefSchema), row.sources, 'analyses.sources'),
    createdAt: row.createdAt.toISOString(),
    ...actor(row, 'prospect_analyses'),
  };
}

export function toProductionDto(row: ProductionRow): Production {
  return parseJson(
    productionSchema,
    {
      id: row.id,
      prospectId: row.prospectId,
      missionId: row.missionId,
      kind: row.kind,
      version: row.version,
      status: assertOneOf(row.status, PRODUCTION_STATUSES, 'prospect_productions.status'),
      title: row.title,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...actor(row, 'prospect_productions'),
    },
    'prospect_productions',
  );
}

export function toDecisionDto(row: DecisionRow): Decision {
  return {
    id: row.id,
    prospectId: row.prospectId,
    missionId: row.missionId,
    productionId: row.productionId,
    kind: assertOneOf(row.kind, DECISION_KINDS, 'prospect_decisions.kind'),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    ...actor(row, 'prospect_decisions'),
  };
}

export function toMessageDto(row: MessageRow): Message {
  return {
    id: row.id,
    prospectId: row.prospectId,
    productionId: row.productionId,
    direction: assertOneOf(row.direction, MESSAGE_DIRECTIONS, 'prospect_messages.direction'),
    kind: assertOneOf(row.kind, MESSAGE_KINDS, 'prospect_messages.kind'),
    delivery: assertOneOf(row.delivery, MESSAGE_DELIVERY, 'prospect_messages.delivery'),
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProspectEventDto(row: EventRow): ProspectEvent {
  if (row.room !== null && !isRoomId(row.room)) {
    throw new Error(`Salle inattendue en base (prospect_events.room) : « ${row.room} »`);
  }
  return {
    id: row.id,
    prospectId: row.prospectId,
    missionId: row.missionId,
    type: assertOneOf(row.type, PROSPECT_EVENT_TYPES, 'prospect_events.type'),
    room: row.room,
    title: row.title,
    details: row.details,
    payload: row.payload as ProspectEvent['payload'],
    createdAt: row.createdAt.toISOString(),
    ...actor(row, 'prospect_events'),
  };
}
