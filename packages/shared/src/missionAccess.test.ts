import { describe, expect, it } from 'vitest';
import { canAgentSeeMission, checkAgentMissionAccess } from './agentPolicy';
import { createMissionRequestSchema } from './missionApi';
import { MISSION_ACTIONS } from './missionLifecycle';

const roomAgent = { id: 'agent-a', room: 'analysis' };
const noRoomAgent = { id: 'agent-a', room: null };
const mine = { agentId: 'agent-a', room: 'analysis' };
const mineElsewhere = { agentId: 'agent-a', room: 'dubbing' };
const freeHere = { agentId: null, room: 'analysis' };
const freeElsewhere = { agentId: null, room: 'dubbing' };
const otherAgent = { agentId: 'agent-b', room: 'analysis' };

describe('canAgentSeeMission', () => {
  it('agent rattaché à une salle : ses missions et les missions libres de sa salle', () => {
    expect(canAgentSeeMission(mine, roomAgent)).toBe(true);
    expect(canAgentSeeMission(freeHere, roomAgent)).toBe(true);
    expect(canAgentSeeMission(freeElsewhere, roomAgent)).toBe(false);
    expect(canAgentSeeMission(mineElsewhere, roomAgent)).toBe(false);
  });

  it('agent sans salle : uniquement ses missions, aucune mission libre', () => {
    expect(canAgentSeeMission(mine, noRoomAgent)).toBe(true);
    expect(canAgentSeeMission(mineElsewhere, noRoomAgent)).toBe(true);
    expect(canAgentSeeMission(freeHere, noRoomAgent)).toBe(false);
    expect(canAgentSeeMission(freeElsewhere, noRoomAgent)).toBe(false);
  });

  it('jamais la mission d’un autre agent', () => {
    expect(canAgentSeeMission(otherAgent, roomAgent)).toBe(false);
    expect(canAgentSeeMission(otherAgent, noRoomAgent)).toBe(false);
  });
});

describe('checkAgentMissionAccess', () => {
  it('toutes les actions sur sa propre mission (le cycle de vie décide ensuite)', () => {
    for (const action of MISSION_ACTIONS) {
      expect(checkAgentMissionAccess(mine, roomAgent, action).allowed).toBe(true);
    }
  });

  it('mission libre de sa salle : seul le démarrage est permis (il attribue la mission)', () => {
    for (const action of MISSION_ACTIONS) {
      expect(checkAgentMissionAccess(freeHere, roomAgent, action).allowed).toBe(action === 'start');
    }
  });

  it('refuse toute action sur la mission d’un autre agent, en le disant', () => {
    for (const action of MISSION_ACTIONS) {
      const check = checkAgentMissionAccess(otherAgent, roomAgent, action);
      expect(check).toMatchObject({ allowed: false });
      if (!check.allowed) expect(check.reason).toContain('agent-b');
    }
  });

  it('agent sans salle : ne peut pas prendre une mission libre', () => {
    expect(checkAgentMissionAccess(freeHere, noRoomAgent, 'start')).toMatchObject({
      allowed: false,
    });
  });

  it('mission libre d’une autre salle : refusée', () => {
    expect(checkAgentMissionAccess(freeElsewhere, roomAgent, 'start')).toMatchObject({
      allowed: false,
    });
  });
});

describe('agentId à la création d’une mission', () => {
  const base = { type: 'analysis.score', room: 'analysis' };

  it('accepte un identifiant d’agent ou aucun', () => {
    expect(createMissionRequestSchema.parse({ ...base, agentId: 'agent-analyste' }).agentId).toBe(
      'agent-analyste',
    );
    expect(createMissionRequestSchema.parse(base).agentId).toBeNull();
  });

  it.each(['owner', 'agent-', 'Agent-X', 'analyste', 'agent_x', ' ', 'agent-x '])(
    'refuse « %s »',
    (agentId) => {
      expect(createMissionRequestSchema.safeParse({ ...base, agentId }).success).toBe(false);
    },
  );
});
