import {
  DECISION_KIND_LABELS,
  ERROR_CODES,
  PIPELINE_MISSION_TYPES,
  PROSPECT_STAGE_LABELS,
  PROSPECT_STAGE_ROOMS,
  RELATIONSHIP_STATUS_LABELS,
  ROOM_LABELS,
  canAgentMoveToStage,
  canAgentSeeMission,
  canMoveToStage,
  canSendFollowup,
  channelHandleKey,
  channelUrlKey,
  normalizeChannelHandle,
  parseChannelUrl,
  computeAnalysisScore,
  createAnalysisRequestSchema,
  createMissionRequestSchema,
  createProductionRequestSchema,
  createProspectRequestSchema,
  type CreateAnalysisRequest,
  type CreateMissionRequest,
  type CreateProductionRequest,
  type CreateProspectRequest,
  type AgentEventRequest,
  type AgentStageRequest,
  type DecisionKind,
  type DuplicateMatchField,
  type EnrichProspectRequest,
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
  type ProspectLookupQuery,
  type ProspectLookupResponse,
  type ProspectStage,
  type RelationshipStatus,
  type ReplyRequest,
  type RoomId,
  emailContentSchema,
} from '@agency/shared';
import { Prisma, type Prospect as ProspectRow } from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import type { TransactionHook } from '../db/transactionHook.ts';
import { assertHumanActor, isHumanActor } from '../auth/actors.ts';
import { assertCampaignTargetIn, lockSearchMissionIn } from '../campaigns/searchMission.ts';
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

/**
 * Contrôle supplémentaire exécuté dans la transaction, sur le dossier tel qu'il est lu
 * (ex. : règles propres aux agents). Il lève une erreur pour refuser la commande.
 */
export interface CommandOptions {
  guard?: (row: ProspectRow) => void;
  /** Instructions exécutées dans la même transaction (idempotence des requêtes d'agents). */
  hook?: TransactionHook;
}

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

/**
 * Mission créée par le serveur quand un prospect arrive à une étape (passage demandé par un agent).
 * C'est le CRM qui décide : l'agent ne choisit ni le type ni l'exigence de validation humaine.
 */
const STAGE_MISSIONS: Partial<
  Record<ProspectStage, Omit<CreateMissionRequest, 'prospectId' | 'priority'>>
> = {
  analysis: { type: PIPELINE_MISSION_TYPES.analyze, room: 'analysis' },
  review: { type: PIPELINE_MISSION_TYPES.review, room: 'director', requiresValidation: true },
  dubbing: { type: PIPELINE_MISSION_TYPES.dubbing, room: 'dubbing' },
  proposal: { type: PIPELINE_MISSION_TYPES.proposal, room: 'copywriting' },
  email_review: {
    type: PIPELINE_MISSION_TYPES.emailReview,
    room: 'email_review',
    requiresValidation: true,
  },
  followup: { type: PIPELINE_MISSION_TYPES.followup, room: 'followup' },
};

/**
 * Salles où une mission exigeant une validation est soumise DIRECTEMENT à l'utilisateur : le système
 * la démarre et la soumet dès sa création (aucun agent n'y travaille). « Mon bureau » : la revue du
 * prospect après l'analyse. La salle de validation des e-mails n'y figure pas : sa mission est
 * démarrée par un agent (rédaction ou vérification de l'e-mail), qui la soumet ensuite.
 */
const DIRECT_HUMAN_REVIEW_ROOMS: readonly string[] = ['director'];

/** Statuts qu'un auteur non humain peut donner à un e-mail : jamais « validé » ni « envoyé ». */
const NON_HUMAN_EMAIL_STATUSES: readonly ProductionStatus[] = ['draft', 'pending_review'];

/** Libellés des champs complétés (historique du dossier). */
const ENRICHABLE_FIELD_LABELS: Record<string, string> = {
  creatorName: 'nom du créateur',
  channelName: 'nom de la chaîne',
  channelHandle: 'identifiant de chaîne',
  youtubeChannelId: 'identifiant YouTube',
  channelUrl: 'adresse de la chaîne',
  avatarUrl: 'avatar',
  category: 'catégorie',
  description: 'description',
  country: 'pays',
  subscriberCount: 'abonnés',
  viewCount: 'vues',
  videoCount: 'vidéos',
  statsSource: 'source des statistiques',
  statsUpdatedAt: 'date des statistiques',
  contactEmail: 'e-mail de contact',
  contactName: 'nom du contact',
  contactSource: 'source du contact',
  priority: 'priorité',
};

