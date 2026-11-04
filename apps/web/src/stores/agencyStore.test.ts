import { beforeEach, describe, expect, it } from 'vitest';
import { useAgencyStore } from './agencyStore';

beforeEach(() => {
  useAgencyStore.setState({ hoveredRoom: null, selectedRoom: null, overviewRequest: 0 });
});

describe('état de l’agence', () => {
  it('sélectionne et ferme une salle', () => {
    useAgencyStore.getState().selectRoom('dubbing');
    expect(useAgencyStore.getState().selectedRoom).toBe('dubbing');
    useAgencyStore.getState().closeRoom();
    expect(useAgencyStore.getState().selectedRoom).toBeNull();
  });

  it('mémorise la salle survolée', () => {
    useAgencyStore.getState().setHoveredRoom('analysis');
    expect(useAgencyStore.getState().hoveredRoom).toBe('analysis');
  });

  it('la vue d’ensemble ferme la salle et demande un recadrage', () => {
    useAgencyStore.getState().selectRoom('director');
    useAgencyStore.getState().showOverview();
    expect(useAgencyStore.getState()).toMatchObject({ selectedRoom: null, overviewRequest: 1 });
  });
});
