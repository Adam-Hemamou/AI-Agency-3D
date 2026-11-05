import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SESSION_KEY, SIGNED_OUT } from './api/auth';
import { ApiClientError } from './api/client';
import { App } from './App';
import './styles.css';

/**
 * Session expirée ou fermée : toute requête refusée en 401 ramène à l'écran de connexion
 * (la connexion elle-même gère ses propres erreurs).
 */
function onApiError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401 && error.code === 'UNAUTHENTICATED') {
    queryClient.setQueryData(SESSION_KEY, SIGNED_OUT);
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.mutationKey?.[0] !== 'login') onApiError(error);
    },
  }),
});

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
