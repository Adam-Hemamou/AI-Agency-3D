import { describe, expect, it } from 'vitest';
import {
  MISSION_ACTIONS,
  VALIDATION_DECISIONS,
  checkMissionAction,
  checkValidationDecision,
  getAvailableActions,
  getAvailableDecisions,
  type MissionAction,
  type MissionLifecycleState,
} from './missionLifecycle';
import { FINAL_MISSION_STATUSES, MISSION_STATUSES, type MissionStatus } from './missions';

function state(
  status: MissionStatus,
  overrides: Partial<MissionLifecycleState> = {},
): MissionLifecycleState {
  return { status, requiresValidation: false, attemptCount: 0, maxAttempts: 3, ...overrides };
}

/**
 * Matrice de référence (mission SANS validation obligatoire) :
 * pour chaque statut, les actions autorisées et leur statut d'arrivée.
 * Toute combinaison absente doit être refusée.
 */
const EXPECTED: Record<MissionStatus, Partial<Record<MissionAction, MissionStatus>>> = {
  pending: { start: 'in_progress', block: 'blocked', cancel: 'cancelled' },
  in_progress: {
    pause: 'paused',
    complete: 'completed',
    block: 'blocked',
    cancel: 'cancelled',
  },
  awaiting_validation: { cancel: 'cancelled' },
  paused: { resume: 'in_progress', cancel: 'cancelled' },
  blocked: { unblock: 'pending', cancel: 'cancelled' },
  completed: {},
  cancelled: {},
};

describe('matrice des transitions (sans validation obligatoire)', () => {
  for (const status of MISSION_STATUSES) {
    for (const action of MISSION_ACTIONS) {
      const expectedTo = EXPECTED[status][action];
      it(`${status} + ${action} → ${expectedTo ?? 'refusé'}`, () => {
        const result = checkMissionAction(state(status), action);
        if (expectedTo) {
          expect(result).toEqual({ allowed: true, to: expectedTo });
        } else {
          expect(result.allowed).toBe(false);
        }
      });
    }
  }
});

describe('validation humaine obligatoire', () => {
  const required = { requiresValidation: true };

  it('interdit de terminer directement une mission qui exige une validation', () => {
    expect(checkMissionAction(state('in_progress', required), 'complete')).toMatchObject({
      allowed: false,
      code: 'VALIDATION_REQUIRED',
    });
  });

  it('permet de la soumettre à validation', () => {
    expect(checkMissionAction(state('in_progress', required), 'submit_for_validation')).toEqual({
      allowed: true,
      to: 'awaiting_validation',
    });
  });

  it('refuse la soumission si aucune validation n’est requise', () => {
    expect(checkMissionAction(state('in_progress'), 'submit_for_validation')).toMatchObject({
      allowed: false,
      code: 'INVALID_TRANSITION',
    });
  });

  it('propose "soumettre" et non "terminer" pour une mission en cours à valider', () => {
    const actions = getAvailableActions(state('in_progress', required));
    expect(actions).toContain('submit_for_validation');
    expect(actions).not.toContain('complete');
  });

  it('applique les décisions depuis "en attente de validation"', () => {
    const s = state('awaiting_validation', required);
    expect(checkValidationDecision(s, 'approve')).toEqual({ allowed: true, to: 'completed' });
    expect(checkValidationDecision(s, 'request_changes')).toEqual({
      allowed: true,
      to: 'in_progress',
    });
    expect(checkValidationDecision(s, 'reject')).toEqual({ allowed: true, to: 'cancelled' });
  });

  it('refuse toute décision hors de "en attente de validation"', () => {
    for (const status of MISSION_STATUSES.filter((s) => s !== 'awaiting_validation')) {
      for (const decision of VALIDATION_DECISIONS) {
        expect(checkValidationDecision(state(status, required), decision)).toMatchObject({
          allowed: false,
          code: 'INVALID_TRANSITION',
        });
      }
    }
  });

  it('ne propose de décisions qu’en attente de validation', () => {
    expect(getAvailableDecisions(state('awaiting_validation', required))).toEqual([
      ...VALIDATION_DECISIONS,
    ]);
    expect(getAvailableDecisions(state('in_progress', required))).toEqual([]);
  });
});

describe('tentatives', () => {
  it('refuse de démarrer quand le maximum de tentatives est atteint', () => {
    expect(
      checkMissionAction(state('pending', { attemptCount: 3, maxAttempts: 3 }), 'start'),
    ).toMatchObject({ allowed: false, code: 'MAX_ATTEMPTS_REACHED' });
  });

  it('autorise le démarrage tant qu’il reste des tentatives', () => {
    expect(
      checkMissionAction(state('pending', { attemptCount: 2, maxAttempts: 3 }), 'start').allowed,
    ).toBe(true);
  });
});

describe('états finaux', () => {
  it('aucune action ni décision possible sur une mission terminée ou annulée', () => {
    for (const status of FINAL_MISSION_STATUSES) {
      expect(getAvailableActions(state(status))).toEqual([]);
      expect(getAvailableDecisions(state(status, { requiresValidation: true }))).toEqual([]);
    }
  });
});
