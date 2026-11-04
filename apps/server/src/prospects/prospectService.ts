import {
  DECISION_KIND_LABELS,
  ERROR_CODES,
  PIPELINE_MISSION_TYPES,
  PROSPECT_STAGE_LABELS,
  PROSPECT_STAGE_ROOMS,
  RELATIONSHIP_STATUS_LABELS,
  ROOM_LABELS,
  canMoveToStage,
  canSendFollowup,
  computeAnalysisScore,
  createAnalysisRequestSchema,
  createMissionRequestSchema,
  createProductionRequestSchema,
  createProspectRequestSchema,
  type CreateAnalysisRequest,
  type CreateMissionRequest,
  type CreateProductionRequest,
  type CreateProspectRequest,
  type DecisionKind,
  type EmailDecisionRequest,
  type EmailDraftRequest,
  type FollowupMessageRequest,
  type FollowupUpdateRequest,
  type MessageDelivery,
  type MessageDirection,
  type MessageKind,
  type ProductionStatus,
  type ProspectDecisionRequest,
  type ProspectDossier,
  type ProspectEventType,
  type ProspectListResponse,
  type ProspectStage,
  type RelationshipStatus,
  type ReplyRequest,
  type RoomId,
  emailContentSchema,
} from '@agency/shared';
import type { Prisma, Prospect as ProspectRow } from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { parseOrThrow } from '../lib/validate.ts';
import {
  systemClock,
  type Actor,
  type Clock,
  type Db,
  type MissionService,
} from '../missions/missionService.ts';
import { toMissionDto } from '../missions/serializers.ts';
import {
  toAnalysisDto,
  toDecisionDto,
  toMessageDto,
  toProductionDto,
  toProspectDto,
  toProspectEventDto,
} from './serializers.ts';

export interface ProspectServiceDeps {
  prisma: AppPrismaClient;
  missions: MissionService;
  /** MODE_SIMULATION : aucun e-mail réel ne peut partir. */
  simulationMode: boolean;
  clock?: Clock;
}

/** Titre de la timeline quand une production est ajoutée. */
const PRODUCTION_ADDED_TITLES: Record<CreateProductionRequest['kind'], string> = {
  video_excerpt: 'Extrait vidéo sélectionné',
  dubbing: 'Doublage préparé',
  proposal: 'Proposition commerciale préparée',
  email: 'E-mail rédigé',
};

/** Acteur « système » : enchaînements automatiques entre les salles. */
const SYSTEM: Actor = { type: 'system', id: null };
const DAY_MS = 24 * 60 * 60 * 1000;
/** Délai avant la relance suggérée après un envoi. */
const FOLLOWUP_DELAY_DAYS = 7;

type ProspectPatch = Partial<
  Pick<
    ProspectRow,
    | 'stage'
    | 'relationshipStatus'
    | 'priority'
    | 'doNotContact'
    | 'doNotContactReason'
    | 'nextAction'
    | 'nextActionAt'
  >
>;

function invalid(message: string, details?: unknown): AppError {
  return new AppError(ERROR_CODES.INVALID_TRANSITION, message, 409, details);
}

function concurrentModification(reference: string): AppError {
  return new AppError(
    ERROR_CODES.CONCURRENT_MODIFICATION,
    `Le dossier ${reference} a été modifié entre-temps : rechargez-le puis réessayez`,
    409,
  );
}

/**
 * Service du CRM : SEUL point d'écriture des dossiers prospects.
 * - Chaque opération est atomique (dossier, missions et timeline dans la même transaction).
 * - Les missions évoluent uniquement via le moteur de missions (mêmes règles, même historique).
 * - Aucune action externe : les envois sont simulés et marqués comme tels.
 */
