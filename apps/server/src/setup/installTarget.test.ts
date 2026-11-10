import { describe, expect, it } from 'vitest';
import { resolveInstallTarget } from './installTarget.ts';

const ENV = {
  DATABASE_URL: 'mysql://agency:pw@localhost:3306/ai_agency',
  MODE_SIMULATION: 'true',
};

describe('installateur des prospecteurs : base visée', () => {
  it('par défaut : base de test, simulation', () => {
    expect(resolveInstallTarget([], ENV)).toMatchObject({
      kind: 'test',
      database: 'ai_agency_test',
      apply: false,
      updatePrompts: false,
    });
  });

  it('--apply et --update-prompts', () => {
    expect(resolveInstallTarget(['--apply', '--update-prompts'], ENV)).toMatchObject({
      kind: 'test',
      apply: true,
      updatePrompts: true,
    });
  });

  it('TEST_DATABASE_URL est respectée, mais doit finir par « _test »', () => {
    const env = { ...ENV, TEST_DATABASE_URL: 'mysql://a:b@localhost:3306/autre_test' };
    expect(resolveInstallTarget([], env).database).toBe('autre_test');
    expect(() =>
      resolveInstallTarget([], { ...ENV, TEST_DATABASE_URL: 'mysql://a:b@localhost/ai_agency' }),
    ).toThrow(/_test/);
  });

  it('production : refusée sans confirmation du nom exact', () => {
    expect(() => resolveInstallTarget(['--target=production'], ENV)).toThrow(/--confirm=ai_agency/);
    expect(() =>
      resolveInstallTarget(['--target=production', '--confirm=ai_agency_prod'], ENV),
    ).toThrow(/reçu : « ai_agency_prod »/);
  });

  it('production : acceptée avec --confirm=ai_agency, toujours en simulation sans --apply', () => {
    expect(resolveInstallTarget(['--target=production', '--confirm=ai_agency'], ENV)).toMatchObject(
      { kind: 'production', database: 'ai_agency', apply: false },
    );
  });

  it('production : une base de test y est refusée', () => {
    const env = { ...ENV, DATABASE_URL: 'mysql://agency:pw@localhost:3306/ai_agency_test' };
    expect(() =>
      resolveInstallTarget(['--target=production', '--confirm=ai_agency_test'], env),
    ).toThrow(/base de test/);
  });

  it('refuse --confirm sans --target=production', () => {
    expect(() => resolveInstallTarget(['--confirm=ai_agency'], ENV)).toThrow(/--confirm/);
  });

  it('refuse si MODE_SIMULATION n’est pas actif', () => {
    expect(() => resolveInstallTarget([], { ...ENV, MODE_SIMULATION: 'false' })).toThrow(
      /MODE_SIMULATION/,
    );
  });

  it('refuse un argument inconnu', () => {
    expect(() => resolveInstallTarget(['--force'], ENV)).toThrow(/Argument inconnu : --force/);
  });
});
