import { useQuery } from '@tanstack/react-query';
import { missionListResponseSchema, type MissionListResponse, type RoomId } from '@agency/shared';
import { fetchJson } from './client';

/** Nombre maximal de missions affichées dans le panneau d'une salle. */
export const ROOM_MISSIONS_LIMIT = 50;

export function fetchRoomMissions(
  room: RoomId,
  signal?: AbortSignal,
): Promise<MissionListResponse> {
  const params = new URLSearchParams({
    room,
    sort: 'priority',
    limit: String(ROOM_MISSIONS_LIMIT),
  });
  return fetchJson(`/api/missions?${params.toString()}`, missionListResponseSchema, { signal });
}

/**
 * Missions d'une salle, lues depuis l'API (seule source de vérité).
 * Rechargées à chaque ouverture du panneau.
 */
export function useRoomMissions(room: RoomId | null) {
  return useQuery({
    queryKey: ['missions', 'room', room],
    queryFn: ({ signal }) => fetchRoomMissions(room as RoomId, signal),
    enabled: room !== null,
    staleTime: 0,
    retry: false,
  });
}
