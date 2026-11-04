import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_IDS, ROOM_LABELS } from '@agency/shared';
import { useAgencyStore } from '../../stores/agencyStore';
import { AgencyHud } from './AgencyHud';

function renderHud() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgencyHud />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAgencyStore.setState({ hoveredRoom: null, selectedRoom: null, overviewRequest: 0 });
  // L'état du système n'est pas l'objet de ces tests : l'API est simplement injoignable.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('hors ligne'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgencyHud', () => {
  it('liste les sept salles dans l’ordre du pipeline', () => {
    renderHud();
    const buttons = screen.getAllByRole('button', { pressed: false });
    expect(buttons).toHaveLength(ROOM_IDS.length);
    ROOM_IDS.forEach((id, i) => {
      expect(buttons[i]).toHaveTextContent(ROOM_LABELS[id]);
    });
  });

  it('ouvre une salle au clic', () => {
    renderHud();
    fireEvent.click(screen.getByRole('button', { name: /Studio de doublage/ }));
    expect(useAgencyStore.getState().selectedRoom).toBe('dubbing');
    expect(screen.getByRole('button', { name: /Studio de doublage/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('met la salle en évidence au survol', () => {
    renderHud();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Mon bureau/ }));
    expect(useAgencyStore.getState().hoveredRoom).toBe('director');
    fireEvent.mouseLeave(screen.getByRole('button', { name: /Mon bureau/ }));
    expect(useAgencyStore.getState().hoveredRoom).toBeNull();
  });

  it('revient à la vue d’ensemble', () => {
    useAgencyStore.setState({ selectedRoom: 'analysis' });
    renderHud();
    fireEvent.click(screen.getByRole('button', { name: /Vue d’ensemble/ }));
    expect(useAgencyStore.getState()).toMatchObject({ selectedRoom: null, overviewRequest: 1 });
  });
});
