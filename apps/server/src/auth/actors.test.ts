import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/AppError.ts';
import type { Actor } from '../missions/missionService.ts';
import { HUMAN_ACTOR, agentActor, assertHumanActor, isHumanActor } from './actors.ts';

describe('identité humaine', () => {
  it('reconnaît l’utilisateur humain', () => {
    expect(isHumanActor(HUMAN_ACTOR)).toBe(true);
    expect(HUMAN_ACTOR).toEqual({ type: 'user', id: 'owner' });
  });

  it.each<Actor>([
    { type: 'agent', id: 'agent-analyste' },
    { type: 'system', id: null },
    // Un agent qui se déclarerait « utilisateur » reste reconnu comme agent.
    { type: 'user', id: 'agent-analyste' },
    { type: 'user', id: null },
    { type: 'user', id: '' },
  ])('refuse %j', (actor) => {
    expect(isHumanActor(actor)).toBe(false);
    expect(() => assertHumanActor(actor, 'valider')).toThrow(AppError);
    try {
      assertHumanActor(actor, 'valider');
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN_ACTOR');
      expect((error as AppError).httpStatus).toBe(403);
    }
  });

  it('les identités ne peuvent pas être modifiées après coup', () => {
    expect(Object.isFrozen(HUMAN_ACTOR)).toBe(true);
    expect(Object.isFrozen(agentActor('agent-analyste'))).toBe(true);
  });
});

describe('identité d’agent', () => {
  it('construit l’identité d’un agent', () => {
    expect(agentActor('agent-analyste')).toEqual({ type: 'agent', id: 'agent-analyste' });
  });

  it.each(['owner', 'user', '', 'analyste'])('refuse l’identifiant %j', (id) => {
    expect(() => agentActor(id)).toThrow();
  });
});
