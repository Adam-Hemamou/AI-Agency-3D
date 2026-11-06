import { ERROR_CODES } from './errors';
import { MISSION_STATUS_LABELS, type ActorType, type MissionStatus } from './missions';

/**
 * Cycle de vie des missions : SOURCE UNIQUE des règles de transition.
 * Le serveur les applique (seul habilité à modifier une mission) ;
 * l'interface les utilise pour n'afficher que les actions possibles.
 */

/** Actions de cycle de vie (hors validation humaine). */
export const MISSION_ACTIONS = [
  'start',
  'pause',
  'resume',
  'submit_for_validation',
  'complete',
  'block',
  'unblock',
  'cancel',
  /**
   * Remise en attente après l'échec d'une exécution (Phase 2) : RÉSERVÉE AU SYSTÈME, et refusée
   * par le moteur si la mission a déjà produit un effet depuis son démarrage ou s'il ne reste
   * aucune tentative. Jamais proposée dans l'interface (SYSTEM_MISSION_ACTIONS).
   */
  'release',
] as const;
export type MissionAction = (typeof MISSION_ACTIONS)[number];

/** Actions que seul le système peut effectuer : jamais proposées comme « disponibles ». */
export const SYSTEM_MISSION_ACTIONS: readonly MissionAction[] = ['release'];

export const MISSION_ACTION_LABELS: Record<MissionAction, string> = {
  start: 'Démarrer',
  pause: 'Mettre en pause',
  resume: 'Reprendre',
  submit_for_validation: 'Soumettre à validation',
  complete: 'Terminer',
  block: 'Bloquer',
  unblock: 'Débloquer',
  cancel: 'Annuler',
  release: 'Remettre en attente',
};

interface Transition {
  from: readonly MissionStatus[];
  to: MissionStatus;
}

export const MISSION_TRANSITIONS: Record<MissionAction, Transition> = {
  start: { from: ['pending'], to: 'in_progress' },
  pause: { from: ['in_progress'], to: 'paused' },
  resume: { from: ['paused'], to: 'in_progress' },
  submit_for_validation: { from: ['in_progress'], to: 'awaiting_validation' },
  complete: { from: ['in_progress'], to: 'completed' },
  block: { from: ['pending', 'in_progress'], to: 'blocked' },
  unblock: { from: ['blocked'], to: 'pending' },
  release: { from: ['in_progress'], to: 'pending' },
  cancel: {
    from: ['pending', 'in_progress', 'awaiting_validation', 'paused', 'blocked'],
    to: 'cancelled',
  },
};

/** Décisions de validation humaine, possibles uniquement depuis "awaiting_validation". */
export const VALIDATION_DECISIONS = ['approve', 'request_changes', 'reject'] as const;
export type ValidationDecision = (typeof VALIDATION_DECISIONS)[number];

/** Résultat de validation enregistré sur la mission. */
export const VALIDATION_OUTCOMES = ['approved', 'changes_requested', 'rejected'] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

export const VALIDATION_DECISION_LABELS: Record<ValidationDecision, string> = {
  approve: 'Approuver',
  request_changes: 'Demander des modifications',
  reject: 'Refuser',
};

export const VALIDATION_TRANSITIONS: Record<
  ValidationDecision,
  { from: 'awaiting_validation'; to: MissionStatus; outcome: ValidationOutcome }
> = {
  approve: { from: 'awaiting_validation', to: 'completed', outcome: 'approved' },
  request_changes: { from: 'awaiting_validation', to: 'in_progress', outcome: 'changes_requested' },
  reject: { from: 'awaiting_validation', to: 'cancelled', outcome: 'rejected' },
};

/** Seul un humain peut rendre une décision de validation. */
export const VALIDATION_ACTOR: ActorType = 'user';

/** Actions et décisions pour lesquelles un motif écrit est obligatoire (traçabilité). */
export const ACTIONS_REQUIRING_REASON: readonly MissionAction[] = ['block', 'cancel', 'release'];
export const DECISIONS_REQUIRING_REASON: readonly ValidationDecision[] = [
  'request_changes',
  'reject',
];

