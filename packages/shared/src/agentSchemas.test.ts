import { describe, expect, it } from 'vitest';
import {
  AGENT_JSON_SCHEMA_NAMES,
  agentJsonSchema,
  agentJsonSchemaList,
  isAgentJsonSchemaName,
} from './agentSchemas';

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [key: string]: unknown;
};

describe('schémas JSON exposés à n8n', () => {
  it('chaque schéma se convertit, avec son titre et sa description', () => {
    for (const name of AGENT_JSON_SCHEMA_NAMES) {
      const schema = agentJsonSchema(name) as JsonSchema;
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema).toMatchObject({ type: 'object', title: name });
      expect(typeof schema.description).toBe('string');
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('qualification du prospecteur : champs obligatoires et facultatifs (valeurs par défaut)', () => {
    const schema = agentJsonSchema('discovery') as JsonSchema;
    expect(schema.required).toEqual(expect.arrayContaining(['source', 'reason', 'qualification']));
    expect(schema.required).not.toContain('keywords'); // a une valeur par défaut
    expect(schema.properties?.qualification?.required).toEqual(
      expect.arrayContaining(['targetFit', 'potentialInterest', 'firstObservation']),
    );
    expect(schema.properties?.keywords).toMatchObject({ type: 'array' });
  });

  it('création par un agent : mission de recherche obligatoire, jamais « isDemo », champs fermés', () => {
    const schema = agentJsonSchema('prospect_create') as JsonSchema;
    expect(schema.required).toEqual(
      expect.arrayContaining(['missionId', 'creatorName', 'channelName', 'discovery']),
    );
    expect(schema.properties).not.toHaveProperty('isDemo');
    expect(schema.additionalProperties).toBe(false);
  });

  it('analyse : critères notés de 0 à 10, contenu structuré', () => {
    const schema = agentJsonSchema('analysis_create') as JsonSchema;
    expect(schema.required).toEqual(
      expect.arrayContaining(['summary', 'conclusion', 'priority', 'content']),
    );
    const criterion = (schema.properties?.scoreCriteria as { items: JsonSchema }).items;
    expect(criterion.properties?.value).toMatchObject({ minimum: 0, maximum: 10 });
  });

  it('liste et noms reconnus', () => {
    expect(agentJsonSchemaList().items.map((i) => i.name)).toEqual([...AGENT_JSON_SCHEMA_NAMES]);
    expect(isAgentJsonSchemaName('discovery')).toBe(true);
    expect(isAgentJsonSchemaName('inconnu')).toBe(false);
    expect(isAgentJsonSchemaName('__proto__')).toBe(false);
  });
});
