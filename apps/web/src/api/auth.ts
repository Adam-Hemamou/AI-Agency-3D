import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionResponseSchema, type SessionResponse } from '@agency/shared';
import { fetchJson, sendJson } from './client';

/** Clé du cache de la session : passée à « non connecté » dès qu'une requête reçoit un 401. */
export const SESSION_KEY = ['session'] as const;

export const SIGNED_OUT: SessionResponse = { authenticated: false, expiresAt: null };

export function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  return fetchJson('/api/auth/session', sessionResponseSchema, { signal });
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => fetchSession(signal),
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['login'],
    mutationFn: (password: string) =>
      sendJson('/api/auth/login', 'POST', { password }, sessionResponseSchema),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, session);
      // Les données chargées avant la connexion (refusées) sont rechargées.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson('/api/auth/logout', 'POST', {}, sessionResponseSchema),
    onSettled: () => {
      // Quoi qu'il arrive, plus rien de confidentiel ne reste affiché.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
      queryClient.setQueryData(SESSION_KEY, SIGNED_OUT);
    },
  });
}
