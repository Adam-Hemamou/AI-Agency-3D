/**
 * Statuts possibles d'une mission, communs à toutes les salles.
 * Les règles de transition sont définies dans `missionLifecycle.ts`.
 */
export const MISSION_STATUSES = [
  'pending',
  'in_progress',
  'awaiting_validation',
  'paused',
  'completed',
  'cancelled',
  'blocked',
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

/** Libellés affichés dans l'interface. */
export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  pending: 'En attente',
  in_progress: 'En cours',
  awaiting_validation: 'En attente de validation',
  paused: 'En pause',
  completed: 'Terminée',
  cancelled: 'Annulée',
  blocked: 'Bloquée',
};

/** Statuts après lesquels une mission n'évolue plus. */
export const FINAL_MISSION_STATUSES: readonly MissionStatus[] = ['completed', 'cancelled'];

export function isMissionStatus(value: unknown): value is MissionStatus {
  return typeof value === 'string' && (MISSION_STATUSES as readonly string[]).includes(value);
}

/** Priorité : entier de 1 (très basse) à 5 (critique). */
export const MISSION_PRIORITY = { MIN: 1, MAX: 5, DEFAULT: 3 } as const;

/** Nombre maximal de tentatives d'exécution d'une mission. */
export const MISSION_ATTEMPTS = { MIN: 1, MAX: 10, DEFAULT: 3 } as const;

/** Origine d'un changement : l'utilisateur (humain), un agent IA ou le système. */
export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ACTOR_TYPE_LABELS: Record<ActorType, string> = {
  user: 'Utilisateur',
  agent: 'Agent',
  system: 'Système',
};
