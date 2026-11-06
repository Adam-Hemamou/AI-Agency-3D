import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_DEFAULTS,
  AGENT_MODEL_LIMITS,
  AGENT_PROMPT_MAX_LENGTH,
  agentModelSettingsSchema,
  agentPromptVersionParamSchema,
  createAgentPromptRequestSchema,
  ollamaModelSchema,
  unicodeLength,
  updateAgentProfileRequestSchema,
} from './agentProfiles';
import { isAgentRole } from './agentPolicy';

describe('valeurs par défaut du modèle', () => {
  it('Qwen3:8b, sans bloc de raisonnement, contexte de 8192', () => {
    expect(AGENT_MODEL_DEFAULTS).toMatchObject({
      model: 'qwen3:8b',
      think: false,
      numCtx: 8192,
    });
  });

  it('respectent leurs propres bornes', () => {
    expect(agentModelSettingsSchema.parse({ ...AGENT_MODEL_DEFAULTS })).toEqual(
      AGENT_MODEL_DEFAULTS,
    );
  });
});

describe('noms de modèle Ollama', () => {
  it.each(['qwen3:8b', 'qwen3', 'llama3.1:8b-instruct-q4_K_M', 'library/qwen3:8b'])(
    'accepte « %s »',
    (name) => expect(ollamaModelSchema.safeParse(name).success).toBe(true),
  );

  it.each(['', ':8b', 'qwen3:8b; rm -rf /', 'qwen 3', 'qwen3:', 'a'.repeat(65)])(
    'refuse « %s »',
    (name) => expect(ollamaModelSchema.safeParse(name).success).toBe(false),
  );
});

describe('paramètres du modèle', () => {
  const base = { ...AGENT_MODEL_DEFAULTS };

  it.each([
    ['temperature', AGENT_MODEL_LIMITS.temperature.min - 0.1],
    ['temperature', AGENT_MODEL_LIMITS.temperature.max + 0.1],
    ['topP', 0],
    ['topP', 1.01],
    ['topK', 0],
    ['topK', 3.5],
    ['numCtx', 1024],
    ['numCtx', 65536],
    ['numPredict', 10],
    ['numPredict', 100_000],
    ['timeoutSeconds', 5],
    ['timeoutSeconds', 3600],
  ] as const)('refuse %s = %s', (field, value) => {
    expect(agentModelSettingsSchema.safeParse({ ...base, [field]: value }).success).toBe(false);
  });

  it('accepte les bornes exactes', () => {
    for (const [field, { min, max }] of Object.entries(AGENT_MODEL_LIMITS)) {
      expect(agentModelSettingsSchema.safeParse({ ...base, [field]: min }).success, field).toBe(
        true,
      );
      expect(agentModelSettingsSchema.safeParse({ ...base, [field]: max }).success, field).toBe(
        true,
      );
    }
  });

  it('refuse un champ inconnu', () => {
    expect(agentModelSettingsSchema.safeParse({ ...base, seed: 42 }).success).toBe(false);
  });
});

describe('modification du profil', () => {
  it('accepte une modification partielle, et le retrait du rôle', () => {
    expect(updateAgentProfileRequestSchema.parse({ temperature: 0.5 })).toEqual({
      temperature: 0.5,
    });
    expect(updateAgentProfileRequestSchema.parse({ role: 'analyst' })).toEqual({ role: 'analyst' });
    expect(updateAgentProfileRequestSchema.parse({ role: null })).toEqual({ role: null });
  });

  it('refuse une demande vide, un rôle inconnu ou un champ inconnu', () => {
    for (const body of [{}, { role: 'director' }, { prompt: 'x' }, { activePromptVersion: 2 }]) {
      expect(updateAgentProfileRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it('isAgentRole reconnaît uniquement les rôles connus', () => {
    expect(isAgentRole('analyst')).toBe(true);
    expect(isAgentRole('owner')).toBe(false);
    expect(isAgentRole(null)).toBe(false);
  });
});

describe('nouvelle version du prompt', () => {
  it('n’est pas activée par défaut', () => {
    expect(createAgentPromptRequestSchema.parse({ systemPrompt: '  Tu es analyste.  ' })).toEqual({
      systemPrompt: 'Tu es analyste.',
      note: null,
      activate: false,
    });
  });

  it('refuse un prompt vide, trop long, ou un champ inconnu', () => {
    for (const body of [
      { systemPrompt: '   ' },
      { systemPrompt: 'x'.repeat(AGENT_PROMPT_MAX_LENGTH + 1) },
      { systemPrompt: 'ok', version: 3 },
      {},
    ]) {
      expect(createAgentPromptRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(
      createAgentPromptRequestSchema.safeParse({
        systemPrompt: 'é'.repeat(AGENT_PROMPT_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('numéro de version : entier positif uniquement', () => {
    expect(agentPromptVersionParamSchema.parse('3')).toBe(3);
    for (const value of ['0', '-1', '1.5', 'abc', '']) {
      expect(agentPromptVersionParamSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('longueur du prompt en caractères Unicode', () => {
  const MAX = AGENT_PROMPT_MAX_LENGTH;
  const accepts = (systemPrompt: string) =>
    createAgentPromptRequestSchema.safeParse({ systemPrompt }).success;

  it('compte les caractères, pas les unités UTF-16 (un emoji compte pour 1)', () => {
    expect(unicodeLength('é')).toBe(1);
    expect(unicodeLength('漢')).toBe(1);
    expect(unicodeLength('😀')).toBe(1);
    expect('😀'.length).toBe(2); // ce que comptait la version précédente
    expect(unicodeLength('Analyse 😀 漢字 é')).toBe(14);
  });

  it.each([
    ['emoji (4 octets)', '😀'],
    ['idéogrammes (3 octets)', '漢'],
    ['accents (2 octets)', 'é'],
    ['ASCII (1 octet)', 'a'],
  ])('accepte exactement 20 000 caractères, pas un de plus : %s', (_label, char) => {
    expect(accepts(char.repeat(MAX))).toBe(true);
    expect(accepts(char.repeat(MAX + 1))).toBe(false);
  });

  it('accepte un mélange de 20 000 caractères, et le refuse au-delà', () => {
    const mixed = 'aé漢😀'.repeat(MAX / 4);
    expect(unicodeLength(mixed)).toBe(MAX);
    expect(accepts(mixed)).toBe(true);
    expect(accepts(mixed + 'x')).toBe(false);
  });

  it('les espaces retirés aux extrémités ne comptent pas', () => {
    expect(accepts(`  ${'😀'.repeat(MAX)}  `)).toBe(true);
  });
});
