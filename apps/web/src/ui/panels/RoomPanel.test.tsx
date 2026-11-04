import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MissionListItem as Mission, MissionListResponse } from '@agency/shared';
import { RoomPanel, type RoomPanelProps } from './RoomPanel';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: crypto.randomUUID(),
    type: 'score_creator',
    room: 'analysis',
    status: 'pending',
    priority: 3,
    input: {},
    output: null,
    requiresValidation: false,
    validationOutcome: null,
    validatedAt: null,
    validatedBy: null,
    agentId: null,
    prospectId: null,
    prospect: null,
    attemptCount: 0,
    maxAttempts: 3,
    lastErrorCode: null,
    lastErrorMessage: null,
    version: 0,
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function list(items: Mission[], total = items.length): MissionListResponse {
  return { items, total, limit: 50, offset: 0 };
}

function renderPanel(props: Partial<RoomPanelProps> = {}) {
  const onClose = vi.fn();
  const onRetry = vi.fn();
  render(
    <RoomPanel
      room="analysis"
      accent="#3d7cc9"
      icon="🌍"
      isLoading={false}
      onClose={onClose}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onClose, onRetry };
}

describe('RoomPanel', () => {
  it('affiche le nom et la fonction de la salle', () => {
    renderPanel({ data: list([]) });
    expect(screen.getByRole('heading', { name: "Salle d'analyse" })).toBeInTheDocument();
    expect(screen.getByText('Étude du potentiel international des créateurs.')).toBeInTheDocument();
  });

  it('indique le chargement', () => {
    renderPanel({ isLoading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Chargement des missions');
    expect(screen.getByTestId('mission-count')).toHaveTextContent('–');
  });

  it('affiche un état vide quand la salle n’a aucune mission', () => {
    renderPanel({ data: list([]) });
    expect(screen.getByText('Aucune mission dans cette salle')).toBeInTheDocument();
    expect(screen.getByTestId('mission-count')).toHaveTextContent('0');
    expect(screen.getByText('mission')).toBeInTheDocument();
  });

  it('liste les missions avec leur statut et le nombre total', () => {
    renderPanel({
      data: list([
        mission({ type: 'score_creator', status: 'in_progress', priority: 5 }),
        mission({ type: 'review_channel', status: 'blocked', requiresValidation: true }),
      ]),
    });
    expect(screen.getByTestId('mission-count')).toHaveTextContent('2');
    expect(screen.getByText('missions')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Missions de la salle' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('score_creator')).toBeInTheDocument();
    expect(within(items[0]!).getByText('En cours')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Priorité 5')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Bloquée')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Validation humaine')).toBeInTheDocument();
  });

  it('résume la répartition par statut', () => {
    renderPanel({
      data: list([
        mission({ status: 'pending' }),
        mission({ status: 'pending' }),
        mission({ status: 'completed' }),
      ]),
    });
    const summary = screen.getByRole('list', { name: 'Répartition par statut' });
    expect(summary).toHaveTextContent('2 en attente');
    expect(summary).toHaveTextContent('1 terminée(s)');
  });

  it('signale quand seule une partie des missions est affichée', () => {
    renderPanel({ data: list([mission()], 120) });
    expect(screen.getByTestId('mission-count')).toHaveTextContent('120');
    expect(screen.getByText('… et 119 autre(s).')).toBeInTheDocument();
  });

  it('affiche l’erreur et permet de réessayer', () => {
    const { onRetry } = renderPanel({ error: new Error('Le serveur est injoignable') });
    expect(screen.getByRole('alert')).toHaveTextContent('Le serveur est injoignable');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('se ferme avec le bouton ✕', () => {
    const { onClose } = renderPanel({ data: list([]) });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le panneau' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('donne le focus au bouton de fermeture à l’ouverture', () => {
    renderPanel({ data: list([]) });
    expect(screen.getByRole('button', { name: 'Fermer le panneau' })).toHaveFocus();
  });
  it('affiche le prospect de la mission et ouvre son dossier au clic', () => {
    const onOpenMission = vi.fn();
    const m = mission({
      type: 'review_prospect',
      prospectId: 'p1',
      prospect: {
        id: 'p1',
        reference: 'P-2026-0001',
        creatorName: 'Créatrice Fictive',
        channelName: 'Chaîne Fictive',
        stage: 'review',
      },
    });
    renderPanel({ data: list([m, mission()]), onOpenMission, activeMissionId: m.id });
    const button = screen.getByRole('button', { name: /Créatrice Fictive/ });
    expect(button).toHaveTextContent('P-2026-0001');
    expect(button).toHaveTextContent('Validation du prospect');
    expect(button).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Sans prospect associé')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenMission).toHaveBeenCalledWith(m);
  });
});
