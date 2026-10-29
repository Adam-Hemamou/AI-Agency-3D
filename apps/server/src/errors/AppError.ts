import { ERROR_CODES, type ErrorCode } from '@agency/shared';

/**
 * Erreur applicative identifiée : un code stable, un statut HTTP et un message lisible.
 * Toute erreur prévue doit être levée sous cette forme.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static notFound(message: string): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, message, 404);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, message, 400, details);
  }

  /** À utiliser par tout fournisseur réel lorsque MODE_SIMULATION est actif. */
  static externalActionBlocked(action: string): AppError {
    return new AppError(
      ERROR_CODES.EXTERNAL_ACTION_BLOCKED,
      `Action externe refusée en mode simulation : ${action}`,
      403,
    );
  }
}
