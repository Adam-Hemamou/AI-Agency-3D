import type { HealthResponse } from '@agency/shared';

type Tone = 'ok' | 'warn' | 'error' | 'muted';

function Indicator({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <li className="indicator">
      <span className={`dot dot--${tone}`} aria-hidden="true" />
      <span className="indicator__label">{label}</span>
      <span className="indicator__value">{value}</span>
    </li>
  );
}

export interface HealthStatusProps {
  health?: HealthResponse;
  isLoading: boolean;
  error?: Error | null;
}

/** Panneau d'état des fondations : API, base de données, mode simulation. */
export function HealthStatus({ health, isLoading, error }: HealthStatusProps) {
  if (isLoading) {
    return (
      <ul className="indicators" aria-label="État du système">
        <Indicator label="API" value="Vérification…" tone="muted" />
      </ul>
    );
  }

  if (error || !health) {
    return (
      <ul className="indicators" aria-label="État du système">
        <Indicator label="API" value={error?.message ?? 'Indisponible'} tone="error" />
      </ul>
    );
  }

  const db = health.checks.database;
  return (
    <ul className="indicators" aria-label="État du système">
      <Indicator label="API" value={`En ligne · v${health.version}`} tone="ok" />
      <Indicator
        label="Base de données"
        value={
          db.status === 'up'
            ? `Connectée · ${db.latencyMs ?? 0} ms`
            : `Hors ligne · ${db.error ?? ''}`
        }
        tone={db.status === 'up' ? 'ok' : 'error'}
      />
      <Indicator
        label="Mode simulation"
        value={
          health.simulationMode
            ? 'Actif — lectures publiques seulement, ni dépense ni envoi'
            : 'DÉSACTIVÉ'
        }
        tone={health.simulationMode ? 'ok' : 'warn'}
      />
      {health.demoMode && (
        <Indicator label="Données" value="Démonstration (fictives)" tone="warn" />
      )}
    </ul>
  );
}
