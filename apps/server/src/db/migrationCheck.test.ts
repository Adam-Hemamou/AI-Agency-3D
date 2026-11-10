import { describe, expect, it } from 'vitest';
import {
  compareMigrations,
  describeDatabase,
  listRepositoryMigrations,
  migrationProblem,
} from './migrationCheck.ts';

const done = (name: string) => ({ name, finished: true, rolledBack: false });

describe('vérification des migrations au démarrage', () => {
  it('lit les migrations du dépôt, dans l’ordre', () => {
    const names = listRepositoryMigrations();
    expect(names[0]).toBe('20261029205902_missions_and_events');
    expect(names).toContain('20261109100000_prospecting_campaigns');
    expect(names).toEqual([...names].sort());
  });

  it('base à jour : aucun problème', () => {
    const check = compareMigrations(['a', 'b'], [done('a'), done('b')]);
    expect(check).toEqual({ pending: [], failed: [], unknown: [] });
    expect(migrationProblem(check, 'ai_agency')).toBeNull();
  });

  it('migration absente de la base : en attente, démarrage refusé', () => {
    const check = compareMigrations(['a', 'b'], [done('a')]);
    expect(check.pending).toEqual(['b']);
    const message = migrationProblem(check, 'ai_agency (localhost:3306)');
    expect(message).toContain('1 migration(s) en attente : b');
    expect(message).toContain('ai_agency (localhost:3306)');
    expect(message).toContain('npx prisma migrate deploy');
  });

  it('base vide (aucune table _prisma_migrations) : tout est en attente', () => {
    expect(compareMigrations(['a', 'b'], []).pending).toEqual(['a', 'b']);
  });

  it('migration commencée sans fin : en échec, pas « en attente »', () => {
    const check = compareMigrations(
      ['a', 'b'],
      [done('a'), { name: 'b', finished: false, rolledBack: false }],
    );
    expect(check).toEqual({ pending: [], failed: ['b'], unknown: [] });
    expect(migrationProblem(check, 'ai_agency')).toContain('jamais terminée(s) : b');
  });

  it('échec annulé puis migration réappliquée : à jour', () => {
    const check = compareMigrations(
      ['a'],
      [{ name: 'a', finished: false, rolledBack: true }, done('a')],
    );
    expect(check).toEqual({ pending: [], failed: [], unknown: [] });
  });

  it('échec annulé sans nouvel essai : de nouveau en attente', () => {
    const check = compareMigrations(['a'], [{ name: 'a', finished: false, rolledBack: true }]);
    expect(check.pending).toEqual(['a']);
  });

  it('migration en base inconnue du dépôt : signalée, sans bloquer', () => {
    const check = compareMigrations(['a'], [done('a'), done('z')]);
    expect(check.unknown).toEqual(['z']);
    expect(migrationProblem(check, 'ai_agency')).toBeNull();
  });

  it('décrit la base sans identifiant ni mot de passe', () => {
    const text = describeDatabase('mysql://agency:secret@localhost:3306/ai_agency');
    expect(text).toBe('ai_agency (localhost:3306)');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('agency:');
  });
});
