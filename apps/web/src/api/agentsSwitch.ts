import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsSwitchStatusSchema, type AgentsSwitchStatus } from '@agency/shared';
import { fetchJson, sendJson } from './client';

const KEY = ['agents-switch'] as const;

/** État de l'arrêt d'urgence des agents (rafraîchi toutes les 10 secondes). */
export function useAgentsSwitch() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      fetchJson('/api/agents/emergency-stop', agentsSwitchStatusSchema, { signal }),
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useSetAgentsEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      sendJson('/api/agents/emergency-stop', 'POST', { enabled }, agentsSwitchStatusSchema),
    onSuccess: (status: AgentsSwitchStatus) => queryClient.setQueryData(KEY, status),
  });
}
