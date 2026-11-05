import {
  ERROR_CODES,
  type Agent,
  type AgentListResponse,
  type CreateAgentInput,
  type IssueAgentKeyInput,
  type IssuedAgentKeyResponse,
  type AgentApiKey,
  type AgentPermission,
  type UpdateAgentRequest,
} from '@agency/shared';
import {
  Prisma,
  type Agent as AgentRow,
  type AgentApiKey as AgentApiKeyRow,
} from '../generated/prisma/client.ts';
import type { Db } from '../missions/missionService.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import { agentActor, assertHumanActor } from '../auth/actors.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Actor, type Clock } from '../missions/missionService.ts';
import { agentKeyMatches, generateAgentKey, parseAgentKey } from './agentKeys.ts';
import { toAgentDto, toAgentKeyDto, toPermissionList } from './serializers.ts';

export interface AgentServiceDeps {
  prisma: AppPrismaClient;
  clock?: Clock;
}

/** Résultat d'une authentification réussie. */
export interface AuthenticatedAgent {
  /** Identité à utiliser pour toute action : toujours de type "agent". */
  actor: Actor;
  agent: AgentRow;
  key: AgentApiKeyRow;
  /** Permissions accordées par l'utilisateur, lues à chaque requête. */
  permissions: ReadonlySet<AgentPermission>;
}

/** La date de dernière utilisation n'est réécrite qu'au-delà de ce délai (évite une écriture par requête). */
const LAST_USED_REFRESH_MS = 60_000;
/** Nouvel essai si deux clés tirent par hasard le même identifiant public. */
const KEY_GENERATION_ATTEMPTS = 3;

const WITH_KEYS = {
  apiKeys: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  permissions: true,
} satisfies Prisma.AgentInclude;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function agentNotFound(id: string): AppError {
  return AppError.notFound(`Agent introuvable : ${id}`);
}

/**
 * Service des agents : SEUL point d'écriture des tables agents et agent_api_keys.
 * - Seul l'utilisateur humain gère les agents et leurs clés (un agent ne peut ni se créer
 *   de clé, ni en révoquer, ni modifier son statut).
 * - Les clés ne sont jamais stockées en clair et ne sont affichées qu'une fois, à leur création.
 */
