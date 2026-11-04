import { describe, expect, it } from 'vitest';
import { isDemoDataset, resolveDemoDatabaseUrl } from './demo.ts';

describe('resolveDemoDatabaseUrl', () => {
  it('suffixe la base réelle par "_demo"', () => {
    expect(
      resolveDemoDatabaseUrl({ DATABASE_URL: 'mysql://agency:pw@localhost:3306/ai_agency' }),
    ).toBe('mysql://agency:pw@localhost:3306/ai_agency_demo');
  });

  it('privilégie DEMO_DATABASE_URL', () => {
    expect(
      resolveDemoDatabaseUrl({
        DATABASE_URL: 'mysql://a:b@localhost/ai_agency',
        DEMO_DATABASE_URL: 'mysql://a:b@localhost:3307/autre_demo',
      }),
    ).toBe('mysql://a:b@localhost:3307/autre_demo');
  });

  it('refuse une base dont le nom ne se termine pas par "_demo"', () => {
    expect(() =>
      resolveDemoDatabaseUrl({ DEMO_DATABASE_URL: 'mysql://a:b@localhost/ai_agency' }),
    ).toThrow(/_demo/);
  });

  it('exige une URL', () => {
    expect(() => resolveDemoDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});

describe('isDemoDataset', () => {
  it('ne vaut vrai que pour AGENCY_DATASET=demo', () => {
    expect(isDemoDataset({ AGENCY_DATASET: 'demo' })).toBe(true);
    expect(isDemoDataset({})).toBe(false);
    expect(isDemoDataset({ AGENCY_DATASET: 'prod' })).toBe(false);
  });
});
