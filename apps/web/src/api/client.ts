import type { z } from 'zod';
import type { ErrorCode } from '@agency/shared';

/** Erreur côté interface : porte le code renvoyé par l'API quand il existe. */
export class ApiClientError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  readonly status?: number;

  constructor(code: ApiClientError['code'], message: string, status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

interface FetchJsonOptions {
  /** Statuts HTTP non-2xx dont le corps doit quand même être lu comme une réponse valide. */
  acceptStatuses?: number[];
  signal?: AbortSignal;
}

/**
 * GET JSON + validation du corps avec un schéma Zod partagé.
 * Toute réponse inattendue devient une ApiClientError identifiée.
 */
export async function fetchJson<T>(
  path: string,
  schema: z.ZodType<T>,
  { acceptStatuses = [], signal }: FetchJsonOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' }, signal });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'Le serveur est injoignable');
  }

  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok && !acceptStatuses.includes(res.status)) {
    const apiError = (body as { error?: { code?: ErrorCode; message?: string } } | undefined)
      ?.error;
    throw new ApiClientError(
      apiError?.code ?? 'INTERNAL_ERROR',
      apiError?.message ?? `Erreur HTTP ${res.status}`,
      res.status,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError('INVALID_RESPONSE', 'Réponse du serveur inattendue', res.status);
  }
  return parsed.data;
}