export function createAgentService({ prisma, clock = systemClock }: AgentServiceDeps) {
  async function replacePermissions(
    tx: Db,
    agentId: string,
    permissions: readonly AgentPermission[],
    now: Date,
  ) {
    await tx.agentPermission.deleteMany({ where: { agentId } });
    if (permissions.length > 0) {
      await tx.agentPermission.createMany({
        data: permissions.map((permission) => ({ agentId, permission, grantedAt: now })),
      });
    }
  }

  async function loadWithKeys(id: string) {
    const row = await prisma.agent.findUnique({ where: { id }, include: WITH_KEYS });
    if (!row) throw agentNotFound(id);
    return row;
  }

  return {
    async list(): Promise<AgentListResponse> {
      const rows = await prisma.agent.findMany({ orderBy: { id: 'asc' }, include: WITH_KEYS });
      return { items: rows.map(toAgentDto) };
    },

    async get(id: string): Promise<Agent> {
      return toAgentDto(await loadWithKeys(id));
    },

    async create(input: CreateAgentInput, actor: Actor): Promise<Agent> {
      assertHumanActor(actor, 'créer un agent');
      const now = clock();
      try {
        const { permissions, ...identity } = input;
        const row = await prisma.agent.create({
          data: {
            ...identity,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            permissions: {
              create: permissions.map((permission) => ({ permission, grantedAt: now })),
            },
          },
          include: WITH_KEYS,
        });
        return toAgentDto(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(
            ERROR_CODES.ALREADY_EXISTS,
            `Un agent porte déjà l'identifiant ${input.id}`,
            409,
          );
        }
        throw error;
      }
    },

    async update(id: string, request: UpdateAgentRequest, actor: Actor): Promise<Agent> {
      assertHumanActor(actor, 'modifier un agent');
      await loadWithKeys(id);
      const { permissions, ...fields } = request;
      const now = clock();
      await prisma.$transaction(async (tx) => {
        await tx.agent.update({ where: { id }, data: { ...fields, updatedAt: now } });
        if (permissions) await replacePermissions(tx, id, permissions, now);
      });
      return toAgentDto(await loadWithKeys(id));
    },

    /** Crée une clé. La clé complète figure UNIQUEMENT dans cette réponse. */
    async issueKey(
      agentId: string,
      input: IssueAgentKeyInput,
      actor: Actor,
    ): Promise<IssuedAgentKeyResponse> {
      assertHumanActor(actor, 'créer une clé API d’agent');
      const agent = await loadWithKeys(agentId);
      if (agent.status !== 'active') {
        throw new AppError(
          ERROR_CODES.INVALID_TRANSITION,
          `L'agent ${agentId} est désactivé : réactivez-le avant de lui créer une clé`,
          409,
        );
      }
      const now = clock();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt <= now) {
        throw AppError.validation('Clé API invalide', [
          { path: 'expiresAt', message: 'La date d’expiration doit être dans le futur' },
        ]);
      }

      for (let attempt = 1; ; attempt++) {
        const generated = generateAgentKey();
        try {
          const key = await prisma.agentApiKey.create({
            data: {
              agentId,
              prefix: generated.prefix,
              secretHash: generated.secretHash,
              label: input.label,
              createdAt: now,
              expiresAt,
            },
          });
          return { key: toAgentKeyDto(key), apiKey: generated.apiKey };
        } catch (error) {
          if (!isUniqueViolation(error) || attempt >= KEY_GENERATION_ATTEMPTS) throw error;
        }
      }
    },

    /** Révoque une clé, définitivement. Révoquer une clé déjà révoquée ne change rien. */
    async revokeKey(agentId: string, keyId: string, actor: Actor): Promise<AgentApiKey> {
      assertHumanActor(actor, 'révoquer une clé API d’agent');
      const key = await prisma.agentApiKey.findUnique({ where: { id: keyId } });
      if (!key || key.agentId !== agentId) {
        throw AppError.notFound(`Clé introuvable pour l'agent ${agentId} : ${keyId}`);
      }
      if (key.revokedAt) return toAgentKeyDto(key);
      await prisma.agentApiKey.updateMany({
        where: { id: keyId, revokedAt: null },
        data: { revokedAt: clock() },
      });
      return toAgentKeyDto(await prisma.agentApiKey.findUniqueOrThrow({ where: { id: keyId } }));
    },

    /**
     * Identifie l'agent qui présente une clé. Renvoie null si la clé est mal formée, inconnue,
     * erronée, révoquée, expirée, ou si l'agent est désactivé (sans dire laquelle de ces raisons).
     */
    async authenticate(apiKey: string): Promise<AuthenticatedAgent | null> {
      const parsed = parseAgentKey(apiKey);
      if (!parsed) return null;
      const key = await prisma.agentApiKey.findUnique({
        where: { prefix: parsed.prefix },
        include: { agent: { include: { permissions: true } } },
      });
      if (!key || !agentKeyMatches(apiKey, key.secretHash)) return null;

      const now = clock();
      if (key.revokedAt) return null;
      if (key.expiresAt && key.expiresAt <= now) return null;
      if (key.agent.status !== 'active') return null;

      if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
        await prisma.agentApiKey.updateMany({
          where: { id: key.id, revokedAt: null },
          data: { lastUsedAt: now },
        });
        key.lastUsedAt = now;
      }
      const { agent, ...keyRow } = key;
      const { permissions, ...agentRow } = agent;
      return {
        actor: agentActor(agent.id),
        agent: agentRow,
        key: keyRow,
        permissions: new Set(toPermissionList(permissions)),
      };
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
