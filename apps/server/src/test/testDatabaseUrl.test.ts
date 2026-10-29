import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseUrl } from './testDatabaseUrl.ts';

describe('URL de la base de test', () => {
  it('dérive la base de test de DATABASE_URL', () => {
    expect(
      resolveTestDatabaseUrl({ DATABASE_URL: 'mysql://agency:pw@localhost:3306/ai_agency' }),
    ).toBe('mysql://agency:pw@localhost:3306/ai_agency_test');
  });

  it('privilégie TEST_DATABASE_URL', () => {
    expect(
      resolveTestDatabaseUrl({
        DATABASE_URL: 'mysql://a:b@localhost/ai_agency',
        TEST_DATABASE_URL: 'mysql://a:b@localhost:3307/autre_test',
      }),
    ).toBe('mysql://a:b@localhost:3307/autre_test');
  });

  it('refuse une base dont le nom ne finit pas par "_test"', () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'mysql://a:b@localhost/ai_agency' }),
    ).toThrow(/_test/);
  });

  it('exige une URL', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});
