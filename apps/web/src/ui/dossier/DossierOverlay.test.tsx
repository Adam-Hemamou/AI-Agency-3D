import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, ProspectDossier } from '@agency/shared';
import { useAgencyStore } from '../../stores/agencyStore';
import { DossierOverlay } from './DossierOverlay';

const NOW = '2026-11-01T10:00:00.000Z';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-review',
    type: 'review_prospect',
    room: 'director',
    status: 'awaiting_validation',
    priority: 4,
    input: {},
    output: null,
    requiresValidation: true,
    validationOutcome: null,
    validatedAt: null,
    validatedBy: null,
    agentId: null,
    prospectId: 'p1',
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

const dossier: ProspectDossier = {
  prospect: {
    id: 'p1',
    reference: 'P-2026-0001',
    creatorName: 'Créatrice Fictive',
    channelName: 'Chaîne Fictive',
    stage: 'review',
    channelHandle: null,
    channelUrl: null,
    avatarUrl: null,
    category: 'Cuisine',
    description: null,
    country: null,
    subscriberCount: null,
    viewCount: null,
    videoCount: null,
    statsSource: null,
    statsUpdatedAt: null,
    contactEmail: null,
    contactName: null,
    contactSource: null,
    discovery: null,
    relationshipStatus: null,
    priority: 3,
    doNotContact: false,
    doNotContactReason: null,
    nextAction: null,
    nextActionAt: null,
    isDemo: true,
    version: 5,
    discoveredAt: NOW,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  missions: [mission()],
  analyses: [],
  productions: [],
  decisions: [],
  messages: [],
  events: [],
};

function respond(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/dossier')) return respond(dossier);
  if (url.endsWith('/decisions') && init?.method === 'POST') {
    return respond({ ...dossier, prospect: { ...dossier.prospect, stage: 'dubbing' } });
  }
  if (url === '/api/missions/m-solo') {
    return respond(
      mission({
        id: 'm-solo',
        type: 'market_watch',
        room: 'prospecting',
        prospectId: null,
        status: 'pending',
      }),
    );
  }
  if (url.startsWith('/api/missions/')) return respond({ items: [] });
  return respond({ error: { code: 'NOT_FOUND', message: 'introuvable' } }, 404);
});

function renderOverlay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DossierOverlay />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  // Pas d'animation de fermeture dans les tests.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  useAgencyStore.setState({
    selectedRoom: 'director',
    dossier: { prospectId: 'p1', missionId: 'm-review', section: 'decision' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DossierOverlay', () => {
  it('ouvre le dossier du prospect sur la section de la salle', async () => {
    renderOverlay();
    expect(await screen.findByRole('heading', { name: 'Créatrice Fictive' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Validation');
    expect(screen.getByText('Prospect sans analyse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Valider le prospect/ })).toBeEnabled();
  });

  it('change de section avec les onglets', async () => {
    renderOverlay();
    fireEvent.click(await screen.findByRole('tab', { name: /Analyse/ }));
    expect(useAgencyStore.getState().dossier?.section).toBe('analysis');
    expect(await screen.findByText('Aucune analyse pour ce prospect')).toBeInTheDocument();
  });

  it('Échap ferme le dossier mais garde le panneau de la salle', async () => {
    renderOverlay();
    await screen.findByRole('heading', { name: 'Créatrice Fictive' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAgencyStore.getState().dossier).toBeNull();
    expect(useAgencyStore.getState().selectedRoom).toBe('director');
  });

  it('demande confirmation puis envoie la décision à l’API (jamais de statut modifié localement)', async () => {
    renderOverlay();
    fireEvent.click(await screen.findByRole('button', { name: /Valider le prospect/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/decisions'),
      expect.anything(),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider le prospect' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/prospects/p1/decisions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/decisions'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      missionId: 'm-review',
      expectedVersion: 5,
      decision: 'approve',
    });
    expect(await screen.findByText(/Prospect validé/)).toBeInTheDocument();
  });

  it('Échap dans la confirmation l’annule sans fermer le dossier', async () => {
    renderOverlay();
    fireEvent.click(await screen.findByRole('button', { name: /Refuser le prospect/ }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(useAgencyStore.getState().dossier).not.toBeNull();
  });

  it('affiche une mission sans prospect sans inventer de dossier', async () => {
    useAgencyStore.setState({
      dossier: { prospectId: null, missionId: 'm-solo', section: 'prospecting' },
    });
    renderOverlay();
    expect(await screen.findByText('Mission sans prospect associé')).toBeInTheDocument();
    expect(screen.getAllByText(/Veille de marché/).length).toBeGreaterThan(0);
  });
});
