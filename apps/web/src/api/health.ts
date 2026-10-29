import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema, type HealthResponse } from '@agency/shared';
import { fetchJson } from './client';

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // 503 = API en ligne mais base indisponible : le corps reste une réponse de santé valide.
  return fetchJson('/api/health', healthResponseSchema, { acceptStatuses: [503], signal });
}

/** État du backend, rafraîchi toutes les 5 secondes. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 5000,
    retry: false,
  });
}
