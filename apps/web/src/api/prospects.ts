import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  missionEventsResponseSchema,
  prospectDossierSchema,
  type EmailDecisionRequest,
  type EmailDraftRequest,
  type FollowupMessageRequest,
  type FollowupUpdateRequest,
  type ProspectDecisionRequest,
  type ProspectDossier,
  type ReplyRequest,
} from '@agency/shared';
import { fetchJson, sendJson } from './client';

export const dossierKey = (id: string) => ['prospects', id, 'dossier'] as const;

/** Dossier complet d'un prospect (source de vérité : l'API). */
export function useProspectDossier(id: string | null) {
  return useQuery({
    queryKey: dossierKey(id ?? ''),
    queryFn: ({ signal }) =>
      fetchJson(`/api/prospects/${id}/dossier`, prospectDossierSchema, { signal }),
    enabled: id !== null,
    staleTime: 0,
    retry: false,
  });
}

/** Historique d'une mission (affiché à la demande dans l'onglet Missions). */
export function useMissionEvents(missionId: string | null) {
  return useQuery({
    queryKey: ['missions', missionId, 'events'],
    queryFn: ({ signal }) =>
      fetchJson(`/api/missions/${missionId}/events`, missionEventsResponseSchema, { signal }),
    enabled: missionId !== null,
    retry: false,
  });
}

/**
 * Actions possibles sur un dossier. Toutes passent par l'API, qui applique les règles
 * métier et le moteur de missions : l'interface ne modifie JAMAIS un statut elle-même.
 */
export type DossierAction =
  | { kind: 'decide'; body: ProspectDecisionRequest }
  | { kind: 'decideEmail'; body: EmailDecisionRequest }
  | { kind: 'editEmail'; body: EmailDraftRequest }
  | { kind: 'simulateSend'; body: { productionId: string } }
  | { kind: 'reply'; body: ReplyRequest }
  | { kind: 'followup'; body: FollowupMessageRequest }
  | { kind: 'updateFollowup'; body: FollowupUpdateRequest }
  | { kind: 'note'; body: { text: string } };

function route(id: string, action: DossierAction): { path: string; method: 'POST' | 'PATCH' } {
  const base = `/api/prospects/${id}`;
  switch (action.kind) {
    case 'decide':
      return { path: `${base}/decisions`, method: 'POST' };
    case 'decideEmail':
      return { path: `${base}/email/decisions`, method: 'POST' };
    case 'editEmail':
      return { path: `${base}/email/drafts`, method: 'POST' };
    case 'simulateSend':
      return { path: `${base}/email/simulated-send`, method: 'POST' };
    case 'reply':
      return { path: `${base}/replies`, method: 'POST' };
    case 'followup':
      return { path: `${base}/followups`, method: 'POST' };
    case 'updateFollowup':
      return { path: `${base}/followup`, method: 'PATCH' };
    case 'note':
      return { path: `${base}/notes`, method: 'POST' };
  }
}

export function sendDossierAction(id: string, action: DossierAction): Promise<ProspectDossier> {
  const { path, method } = route(id, action);
  return sendJson(path, method, action.body, prospectDossierSchema);
}

/** Envoie une action ; le dossier renvoyé remplace le cache, les listes sont rechargées. */
export function useDossierAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: DossierAction) => sendDossierAction(id, action),
    onSuccess: (dossier) => {
      queryClient.setQueryData(dossierKey(id), dossier);
      void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });
}
