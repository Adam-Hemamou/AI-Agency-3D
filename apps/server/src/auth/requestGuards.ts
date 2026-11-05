import type { Request, RequestHandler } from 'express';
import { ERROR_CODES } from '@agency/shared';
import { AppError } from '../errors/AppError.ts';

/**
 * Protections contre les requêtes venant d'ailleurs que de l'interface du CRM.
 *
 * - hostGuard : l'en-tête Host doit désigner la machine locale (ou un nom explicitement autorisé).
 *   Bloque le « DNS rebinding » : une page web malveillante qui ferait pointer son propre nom
 *   de domaine vers 127.0.0.1 pour atteindre l'API depuis le navigateur.
 * - originGuard : toute écriture faite avec la session humaine (cookie) doit venir de la même
 *   origine que l'API (en-tête Origin identique à Host, port compris). Une autre application
 *   locale (autre port de localhost) ne peut donc pas agir avec votre session.
 * - requireAuthentication : refus par défaut de toute requête sans identité, sauf routes publiques.
 */

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/** Nom d'hôte de l'en-tête Host, sans le port, en minuscules. */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

export function hostGuard(extraHostnames: readonly string[] = []): RequestHandler {
  const allowed = new Set([...LOCAL_HOSTNAMES, ...extraHostnames.map((h) => h.toLowerCase())]);
  return (req, _res, next) => {
    const host = req.headers.host;
    if (!host || !allowed.has(hostnameOf(host))) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN_ORIGIN,
        `Adresse non autorisée : ${host ?? '(aucune)'}`,
        403,
      );
    }
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** L'origine déclarée par le navigateur correspond-elle exactement à l'API (schéma, hôte, port) ? */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  return origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

/**
 * Écritures portées par le cookie de session (et la connexion elle-même) : même origine exigée.
 * Les requêtes d'agents (clé dans Authorization) n'ont pas de cookie implicite : non concernées.
 */
export function originGuard(isCookieRequest: (req: Request) => boolean): RequestHandler {
  return (req, _res, next) => {
    if (!SAFE_METHODS.has(req.method) && isCookieRequest(req) && !isSameOrigin(req)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN_ORIGIN,
        'Requête refusée : elle ne vient pas de l’interface du CRM',
        403,
      );
    }
    next();
  };
}

/** Routes accessibles sans identité. */
const PUBLIC_ROUTES: readonly { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/api\/health\/?$/ },
  { method: 'GET', pattern: /^\/api\/auth\/session\/?$/ },
  { method: 'POST', pattern: /^\/api\/auth\/login\/?$/ },
];

export function isPublicRoute(method: string, path: string): boolean {
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return PUBLIC_ROUTES.some((r) => r.method === verb && r.pattern.test(path));
}

export const requireAuthentication: RequestHandler = (req, res, next) => {
  if (!res.locals.actor && !isPublicRoute(req.method, req.path)) {
    throw new AppError(
      ERROR_CODES.UNAUTHENTICATED,
      'Authentification requise : connectez-vous à l’interface, ou présentez une clé API d’agent',
      401,
    );
  }
  next();
};
