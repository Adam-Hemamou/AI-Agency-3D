import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import {
  ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  idempotencyKeySchema,
} from '@agency/shared';
import { Prisma, type AgentRequest } from '../generated/prisma/client.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import type { TransactionHook, WriteResource } from '../db/transactionHook.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock, type Db } from '../missions/missionService.ts';

/**
 * Protection contre les requêtes répétées (n8n rejoue une requête après un délai dépassé,
 * une coupure réseau, une relance manuelle du workflow…).
 *
 * Chaque écriture d'un agent porte une clé « Idempotency-Key ». La clé est enregistrée DANS la
 * transaction de l'écriture métier, en première instruction :
 * - écriture réussie → la clé et l'écriture sont validées ensemble ;
 * - échec, ou arrêt brutal du serveur avant la fin → tout est annulé ensemble, la clé reste libre ;
 *   aucun état « en cours » ne peut donc rester bloqué ;
 * - même clé, même requête, déjà traitée → l'état ACTUEL de la ressource écrite est renvoyé
 *   (en-tête Idempotent-Replayed), rien n'est refait ;
 * - même clé en même temps → la seconde requête attend la fin de la première (verrou de la base
 *   sur la clé unique), puis reçoit sa réponse ;
 * - même clé, AUTRE requête → 409 IDEMPOTENCY_CONFLICT, rien n'est exécuté.
 *
 * Les clés de plus de RETENTION_DAYS jours sont effacées : une répétition plus tardive serait exécutée.
 */

const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Empreinte stable de la requête : l'ordre des clés du JSON n'a pas d'importance. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([method.toUpperCase(), path, canonical(body)]))
    .digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function conflict(message: string): AppError {
  return new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, message, 409);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * La clé vient d'être validée par une autre transaction : la requête a déjà été traitée.
 * Volontairement PAS une erreur Prisma : les services ne doivent pas la rejouer.
 */
class KeyAlreadyUsed extends Error {
  constructor() {
    super('Clé d’idempotence déjà utilisée');
    this.name = 'KeyAlreadyUsed';
  }
}

export interface IdempotentRequest {
  agentId: string;
  key: string;
  method: string;
  path: string;
  body: unknown;
  /** Statut HTTP de la réponse en cas de succès (201 création, 200 sinon). */
  status: number;
  /**
   * Contrôles exécutés dans la transaction, juste après l'enregistrement de la clé (arrêt
   * d'urgence, quotas) : s'ils échouent, la transaction est annulée et rien n'est modifié.
   */
  beforeWrite?: (tx: Db) => Promise<void>;
}

export interface IdempotentResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

