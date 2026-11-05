import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ERROR_CODES, type ApiErrorBody } from '@agency/shared';
import { isDatabaseUnavailable } from '../db/errors.ts';
import { logger } from '../lib/logger.ts';
import { AppError } from './AppError.ts';

/** Route inconnue → 404 au format d'erreur standard. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route introuvable : ${req.method} ${req.path}`));
};

/** Convertit toute erreur en réponse JSON { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof AppError) {
    const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)
      ?.retryAfterSeconds;
    if (typeof retryAfter === 'number') res.set('Retry-After', String(retryAfter));
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    if (err.httpStatus >= 500) logger.error(`${req.method} ${req.path} → ${err.code}`, err);
    res.status(err.httpStatus).json(body);
    return;
  }

  // JSON mal formé envoyé par le client.
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ApiErrorBody = {
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Corps de requête JSON invalide' },
    };
    res.status(400).json(body);
    return;
  }

  // Base injoignable : erreur d'infrastructure identifiée, pas un bug.
  if (isDatabaseUnavailable(err)) {
    logger.error(`${req.method} ${req.path} → base de données injoignable`);
    const body: ApiErrorBody = {
      error: {
        code: ERROR_CODES.DATABASE_UNAVAILABLE,
        message: 'Base de données injoignable : vérifiez que MySQL est démarré',
      },
    };
    res.status(503).json(body);
    return;
  }

  // Erreur imprévue : détail dans les journaux, message générique pour le client.
  logger.error(`${req.method} ${req.path} → erreur inattendue`, err);
  const body: ApiErrorBody = {
    error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Erreur interne du serveur' },
  };
  res.status(500).json(body);
};
