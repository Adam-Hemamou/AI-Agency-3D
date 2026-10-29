import { describe, expect, it } from 'vitest';
import {
  FINAL_MISSION_STATUSES,
  MISSION_STATUSES,
  MISSION_STATUS_LABELS,
  ROOM_IDS,
  ROOM_LABELS,
  healthResponseSchema,
  isMissionStatus,
  isRoomId,
} from './index';

describe('statuts de mission', () => {
  it('définit exactement les sept statuts du cahier des charges', () => {
    expect(MISSION_STATUSES).toHaveLength(7);
    expect(new Set(MISSION_STATUSES).size).toBe(7);
  });

  it('a un libellé pour chaque statut', () => {
    for (const status of MISSION_STATUSES) {
      expect(MISSION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('ne considère comme finaux que "terminée" et "annulée"', () => {
    expect([...FINAL_MISSION_STATUSES].sort()).toEqual(['cancelled', 'completed']);
  });

  it('reconnaît les statuts valides et rejette les autres', () => {
    expect(isMissionStatus('blocked')).toBe(true);
    expect(isMissionStatus('unknown')).toBe(false);
    expect(isMissionStatus(42)).toBe(false);
  });
});

describe('salles', () => {
  it('définit les sept salles, chacune avec un libellé', () => {
    expect(ROOM_IDS).toHaveLength(7);
    for (const room of ROOM_IDS) {
      expect(ROOM_LABELS[room]).toBeTruthy();
    }
  });

  it('reconnaît les identifiants de salle', () => {
    expect(isRoomId('director')).toBe(true);
    expect(isRoomId('kitchen')).toBe(false);
  });
});

describe('schéma de santé', () => {
  it('accepte une réponse valide', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      simulationMode: true,
      uptimeSeconds: 3,
      checks: { database: { status: 'up', latencyMs: 2 } },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejette une réponse incomplète', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