export function createIdempotencyStore(
  prisma: AppPrismaClient,
  { clock = systemClock }: { clock?: Clock } = {},
) {
  function findRecord(agentId: string, key: string) {
    return prisma.agentRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId, idempotencyKey: key } },
    });
  }

  /** Réponse d'une requête déjà traitée : état actuel de la ressource, ou refus. */
  async function replay(
    record: AgentRequest,
    requestHash: string,
    render: (resource: WriteResource) => Promise<unknown>,
  ): Promise<IdempotentResult> {
    if (record.requestHash !== requestHash) {
      throw conflict(
        `La clé ${IDEMPOTENCY_HEADER} « ${record.idempotencyKey} » a déjà servi pour une autre requête : utilisez une nouvelle clé`,
      );
    }
    if (record.status === 'completed' && record.resourceType && record.resourceId) {
      const resource: WriteResource = {
        type: record.resourceType as WriteResource['type'],
        id: record.resourceId,
        eventId: record.eventId,
      };
      return { status: record.responseStatus ?? 200, body: await render(resource), replayed: true };
    }
    // Requêtes enregistrées avant le lot C (réponse complète, ou interrompue « en cours »).
    if (record.status === 'completed' && record.responseStatus !== null) {
      return { status: record.responseStatus, body: record.responseBody, replayed: true };
    }
    throw conflict(
      'Cette requête a été interrompue avant une mise à jour du serveur : vérifiez le dossier, puis utilisez une nouvelle clé',
    );
  }

  return {
    /**
     * Exécute la commande une seule fois pour ce couple (agent, clé).
     * execute reçoit le hook à transmettre au service ; render produit la réponse à partir de
     * la ressource écrite (même chemin pour la première réponse et pour les répétitions).
     */
    async run(
      request: IdempotentRequest,
      execute: (hook: TransactionHook) => Promise<unknown>,
      render: (resource: WriteResource) => Promise<unknown>,
    ): Promise<IdempotentResult> {
      const requestHash = requestFingerprint(request.method, request.path, request.body);
      const now = clock();
      await prisma.agentRequest.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * DAY_MS) } },
      });

      // Déjà traitée : réponse immédiate, sans ouvrir de transaction.
      const known = await findRecord(request.agentId, request.key);
      if (known) return replay(known, requestHash, render);

      // Objet (et non variable) : renseigné par hook.end, lu après la transaction.
      const outcome: { written: WriteResource | null } = { written: null };
      const hook: TransactionHook = {
        async begin(tx) {
          try {
            // createMany et non create : create relit la ligne (SELECT) et figerait la « photo »
            // de la base AVANT les verrous pris ensuite par le service (compteur, dossier) ;
            // les lectures suivantes ne verraient alors pas les écritures simultanées.
            await tx.agentRequest.createMany({
              data: {
                agentId: request.agentId,
                idempotencyKey: request.key,
                requestHash,
                method: request.method.toUpperCase(),
                path: request.path.slice(0, 500),
                status: 'completed',
                responseStatus: request.status,
                createdAt: now,
                completedAt: now,
              },
            });
          } catch (error) {
            // Une requête avec la même clé vient d'être validée (on a attendu son verrou).
            if (isUniqueViolation(error)) throw new KeyAlreadyUsed();
            throw error;
          }
          await request.beforeWrite?.(tx);
        },
        async end(tx, resource) {
          await tx.agentRequest.update({
            where: {
              agentId_idempotencyKey: { agentId: request.agentId, idempotencyKey: request.key },
            },
            data: {
              resourceType: resource.type,
              resourceId: resource.id,
              eventId: resource.eventId ?? null,
            },
          });
          outcome.written = resource;
        },
      };

      try {
        await execute(hook);
      } catch (error) {
        if (!(error instanceof KeyAlreadyUsed)) throw error;
        const record = await findRecord(request.agentId, request.key);
        if (!record) throw conflict('Requête simultanée avec la même clé : réessayez');
        return replay(record, requestHash, render);
      }
      const written = outcome.written;
      if (!written) throw new Error('idempotence : la commande n’a pas appelé hook.end');
      // La réponse est construite APRÈS la validation : si le serveur s'arrête ici, l'écriture
      // est enregistrée avec sa clé, et la répétition de la requête renverra ce résultat.
      return { status: request.status, body: await render(written), replayed: false };
    },
  };
}

export type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

export interface IdempotentCommand {
  /** Statut HTTP en cas de succès. */
  status: number;
  /** Exécute la commande en transmettant le hook au service. */
  execute: (req: Request, res: Response, hook: TransactionHook) => Promise<unknown>;
  /** Réponse construite à partir de la ressource écrite (première réponse et répétitions). */
  render: (resource: WriteResource, res: Response) => Promise<unknown>;
  /** Contrôles dans la transaction (arrêt d'urgence, quotas). */
  beforeWrite?: (tx: Db) => Promise<void>;
}

/** Route d'écriture d'un agent : exige l'en-tête Idempotency-Key et n'exécute la commande qu'une fois. */
export function idempotentCommand(
  store: IdempotencyStore,
  command: IdempotentCommand,
): RequestHandler {
  return async (req, res) => {
    const agentId = res.locals.agent?.agent.id;
    if (!agentId) throw new Error('idempotentCommand : route réservée aux agents authentifiés');
    const raw = req.get(IDEMPOTENCY_HEADER);
    const parsed = idempotencyKeySchema.safeParse(raw);
    if (!parsed.success) {
      throw AppError.validation(
        raw === undefined
          ? `En-tête ${IDEMPOTENCY_HEADER} obligatoire pour toute écriture d'un agent`
          : `En-tête ${IDEMPOTENCY_HEADER} invalide`,
        [{ path: IDEMPOTENCY_HEADER, message: parsed.error.issues[0]?.message ?? 'Invalide' }],
      );
    }
    const result = await store.run(
      {
        agentId,
        key: parsed.data,
        method: req.method,
        path: req.originalUrl,
        body: req.body ?? null,
        status: command.status,
        beforeWrite: command.beforeWrite,
      },
      (hook) => command.execute(req, res, hook),
      (resource) => command.render(resource, res),
    );
    if (result.replayed) res.set(IDEMPOTENT_REPLAY_HEADER, 'true');
    res.status(result.status).json(result.body);
  };
}
