import { useHealth } from './api/health';
import { FoundationScene } from './scene/FoundationScene';
import { HealthStatus } from './ui/components/HealthStatus';

export function App() {
  const health = useHealth();

  return (
    <div className="app">
      <div className="app__scene">
        <FoundationScene />
      </div>

      <aside className="panel" aria-label="Fondations">
        <header className="panel__header">
          <p className="panel__eyebrow">Phase 0 · Fondations</p>
          <h1 className="panel__title">AI Agency 3D</h1>
        </header>
        <HealthStatus health={health.data} isLoading={health.isLoading} error={health.error} />
        <p className="panel__note">
          Scène de test : déplacez-vous avec le clic gauche et zoomez avec la molette. Les salles
          arriveront en phase 2.
        </p>
      </aside>
    </div>
  );
}
