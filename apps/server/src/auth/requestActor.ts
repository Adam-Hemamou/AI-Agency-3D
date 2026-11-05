import type { Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, SESSION_COOKIE_NAME } from '@agency/shared';
import type { AgentService, AuthenticatedAgent } from '../agents/agentService.ts';
import { AppError } from '../errors/AppError.ts';
import type { Actor } from '../missions/missionService.ts';
import { HUMAN_ACTOR } from './actors.ts';
import type { OwnerAuthService, OwnerSessionInfo } from './ownerAuth.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Auteur de la requête, fixé par identifyRequest. */
      actor?: Actor;
      /** Renseigné uniquement pour une requête authentifiée par une clé d'agent. */
      agent?: AuthenticatedAgent;
      /** Renseigné uniquement pour une requête portée par une session humaine valide. */
      ownerSession?: OwnerSessionInfo;
    }
  }
}

/**
 * En-têtes qui ressemblent à une clé API. Ils sont refusés plutôt qu'ignorés : une clé
 * mal placée ne doit jamais faire passer un agent pour l'humain.
 */
const MISPLACED_KEY_HEADERS = ['x-api-key', 'x-agent-key', 'api-key'] as const;

const BEARER = /^Bearer[ \t]+(\S+)$/i;

function unauthenticated(message: string): AppError {
  return new AppError(ERROR_CODES.UNAUTHENTICATED, message, 401);
}

/** Valeur d'un cookie de l'en-tête Cookie (sans dépendance supplémentaire). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return ''; // Cookie mal encodé : présent, mais ne correspond à aucune session.
      }
    }
  }
  return undefined;
}

/** La requête porte-t-elle le cookie de session humaine (valide ou non) ? */
export function hasSessionCookie(req: Request): boolean {
  return readCookie(req, SESSION_COOKIE_NAME) !== undefined;
}

/**
 * Détermine l'auteur de chaque requête, à partir de ses seules preuves d'identité :
 * - « Authorization: Bearer agk_… » valide → l'agent propriétaire de la clé ;
 * - toute autre forme de clé (invalide, révoquée, expirée, autre schéma, en-tête mal placé)
 *   → 401, JAMAIS un repli sur l'identité humaine ;
 * - clé d'agent ET cookie de session dans la même requête → 401 (identité ambiguë) ;
 * - cookie de session humaine valide → l'utilisateur ;
 * - sinon → aucune identité : requireAuthentication refusera tout sauf les routes publiques.
 *
 * Le corps et les paramètres de la requête ne jouent aucun rôle : impossible de s'y déclarer
 * « utilisateur » ou de choisir son identité.
 */
export function identifyRequest(
  agents: AgentService | undefined,
  owner: OwnerAuthService | undefined,
): RequestHandler {
  return async (req, res, next) => {
    for (const header of MISPLACED_KEY_HEADERS) {
      if (req.headers[header] !== undefined) {
        throw unauthenticated(
          `En-tête « ${header} » non pris en charge : utilisez « Authorization: Bearer <clé API> »`,
        );
      }
    }

    const authorization = req.headers.authorization;
    if (authorization !== undefined) {
      if (hasSessionCookie(req)) {
        throw unauthenticated('Requête ambiguë : clé d’agent et session humaine à la fois');
      }
      const token = BEARER.exec(authorization.trim())?.[1];
      if (!token) {
        throw unauthenticated('En-tête Authorization invalide : attendu « Bearer <clé API> »');
      }
      const authenticated = agents ? await agents.authenticate(token) : null;
      if (!authenticated) throw unauthenticated('Clé API invalide, expirée ou révoquée');
      res.locals.actor = authenticated.actor;
      res.locals.agent = authenticated;
      next();
      return;
    }

    const sessionToken = readCookie(req, SESSION_COOKIE_NAME);
    const session = sessionToken && owner ? await owner.authenticate(sessionToken) : null;
    if (session) {
      res.locals.actor = HUMAN_ACTOR;
      res.locals.ownerSession = session;
    }
    next();
  };
}

/** Auteur de la requête. Erreur si identifyRequest n'est pas passé (jamais d'identité par défaut). */
export function actorOf(res: Response): Actor {
  const actor = res.locals.actor;
  if (!actor) throw new Error('Auteur de la requête inconnu : identifyRequest doit être appliqué');
  return actor;
}
