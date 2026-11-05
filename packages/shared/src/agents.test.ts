import { describe, expect, it } from 'vitest';
import {
  AGENT_API_KEY_PATTERN,
  HUMAN_ACTOR_ID,
  agentIdSchema,
  createAgentRequestSchema,
  isAgentId,
  issueAgentKeyRequestSchema,
  updateAgentRequestSchema,
} from './agents';

describe('identifiants d’agents', () => {
  it.each(['agent-prospecteur', 'agent-redacteur-2', 'agent-a1'])('accepte %s', (id) => {
    expect(isAgentId(id)).toBe(true);
  });

  it.each([
    HUMAN_ACTOR_ID,
    'user',
    'system',
    'agent-',
    'agent',
    'Agent-prospecteur',
    'agent-Prospecteur',
    'agent--double',
    'agent-fin-',
    'agent_prospecteur',
    ' agent-espace',
    `agent-${'x'.repeat(64)}`,
  ])('refuse %j', (id) => {
    expect(agentIdSchema.safeParse(id).success).toBe(false);
  });

  it('l’identifiant de l’humain ne peut jamais être celui d’un agent', () => {
    expect(isAgentId(HUMAN_ACTOR_ID)).toBe(false);
  });
});

describe('création d’un agent', () => {
  it('applique les valeurs par défaut', () => {
    expect(createAgentRequestSchema.parse({ id: 'agent-analyste', name: 'Analyste' })).toEqual({
      id: 'agent-analyste',
      name: 'Analyste',
      description: null,
      room: null,
      permissions: [],
    });
  });

  it('refuse tout champ inconnu (impossible de se déclarer humain ou de fixer un statut)', () => {
    for (const extra of [{ type: 'user' }, { actorType: 'user' }, { status: 'active' }]) {
      expect(
        createAgentRequestSchema.safeParse({ id: 'agent-a', name: 'A', ...extra }).success,
      ).toBe(false);
    }
  });

  it('refuse une salle inconnue', () => {
    expect(
      createAgentRequestSchema.safeParse({ id: 'agent-a', name: 'A', room: 'cuisine' }).success,
    ).toBe(false);
  });
});

describe('modification et clés', () => {
  it('refuse une modification vide ou un identifiant modifié', () => {
    expect(updateAgentRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ id: 'agent-b' }).success).toBe(false);
    expect(updateAgentRequestSchema.parse({ status: 'disabled' })).toEqual({ status: 'disabled' });
  });

  it('valide la demande de clé', () => {
    expect(issueAgentKeyRequestSchema.parse({})).toEqual({ label: null, expiresAt: null });
    expect(issueAgentKeyRequestSchema.safeParse({ expiresAt: 'demain' }).success).toBe(false);
  });

  it('reconnaît le format des clés', () => {
    const secret = 'A'.repeat(43);
    expect(AGENT_API_KEY_PATTERN.test(`agk_abcdefghij12_${secret}`)).toBe(true);
    expect(AGENT_API_KEY_PATTERN.test(`agk_ABCDEFGHIJ12_${secret}`)).toBe(false);
    expect(AGENT_API_KEY_PATTERN.test(`agk_abcdefghij12_${secret}x`)).toBe(false);
    expect(AGENT_API_KEY_PATTERN.test(`abcdefghij12_${secret}`)).toBe(false);
  });
});
