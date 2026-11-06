import { describe, expect, it } from 'vitest';
import {
  AGENT_HEARTBEAT_INTERVAL_SECONDS,
  AGENT_RUN_RAW_OUTPUT_MAX_LENGTH,
  AGENT_RUN_STATUSES,
  FINAL_AGENT_RUN_STATUSES,
  agentRunSchema,
  runListItemSchema,
  runListQuerySchema,
  claimRunRequestSchema,
  n8nExecutionIdSchema,
  runFailureRequestSchema,
  runHeartbeatRequestSchema,
} from './agentRuns';
import { missionTransitionRequestSchema } from './missionApi';

describe('statuts des exécutions', () => {
  it('une seule exécution « en cours », toutes les autres sont finales', () => {
    expect(FINAL_AGENT_RUN_STATUSES).toEqual(AGENT_RUN_STATUSES.filter((s) => s !== 'started'));
    expect(FINAL_AGENT_RUN_STATUSES).not.toContain('started');
  });

  it('signal de vie toutes les 5 minutes, bien en deçà du délai de récupération (60 min)', () => {
    expect(AGENT_HEARTBEAT_INTERVAL_SECONDS).toBe(300);
    expect(AGENT_HEARTBEAT_INTERVAL_SECONDS * 4).toBeLessThan(60 * 60);
  });
});

describe('prise de mission', () => {
  it('exige l’identifiant de l’exécution n8n', () => {
    expect(claimRunRequestSchema.parse({ n8nExecutionId: ' 4821 ' })).toEqual({
      n8nExecutionId: '4821',
    });
    for (const body of [{}, { n8nExecutionId: '' }, { n8nExecutionId: '1', agentId: 'agent-x' }]) {
      expect(claimRunRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it.each(['exec 1', 'a/b', 'é', 'x'.repeat(129), "1'; DROP TABLE"])(
    'refuse l’identifiant n8n « %s »',
    (value) => expect(n8nExecutionIdSchema.safeParse(value).success).toBe(false),
  );

  it('signal de vie : identifiant n8n obligatoire, rien d’autre', () => {
    expect(runHeartbeatRequestSchema.parse({ n8nExecutionId: '4821' })).toEqual({
      n8nExecutionId: '4821',
    });
    for (const body of [{}, { n8nExecutionId: '4821', status: 'succeeded' }]) {
      expect(runHeartbeatRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('échec signalé', () => {
  it('accepte un code connu, un message et des mesures facultatives', () => {
    expect(
      runFailureRequestSchema.parse({
        n8nExecutionId: '4821',
        code: 'INVALID_OUTPUT',
        message: 'JSON non conforme après 2 relances',
        rawOutput: '{"score":',
        promptTokens: 1200,
        outputTokens: 40,
        llmMs: 8000,
      }),
    ).toMatchObject({ code: 'INVALID_OUTPUT', promptTokens: 1200 });
  });

  it('refuse un code inconnu, un message vide, une sortie trop longue ou une décision imposée', () => {
    for (const body of [
      { code: 'LLM_TIMEOUT', message: 'sans identifiant n8n' },
      { n8nExecutionId: '4821', code: 'OOPS', message: 'x' },
      { n8nExecutionId: '4821', code: 'LLM_TIMEOUT', message: '  ' },
      {
        n8nExecutionId: '4821',
        code: 'LLM_TIMEOUT',
        message: 'x',
        rawOutput: 'y'.repeat(AGENT_RUN_RAW_OUTPUT_MAX_LENGTH + 1),
      },
      { n8nExecutionId: '4821', code: 'LLM_TIMEOUT', message: 'x', decision: 'released' },
      { n8nExecutionId: '4821', code: 'LLM_TIMEOUT', message: 'x', promptTokens: -1 },
    ]) {
      expect(runFailureRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('action release dans les requêtes de transition', () => {
  it('exige un motif (traçabilité)', () => {
    expect(missionTransitionRequestSchema.safeParse({ action: 'release' }).success).toBe(false);
    expect(
      missionTransitionRequestSchema.safeParse({ action: 'release', reason: 'Ollama injoignable' })
        .success,
    ).toBe(true);
  });
});

describe('filtres du journal des exécutions', () => {
  it('valeurs par défaut : plus récentes d’abord, 50 par page', () => {
    expect(runListQuerySchema.parse({})).toEqual({ sort: 'recent', limit: 50, offset: 0 });
  });

  it('statuts en liste (virgules ou paramètres répétés), dates et pagination', () => {
    expect(runListQuerySchema.parse({ status: 'started,failed' }).status).toEqual([
      'started',
      'failed',
    ]);
    expect(runListQuerySchema.parse({ status: ['started', 'stopped'] }).status).toEqual([
      'started',
      'stopped',
    ]);
    expect(
      runListQuerySchema.parse({
        agentId: 'agent-analyste',
        from: '2026-11-07T00:00:00.000Z',
        to: '2026-11-08T00:00:00.000Z',
        sort: 'oldest',
        limit: '10',
        offset: '20',
      }),
    ).toMatchObject({ agentId: 'agent-analyste', sort: 'oldest', limit: 10, offset: 20 });
  });

  it.each([
    [{ status: 'done' }],
    [{ agentId: 'owner' }],
    [{ limit: '0' }],
    [{ limit: '500' }],
    [{ offset: '-1' }],
    [{ sort: 'random' }],
    [{ from: 'hier' }],
    [{ from: '2026-11-08T00:00:00.000Z', to: '2026-11-07T00:00:00.000Z' }],
    [{ from: '2026-11-08T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' }],
    [{ includeRawOutput: 'true' }],
  ])('refuse %j', (query) => {
    expect(runListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('la réponse ne prévoit jamais la sortie brute du modèle', () => {
    expect(Object.keys(runListItemSchema.shape)).not.toContain('rawOutput');
    expect(Object.keys(agentRunSchema.shape)).not.toContain('rawOutput');
  });
});
