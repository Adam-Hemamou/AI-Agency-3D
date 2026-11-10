import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '@agency/shared';
import { HealthStatus } from './HealthStatus';

const healthy: HealthResponse = {
  status: 'ok',
  version: '0.1.0',
  simulationMode: true,
  uptimeSeconds: 10,
  checks: { database: { status: 'up', latencyMs: 4 } },
  timestamp: '2026-10-29T00:00:00.000Z',
};

describe('HealthStatus', () => {
  it('indique la vérification en cours', () => {
    render(<HealthStatus isLoading />);
    expect(screen.getByText('Vérification…')).toBeInTheDocument();
  });

  it("affiche l'API, la base et le mode simulation quand tout va bien", () => {
    render(<HealthStatus isLoading={false} health={healthy} />);
    expect(screen.getByText('En ligne · v0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Connectée · 4 ms')).toBeInTheDocument();
    expect(
      screen.getByText('Actif — lectures publiques seulement, ni dépense ni envoi'),
    ).toBeInTheDocument();
  });

  it('signale une base hors ligne', () => {
    render(
      <HealthStatus
        isLoading={false}
        health={{
          ...healthy,
          status: 'degraded',
          checks: { database: { status: 'down', error: 'connexion refusée' } },
        }}
      />,
    );
    expect(screen.getByText('Hors ligne · connexion refusée')).toBeInTheDocument();
  });

  it("affiche l'erreur quand l'API est injoignable", () => {
    render(<HealthStatus isLoading={false} error={new Error('Le serveur est injoignable')} />);
    expect(screen.getByText('Le serveur est injoignable')).toBeInTheDocument();
  });

  it('alerte si le mode simulation est désactivé', () => {
    render(<HealthStatus isLoading={false} health={{ ...healthy, simulationMode: false }} />);
    expect(screen.getByText('DÉSACTIVÉ')).toBeInTheDocument();
  });
});
