import { create } from 'zustand';
import type { DossierSection, RoomId } from '@agency/shared';

/** Dossier ouvert au centre de l'écran (un prospect, ou une mission sans prospect). */
export interface OpenDossier {
  prospectId: string | null;
  missionId: string;
  section: DossierSection;
}

/**
 * État d'interface partagé entre la scène 3D et les panneaux HTML.
 * Il ne contient AUCUNE donnée métier : missions et dossiers viennent toujours de l'API.
 */
export interface AgencyState {
  hoveredRoom: RoomId | null;
  selectedRoom: RoomId | null;
  /** Incrémenté pour demander à la caméra de revenir à la vue d'ensemble. */
  overviewRequest: number;
  dossier: OpenDossier | null;
  setHoveredRoom: (room: RoomId | null) => void;
  selectRoom: (room: RoomId) => void;
  closeRoom: () => void;
  showOverview: () => void;
  openDossier: (dossier: OpenDossier) => void;
  setDossierSection: (section: DossierSection) => void;
  /** Ferme le dossier SANS fermer le panneau de la salle. */
  closeDossier: () => void;
}

export const useAgencyStore = create<AgencyState>((set) => ({
  hoveredRoom: null,
  selectedRoom: null,
  overviewRequest: 0,
  dossier: null,
  setHoveredRoom: (room) => set({ hoveredRoom: room }),
  selectRoom: (room) => set({ selectedRoom: room }),
  closeRoom: () => set({ selectedRoom: null, dossier: null }),
  showOverview: () =>
    set((s) => ({ selectedRoom: null, dossier: null, overviewRequest: s.overviewRequest + 1 })),
  openDossier: (dossier) => set({ dossier }),
  setDossierSection: (section) =>
    set((s) => (s.dossier ? { dossier: { ...s.dossier, section } } : {})),
  closeDossier: () => set({ dossier: null }),
}));
