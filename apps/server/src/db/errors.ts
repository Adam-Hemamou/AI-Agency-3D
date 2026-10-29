/**
 * Reconnaît une erreur Prisma signifiant « base de données injoignable »,
 * pour la distinguer d'un bug (500) et renvoyer DATABASE_UNAVAILABLE (503).
 */

/** Codes Prisma de connexion impossible / perdue / délai dépassé. */
const PRISMA_CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

/** Codes du pilote MariaDB : délai d'obtention de connexion, connexion fermée, délai de connexion. */
const DRIVER_CONNECTION_CODES = new Set([45028, 45009, 45012]);

const NETWORK_ERROR_PATTERN = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH/;

/** P2028 n'est retenu que pour ce message : aucune connexion obtenue pour ouvrir la transaction. */
const TRANSACTION_START_TIMEOUT = /Unable to start a transaction in the given time/;

interface MaybePrismaError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  meta?: { driverAdapterError?: { cause?: { code?: unknown; cause?: unknown } } };
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as MaybePrismaError;

  if (err.name === 'PrismaClientInitializationError') return true;
  if (typeof err.code === 'string' && PRISMA_CONNECTION_CODES.has(err.code)) return true;
  if (
    err.code === 'P2028' &&
    typeof err.message === 'string' &&
    TRANSACTION_START_TIMEOUT.test(err.message)
  ) {
    return true;
  }

  const driverCause = err.meta?.driverAdapterError?.cause;
  if (!driverCause) return false;
  if (typeof driverCause.code === 'number' && DRIVER_CONNECTION_CODES.has(driverCause.code)) {
    return true;
  }
  return typeof driverCause.cause === 'string' && NETWORK_ERROR_PATTERN.test(driverCause.cause);
}
