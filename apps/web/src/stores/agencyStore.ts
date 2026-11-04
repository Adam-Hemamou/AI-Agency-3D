import { create } from 'zustand';
import type { RoomId } from '@agency/shared';

/**
 * État d'interface partagé entre la scène 3D et les panneaux HTML.
 * Il ne contient AUCUNE donnée métier : les missions viennent toujours de l'API.
 */
export interface AgencyState {
  hoveredRoom: RoomId | null;
  selectedRoom: RoomId | null;
  /** Incrémenté pour demander à la caméra de revenir à la vue d'ensemble. */
  overviewRequest: number;
  setHoveredRoom: (room: RoomId | null) => void;
  selectRoom: (room: RoomId) => void;
  closeRoom: () => void;
  showOverview: () => void;
}

export const useAgencyStore = create<AgencyState>((set) => ({
  hoveredRoom: null,
  selectedRoom: null,
  overviewRequest: 0,
  setHoveredRoom: (room) => set({ hoveredRoom: room }),
  selectRoom: (room) => set({ selectedRoom: room }),
  closeRoom: () => set({ selectedRoom: null }),
  showOverview: () => set((s) => ({ selectedRoom: null, overviewRequest: s.overviewRequest + 1 })),
}));