/** Actions qui peuvent transmettre un résultat (output). */
export const ACTIONS_WITH_OUTPUT: readonly MissionAction[] = ['submit_for_validation', 'complete'];

/** Toutes les actions qui peuvent apparaître dans l'historique. */
export const MISSION_EVENT_ACTIONS = [
  'created',
  ...MISSION_ACTIONS,
  ...VALIDATION_DECISIONS,
] as const;
export type MissionEventAction = (typeof MISSION_EVENT_ACTIONS)[number];

/** Ce dont les règles ont besoin pour décider. */
export interface MissionLifecycleState {
  status: MissionStatus;
  requiresValidation: boolean;
  attemptCount: number;
  maxAttempts: number;
}

export type LifecycleRefusalCode =
  | typeof ERROR_CODES.INVALID_TRANSITION
  | typeof ERROR_CODES.VALIDATION_REQUIRED
  | typeof ERROR_CODES.MAX_ATTEMPTS_REACHED;

export type ActionCheck =
  | { allowed: true; to: MissionStatus }
  | { allowed: false; code: LifecycleRefusalCode; message: string };

function invalid(action: string, status: MissionStatus): ActionCheck {
  return {
    allowed: false,
    code: ERROR_CODES.INVALID_TRANSITION,
    message: `Action « ${action} » impossible depuis le statut « ${MISSION_STATUS_LABELS[status]} »`,
  };
}

/** Vérifie si une action de cycle de vie est permise dans l'état donné. */
export function checkMissionAction(
  state: MissionLifecycleState,
  action: MissionAction,
): ActionCheck {
  const transition = MISSION_TRANSITIONS[action];
  if (!transition.from.includes(state.status)) return invalid(action, state.status);

  if (action === 'complete' && state.requiresValidation) {
    return {
      allowed: false,
      code: ERROR_CODES.VALIDATION_REQUIRED,
      message:
        'Cette mission exige une validation humaine : elle doit être soumise à validation puis approuvée',
    };
  }

  if (action === 'submit_for_validation' && !state.requiresValidation) {
    return {
      allowed: false,
      code: ERROR_CODES.INVALID_TRANSITION,
      message: "Cette mission n'exige pas de validation : elle peut être terminée directement",
    };
  }

  if (action === 'start' && state.attemptCount >= state.maxAttempts) {
    return {
      allowed: false,
      code: ERROR_CODES.MAX_ATTEMPTS_REACHED,
      message: `Nombre maximal de tentatives atteint (${state.maxAttempts})`,
    };
  }

  // Remettre en attente une mission qui ne pourrait plus redémarrer n'aurait pas de sens.
  if (action === 'release' && state.attemptCount >= state.maxAttempts) {
    return {
      allowed: false,
      code: ERROR_CODES.MAX_ATTEMPTS_REACHED,
      message: `Plus aucune tentative possible (${state.maxAttempts}) : la mission doit être bloquée`,
    };
  }

  return { allowed: true, to: transition.to };
}

/** Vérifie si une décision de validation est permise dans l'état donné. */
export function checkValidationDecision(
  state: MissionLifecycleState,
  decision: ValidationDecision,
): ActionCheck {
  const transition = VALIDATION_TRANSITIONS[decision];
  if (state.status !== transition.from) return invalid(decision, state.status);
  return { allowed: true, to: transition.to };
}

/**
 * Actions de cycle de vie actuellement possibles (pour l'affichage des boutons). Les actions
 * réservées au système (SYSTEM_MISSION_ACTIONS) n'y figurent jamais.
 */
export function getAvailableActions(state: MissionLifecycleState): MissionAction[] {
  return MISSION_ACTIONS.filter(
    (action) =>
      !SYSTEM_MISSION_ACTIONS.includes(action) && checkMissionAction(state, action).allowed,
  );
}

/** Décisions de validation actuellement possibles. */
export function getAvailableDecisions(state: MissionLifecycleState): ValidationDecision[] {
  return VALIDATION_DECISIONS.filter((d) => checkValidationDecision(state, d).allowed);
}
