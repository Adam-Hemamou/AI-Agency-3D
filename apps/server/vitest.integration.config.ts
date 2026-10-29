import { defineConfig } from 'vitest/config';

/**
 * Tests d'intégration : exécutés contre une vraie base MySQL DÉDIÉE AUX TESTS
 * (recréée à chaque exécution, jamais la base de développement).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    // Les fichiers partagent la même base : ils s'exécutent l'un après l'autre.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
