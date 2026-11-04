import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Deux environnements :
 * - normal       : interface 5173 → API 3001 (base réelle) ;
 * - "--mode demo" : interface 5174 → API 3101 (base de démonstration, données fictives).
 * Les deux peuvent tourner en même temps sans se mélanger.
 */
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const api = demo ? 'http://127.0.0.1:3101' : 'http://127.0.0.1:3001';
  return {
    plugins: [react()],
    server: {
      port: demo ? 5174 : 5173,
      strictPort: true,
      // Les appels /api/* sont transmis au backend Express : pas de souci CORS en développement.
      proxy: { '/api': api },
    },
    // Même proxy pour l'aperçu du build de production (npm run preview).
    preview: {
      port: 4173,
      proxy: { '/api': api },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
