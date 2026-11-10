import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_ACTION_KINDS,
  agentCapabilitiesResponseSchema,
  externalActionPolicy,
  isExternalActionAllowed,
} from './externalActions';

describe('actions externes et mode simulation', () => {
  it('mode simulation : lecture publique autorisée, dépenses et envois bloqués', () => {
    expect(isExternalActionAllowed('public_read', true)).toBe(true);
    expect(isExternalActionAllowed('spend', true)).toBe(false);
    expect(isExternalActionAllowed('send', true)).toBe(false);
    expect(externalActionPolicy(true).spend.reason).toContain('Mode simulation');
  });

  it('hors simulation : dépenses et envois restent bloqués (aucune intégration réelle)', () => {
    expect(isExternalActionAllowed('public_read', false)).toBe(true);
    expect(isExternalActionAllowed('spend', false)).toBe(false);
    expect(isExternalActionAllowed('send', false)).toBe(false);
    expect(externalActionPolicy(false).send.reason).toContain('autorisation humaine');
  });

  it('couvre chaque type d’action, et la réponse de l’API respecte son schéma', () => {
    for (const simulation of [true, false]) {
      expect(Object.keys(externalActionPolicy(simulation)).sort()).toEqual(
        [...EXTERNAL_ACTION_KINDS].sort(),
      );
      const parsed = agentCapabilitiesResponseSchema.safeParse({
        simulationMode: simulation,
        externalActions: externalActionPolicy(simulation),
        publicDataSources: ['youtube_data_api'],
      });
      expect(parsed.success).toBe(true);
    }
  });
});
