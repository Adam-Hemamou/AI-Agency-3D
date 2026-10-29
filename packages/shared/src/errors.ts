/**
 * Codes d'erreur centralisés. Chaque erreur renvoyée par l'API porte l'un de ces codes,
 * ce qui permet de l'identifier clairement côté interface et dans l'historique.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  /** Une action externe réelle a été tentée alors que MODE_SIMULATION est actif. */
  EXTERNAL_ACTION_BLOCKED: 'EXTERNAL_ACTION_BLOCKED',
  /** Changement de statut interdit par le cycle de vie. */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /** Tentative de terminer une mission qui exige une validation humaine. */
  VALIDATION_REQUIRED: 'VALIDATION_REQUIRED',
  /** Nombre maximal de tentatives d'exécution atteint. */
  MAX_ATTEMPTS_REACHED: 'MAX_ATTEMPTS_REACHED',
  /** L'origine du changement n'a pas le droit d'effectuer cette action (ex. : un agent qui valide). */
  FORBIDDEN_ACTOR: 'FORBIDDEN_ACTOR',
  /** La mission a été modifiée entre-temps (version attendue différente). */
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Format unique des réponses d'erreur de l'API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
