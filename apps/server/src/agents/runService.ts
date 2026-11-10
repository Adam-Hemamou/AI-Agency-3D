import {
  AGENT_MODEL_DEFAULTS,
  ERROR_CODES,
  agentModelSettingsSchema,
  type AgentModelSettings,
  type AgentRun,
  type AgentRunStatus,
  type ClaimRunResponse,
  type RunFailureRequest,
  type RunFailureResponse,
  type RunHeartbeatResponse,
  type AgentRunDetailResponse,
  type RunListQuery,
  type RunListResponse,
  type RunMissionSummary,
  type MissionStatus,
  type RoomId,
} from '@agency/shared';
import { Prisma, type AgentRun as AgentRunRow } from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { toMissionDto } from '../missions/serializers.ts';
import {
  effectsSinceStartIn,
  hasEffects,
  systemClock,
  type Actor,
  type Clock,
  type Db,
  type MissionService,
} from '../missions/missionService.ts';
import type { AgentControl } from './agentControl.ts';
import type { AuthenticatedAgent } from './agentService.ts';

export interface RunServiceDeps {
  prisma: AppPrismaClient;
  missions: MissionService;
  /** Arrêt d'urgence, revérifié dans la transaction de la prise de mission. */
  control: AgentControl;
  clock?: Clock;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Exécution lue SANS sa sortie brute (jamais renvoyée par l'API). */
type RunRowWithoutRawOutput = Omit<AgentRunRow, 'rawOutput'>;

/** Toutes les colonnes d'une exécution, sauf la sortie brute du modèle. */
const RUN_SELECT_WITHOUT_RAW_OUTPUT = {
  id: true,
  missionId: true,
  agentId: true,
  attempt: true,
  status: true,
  n8nExecutionId: true,
  promptVersion: true,
  settings: true,
  startedAt: true,
  heartbeatAt: true,
  finishedAt: true,
  failureCode: true,
  failureMessage: true,
  promptTokens: true,
  outputTokens: true,
  llmMs: true,
} satisfies Prisma.AgentRunSelect;

const MISSION_SUMMARY_SELECT = {
  id: true,
  type: true,
  room: true,
  status: true,
  attemptCount: true,
  maxAttempts: true,
} satisfies Prisma.MissionSelect;

function toMissionSummary(row: {
  id: string;
  type: string;
  room: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
}): RunMissionSummary {
  return {
    id: row.id,
    type: row.type,
    room: row.room as RoomId,
    status: row.status as MissionStatus,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
  };
}

export function toRunDto(row: RunRowWithoutRawOutput): AgentRun {
  const parsed = agentModelSettingsSchema.safeParse(row.settings);
  return {
    id: row.id,
    missionId: row.missionId,
    agentId: row.agentId,
    attempt: row.attempt,
    status: row.status as AgentRunStatus,
    n8nExecutionId: row.n8nExecutionId,
    promptVersion: row.promptVersion,
    // Copie enregistrée à la prise de mission ; une valeur illisible ne devrait jamais arriver.
    settings: parsed.success ? parsed.data : { ...AGENT_MODEL_DEFAULTS },
    startedAt: row.startedAt.toISOString(),
    heartbeatAt: iso(row.heartbeatAt),
    finishedAt: iso(row.finishedAt),
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    promptTokens: row.promptTokens,
    outputTokens: row.outputTokens,
    llmMs: row.llmMs,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Interblocage ou conflit d'écriture détecté par MySQL : la transaction a été annulée en entier. */
function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

/** Candidates examinées par prise (au-delà, la prise suivante de n8n prendra le relais). */
const CANDIDATE_BATCH = 50;
/** Nouvel essai de la transaction après un interblocage MySQL (transaction annulée en entier). */
const DEADLOCK_RETRIES = 3;

/** Auteur des décisions prises après un échec (remise en attente ou blocage). */
const SYSTEM: Actor = { type: 'system', id: null };

function forbidden(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

function notActive(row: { status: string }, what: string): AppError {
  return new AppError(
    ERROR_CODES.INVALID_TRANSITION,
    `${what} impossible : l’exécution n’est plus en cours (statut « ${row.status} »)`,
    409,
    { currentStatus: row.status },
  );
}

function missionNotInProgress(status: string, what: string): AppError {
  return new AppError(
    ERROR_CODES.INVALID_TRANSITION,
    `${what} impossible : la mission n’est plus en cours (statut « ${status} »)`,
    409,
    { missionStatus: status },
  );
}

/** Mission choisie pour une prise : à reprendre (déjà en cours) ou à démarrer. */
interface Candidate {
  id: string;
  resume: boolean;
}

/**
 * Exécutions des agents. SEUL point d'écriture de la table agent_runs.
 *
 * Prise de mission (claim) : dans UNE transaction,
 * 1. arrêt d'urgence revérifié ;
 * 2. même exécution n8n déjà enregistrée → on renvoie la même exécution (idempotence) ;
 * 3. prompt actif obligatoire (sinon 409 AGENT_PROMPT_MISSING) ;
 * 4. choix de la mission, verrouillée avec SKIP LOCKED : deux prises simultanées ne verrouillent
 *    jamais la même mission (chacune passe à la suivante disponible) ;
 *    a) sa mission à reprendre après une demande de modification (en cours, sans exécution active),
 *    b) sinon ses missions en attente, puis les missions libres de sa salle,
 *    par priorité décroissante, puis ancienneté ;
 * 5. démarrage par le moteur de missions (mêmes règles que POST …/transitions : visibilité, salle,
 *    tentatives ; une mission libre est attribuée à l'agent) ;
 * 6. création de l'exécution : version du prompt et copie des paramètres utilisés.
 * L'index unique « une exécution en cours par mission » et celui de l'exécution n8n garantissent
 * en dernier recours, en base, qu'aucun doublon n'est possible.
 */
export function createRunService({
  prisma,
  missions,
  control,
  clock = systemClock,
}: RunServiceDeps) {
  async function existingRun(tx: Db, agentId: string, n8nExecutionId: string) {
    return tx.agentRun.findUnique({
      where: { agentId_n8nExecutionId: { agentId, n8nExecutionId } },
    });
  }

  async function replay(tx: Db, run: AgentRunRow): Promise<ClaimRunResponse> {
    const mission = await tx.mission.findUniqueOrThrow({ where: { id: run.missionId } });
    return {
      run: toRunDto(run),
      mission: toMissionDto(mission),
      resumed: false,
      replayed: true,
    };
  }

  /**
   * Prochaine mission pour cet agent, verrouillée. Les conditions reprennent la règle de visibilité
   * (canAgentSeeMission) : agent rattaché à une salle → ses missions et les libres de SA salle ;
   * agent sans salle → uniquement ses missions.
   *
   * En deux temps, car une lecture verrouillante avec ORDER BY verrouille TOUTES les lignes qu'elle
   * examine (une seule prise bloquerait alors toutes les missions de la salle) :
   * 1. liste ordonnée des candidates, SANS verrou ;
   * 2. verrouillage d'une candidate à la fois, par sa clé (une seule ligne), avec SKIP LOCKED : une
   *    mission en cours de prise ailleurs est sautée sans attendre, et toutes les conditions sont
   *    revérifiées sur la dernière version enregistrée (lecture verrouillante).
   */
  async function nextCandidate(
    tx: Db,
    agent: { id: string; room: string | null },
  ): Promise<Candidate | null> {
    const roomFilter = agent.room === null ? Prisma.empty : Prisma.sql`AND m.room = ${agent.room}`;
    const noActiveRun = Prisma.sql`NOT EXISTS (
      SELECT 1 FROM agent_runs r WHERE r.mission_id = m.id AND r.status = 'started'
    )`;
    // a) À reprendre : en cours, à lui, SANS exécution active. Cas : demande de modification de
    //    l'utilisateur, ou mission démarrée / reprise par l'utilisateur pour cet agent (un agent ne
    //    démarre ni ne reprend jamais lui-même une mission hors de la prise de mission).
    //    Les demandes de modification passent en premier.
    const resumable = Prisma.sql`m.status = 'in_progress'
      AND m.agent_id = ${agent.id}
      ${roomFilter}
      AND ${noActiveRun}`;
    // b) À démarrer : les siennes d'abord, puis les libres de sa salle (jamais sans salle).
    const ownership =
      agent.room === null
        ? Prisma.sql`m.agent_id = ${agent.id}`
        : Prisma.sql`(m.agent_id = ${agent.id} OR m.agent_id IS NULL)`;
    // Mission d'une campagne désactivée : plus proposée (elle le redevient si la campagne est réactivée).
    const campaignEnabled = Prisma.sql`NOT EXISTS (
      SELECT 1 FROM prospecting_campaigns c WHERE c.id = m.campaign_id AND c.enabled = FALSE
    )`;
    const startable = Prisma.sql`m.status = 'pending'
      AND m.attempt_count < m.max_attempts
      AND ${ownership}
      ${roomFilter}
      AND ${noActiveRun}
      AND ${campaignEnabled}`;

    for (const [condition, resume, order] of [
      [
        resumable,
        true,
        Prisma.sql`(m.validation_outcome <=> 'changes_requested') DESC, m.priority DESC,
          m.created_at ASC, m.id ASC`,
      ],
      [
        startable,
        false,
        Prisma.sql`(m.agent_id IS NULL) ASC, m.priority DESC, m.created_at ASC, m.id ASC`,
      ],
    ] as const) {
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM missions m WHERE ${condition} ORDER BY ${order} LIMIT ${CANDIDATE_BATCH}`;
      for (const { id } of candidates) {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT m.id FROM missions m WHERE m.id = ${id} AND ${condition}
          FOR UPDATE OF m SKIP LOCKED`;
        if (locked) return { id: locked.id, resume };
      }
    }
    return null;
  }

  async function claimIn(
    tx: Db,
    agent: AuthenticatedAgent,
    n8nExecutionId: string,
  ): Promise<ClaimRunResponse | null> {
    control.assertEnabled();

    const previous = await existingRun(tx, agent.agent.id, n8nExecutionId);
    if (previous) return replay(tx, previous);

    const profile = await tx.agentProfile.findUnique({
      where: { agentId: agent.agent.id },
      include: { activePrompt: { select: { version: true } } },
    });
    if (!profile?.activePrompt) {
      throw new AppError(
        ERROR_CODES.AGENT_PROMPT_MISSING,
        `L’agent ${agent.agent.id} n’a aucun prompt actif : il ne peut prendre aucune mission`,
        409,
      );
    }

    const candidate = await nextCandidate(tx, agent.agent);
    if (!candidate) return null;

    const mission = candidate.resume
      ? await tx.mission.findUniqueOrThrow({ where: { id: candidate.id } })
      : null;
    const started = candidate.resume
      ? toMissionDto(mission!)
      : (
          await missions.inTransaction.applyAction(
            tx,
            candidate.id,
            { action: 'start' },
            agent.actor,
          )
        ).mission;

    const settings: AgentModelSettings = {
      model: profile.model,
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      numCtx: profile.numCtx,
      numPredict: profile.numPredict,
      think: profile.think,
      timeoutSeconds: profile.timeoutSeconds,
    };
    const now = clock();
    const run = await tx.agentRun.create({
      data: {
        missionId: candidate.id,
        agentId: agent.agent.id,
        attempt: Math.max(1, started.attemptCount),
        status: 'started',
        n8nExecutionId,
        promptVersion: profile.activePrompt.version,
        settings,
        startedAt: now,
        heartbeatAt: now,
      },
    });
    return { run: toRunDto(run), mission: started, resumed: candidate.resume, replayed: false };
  }

  /** Transaction rejouée (3 essais au plus) si MySQL l'annule pour interblocage. */
  async function withRetry<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(work);
      } catch (error) {
        if (!isWriteConflict(error) || attempt >= DEADLOCK_RETRIES) throw error;
      }
    }
  }

  /**
   * Exécution de l'agent authentifié, verrouillée jusqu'à la fin de la transaction.
   * 404 si elle n'existe pas ; 403 si elle appartient à un autre agent ou a été prise par une autre
   * exécution n8n (aucun détail sur l'exécution d'un autre agent n'est renvoyé).
   */
  async function lockOwnRun(tx: Db, agentId: string, runId: string, n8nExecutionId: string) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM agent_runs WHERE id = ${runId} FOR UPDATE`;
    if (!locked) throw AppError.notFound(`Exécution introuvable : ${runId}`);
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.agentId !== agentId) throw forbidden('Cette exécution appartient à un autre agent');
    if (run.n8nExecutionId !== n8nExecutionId) {
      throw forbidden('Cette exécution a été prise par une autre exécution n8n');
    }
    return run;
  }

  return {
    /**
     * Une exécution de l'agent authentifié, avec sa mission (lecture seule, sans la sortie brute).
     * 404 si elle n'existe pas ; 403 si elle appartient à un autre agent (rien n'en est renvoyé).
     */
    async getForAgent(agent: AuthenticatedAgent, runId: string): Promise<AgentRunDetailResponse> {
      const row = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { ...RUN_SELECT_WITHOUT_RAW_OUTPUT, mission: { select: MISSION_SUMMARY_SELECT } },
      });
      if (!row) throw AppError.notFound(`Exécution introuvable : ${runId}`);
      if (row.agentId !== agent.agent.id) {
        throw forbidden('Cette exécution appartient à un autre agent');
      }
      const { mission, ...run } = row;
      return { run: toRunDto(run), mission: toMissionSummary(mission) };
    },

    /**
     * Journal des exécutions (utilisateur) : filtres, tri chronologique par date de début (puis
     * identifiant, pour un ordre stable) et pagination. Trois requêtes au total, quelle que soit la
     * taille de la page : la page (avec mission et agent joints), le total, et la liste des
     * exécutions de la page qui ont une sortie brute conservée (contenu jamais lu).
     */
    async list(query: RunListQuery): Promise<RunListResponse> {
      const where: Prisma.AgentRunWhereInput = {
        ...(query.agentId && { agentId: query.agentId }),
        ...(query.missionId && { missionId: query.missionId }),
        ...(query.status && { status: { in: query.status } }),
        ...((query.from || query.to) && {
          startedAt: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lt: new Date(query.to) }),
          },
        }),
      };
      const direction = query.sort === 'oldest' ? 'asc' : 'desc';
      const [rows, total] = await prisma.$transaction([
        prisma.agentRun.findMany({
          where,
          orderBy: [{ startedAt: direction }, { id: direction }],
          take: query.limit,
          skip: query.offset,
          select: {
            ...RUN_SELECT_WITHOUT_RAW_OUTPUT,
            mission: { select: MISSION_SUMMARY_SELECT },
            agent: { select: { name: true } },
          },
        }),
        prisma.agentRun.count({ where }),
      ]);
      const withRawOutput = rows.length
        ? await prisma.agentRun.findMany({
            where: { id: { in: rows.map((r) => r.id) }, rawOutput: { not: null } },
            select: { id: true },
          })
        : [];
      const rawOutputIds = new Set(withRawOutput.map((r) => r.id));
      return {
        items: rows.map(({ mission, agent, ...run }) => ({
          ...toRunDto(run),
          agentName: agent.name,
          mission: toMissionSummary(mission),
          durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
          hasRawOutput: rawOutputIds.has(run.id),
        })),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    },

    /**
     * Signal de vie : seule l'exécution EN COURS de l'agent, prise par cette exécution n8n, peut être
     * maintenue en vie, et seulement tant que sa mission est en cours. Verrou de l'exécution : un
     * signal et un échec simultanés passent l'un après l'autre (un signal après l'échec est refusé).
     */
    async heartbeat(
      agent: AuthenticatedAgent,
      runId: string,
      n8nExecutionId: string,
    ): Promise<RunHeartbeatResponse> {
      return withRetry(async (tx) => {
        control.assertEnabled();
        const run = await lockOwnRun(tx, agent.agent.id, runId, n8nExecutionId);
        if (run.status !== 'started') throw notActive(run, 'Signal de vie');
        const mission = await tx.mission.findUniqueOrThrow({
          where: { id: run.missionId },
          select: { status: true },
        });
        if (mission.status !== 'in_progress') {
          throw missionNotInProgress(mission.status, 'Signal de vie');
        }
        const updated = await tx.agentRun.update({
          where: { id: runId },
          data: { heartbeatAt: clock() },
        });
        return { run: toRunDto(updated) };
      });
    },

    /**
     * Échec signalé par n8n : l'exécution est close et le CRM décide seul de la suite.
     * - Aucun effet depuis le démarrage et une tentative restante : mission remise en attente
     *   (release, par le système) ; exécution « released ».
     * - Sinon : mission bloquée (par le système, avec le code et le motif) ; exécution « failed ».
     * Verrous dans l'ordre mission puis exécution (même ordre que la prise de mission ; la
     * récupération et les écritures qui citent la mission verrouillent aussi la mission) : un échec
     * concurrent d'une transition, d'une écriture ou de la récupération passe avant ou après, jamais
     * entre les deux. Le même échec renvoyé par n8n ne change rien (replayed).
     */
    async fail(
      agent: AuthenticatedAgent,
      runId: string,
      request: RunFailureRequest,
    ): Promise<RunFailureResponse> {
      // Mission de l'exécution, lue AVANT la transaction (elle ne change jamais : protégée en base).
      // Les premières instructions de la transaction sont ainsi les verrous : toutes les lectures
      // suivantes voient le dernier état enregistré (une lecture ordinaire faite avant les verrous
      // figerait une photo plus ancienne de la base pour toute la transaction).
      const target = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { missionId: true },
      });
      if (!target) throw AppError.notFound(`Exécution introuvable : ${runId}`);
      return withRetry(async (tx) => {
        control.assertEnabled();
        await tx.$queryRaw`SELECT id FROM missions WHERE id = ${target.missionId} FOR UPDATE`;
        const run = await lockOwnRun(tx, agent.agent.id, runId, request.n8nExecutionId);

        if (run.status === 'failed' || run.status === 'released') {
          const mission = await tx.mission.findUniqueOrThrow({ where: { id: run.missionId } });
          return {
            run: toRunDto(run),
            mission: toMissionDto(mission),
            decision: run.status === 'released' ? 'released' : 'blocked',
            replayed: true,
          };
        }
        if (run.status !== 'started') throw notActive(run, 'Signalement d’échec');

        const mission = await tx.mission.findUniqueOrThrow({ where: { id: run.missionId } });
        if (mission.status !== 'in_progress') {
          throw missionNotInProgress(mission.status, 'Signalement d’échec');
        }

        const reason = `Échec de l’exécution (${request.code}) : ${request.message}`;
        const canRelease =
          mission.attemptCount < mission.maxAttempts &&
          !hasEffects(await effectsSinceStartIn(tx, mission));
        // L'exécution est close AVANT la transition, avec tous ses détails : la clôture automatique
        // du moteur (mission qui quitte « en cours ») ne trouve alors plus d'exécution active. Tout
        // est annulé ensemble si la transition échoue.
        const closed = await tx.agentRun.update({
          where: { id: runId },
          data: {
            status: canRelease ? 'released' : 'failed',
            finishedAt: clock(),
            failureCode: request.code,
            failureMessage: request.message,
            rawOutput: request.rawOutput ?? null,
            promptTokens: request.promptTokens ?? null,
            outputTokens: request.outputTokens ?? null,
            llmMs: request.llmMs ?? null,
          },
        });
        const result = await missions.inTransaction.applyAction(
          tx,
          mission.id,
          canRelease
            ? { action: 'release', reason }
            : { action: 'block', reason, errorCode: request.code },
          SYSTEM,
        );
        return {
          run: toRunDto(closed),
          mission: result.mission,
          decision: canRelease ? 'released' : 'blocked',
          replayed: false,
        };
      });
    },

    /**
     * Prend la prochaine mission de l'agent authentifié et crée son exécution.
     * null : aucune mission disponible (204).
     */
    async claim(
      agent: AuthenticatedAgent,
      n8nExecutionId: string,
    ): Promise<ClaimRunResponse | null> {
      try {
        return await withRetry((tx) => claimIn(tx, agent, n8nExecutionId));
      } catch (error) {
        // Même exécution n8n envoyée deux fois en même temps : la première a été enregistrée,
        // la seconde (annulée en entier, démarrage compris) renvoie la même exécution.
        if (isUniqueViolation(error)) {
          const run = await existingRun(prisma, agent.agent.id, n8nExecutionId);
          if (run) return prisma.$transaction((tx) => replay(tx, run));
        }
        throw error;
      }
    },
  };
}

export type RunService = ReturnType<typeof createRunService>;
