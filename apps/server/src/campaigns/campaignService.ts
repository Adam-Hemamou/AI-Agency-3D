import {
  AGENT_DAILY_QUOTAS,
  ERROR_CODES,
  PIPELINE_MISSION_TYPES,
  canAgentSeeMission,
  checkCampaignTargets,
  createCampaignRequestSchema,
  createMissionRequestSchema,
  type AgentCampaignContext,
  type AgentMissionScope,
  type Campaign,
  type CampaignListResponse,
  type ChannelLookupQuery,
  type ChannelLookupResponse,
  type ChannelRejectionsInput,
  type CreateCampaignInput,
  type MissionStatus,
  type RejectionReasonCode,
  type UpdateCampaignRequest,
} from '@agency/shared';
import { Prisma, type ProspectingCampaign } from '../generated/prisma/client.ts';
import { quotaDay } from '../agents/quotas.ts';
import { assertHumanActor } from '../auth/actors.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import type { TransactionHook } from '../db/transactionHook.ts';
import { AppError } from '../errors/AppError.ts';
import {
  systemClock,
  type Actor,
  type Clock,
  type Db,
  type MissionService,
} from '../missions/missionService.ts';
import { lockSearchMissionIn } from './searchMission.ts';

/**
 * Campagnes de prospection et mémoire des chaînes écartées. SEUL point d'écriture des tables
 * prospecting_campaigns et rejected_channels.
 *
 * - L'utilisateur crée, modifie, active et désactive les campagnes (jamais un agent).
 * - Chaque jour (heure de Paris), generateDailyMissions crée UNE mission de recherche par campagne
 *   active (index unique campagne + jour : aucun doublon, même avec plusieurs serveurs), attribuée à
 *   l'agent de la campagne. Les missions des jours précédents jamais prises sont annulées.
 * - Une campagne désactivée garde sa mission du jour, mais elle n'est plus proposée à la prise de
 *   mission et toute écriture y est refusée ; réactivée le même jour, elle redevient disponible.
 * - Les critères sont lus EN DIRECT par l'agent (contexte de sa mission) : une modification
 *   s'applique sans toucher au workflow n8n. Un changement d'agent s'applique dès la mission suivante.
 */

export interface CampaignServiceDeps {
  prisma: AppPrismaClient;
  missions: MissionService;
  clock?: Clock;
  /**
   * Quota global de créations de prospects par jour (tous agents) : la somme des objectifs
   * quotidiens des campagnes actives ne peut pas le dépasser. Par défaut, celui des agents.
   */
  globalProspectQuota?: number;
}

/** Nouvel essai d'une transaction annulée par MySQL (interblocage entre deux modifications). */
const DEADLOCK_RETRIES = 3;

/** Ligne lue pour le contrôle des objectifs (MySQL renvoie un booléen sous forme de nombre). */
interface TargetRow {
  id: string;
  enabled: number | boolean;
  daily_target: number;
}

function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

const SYSTEM: Actor = { type: 'system', id: null };
const DAY_MS = 24 * 60 * 60 * 1000;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export function toCampaignDto(row: ProspectingCampaign): Campaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    agentId: row.agentId,
    themes: strings(row.themes),
    keywords: strings(row.keywords),
    languages: strings(row.languages),
    countries: strings(row.countries),
    minSubscribers: row.minSubscribers,
    maxSubscribers: row.maxSubscribers,
    maxDaysSinceLastVideo: row.maxDaysSinceLastVideo,
    dailyTarget: row.dailyTarget,
    reevaluationDays: row.reevaluationDays,
    priority: row.priority,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function forbidden(message: string): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN_ACTOR, message, 403);
}

/** Campagne active sans mission du jour : son agent ne pourrait pas la prendre. */
export interface SkippedCampaign {
  campaignId: string;
  day: string;
  reason: string;
}

/** Mission de campagne créée ou annulée par un passage de la planification. */
export interface ScheduledMission {
  campaignId: string;
  missionId: string;
  day: string;
}

