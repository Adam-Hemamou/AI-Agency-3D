import {
  AGENT_MODEL_DEFAULTS,
  isAgentRole,
  type AgentModelSettings,
  type AgentProfile,
  type AgentPrompt,
  type AgentPromptListResponse,
  type AgentSelfProfileResponse,
  type CreateAgentPromptInput,
  type RoomId,
  type UpdateAgentProfileRequest,
} from '@agency/shared';
import type {
  AgentProfile as AgentProfileRow,
  AgentPrompt as AgentPromptRow,
} from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import { assertHumanActor } from '../auth/actors.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Actor, type Clock, type Db } from '../missions/missionService.ts';

export interface AgentProfileServiceDeps {
  prisma: AppPrismaClient;
  clock?: Clock;
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

function settingsOf(row: AgentProfileRow | null): AgentModelSettings {
  if (!row) return { ...AGENT_MODEL_DEFAULTS };
  return {
    model: row.model,
    temperature: row.temperature,
    topP: row.topP,
    topK: row.topK,
    numCtx: row.numCtx,
    numPredict: row.numPredict,
    think: row.think,
    timeoutSeconds: row.timeoutSeconds,
  };
}

function toProfileDto(agentId: string, row: AgentProfileRow | null): AgentProfile {
  return {
    agentId,
    role: row?.role && isAgentRole(row.role) ? row.role : null,
    settings: settingsOf(row),
    activePromptVersion: row?.activePromptVersion ?? null,
    isDefault: row === null,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

function toPromptDto(row: AgentPromptRow, activeVersion: number | null): AgentPrompt {
  return {
    agentId: row.agentId,
    version: row.version,
    systemPrompt: row.systemPrompt,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    active: row.version === activeVersion,
  };
}

function agentNotFound(id: string): AppError {
  return AppError.notFound(`Agent introuvable : ${id}`);
}

/**
 * Profils IA et prompts versionnés : SEUL point d'écriture des tables agent_profiles et
 * agent_prompts.
 * - Toute écriture est réservée à l'utilisateur humain (assertHumanActor) ; les routes de gestion
 *   sont en outre refusées aux agents par la liste blanche (agentAccessGuard).
 * - Un agent lit uniquement SON profil (selfProfile), à partir de l'identité de sa clé.
 * - Une version de prompt n'est jamais modifiée ni supprimée (protégée en base) : modifier le
 *   prompt crée une version ; activer une version, ancienne ou récente, ne change que le profil.
 */
export function createAgentProfileService({
  prisma,
  clock = systemClock,
}: AgentProfileServiceDeps) {
  /**
   * Verrouille la ligne de l'agent jusqu'à la fin de la transaction : les écritures sur le profil
   * et les prompts d'un même agent passent l'une après l'autre (numéros de version sans trou ni
   * doublon). Lève 404 si l'agent n'existe pas.
   */
  async function lockAgent(tx: Db, agentId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM agents WHERE id = ${agentId} FOR UPDATE`;
    if (rows.length === 0) throw agentNotFound(agentId);
  }

  async function assertAgentExists(agentId: string): Promise<void> {
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
    if (!agent) throw agentNotFound(agentId);
  }

  /** Crée le profil avec les valeurs par défaut s'il n'existe pas, dans la transaction. */
  async function ensureProfile(tx: Db, agentId: string, actor: Actor, now: Date) {
    const existing = await tx.agentProfile.findUnique({ where: { agentId } });
    if (existing) return existing;
    return tx.agentProfile.create({
      data: {
        agentId,
        ...AGENT_MODEL_DEFAULTS,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.id ?? actor.type,
      },
    });
  }

  return {
    async getProfile(agentId: string): Promise<AgentProfile> {
      await assertAgentExists(agentId);
      const row = await prisma.agentProfile.findUnique({ where: { agentId } });
      return toProfileDto(agentId, row);
    },

    /** Seuls les champs fournis changent ; un profil absent part des valeurs par défaut. */
    async updateProfile(
      agentId: string,
      request: UpdateAgentProfileRequest,
      actor: Actor,
    ): Promise<AgentProfile> {
      assertHumanActor(actor, 'modifier le profil d’un agent');
      const now = clock();
      const row = await prisma.$transaction(async (tx) => {
        await lockAgent(tx, agentId);
        await ensureProfile(tx, agentId, actor, now);
        return tx.agentProfile.update({
          where: { agentId },
          data: { ...request, updatedAt: now, updatedBy: actor.id ?? actor.type },
        });
      });
      return toProfileDto(agentId, row);
    },

    async listPrompts(agentId: string): Promise<AgentPromptListResponse> {
      await assertAgentExists(agentId);
      const [rows, profile] = await Promise.all([
        prisma.agentPrompt.findMany({ where: { agentId }, orderBy: { version: 'desc' } }),
        prisma.agentProfile.findUnique({ where: { agentId } }),
      ]);
      const active = profile?.activePromptVersion ?? null;
      return { items: rows.map((row) => toPromptDto(row, active)) };
    },

    async getPrompt(agentId: string, version: number): Promise<AgentPrompt> {
      await assertAgentExists(agentId);
      const [row, profile] = await Promise.all([
        prisma.agentPrompt.findUnique({ where: { agentId_version: { agentId, version } } }),
        prisma.agentProfile.findUnique({ where: { agentId } }),
      ]);
      if (!row) throw AppError.notFound(`Version ${version} du prompt introuvable pour ${agentId}`);
      return toPromptDto(row, profile?.activePromptVersion ?? null);
    },

    /** Nouvelle version (numéro suivant). Activée seulement si demandé. */
    async createPrompt(
      agentId: string,
      input: CreateAgentPromptInput,
      actor: Actor,
    ): Promise<AgentPrompt> {
      assertHumanActor(actor, 'modifier le prompt d’un agent');
      const now = clock();
      const by = actor.id ?? actor.type;
      const { row, active } = await prisma.$transaction(async (tx) => {
        await lockAgent(tx, agentId);
        const last = await tx.agentPrompt.findFirst({
          where: { agentId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await tx.agentPrompt.create({
          data: {
            agentId,
            version: (last?.version ?? 0) + 1,
            systemPrompt: input.systemPrompt,
            note: input.note,
            createdAt: now,
            createdBy: by,
          },
        });
        let activeVersion: number | null;
        if (input.activate) {
          await ensureProfile(tx, agentId, actor, now);
          await tx.agentProfile.update({
            where: { agentId },
            data: { activePromptVersion: created.version, updatedAt: now, updatedBy: by },
          });
          activeVersion = created.version;
        } else {
          const profile = await tx.agentProfile.findUnique({ where: { agentId } });
          activeVersion = profile?.activePromptVersion ?? null;
        }
        return { row: created, active: activeVersion };
      });
      return toPromptDto(row, active);
    },

    /** Rend une version existante active (y compris une ancienne : retour arrière). */
    async activatePrompt(agentId: string, version: number, actor: Actor): Promise<AgentProfile> {
      assertHumanActor(actor, 'changer le prompt actif d’un agent');
      const now = clock();
      const row = await prisma.$transaction(async (tx) => {
        await lockAgent(tx, agentId);
        const prompt = await tx.agentPrompt.findUnique({
          where: { agentId_version: { agentId, version } },
          select: { version: true },
        });
        if (!prompt) {
          throw AppError.notFound(`Version ${version} du prompt introuvable pour ${agentId}`);
        }
        await ensureProfile(tx, agentId, actor, now);
        return tx.agentProfile.update({
          where: { agentId },
          data: { activePromptVersion: version, updatedAt: now, updatedBy: actor.id ?? actor.type },
        });
      });
      return toProfileDto(agentId, row);
    },

    /**
     * Profil de l'agent authentifié (GET /api/agent/profile) : identité, paramètres effectifs et
     * prompt actif. Ne prend qu'un identifiant d'agent issu de sa clé, jamais de la requête.
     */
    async selfProfile(agent: {
      id: string;
      name: string;
      room: string | null;
    }): Promise<AgentSelfProfileResponse> {
      const profile = await prisma.agentProfile.findUnique({
        where: { agentId: agent.id },
        include: { activePrompt: true },
      });
      const prompt = profile?.activePrompt ?? null;
      return {
        agent: {
          id: agent.id,
          name: agent.name,
          room: agent.room as RoomId | null,
          role: profile?.role && isAgentRole(profile.role) ? profile.role : null,
        },
        settings: settingsOf(profile),
        prompt: prompt
          ? {
              version: prompt.version,
              systemPrompt: prompt.systemPrompt,
              createdAt: prompt.createdAt.toISOString(),
            }
          : null,
      };
    },
  };
}

export type AgentProfileService = ReturnType<typeof createAgentProfileService>;