export function createProspectService({
  prisma,
  missions,
  simulationMode,
  clock = systemClock,
}: ProspectServiceDeps) {
  const engine = missions.inTransaction;

  // -------------------------------------------------------------------------
  // Outils internes (toujours dans une transaction)
  // -------------------------------------------------------------------------

  async function load(tx: Db, id: string): Promise<ProspectRow> {
    const row = await tx.prospect.findUnique({ where: { id } });
    if (!row) throw AppError.notFound(`Prospect introuvable : ${id}`);
    return row;
  }

  function checkVersion(row: ProspectRow, expectedVersion: number | undefined) {
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw concurrentModification(row.reference);
    }
  }

  /** Met à jour le dossier (contrôle de version) et date la dernière activité. */
  async function update(tx: Db, row: ProspectRow, patch: ProspectPatch): Promise<ProspectRow> {
    const now = clock();
    const result = await tx.prospect.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...patch, version: { increment: 1 }, lastActivityAt: now, updatedAt: now },
    });
    if (result.count !== 1) throw concurrentModification(row.reference);
    return tx.prospect.findUniqueOrThrow({ where: { id: row.id } });
  }

  async function addEvent(
    tx: Db,
    prospectId: string,
    actor: Actor,
    event: {
      type: ProspectEventType;
      title: string;
      room: RoomId | null;
      details?: string | null;
      missionId?: string | null;
      payload?: Prisma.InputJsonObject;
    },
  ) {
    await tx.prospectEvent.create({
      data: {
        prospectId,
        missionId: event.missionId ?? null,
        type: event.type,
        room: event.room,
        title: event.title,
        details: event.details ?? null,
        payload: event.payload ?? {},
        actorType: actor.type,
        actorId: actor.id,
        createdAt: clock(),
      },
    });
  }

  async function moveToStageIn(
    tx: Db,
    row: ProspectRow,
    to: ProspectStage,
    actor: Actor,
    extra: { missionId?: string | null; details?: string | null; patch?: ProspectPatch } = {},
  ): Promise<ProspectRow> {
    const from = row.stage as ProspectStage;
    if (!canMoveToStage(from, to)) {
      throw invalid(
        `Le dossier ${row.reference} ne peut pas passer de « ${PROSPECT_STAGE_LABELS[from]} » à « ${PROSPECT_STAGE_LABELS[to]} »`,
      );
    }
    const updated = await update(tx, row, { ...extra.patch, stage: to });
    const room = PROSPECT_STAGE_ROOMS[to];
    await addEvent(tx, row.id, actor, {
      type: 'stage_changed',
      title:
        room && to !== 'refused' ? `Transmis à : ${ROOM_LABELS[room]}` : PROSPECT_STAGE_LABELS[to],
      room,
      details: extra.details ?? null,
      missionId: extra.missionId ?? null,
      payload: { from, to },
    });
    return updated;
  }

  async function createMissionIn(
    tx: Db,
    row: ProspectRow,
    request: Omit<CreateMissionRequest, 'prospectId' | 'priority'>,
    actor: Actor,
  ) {
    const input = createMissionRequestSchema.parse({
      ...request,
      priority: row.priority,
      prospectId: row.id,
      input: { prospectReference: row.reference, ...request.input },
    });
    return (await engine.create(tx, input, actor)).mission;
  }

  async function recordDecision(
    tx: Db,
    row: ProspectRow,
    actor: Actor,
    decision: {
      kind: DecisionKind;
      reason: string | null;
      missionId: string;
      productionId?: string | null;
      room: RoomId;
    },
  ) {
    await tx.prospectDecision.create({
      data: {
        prospectId: row.id,
        missionId: decision.missionId,
        productionId: decision.productionId ?? null,
        kind: decision.kind,
        reason: decision.reason,
        actorType: actor.type,
        actorId: actor.id,
        createdAt: clock(),
      },
    });
    await addEvent(tx, row.id, actor, {
      type: 'decision_recorded',
      title: DECISION_KIND_LABELS[decision.kind],
      room: decision.room,
      details: decision.reason,
      missionId: decision.missionId,
      payload: { kind: decision.kind },
    });
  }

  /** La mission existe, concerne ce prospect et appartient à la salle attendue. */
  async function loadMissionOf(tx: Db, row: ProspectRow, missionId: string, room: RoomId) {
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission || mission.prospectId !== row.id) {
      throw AppError.validation(`Cette mission ne concerne pas le dossier ${row.reference}`);
    }
    if (mission.room !== room) {
      throw AppError.validation(`Cette mission n'appartient pas à : ${ROOM_LABELS[room]}`);
    }
    return mission;
  }

  async function loadLatestEmail(tx: Db, row: ProspectRow, productionId: string) {
    const production = await tx.prospectProduction.findUnique({ where: { id: productionId } });
    if (!production || production.prospectId !== row.id || production.kind !== 'email') {
      throw AppError.validation(`Cet e-mail ne concerne pas le dossier ${row.reference}`);
    }
    const latest = await tx.prospectProduction.findFirst({
      where: { prospectId: row.id, kind: 'email' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    if (latest?.id !== production.id) {
      throw invalid(
        `Une version plus récente de l'e-mail existe (v${latest?.version}) : rechargez le dossier`,
      );
    }
    return production;
  }

  async function setProductionStatus(tx: Db, id: string, status: ProductionStatus) {
    await tx.prospectProduction.update({ where: { id }, data: { status, updatedAt: clock() } });
  }

  async function addProductionIn(
    tx: Db,
    row: ProspectRow,
    request: CreateProductionRequest,
    actor: Actor,
    event?: { title: string; details?: string | null },
  ) {
    const input = parseOrThrow(createProductionRequestSchema, request, 'Production');
    const last = await tx.prospectProduction.findFirst({
      where: { prospectId: row.id, kind: input.kind },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const now = clock();
    const production = await tx.prospectProduction.create({
      data: {
        prospectId: row.id,
        missionId: input.missionId,
        kind: input.kind,
        version,
        status: input.status,
        title: input.title,
        content: input.content as Prisma.InputJsonObject,
        actorType: actor.type,
        actorId: actor.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    await addEvent(tx, row.id, actor, {
      type: 'production_added',
      title: event?.title ?? `${PRODUCTION_ADDED_TITLES[input.kind]} (version ${version})`,
      details: event?.details ?? input.title,
      room: PROSPECT_STAGE_ROOMS[row.stage as ProspectStage],
      missionId: input.missionId,
      payload: { kind: input.kind, version, productionId: production.id },
    });
    await update(tx, row, {});
    return production;
  }

  async function addMessageIn(
    tx: Db,
    row: ProspectRow,
    message: {
      direction: MessageDirection;
      kind: MessageKind;
      delivery: MessageDelivery;
      subject: string | null;
      body: string;
      fromAddress: string | null;
      toAddress: string | null;
      productionId?: string | null;
      occurredAt?: Date;
    },
  ) {
    const now = clock();
    return tx.prospectMessage.create({
      data: {
        prospectId: row.id,
        productionId: message.productionId ?? null,
        direction: message.direction,
        kind: message.kind,
        delivery: message.delivery,
        subject: message.subject,
        body: message.body,
        fromAddress: message.fromAddress,
        toAddress: message.toAddress,
        occurredAt: message.occurredAt ?? now,
        createdAt: now,
      },
    });
  }

  /** Mission ouverte d'un prospect dans une salle (la plus récente). */
  function openMissionIn(tx: Db, prospectId: string, room: RoomId) {
    return tx.mission.findFirst({
      where: {
        prospectId,
        room,
        status: { in: ['pending', 'in_progress', 'awaiting_validation', 'paused', 'blocked'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Relation close (convertie, sans suite, archivée) : la mission de suivi se termine,
   * via le moteur de missions. Une mission jamais démarrée est annulée avec un motif.
   */
  async function closeFollowupMissionIn(
    tx: Db,
    prospectId: string,
    status: RelationshipStatus,
    actor: Actor,
  ) {
    if (!['converted', 'not_interested', 'archived'].includes(status)) return;
    const mission = await openMissionIn(tx, prospectId, 'followup');
    if (!mission) return;
    const label = RELATIONSHIP_STATUS_LABELS[status];
    if (mission.status === 'in_progress') {
      await engine.applyAction(
        tx,
        mission.id,
        { action: 'complete', output: { result: label } },
        actor,
      );
    } else {
      await engine.applyAction(
        tx,
        mission.id,
        { action: 'cancel', reason: `Suivi clos : ${label.toLowerCase()}` },
        actor,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  async function getDossier(id: string): Promise<ProspectDossier> {
    const row = await prisma.prospect.findUnique({
      where: { id },
      include: {
        missions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        analyses: { orderBy: { version: 'desc' } },
        productions: { orderBy: [{ kind: 'asc' }, { version: 'desc' }] },
        decisions: { orderBy: { createdAt: 'asc' } },
        messages: { orderBy: { occurredAt: 'asc' } },
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw AppError.notFound(`Prospect introuvable : ${id}`);
    return {
      prospect: toProspectDto(row),
      missions: row.missions.map(toMissionDto),
      analyses: row.analyses.map(toAnalysisDto),
      productions: row.productions.map(toProductionDto),
      decisions: row.decisions.map(toDecisionDto),
      messages: row.messages.map(toMessageDto),
      events: row.events.map(toProspectEventDto),
    };
  }

  /** Exécute une commande dans une transaction puis renvoie le dossier à jour. */
  async function command(
    id: string,
    run: (tx: Db, row: ProspectRow) => Promise<unknown>,
  ): Promise<ProspectDossier> {
    await prisma.$transaction(async (tx) => {
      const row = await load(tx, id);
      await run(tx, row);
    });
    return getDossier(id);
  }

  return {
    getDossier,

    async list(query: { stage?: ProspectStage; search?: string }): Promise<ProspectListResponse> {
      const where: Prisma.ProspectWhereInput = {
        ...(query.stage && { stage: query.stage }),
        ...(query.search && {
          OR: [
            { creatorName: { contains: query.search } },
            { channelName: { contains: query.search } },
            { reference: { contains: query.search } },
          ],
        }),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.prospect.findMany({
          where,
          orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }],
          take: 200,
        }),
        prisma.prospect.count({ where }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          reference: r.reference,
          creatorName: r.creatorName,
          channelName: r.channelName,
          stage: toProspectDto(r).stage,
        })),
        total,
      };
    },

    // -----------------------------------------------------------------------
    // Écritures du pipeline (agents à venir, scénario de démonstration)
    // -----------------------------------------------------------------------

    /** Crée le dossier d'un prospect découvert, avec sa mission de prospection. */
    async createProspect(
      request: CreateProspectRequest,
      actor: Actor,
      options: {
        discoveryMission?: Omit<CreateMissionRequest, 'prospectId' | 'priority' | 'room' | 'type'>;
      } = {},
    ) {
      const input = parseOrThrow(createProspectRequestSchema, request, 'Prospect');
      const id = await prisma.$transaction(async (tx) => {
        if (input.youtubeChannelId) {
          const existing = await tx.prospect.findUnique({
            where: { youtubeChannelId: input.youtubeChannelId },
            select: { reference: true },
          });
          if (existing) {
            throw invalid(`Cette chaîne a déjà un dossier : ${existing.reference}`);
          }
        }
        const now = clock();
        const count = await tx.prospect.count();
        const reference = `P-${now.getUTCFullYear()}-${String(count + 1).padStart(4, '0')}`;
        const row = await tx.prospect.create({
          data: {
            ...input,
            reference,
            viewCount: input.viewCount === null ? null : BigInt(input.viewCount),
            statsUpdatedAt: input.statsUpdatedAt ? new Date(input.statsUpdatedAt) : null,
            discovery: input.discovery as Prisma.InputJsonObject,
            stage: 'prospecting',
            discoveredAt: now,
            lastActivityAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        const mission = await createMissionIn(
          tx,
          row,
          {
            type: PIPELINE_MISSION_TYPES.discover,
            room: 'prospecting',
            agentId: actor.type === 'agent' ? actor.id : null,
            ...options.discoveryMission,
          },
          actor,
        );
        await addEvent(tx, row.id, actor, {
          type: 'discovered',
          title: 'Prospect découvert',
          room: 'prospecting',
          details: input.discovery.reason,
          missionId: mission.id,
          payload: { source: input.discovery.source },
        });
        return row.id;
      });
      return getDossier(id);
    },

    /** Passe le prospect à l'étape suivante et crée, si besoin, la mission de la salle. */
    async moveToStage(
      id: string,
      to: ProspectStage,
      actor: Actor,
      options: {
        details?: string;
        mission?: Omit<CreateMissionRequest, 'prospectId' | 'priority'>;
      } = {},
    ) {
      return command(id, async (tx, row) => {
        const updated = await moveToStageIn(tx, row, to, actor, { details: options.details });
        if (options.mission) await createMissionIn(tx, updated, options.mission, SYSTEM);
      });
    },

    /** Ajoute une analyse : nouvelle version, l'ancienne est conservée. */
    async addAnalysis(id: string, request: CreateAnalysisRequest, actor: Actor) {
      const input = parseOrThrow(createAnalysisRequestSchema, request, 'Analyse');
      return command(id, async (tx, row) => {
        const last = await tx.prospectAnalysis.findFirst({
          where: { prospectId: row.id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = (last?.version ?? 0) + 1;
        const score = computeAnalysisScore(input.scoreCriteria);
        await tx.prospectAnalysis.create({
          data: {
            prospectId: row.id,
            missionId: input.missionId,
            version,
            summary: input.summary,
            conclusion: input.conclusion,
            score,
            scoreCriteria: input.scoreCriteria as Prisma.InputJsonArray,
            priority: input.priority,
            content: input.content as Prisma.InputJsonObject,
            sources: input.sources as Prisma.InputJsonArray,
            actorType: actor.type,
            actorId: actor.id,
            createdAt: clock(),
          },
        });
        await update(tx, row, { priority: input.priority });
        await addEvent(tx, row.id, actor, {
          type: 'analysis_added',
          title:
            version === 1 ? 'Analyse terminée' : `Nouvelle analyse terminée (version ${version})`,
          room: 'analysis',
          details: input.conclusion,
          missionId: input.missionId,
          payload: { version, score },
        });
      });
    },

    async addProduction(id: string, request: CreateProductionRequest, actor: Actor) {
      return command(id, (tx, row) => addProductionIn(tx, row, request, actor));
    },

    /** Enregistre un message déjà échangé (scénario de démonstration, import). */
    async recordMessage(
      id: string,
      message: Parameters<typeof addMessageIn>[2] & { eventTitle: string },
      actor: Actor,
    ) {
      return command(id, async (tx, row) => {
        await addMessageIn(tx, row, message);
        await update(tx, row, {});
        await addEvent(tx, row.id, actor, {
          type: message.direction === 'inbound' ? 'reply_received' : 'followup_sent',
          title: message.eventTitle,
          room: 'followup',
          details: message.subject,
        });
      });
    },

    // -----------------------------------------------------------------------
    // Actions humaines (interface)
    // -----------------------------------------------------------------------

    /** Mon bureau : valider, refuser ou faire réanalyser un prospect. */
    async decideProspect(id: string, request: ProspectDecisionRequest, actor: Actor) {
      return command(id, async (tx, row) => {
        checkVersion(row, request.expectedVersion);
        const mission = await loadMissionOf(tx, row, request.missionId, 'director');
        if (row.stage !== 'review') {
          throw invalid(`Le dossier ${row.reference} n'est pas en attente de validation`);
        }

        if (request.decision === 'approve') {
          await engine.decide(tx, mission.id, { decision: 'approve' }, actor);
          await recordDecision(tx, row, actor, {
            kind: 'prospect_approved',
            reason: request.reason ?? null,
            missionId: mission.id,
            room: 'director',
          });
          const updated = await moveToStageIn(tx, row, 'dubbing', SYSTEM, {
            missionId: mission.id,
          });
          await createMissionIn(
            tx,
            updated,
            { type: PIPELINE_MISSION_TYPES.dubbing, room: 'dubbing' },
            SYSTEM,
          );
          return;
        }

        if (request.decision === 'reject') {
          const reason = request.reason || null;
          await engine.decide(
            tx,
            mission.id,
            { decision: 'reject', reason: reason ?? 'Prospect refusé (aucun motif précisé)' },
            actor,
          );
          await recordDecision(tx, row, actor, {
            kind: 'prospect_rejected',
            reason,
            missionId: mission.id,
            room: 'director',
          });
          await moveToStageIn(tx, row, 'refused', SYSTEM, { missionId: mission.id });
          return;
        }

        // Nouvelle analyse : la revue en cours est close (sans refuser le prospect)
        // et une nouvelle mission d'analyse est confiée à la salle d'analyse.
        const instruction = request.instruction || null;
        await engine.decide(
          tx,
          mission.id,
          {
            decision: 'reject',
            reason: instruction
              ? `Nouvelle analyse demandée : ${instruction}`
              : 'Nouvelle analyse demandée',
          },
          actor,
        );
        await recordDecision(tx, row, actor, {
          kind: 'reanalysis_requested',
          reason: instruction,
          missionId: mission.id,
          room: 'director',
        });
        const updated = await moveToStageIn(tx, row, 'analysis', SYSTEM, {
          missionId: mission.id,
          details: instruction,
        });
        await createMissionIn(
          tx,
          updated,
          {
            type: PIPELINE_MISSION_TYPES.analyze,
            room: 'analysis',
            input: instruction ? { instruction } : {},
          },
          SYSTEM,
        );
      });
    },

    /** Salle de validation : valider, refuser ou faire corriger un e-mail. Rien n'est envoyé. */
    async decideEmail(id: string, request: EmailDecisionRequest, actor: Actor) {
      return command(id, async (tx, row) => {
        checkVersion(row, request.expectedVersion);
        const mission = await loadMissionOf(tx, row, request.missionId, 'email_review');
        const email = await loadLatestEmail(tx, row, request.productionId);
        if (email.status !== 'pending_review') {
          throw invalid('Cet e-mail n’est pas en attente de validation');
        }
        const reason = request.reason || null;

        if (request.decision === 'approve') {
          await engine.decide(tx, mission.id, { decision: 'approve' }, actor);
          await setProductionStatus(tx, email.id, 'approved');
          await recordDecision(tx, row, actor, {
            kind: 'email_approved',
            reason,
            missionId: mission.id,
            productionId: email.id,
            room: 'email_review',
          });
          await update(tx, row, { nextAction: 'Envoyer l’e-mail validé' });
          return;
        }

        if (request.decision === 'reject') {
          await engine.decide(
            tx,
            mission.id,
            { decision: 'reject', reason: reason ?? 'E-mail refusé (aucun motif précisé)' },
            actor,
          );
          await setProductionStatus(tx, email.id, 'rejected');
          await recordDecision(tx, row, actor, {
            kind: 'email_rejected',
            reason,
            missionId: mission.id,
            productionId: email.id,
            room: 'email_review',
          });
          // Retour à la salle commerciale pour une nouvelle approche.
          const updated = await moveToStageIn(tx, row, 'proposal', SYSTEM, {
            missionId: mission.id,
            details: reason,
          });
          await createMissionIn(
            tx,
            updated,
            {
              type: PIPELINE_MISSION_TYPES.proposal,
              room: 'copywriting',
              input: reason ? { instruction: reason } : {},
            },
            SYSTEM,
          );
          return;
        }

        await engine.decide(
          tx,
          mission.id,
          { decision: 'request_changes', reason: reason ?? 'Modification demandée' },
          actor,
        );
        await setProductionStatus(tx, email.id, 'changes_requested');
        await recordDecision(tx, row, actor, {
          kind: 'email_changes_requested',
          reason,
          missionId: mission.id,
          productionId: email.id,
          room: 'email_review',
        });
      });
    },

    /** Modifie le brouillon : crée une nouvelle version (l'ancienne est conservée). */
    async editEmailDraft(id: string, request: EmailDraftRequest, actor: Actor) {
      return command(id, async (tx, row) => {
        const base = await loadLatestEmail(tx, row, request.productionId);
        if (row.stage !== 'email_review') {
          throw invalid('Le brouillon ne peut être modifié que dans la salle de validation');
        }
        if (!['pending_review', 'changes_requested', 'draft'].includes(base.status)) {
          throw invalid('Cet e-mail ne peut plus être modifié (déjà validé, refusé ou envoyé)');
        }
        const mission = await openMissionIn(tx, row.id, 'email_review');
        if (!mission) throw invalid('Aucune mission de validation ouverte pour cet e-mail');

        const content = emailContentSchema.parse({
          ...(base.content as object),
          subject: request.subject,
          body: request.body,
        });
        await setProductionStatus(tx, base.id, 'superseded');
        const created = await addProductionIn(
          tx,
          row,
          {
            kind: 'email',
            missionId: mission.id,
            status: 'pending_review',
            title: request.subject,
            content,
          },
          actor,
          {
            title: 'Brouillon de l’e-mail modifié',
            details: `Remplace la version ${base.version}`,
          },
        );
        // Après une demande de modification, la mission repasse en attente de validation.
        if (mission.status === 'in_progress') {
          await engine.applyAction(
            tx,
            mission.id,
            { action: 'submit_for_validation', output: { productionId: created.id } },
            actor,
          );
        }
      });
    },

    /** Marque l'e-mail validé comme envoyé. SIMULATION : aucun e-mail réel ne part. */
    async simulateSend(id: string, request: { productionId: string }, actor: Actor) {
      if (!simulationMode) {
        throw AppError.externalActionBlocked(
          'envoi d’e-mail (aucune intégration e-mail réelle n’est disponible)',
        );
      }
      return command(id, async (tx, row) => {
        const email = await loadLatestEmail(tx, row, request.productionId);
        if (email.status !== 'approved') {
          throw invalid('Seul un e-mail validé peut être envoyé');
        }
        if (row.doNotContact) {
          throw new AppError(
            ERROR_CODES.CONTACT_NOT_ALLOWED,
            'Le prospect a demandé à ne plus être contacté',
            409,
          );
        }
        const content = emailContentSchema.parse(email.content);
        await addMessageIn(tx, row, {
          direction: 'outbound',
          kind: 'initial',
          delivery: 'simulated',
          subject: content.subject,
          body: content.body,
          fromAddress: null,
          toAddress: content.to,
          productionId: email.id,
        });
        await setProductionStatus(tx, email.id, 'sent');
        const updated = await moveToStageIn(tx, row, 'followup', SYSTEM, {
          patch: {
            relationshipStatus: 'awaiting_reply',
            nextAction: 'Relancer si aucune réponse',
            nextActionAt: new Date(clock().getTime() + FOLLOWUP_DELAY_DAYS * DAY_MS),
          },
        });
        await addEvent(tx, row.id, actor, {
          type: 'email_sent',
          title: 'E-mail envoyé (simulation)',
          room: 'email_review',
          details: `${content.subject} — aucun e-mail réel n’a été envoyé.`,
          payload: { productionId: email.id, simulated: true },
        });
        // Le suivi commence dès l'envoi : la mission de suivi est ouverte et démarrée.
        const followup = await createMissionIn(
          tx,
          updated,
          { type: PIPELINE_MISSION_TYPES.followup, room: 'followup' },
          SYSTEM,
        );
        await engine.applyAction(tx, followup.id, { action: 'start' }, SYSTEM);
      });
    },

    /** Enregistre une réponse reçue (saisie manuelle). */
    async recordReply(id: string, request: ReplyRequest, actor: Actor) {
      return command(id, async (tx, row) => {
        if (row.stage !== 'followup' && row.stage !== 'converted') {
          throw invalid('Aucun e-mail n’a encore été envoyé à ce prospect');
        }
        await addMessageIn(tx, row, {
          direction: 'inbound',
          kind: 'reply',
          delivery: 'received',
          subject: request.subject ?? null,
          body: request.body,
          fromAddress: row.contactEmail,
          toAddress: null,
          occurredAt: request.receivedAt ? new Date(request.receivedAt) : undefined,
        });
        await update(tx, row, {
          relationshipStatus: 'reply_received',
          nextAction: 'Répondre au prospect',
          nextActionAt: null,
        });
        await addEvent(tx, row.id, actor, {
          type: 'reply_received',
          title: 'Réponse reçue',
          room: 'followup',
          details: request.subject ?? null,
        });
      });
    },

    /** Relance. SIMULATION : refusée si le prospect ne doit plus être contacté. */
    async sendFollowup(id: string, request: FollowupMessageRequest, actor: Actor) {
      if (!simulationMode) {
        throw AppError.externalActionBlocked('relance par e-mail (aucune intégration réelle)');
      }
      return command(id, async (tx, row) => {
        const check = canSendFollowup({
          doNotContact: row.doNotContact,
          relationshipStatus: row.relationshipStatus as RelationshipStatus | null,
          stage: row.stage as ProspectStage,
        });
        if (!check.allowed) {
          throw new AppError(ERROR_CODES.CONTACT_NOT_ALLOWED, check.reason, 409);
        }
        await addMessageIn(tx, row, {
          direction: 'outbound',
          kind: 'followup',
          delivery: 'simulated',
          subject: request.subject,
          body: request.body,
          fromAddress: null,
          toAddress: row.contactEmail,
        });
        await update(tx, row, {
          relationshipStatus: 'awaiting_reply',
          nextAction: 'Attendre la réponse à la relance',
          nextActionAt: new Date(clock().getTime() + FOLLOWUP_DELAY_DAYS * DAY_MS),
        });
        await addEvent(tx, row.id, actor, {
          type: 'followup_sent',
          title: 'Relance envoyée (simulation)',
          room: 'followup',
          details: `${request.subject} — aucun e-mail réel n’a été envoyé.`,
          payload: { simulated: true },
        });
      });
    },

    /** Suivi commercial : statut de la relation, prochaine action, blocage des contacts. */
    async updateFollowup(id: string, request: FollowupUpdateRequest, actor: Actor) {
      return command(id, async (tx, row) => {
        checkVersion(row, request.expectedVersion);
        const patch: ProspectPatch = {};
        const changes: string[] = [];

        if (request.relationshipStatus !== undefined) {
          if (row.stage !== 'followup') {
            throw invalid('Le statut de la relation ne se modifie qu’en salle de suivi');
          }
          patch.relationshipStatus = request.relationshipStatus;
          changes.push(`Relation : ${RELATIONSHIP_STATUS_LABELS[request.relationshipStatus]}`);
        }
        if (request.nextAction !== undefined) {
          patch.nextAction = request.nextAction || null;
          changes.push(`Prochaine action : ${request.nextAction || 'aucune'}`);
        }
        if (request.nextActionAt !== undefined) {
          patch.nextActionAt = request.nextActionAt ? new Date(request.nextActionAt) : null;
        }
        if (request.priority !== undefined) {
          patch.priority = request.priority;
          changes.push(`Priorité : ${request.priority}`);
        }
        if (request.doNotContact !== undefined) {
          patch.doNotContact = request.doNotContact;
          patch.doNotContactReason = request.doNotContact
            ? request.doNotContactReason || null
            : null;
          changes.push(
            request.doNotContact ? 'Ne plus contacter ce prospect' : 'Contact de nouveau autorisé',
          );
        }
        if (changes.length === 0) throw AppError.validation('Aucune modification demandée');

        const updated = await update(tx, row, patch);
        if (request.relationshipStatus === 'converted') {
          await moveToStageIn(tx, updated, 'converted', actor);
        } else if (request.relationshipStatus === 'archived') {
          await moveToStageIn(tx, updated, 'archived', actor);
        }
        if (request.relationshipStatus) {
          await closeFollowupMissionIn(tx, row.id, request.relationshipStatus, actor);
        }
        await addEvent(tx, row.id, actor, {
          type: 'followup_updated',
          title: 'Suivi mis à jour',
          room: 'followup',
          details: changes.join(' · '),
        });
      });
    },

    async addNote(id: string, request: { text: string }, actor: Actor) {
      return command(id, async (tx, row) => {
        await update(tx, row, {});
        await addEvent(tx, row.id, actor, {
          type: 'note_added',
          title: 'Note interne',
          room: PROSPECT_STAGE_ROOMS[row.stage as ProspectStage],
          details: request.text,
        });
      });
    },

    /** Change le statut d'une production (pipeline : doublage généré, proposition validée…). */
    async setProductionStatus(id: string, productionId: string, status: ProductionStatus) {
      return command(id, async (tx, row) => {
        const production = await tx.prospectProduction.findUnique({ where: { id: productionId } });
        if (!production || production.prospectId !== row.id) {
          throw AppError.validation(`Cette production ne concerne pas le dossier ${row.reference}`);
        }
        await setProductionStatus(tx, productionId, status);
      });
    },
  };
}

export type ProspectService = ReturnType<typeof createProspectService>;