export function createCampaignService({
  prisma,
  missions,
  clock = systemClock,
  globalProspectQuota = AGENT_DAILY_QUOTAS.prospect_create,
}: CampaignServiceDeps) {
  const engine = missions.inTransaction;

  /** Transaction rejouée (3 essais au plus) si MySQL l'annule pour interblocage. */
  async function withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (!isWriteConflict(error) || attempt >= DEADLOCK_RETRIES) throw error;
      }
    }
  }

  /**
   * Somme des objectifs quotidiens des campagnes actives ≤ quota global : chaque campagne active
   * peut alors atteindre le sien. Refuse l'ACTIVATION d'une campagne ou l'AUGMENTATION de son
   * objectif qui la dépasserait ; baisser un objectif ou désactiver reste toujours possible.
   * Toutes les campagnes sont verrouillées : deux modifications simultanées comptent l'une après
   * l'autre (un interblocage éventuel annule l'une d'elles, rejouée par withRetry).
   */
  async function checkTargetsIn(
    tx: Db,
    campaignId: string | null,
    before: { enabled: boolean; dailyTarget: number } | null,
    after: { enabled: boolean; dailyTarget: number },
  ) {
    const rows = await tx.$queryRaw<TargetRow[]>`
      SELECT id, enabled, daily_target FROM prospecting_campaigns FOR UPDATE`;
    const others = rows
      .filter((r) => Boolean(r.enabled) && r.id !== campaignId)
      .reduce((sum, r) => sum + Number(r.daily_target), 0);
    const check = checkCampaignTargets({
      otherActiveTargets: others,
      before: before && { enabled: before.enabled, dailyTarget: before.dailyTarget },
      after: { enabled: after.enabled, dailyTarget: after.dailyTarget },
      globalQuota: globalProspectQuota,
    });
    if (check.allowed) return;
    throw new AppError(
      ERROR_CODES.CAMPAIGN_TARGETS_EXCEED_QUOTA,
      `Objectifs trop élevés : les campagnes actives totalisent déjà ${others} prospects par jour, le quota global est de ${globalProspectQuota}. Objectif possible pour cette campagne : ${check.available} au plus.`,
      409,
      {
        globalQuota: globalProspectQuota,
        activeTargets: others,
        requested: after.dailyTarget,
        available: check.available,
      },
    );
  }

  /** Agent d'une campagne : existant, et rattaché à la salle de prospection ou sans salle. */
  async function checkAgentIn(tx: Db, agentId: string | null) {
    if (agentId === null) return;
    const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { room: true } });
    if (!agent) throw AppError.validation(`Agent inconnu : ${agentId}`);
    if (agent.room !== null && agent.room !== 'prospecting') {
      throw AppError.validation(
        `L’agent ${agentId} travaille dans une autre salle (${agent.room}) : il ne pourrait pas prendre les missions de recherche`,
      );
    }
  }

  /** Pourquoi l'agent attribué ne pourrait pas prendre la mission (null : il le peut). */
  async function agentProblem(agentId: string | null): Promise<string | null> {
    if (agentId === null) return null; // mission libre de la salle de prospection
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { status: true, room: true },
    });
    if (!agent) return `agent ${agentId} introuvable`;
    if (agent.status !== 'active') return `agent ${agentId} désactivé`;
    if (agent.room !== null && agent.room !== 'prospecting') {
      return `agent ${agentId} rattaché à une autre salle (${agent.room})`;
    }
    return null;
  }

  async function load(tx: Db | AppPrismaClient, id: string) {
    const row = await tx.prospectingCampaign.findUnique({ where: { id } });
    if (!row) throw AppError.notFound(`Campagne introuvable : ${id}`);
    return row;
  }

  function nameTaken(name: string): AppError {
    return new AppError(ERROR_CODES.ALREADY_EXISTS, `Une campagne s’appelle déjà « ${name} »`, 409);
  }

  /** Mission de recherche visible de l'agent, et sa campagne (obligatoire). */
  async function campaignMissionFor(missionId: string, agent: AgentMissionScope) {
    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) throw AppError.notFound(`Mission introuvable : ${missionId}`);
    if (!canAgentSeeMission({ agentId: mission.agentId, room: mission.room }, agent)) {
      throw forbidden('Cette mission n’est pas visible de cet agent');
    }
    if (mission.type !== PIPELINE_MISSION_TYPES.search || mission.campaignId === null) {
      throw AppError.validation('Cette mission n’est pas une mission de recherche d’une campagne');
    }
    const campaign = await load(prisma, mission.campaignId);
    return { mission, campaign };
  }

  return {
    // -----------------------------------------------------------------------
    // Utilisateur
    // -----------------------------------------------------------------------

    async list(): Promise<CampaignListResponse> {
      const rows = await prisma.prospectingCampaign.findMany({
        orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      });
      return { items: rows.map(toCampaignDto) };
    },

    async get(id: string): Promise<Campaign> {
      return toCampaignDto(await load(prisma, id));
    },

    async create(request: CreateCampaignInput, actor: Actor): Promise<Campaign> {
      assertHumanActor(actor, 'créer une campagne de prospection');
      const input = createCampaignRequestSchema.parse(request);
      try {
        const row = await withRetry(() =>
          prisma.$transaction(async (tx) => {
            await checkAgentIn(tx, input.agentId);
            await checkTargetsIn(tx, null, null, input);
            const now = clock();
            return tx.prospectingCampaign.create({
              data: { ...input, createdAt: now, updatedAt: now, updatedBy: actor.id ?? 'owner' },
            });
          }),
        );
        return toCampaignDto(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken(input.name);
        throw error;
      }
    },

    /** Modification, activation, désactivation : seuls les champs fournis changent. */
    async update(id: string, request: UpdateCampaignRequest, actor: Actor): Promise<Campaign> {
      assertHumanActor(actor, 'modifier une campagne de prospection');
      const { expectedVersion, ...changes } = request;
      try {
        const row = await withRetry(() =>
          prisma.$transaction(async (tx) => {
            const current = await load(tx, id);
            if (current.version !== expectedVersion) {
              throw new AppError(
                ERROR_CODES.CONCURRENT_MODIFICATION,
                'La campagne a été modifiée entre-temps : rechargez-la puis réessayez',
                409,
                { currentVersion: current.version },
              );
            }
            // Champ absent de la requête : valeur actuelle (null signifie « aucune borne »).
            const next = { ...current, ...changes };
            const { minSubscribers: min, maxSubscribers: max } = next;
            if (min !== null && max !== null && min > max) {
              throw AppError.validation(
                'Le nombre minimum d’abonnés doit être inférieur ou égal au maximum',
              );
            }
            if (changes.agentId !== undefined) await checkAgentIn(tx, changes.agentId);
            await checkTargetsIn(tx, id, current, next);
            const updated = await tx.prospectingCampaign.updateMany({
              where: { id, version: expectedVersion },
              data: {
                ...changes,
                version: { increment: 1 },
                updatedAt: clock(),
                updatedBy: actor.id ?? 'owner',
              },
            });
            if (updated.count === 0) {
              throw new AppError(
                ERROR_CODES.CONCURRENT_MODIFICATION,
                'La campagne a été modifiée entre-temps : rechargez-la puis réessayez',
                409,
              );
            }
            return load(tx, id);
          }),
        );
        return toCampaignDto(row);
      } catch (error) {
        if (isUniqueViolation(error) && changes.name) throw nameTaken(changes.name);
        throw error;
      }
    },

    // -----------------------------------------------------------------------
    // Planification (système)
    // -----------------------------------------------------------------------

    /**
     * Missions du jour : une par campagne active, si elle n'existe pas encore. Les missions de
     * recherche des jours précédents jamais prises (en attente) sont annulées : pas d'arriéré.
     * Rejouable sans risque (index unique campagne + jour).
     */
    async generateDailyMissions(): Promise<{
      created: ScheduledMission[];
      cancelled: ScheduledMission[];
      skipped: SkippedCampaign[];
    }> {
      const now = clock();
      const day = quotaDay(now);
      const created: ScheduledMission[] = [];
      const cancelled: ScheduledMission[] = [];
      const skipped: SkippedCampaign[] = [];
      const campaigns = await prisma.prospectingCampaign.findMany({
        orderBy: { createdAt: 'asc' },
      });

      for (const campaign of campaigns) {
        const stale = await prisma.mission.findMany({
          where: { campaignId: campaign.id, status: 'pending', campaignDay: { lt: day } },
          select: { id: true, campaignDay: true },
        });
        for (const mission of stale) {
          try {
            await prisma.$transaction((tx) =>
              engine.applyAction(
                tx,
                mission.id,
                {
                  action: 'cancel',
                  reason: `Mission du ${mission.campaignDay} jamais prise : remplacée par celle du jour`,
                },
                SYSTEM,
              ),
            );
            cancelled.push({
              campaignId: campaign.id,
              missionId: mission.id,
              day: mission.campaignDay!,
            });
          } catch (error) {
            // Prise entre-temps par un agent : elle n'est plus en attente, on la laisse.
            if (!(error instanceof AppError)) throw error;
          }
        }

        if (!campaign.enabled) continue;
        // Agent attribué hors d'état de prendre la mission (désactivé, ou déplacé dans une autre
        // salle) : aucune mission, signalé. Corrigé, la mission est créée au passage suivant.
        const problem = await agentProblem(campaign.agentId);
        if (problem) {
          skipped.push({ campaignId: campaign.id, day, reason: problem });
          continue;
        }
        const input = createMissionRequestSchema.parse({
          type: PIPELINE_MISSION_TYPES.search,
          room: 'prospecting',
          priority: campaign.priority,
          agentId: campaign.agentId,
          input: { campaignId: campaign.id, campaignName: campaign.name, day },
        });
        try {
          const { mission } = await prisma.$transaction((tx) =>
            engine.create(tx, input, SYSTEM, { id: campaign.id, day }),
          );
          created.push({ campaignId: campaign.id, missionId: mission.id, day });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error; // déjà créée aujourd'hui
        }
      }
      return { created, cancelled, skipped };
    },

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------

    /** Critères ACTUELS de la campagne d'une mission de recherche, et avancement de la mission. */
    async agentContext(missionId: string, agent: AgentMissionScope): Promise<AgentCampaignContext> {
      const { mission, campaign } = await campaignMissionFor(missionId, agent);
      const created = await prisma.prospect.count({ where: { discoveryMissionId: mission.id } });
      const rejected = await prisma.rejectedChannel.count({ where: { missionId: mission.id } });
      const dto = toCampaignDto(campaign);
      return {
        mission: {
          id: mission.id,
          status: mission.status as MissionStatus,
          day: mission.campaignDay ?? quotaDay(mission.createdAt),
        },
        campaign: {
          id: dto.id,
          name: dto.name,
          description: dto.description,
          enabled: dto.enabled,
          version: dto.version,
          themes: dto.themes,
          keywords: dto.keywords,
          languages: dto.languages,
          countries: dto.countries,
          minSubscribers: dto.minSubscribers,
          maxSubscribers: dto.maxSubscribers,
          maxDaysSinceLastVideo: dto.maxDaysSinceLastVideo,
          dailyTarget: dto.dailyTarget,
          reevaluationDays: dto.reevaluationDays,
        },
        progress: { created, remaining: Math.max(0, dto.dailyTarget - created), rejected },
      };
    },

    /**
     * Où en est chaque chaîne candidate : déjà un prospect (toutes campagnes confondues : jamais de
     * second dossier), écartée pour CETTE campagne et pas encore réévaluable, ou nouvelle.
     */
    async lookupChannels(
      query: ChannelLookupQuery,
      agent: AgentMissionScope,
    ): Promise<ChannelLookupResponse> {
      const { campaign } = await campaignMissionFor(query.missionId, agent);
      const now = clock();
      const [prospects, rejections] = await Promise.all([
        prisma.prospect.findMany({
          where: { youtubeChannelId: { in: query.channelIds } },
          select: { id: true, reference: true, youtubeChannelId: true },
        }),
        prisma.rejectedChannel.findMany({
          where: {
            platform: 'youtube',
            campaignId: campaign.id,
            channelId: { in: query.channelIds },
          },
        }),
      ]);
      // Comparaison insensible à la casse, comme la base (collation) et l'index unique.
      const key = (id: string) => id.toLowerCase();
      const prospectOf = new Map(prospects.map((p) => [key(p.youtubeChannelId!), p]));
      const rejectionOf = new Map(rejections.map((r) => [key(r.channelId), r]));
      return {
        items: query.channelIds.map((channelId) => {
          const prospect = prospectOf.get(key(channelId));
          const rejection = rejectionOf.get(key(channelId));
          const active = rejection !== undefined && rejection.reevaluateAfter > now;
          return {
            channelId,
            status: prospect ? 'prospect' : active ? 'rejected' : 'new',
            prospect: prospect ? { id: prospect.id, reference: prospect.reference } : null,
            rejection: rejection
              ? {
                  reasonCode: rejection.reasonCode as RejectionReasonCode,
                  reason: rejection.reason,
                  rejectionCount: rejection.rejectionCount,
                  firstRejectedAt: rejection.firstRejectedAt.toISOString(),
                  rejectedAt: rejection.rejectedAt.toISOString(),
                  reevaluateAfter: rejection.reevaluateAfter.toISOString(),
                }
              : null,
          };
        }),
      };
    },

    /**
     * Chaînes écartées dans SA mission de recherche en cours (vérifiée et verrouillée). Une chaîne
     * déjà écartée pour la campagne est mise à jour : motif, date, compteur, nouvelle réévaluation.
     */
    async recordRejections(input: ChannelRejectionsInput, actor: Actor, hook?: TransactionHook) {
      await prisma.$transaction(async (tx) => {
        await hook?.begin(tx);
        const search = await lockSearchMissionIn(tx, input.missionId, actor);
        if (!search.campaign) {
          throw AppError.validation(
            'Une chaîne n’est écartée que dans une mission de recherche d’une campagne',
          );
        }
        const now = clock();
        const reevaluateAfter = new Date(now.getTime() + search.campaign.reevaluationDays * DAY_MS);
        for (const item of input.items) {
          const last = {
            channelTitle: item.channelTitle,
            missionId: input.missionId,
            agentId: actor.id!,
            reasonCode: item.reasonCode,
            reason: item.reason,
            rejectedAt: now,
            reevaluateAfter,
          };
          await tx.rejectedChannel.upsert({
            where: {
              platform_channelId_campaignId: {
                platform: 'youtube',
                channelId: item.channelId,
                campaignId: search.campaign.id,
              },
            },
            create: {
              ...last,
              platform: 'youtube',
              channelId: item.channelId,
              campaignId: search.campaign.id,
              firstRejectedAt: now,
            },
            update: { ...last, rejectionCount: { increment: 1 } },
          });
        }
        await hook?.end(tx, { type: 'mission', id: input.missionId });
      });
    },
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