/** Nouvel essai de création si deux dossiers reçoivent le même numéro en même temps. */
const CREATE_ATTEMPTS = 5;

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

function forbidden(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Conflit passager entre transactions simultanées (interblocage, attente de verrou dépassée) :
 * MySQL annule l'une d'elles, qui peut être rejouée sans risque.
 */
function isTransientConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === 'P2034' || /deadlock|lock wait timeout|try restarting transaction/i.test(error.message)
  );
}

/** Numéro de dossier lisible : P-AAAA-NNNN. */
export function formatReference(year: number, number: number): string {
  return `P-${year}-${String(number).padStart(4, '0')}`;
}

function toJsonable(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
}

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

  /**
   * Charge le dossier en VERROUILLANT sa ligne jusqu'à la fin de la transaction : deux commandes
   * simultanées sur le même dossier (plusieurs agents, l'utilisateur) passent l'une après l'autre
   * au lieu d'être refusées pour « modification concurrente ». Le verrou est pris avant toute
   * lecture ordinaire : la photo de la base prise ensuite contient la dernière version validée.
   * La vérification d'expectedVersion reste appliquée (affichage réellement périmé).
   */
  async function load(tx: Db, id: string): Promise<ProspectRow> {
    await tx.$queryRaw`SELECT id FROM prospects WHERE id = ${id} FOR UPDATE`;
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
  async function update(
    tx: Db,
    row: ProspectRow,
    patch: ProspectPatch | Prisma.ProspectUpdateManyMutationInput,
  ): Promise<ProspectRow> {
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
    if (actor.type === 'agent' && !canAgentMoveToStage(from, to)) {
      throw forbidden(
        `Un agent ne peut pas faire passer un dossier de « ${PROSPECT_STAGE_LABELS[from]} » à « ${PROSPECT_STAGE_LABELS[to]} » : décision humaine`,
      );
    }
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
    const { mission } = await engine.create(tx, input, actor);
    if (!input.requiresValidation || !DIRECT_HUMAN_REVIEW_ROOMS.includes(input.room)) {
      return mission;
    }
    // Revue humaine directe : la mission attend la décision de l'utilisateur dès sa création.
    // Le système la démarre et la soumet (aucun agent n'y travaille), dans la même transaction.
    const latest = await tx.prospectAnalysis.findFirst({
      where: { prospectId: row.id },
      orderBy: { version: 'desc' },
      select: { version: true, score: true },
    });
    await engine.applyAction(tx, mission.id, { action: 'start' }, SYSTEM);
    const submitted = await engine.applyAction(
      tx,
      mission.id,
      {
        action: 'submit_for_validation',
        output: latest ? { analysisVersion: latest.version, score: latest.score } : {},
      },
      SYSTEM,
    );
    return submitted.mission;
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

  /**
   * Réserve le prochain numéro de dossier de l'année. DOIT être la première instruction de la
   * transaction de création : la ligne du compteur reste verrouillée jusqu'à la fin de la
   * transaction, les créations simultanées passent donc l'une après l'autre. Et comme aucune
   * lecture n'a encore eu lieu, les lectures suivantes (recherche de doublons) voient toutes
   * les créations déjà terminées.
   */
  async function reserveReferenceIn(tx: Db, now: Date): Promise<string> {
    const year = now.getUTCFullYear();
    await tx.$executeRaw`
      INSERT INTO prospect_counters (year, last_number) VALUES (${year}, 1)
      ON DUPLICATE KEY UPDATE last_number = last_number + 1`;
    const counter = await tx.prospectCounter.findUniqueOrThrow({ where: { year } });
    // Le compteur ne recule jamais derrière un numéro existant (dossiers importés, compteur absent).
    const [existing] = await tx.$queryRaw<{ max: bigint | number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(reference, 8) AS UNSIGNED)) AS max
      FROM prospects WHERE reference LIKE ${`P-${year}-%`}`;
    const highest = Number(existing?.max ?? 0);
    let number = counter.lastNumber;
    if (highest >= number) {
      number = highest + 1;
      await tx.prospectCounter.update({ where: { year }, data: { lastNumber: number } });
    }
    return formatReference(year, number);
  }

  /**
   * Mission citée par une analyse, une production ou une activité.
   * - Pour tous : elle concerne bien ce dossier.
   * - Pour un agent, en plus : elle lui est attribuée, il peut la voir (sa salle) et elle est
   *   « en cours ». La mission est lue avec un verrou partagé (FOR SHARE), qui renvoie son dernier
   *   état enregistré : l'écriture et la récupération des missions interrompues (qui verrouille la
   *   mission en premier) passent l'une après l'autre. Un effet n'est donc jamais enregistré sur une
   *   mission que la récupération vient de bloquer, ni ignoré par elle.
   * L'utilisateur et le système gardent la seule vérification du dossier.
   */
  async function checkMissionBelongs(
    tx: Db,
    row: ProspectRow,
    missionId: string | null,
    actor: Actor,
  ) {
    if (missionId === null) return;
    if (actor.type !== 'agent') {
      const mission = await tx.mission.findUnique({
        where: { id: missionId },
        select: { prospectId: true },
      });
      if (!mission || mission.prospectId !== row.id) {
        throw AppError.validation(`Cette mission ne concerne pas le dossier ${row.reference}`);
      }
      return;
    }

    const [mission] = await tx.$queryRaw<
      { prospect_id: string | null; agent_id: string | null; room: string; status: string }[]
    >`SELECT prospect_id, agent_id, room, status FROM missions WHERE id = ${missionId} FOR SHARE`;
    if (!mission || mission.prospect_id !== row.id) {
      throw AppError.validation(`Cette mission ne concerne pas le dossier ${row.reference}`);
    }
    const agent = actor.id
      ? await tx.agent.findUnique({ where: { id: actor.id }, select: { id: true, room: true } })
      : null;
    if (!agent) throw forbidden(`Agent inconnu : ${actor.id ?? '(sans identifiant)'}`);
    if (mission.agent_id === null) {
      throw forbidden(
        'Cette mission n’est attribuée à aucun agent : démarrez-la (action « start ») avant d’y rattacher un résultat',
      );
    }
    if (mission.agent_id !== agent.id) {
      throw forbidden(`Cette mission est attribuée à un autre agent (${mission.agent_id})`);
    }
    if (!canAgentSeeMission({ agentId: mission.agent_id, room: mission.room }, agent)) {
      throw forbidden(`Cette mission appartient à une autre salle (${mission.room})`);
    }
    if (mission.status !== 'in_progress') {
      throw new AppError(
        ERROR_CODES.INVALID_TRANSITION,
        `Un résultat ne peut être rattaché qu’à une mission en cours (statut actuel : « ${mission.status} »)`,
        409,
        { currentStatus: mission.status },
      );
    }
  }

  /**
   * Dossiers existants correspondant à une chaîne ou à un contact. Comparaisons insensibles
   * à la casse (collation MySQL) ; "@nom", "nom" et l'URL ".../@nom" désignent la même chaîne.
   */
  async function findDuplicatesIn(
    tx: Db,
    criteria: ProspectLookupQuery,
    excludeId?: string,
  ): Promise<ProspectLookupResponse> {
    const channelIds = new Set<string>();
    const handles = new Set<string>();
    if (criteria.youtubeChannelId) channelIds.add(criteria.youtubeChannelId.trim());
    if (criteria.channelHandle) handles.add(normalizeChannelHandle(criteria.channelHandle));
    const url = criteria.channelUrl?.trim().replace(/\/+$/, '');
    if (url) {
      const parsed = parseChannelUrl(url);
      if (parsed && 'youtubeChannelId' in parsed) channelIds.add(parsed.youtubeChannelId);
      if (parsed && 'channelHandle' in parsed) handles.add(parsed.channelHandle);
    }
    const email = criteria.contactEmail?.trim();

    const or: Prisma.ProspectWhereInput[] = [];
    if (channelIds.size) or.push({ youtubeChannelId: { in: [...channelIds] } });
    if (handles.size) {
      or.push({ channelHandle: { in: [...handles].flatMap((h) => [h, `@${h}`]) } });
    }
    if (url) or.push({ channelUrl: { in: [url, `${url}/`] } });
    const handleKeys = [...handles];
    if (handleKeys.length) or.push({ channelHandleKey: { in: handleKeys } });
    const urlKey = channelUrlKey(url);
    if (urlKey) or.push({ channelUrlKey: urlKey });
    if (email) or.push({ contactEmail: email });
    if (or.length === 0) return { exists: false, matches: [] };

    const rows = await tx.prospect.findMany({
      where: { OR: or, ...(excludeId && { id: { not: excludeId } }) },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const lower = (v: string | null) => v?.toLowerCase() ?? null;
    const matches = rows.map((r) => {
      const matchedOn: DuplicateMatchField[] = [];
      if (r.youtubeChannelId && channelIds.has(r.youtubeChannelId))
        matchedOn.push('youtubeChannelId');
      if (r.channelHandle && handles.has(normalizeChannelHandle(r.channelHandle))) {
        matchedOn.push('channelHandle');
      }
      if (
        (url && lower(r.channelUrl?.replace(/\/+$/, '') ?? null) === lower(url)) ||
        (urlKey && r.channelUrlKey === urlKey)
      ) {
        matchedOn.push('channelUrl');
      }
      if (
        !matchedOn.includes('channelHandle') &&
        r.channelHandleKey &&
        handles.has(r.channelHandleKey)
      ) {
        matchedOn.push('channelHandle');
      }
      if (email && lower(r.contactEmail) === lower(email)) matchedOn.push('contactEmail');
      return { prospect: toSummary(r), matchedOn };
    });
    return { exists: matches.length > 0, matches };
  }

  function toSummary(r: ProspectRow) {
    const dto = toProspectDto(r);
    return {
      id: dto.id,
      reference: dto.reference,
      creatorName: dto.creatorName,
      channelName: dto.channelName,
      stage: dto.stage,
    };
  }

  function duplicateError(found: ProspectLookupResponse): AppError {
    const first = found.matches[0]!;
    return new AppError(
      ERROR_CODES.ALREADY_EXISTS,
      `Cette chaîne a déjà un dossier : ${first.prospect.reference}`,
      409,
      { matches: found.matches },
    );
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
    // Un agent ou le système ne valide ni n'envoie jamais un e-mail : seul l'humain le fait.
    if (
      input.kind === 'email' &&
      !isHumanActor(actor) &&
      !NON_HUMAN_EMAIL_STATUSES.includes(input.status)
    ) {
      throw forbidden(
        `Seul l'utilisateur humain peut donner le statut « ${input.status} » à un e-mail`,
      );
    }
    await checkMissionBelongs(tx, row, input.missionId, actor);
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
    hook?: TransactionHook,
  ): Promise<ProspectDossier> {
    await prisma.$transaction(async (tx) => {
      await hook?.begin(tx);
      const row = await load(tx, id);
      await run(tx, row);
      await hook?.end(tx, { type: 'prospect', id: row.id });
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

    /**
     * Crée le dossier d'un prospect découvert.
     * - searchMissionId (agents) : le prospect est rattaché à la mission de recherche en cours de
     *   l'agent (historique du dossier) ; AUCUNE mission n'est créée. Sans cela, les missions de
     *   découverte, attribuées à l'agent, passeraient avant ses recherches à la prise suivante.
     * - sinon (scénario de démonstration) : une mission de découverte est créée pour le dossier.
     * Un agent doit toujours fournir sa mission de recherche, sauf mission de découverte explicite
     * (démonstration uniquement : la route des agents ne la propose pas).
     */
    async createProspect(
      request: CreateProspectRequest,
      actor: Actor,
      options: {
        searchMissionId?: string;
        discoveryMission?: Omit<CreateMissionRequest, 'prospectId' | 'priority' | 'room' | 'type'>;
        hook?: TransactionHook;
      } = {},
    ) {
      const input = parseOrThrow(createProspectRequestSchema, request, 'Prospect');
      const { searchMissionId } = options;
      if (searchMissionId !== undefined && options.discoveryMission) {
        throw new Error('createProspect : searchMissionId et discoveryMission sont exclusifs');
      }
      if (actor.type === 'agent' && searchMissionId === undefined && !options.discoveryMission) {
        throw forbidden(
          'Un agent ne crée un prospect que dans le cadre de sa mission de recherche en cours (missionId)',
        );
      }
      const create = () =>
        prisma.$transaction(async (tx) => {
          // Clé d'idempotence d'abord (écriture : n'ouvre pas encore la photo de la base),
          // puis le numéro de dossier, puis seulement les lectures.
          await options.hook?.begin(tx);
          const now = clock();
          const reference = await reserveReferenceIn(tx, now);
          // Mission de recherche de l'agent : vérifiée, verrouillée, campagne active, objectif quotidien.
          if (searchMissionId !== undefined) {
            const search = await lockSearchMissionIn(tx, searchMissionId, actor);
            await assertCampaignTargetIn(tx, search);
          }
          // Doublon : même identifiant YouTube, même nom de chaîne ou même adresse de chaîne.
          const duplicates = await findDuplicatesIn(tx, {
            youtubeChannelId: input.youtubeChannelId ?? undefined,
            channelHandle: input.channelHandle ?? undefined,
            channelUrl: input.channelUrl ?? undefined,
          });
          if (duplicates.exists) throw duplicateError(duplicates);
          const row = await tx.prospect.create({
            data: {
              ...input,
              reference,
              channelHandleKey: channelHandleKey(input.channelHandle, input.channelUrl),
              channelUrlKey: channelUrlKey(input.channelUrl),
              viewCount: input.viewCount === null ? null : BigInt(input.viewCount),
              statsUpdatedAt: input.statsUpdatedAt ? new Date(input.statsUpdatedAt) : null,
              discovery: input.discovery as Prisma.InputJsonObject,
              discoveryMissionId: searchMissionId ?? null,
              stage: 'prospecting',
              discoveredAt: now,
              lastActivityAt: now,
              createdAt: now,
              updatedAt: now,
            },
          });
          const missionId =
            searchMissionId ??
            (
              await createMissionIn(
                tx,
                row,
                {
                  type: PIPELINE_MISSION_TYPES.discover,
                  room: 'prospecting',
                  agentId: actor.type === 'agent' ? actor.id : null,
                  ...options.discoveryMission,
                },
                actor,
              )
            ).id;
          await addEvent(tx, row.id, actor, {
            type: 'discovered',
            title: 'Prospect découvert',
            room: 'prospecting',
            details: input.discovery.reason,
            missionId,
            payload: { source: input.discovery.source },
          });
          await options.hook?.end(tx, { type: 'prospect', id: row.id });
          return row.id;
        });
      // Filet de sécurité : si la base refuse malgré tout (index unique, conflit passager entre
      // transactions), on recommence ; la recherche de doublons tranche alors avec une erreur claire.
      for (let attempt = 1; ; attempt++) {
        try {
          return await getDossier(await create());
        } catch (error) {
          const retry = isUniqueViolation(error) || isTransientConflict(error);
          if (!retry || attempt >= CREATE_ATTEMPTS) throw error;
        }
      }
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
    async addAnalysis(
      id: string,
      request: CreateAnalysisRequest,
      actor: Actor,
      options: CommandOptions = {},
    ) {
      const input = parseOrThrow(createAnalysisRequestSchema, request, 'Analyse');
      return command(
        id,
        async (tx, row) => {
          options.guard?.(row);
          await checkMissionBelongs(tx, row, input.missionId, actor);
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
        },
        options.hook,
      );
    },

    /** Dossiers existants pour une chaîne ou un contact (vérification avant création). */
    async findDuplicates(query: ProspectLookupQuery): Promise<ProspectLookupResponse> {
      return findDuplicatesIn(prisma, query);
    },

    /**
     * Passage à l'étape suivante, demandé par un agent : la mission de la nouvelle salle est
     * créée par le serveur (validation humaine comprise), sauf si une mission y est déjà ouverte.
     */
    async advanceStage(
      id: string,
      request: AgentStageRequest,
      actor: Actor,
      options: CommandOptions = {},
    ) {
      return command(
        id,
        async (tx, row) => {
          checkVersion(row, request.expectedVersion);
          options.guard?.(row);
          const updated = await moveToStageIn(tx, row, request.to, actor, {
            details: request.details ?? null,
          });
          const mission = STAGE_MISSIONS[request.to];
          if (mission && !(await openMissionIn(tx, row.id, mission.room))) {
            await createMissionIn(tx, updated, mission, SYSTEM);
          }
        },
        options.hook,
      );
    },

    /**
     * Complète les informations d'un prospect. Seuls les champs réellement modifiés sont
     * enregistrés, avec leur ancienne et leur nouvelle valeur ; rien à modifier = rien d'écrit.
     */
    async enrichProspect(
      id: string,
      request: EnrichProspectRequest,
      actor: Actor,
      options: CommandOptions = {},
    ) {
      try {
        return await command(
          id,
          async (tx, row) => {
            checkVersion(row, request.expectedVersion);
            const { expectedVersion: _version, ...fields } = request;

            if (fields.youtubeChannelId !== undefined) {
              if (row.youtubeChannelId && row.youtubeChannelId !== fields.youtubeChannelId) {
                throw invalid(
                  `Le dossier ${row.reference} a déjà un identifiant YouTube : il ne peut pas changer`,
                );
              }
            }
            if (fields.youtubeChannelId || fields.channelHandle || fields.channelUrl) {
              const duplicates = await findDuplicatesIn(
                tx,
                {
                  youtubeChannelId: fields.youtubeChannelId,
                  channelHandle: fields.channelHandle ?? undefined,
                  channelUrl: fields.channelUrl ?? undefined,
                },
                row.id,
              );
              if (duplicates.exists) throw duplicateError(duplicates);
            }

            const statsChanged = ['subscriberCount', 'viewCount', 'videoCount'].some(
              (k) => k in fields,
            );
            const next: Record<string, unknown> = { ...fields };
            if ('viewCount' in fields) {
              next.viewCount = fields.viewCount === null ? null : BigInt(fields.viewCount!);
            }
            if ('channelHandle' in fields || 'channelUrl' in fields) {
              const handle = 'channelHandle' in fields ? fields.channelHandle : row.channelHandle;
              const url = 'channelUrl' in fields ? fields.channelUrl : row.channelUrl;
              next.channelHandleKey = channelHandleKey(handle, url);
              next.channelUrlKey = channelUrlKey(url);
            }
            if (statsChanged || fields.statsUpdatedAt) {
              next.statsUpdatedAt = fields.statsUpdatedAt
                ? new Date(fields.statsUpdatedAt)
                : clock();
            }

            const changes: Record<
              string,
              { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }
            > = {};
            for (const [field, to] of Object.entries(next)) {
              const from = toJsonable(row[field as keyof ProspectRow]);
              const value = toJsonable(to);
              if (JSON.stringify(from) !== JSON.stringify(value))
                changes[field] = { from, to: value };
            }
            if (Object.keys(changes).length === 0) return;

            const patch = Object.fromEntries(
              Object.keys(changes).map((field) => [field, next[field]]),
            ) as Prisma.ProspectUpdateManyMutationInput;
            await update(tx, row, patch);
            await addEvent(tx, row.id, actor, {
              type: 'prospect_enriched',
              title: 'Informations complétées',
              details: Object.keys(changes)
                .map((f) => ENRICHABLE_FIELD_LABELS[f] ?? f)
                .join(', '),
              room: PROSPECT_STAGE_ROOMS[row.stage as ProspectStage],
              payload: { changes } as Prisma.InputJsonObject,
            });
          },
          options.hook,
        );
      } catch (error) {
        // Une autre écriture vient de donner ce nom ou cette adresse à un autre dossier :
        // la base l'a refusé (index unique), on répond comme pour un doublon détecté.
        if (!isUniqueViolation(error)) throw error;
        const found = await findDuplicatesIn(
          prisma,
          {
            channelHandle: request.channelHandle ?? undefined,
            channelUrl: request.channelUrl ?? undefined,
          },
          id,
        );
        if (found.exists) throw duplicateError(found);
        throw new AppError(ERROR_CODES.ALREADY_EXISTS, 'Cette chaîne a déjà un dossier', 409);
      }
    },

    /** Activité signalée par un agent dans l'historique (titre libre, type fixé par le serveur). */
    async logActivity(
      id: string,
      request: AgentEventRequest,
      actor: Actor,
      options: CommandOptions = {},
    ) {
      return command(
        id,
        async (tx, row) => {
          await checkMissionBelongs(tx, row, request.missionId ?? null, actor);
          await update(tx, row, {});
          await addEvent(tx, row.id, actor, {
            type: 'agent_activity',
            title: request.title,
            details: request.details ?? null,
            room: PROSPECT_STAGE_ROOMS[row.stage as ProspectStage],
            missionId: request.missionId ?? null,
            payload: (request.payload ?? {}) as Prisma.InputJsonObject,
          });
        },
        options.hook,
      );
    },

    async addProduction(
      id: string,
      request: CreateProductionRequest,
      actor: Actor,
      options: CommandOptions = {},
    ) {
      return command(
        id,
        (tx, row) => {
          options.guard?.(row);
          return addProductionIn(tx, row, request, actor);
        },
        options.hook,
      );
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
      assertHumanActor(actor, 'valider, refuser ou faire réanalyser un prospect');
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
      assertHumanActor(actor, 'valider, refuser ou faire corriger un e-mail');
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
      assertHumanActor(actor, 'envoyer un e-mail');
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
      assertHumanActor(actor, 'envoyer une relance');
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
