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
  // changeOrigin: false — l'API reçoit l'adresse de l'interface (Host: localhost:5173) et peut
  // vérifier que les écritures viennent bien de cette même origine (protection de la session).
  const proxy = { '/api': { target: api, changeOrigin: false } };
  return {
    plugins: [react()],
    server: {
      port: demo ? 5174 : 5173,
      strictPort: true,
      // Les appels /api/* sont transmis au backend Express : pas de souci CORS en développement.
      proxy,
    },
    // Même proxy pour l'aperçu du build de production (npm run preview).
    preview: {
      port: 4173,
      proxy,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
