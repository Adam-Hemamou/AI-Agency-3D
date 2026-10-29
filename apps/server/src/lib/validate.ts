import type { z } from 'zod';
import { AppError } from '../errors/AppError.ts';

/**
 * Valide des données avec un schéma Zod partagé.
 * En cas d'échec : erreur VALIDATION_ERROR (400) listant chaque champ fautif.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  data: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(
      `${what} invalide`,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
