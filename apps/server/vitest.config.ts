import { defineConfig } from 'vitest/config';

/** Tests unitaires : rapides, sans base de données. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', '**/node_modules/**'],
  },
});
