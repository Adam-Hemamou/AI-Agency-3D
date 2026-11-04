import { describe, expect, it } from 'vitest';
import {
  createMissionRequestSchema,
  missionListQuerySchema,
  missionTransitionRequestSchema,
  validationDecisionRequestSchema,
} from './missionApi';

describe('création de mission', () => {
  it('applique les valeurs par défaut', () => {
    expect(
      createMissionRequestSchema.parse({ type: 'search_creators', room: 'prospecting' }),
    ).toEqual({
      type: 'search_creators',
      room: 'prospecting',
      priority: 3,
      input: {},
      requiresValidation: false,
      agentId: null,
      prospectId: null,
      maxAttempts: 3,
    });
  });

  it('refuse une salle inconnue, une priorité hors limites et un type mal formé', () => {
    expect(createMissionRequestSchema.safeParse({ type: 'x', room: 'kitchen' }).success).toBe(
      false,
    );
    expect(
      createMissionRequestSchema.safeParse({ type: 'x', room: 'analysis', priority: 9 }).success,
    ).toBe(false);
    expect(
      createMissionRequestSchema.safeParse({ type: 'Avec Espaces', room: 'analysis' }).success,
    ).toBe(false);
  });

  it('refuse les champs inconnus (ex. : imposer un statut)', () => {
    expect(
      createMissionRequestSchema.safeParse({ type: 'x', room: 'analysis', status: 'completed' })
        .success,
    ).toBe(false);
  });

  it('exige que les données d’entrée soient un objet', () => {
    expect(
      createMissionRequestSchema.safeParse({ type: 'x', room: 'analysis', input: [1, 2] }).success,
    ).toBe(false);
  });
});

describe('demande de transition', () => {
  it('exige un motif pour bloquer ou annuler', () => {
    expect(missionTransitionRequestSchema.safeParse({ action: 'block' }).success).toBe(false);
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'cancel', reason: '  ' }).success,
    ).toBe(false);
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'cancel', reason: 'doublon' }).success,
    ).toBe(true);
  });

  it('n’accepte un résultat qu’avec "soumettre" ou "terminer"', () => {
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'complete', output: { ok: true } })
        .success,
    ).toBe(true);
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'pause', output: { ok: true } }).success,
    ).toBe(false);
  });

  it('n’accepte un code d’erreur qu’avec "bloquer"', () => {
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'start', errorCode: 'X' }).success,
    ).toBe(false);
  });

  it('refuse une action inconnue', () => {
    expect(missionTransitionRequestSchema.safeParse({ action: 'approve' }).success).toBe(false);
  });
});

describe('décision de validation', () => {
  it('exige un motif pour refuser ou demander des modifications', () => {
    expect(validationDecisionRequestSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(validationDecisionRequestSchema.safeParse({ decision: 'request_changes' }).success).toBe(
      false,
    );
    expect(validationDecisionRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true);
  });
});

describe('filtres de liste', () => {
  it('accepte des valeurs séparées par des virgules ou répétées', () => {
    expect(missionListQuerySchema.parse({ status: 'pending,blocked' }).status).toEqual([
      'pending',
      'blocked',
    ]);
    expect(missionListQuerySchema.parse({ room: ['analysis', 'director'] }).room).toEqual([
      'analysis',
      'director',
    ]);
  });

  it('convertit la pagination et applique les valeurs par défaut', () => {
    expect(missionListQuerySchema.parse({ limit: '10', offset: '20' })).toEqual({
      limit: 10,
      offset: 20,
      sort: 'recent',
    });
  });

  it('refuse un statut inconnu et un paramètre inconnu', () => {
    expect(missionListQuerySchema.safeParse({ status: 'pending,oops' }).success).toBe(false);
    expect(missionListQuerySchema.safeParse({ foo: 'bar' }).success).toBe(false);
  });

  it('refuse une limite excessive', () => {
    expect(missionListQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
