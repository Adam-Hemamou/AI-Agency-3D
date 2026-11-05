import { ROOM_IDS } from '@agency/shared';
import { useLogout } from '../../api/auth';
import { useHealth } from '../../api/health';
import { SPACE_DESIGNS } from '../../scene/rooms/roomDesigns';
import { useAgencyStore } from '../../stores/agencyStore';
import { AgentsSwitch } from '../components/AgentsSwitch';
import { HealthStatus } from '../components/HealthStatus';

/** Éléments fixes par-dessus la scène : titre, état du système, plan des salles, aide. */
export function AgencyHud() {
  const health = useHealth();
  const logout = useLogout();
  const hoveredRoom = useAgencyStore((s) => s.hoveredRoom);
  const selectedRoom = useAgencyStore((s) => s.selectedRoom);
  const selectRoom = useAgencyStore((s) => s.selectRoom);
  const setHoveredRoom = useAgencyStore((s) => s.setHoveredRoom);
  const showOverview = useAgencyStore((s) => s.showOverview);

  return (
    <>
      {health.data?.demoMode && (
        <p className="hud-demo" role="note">
          <strong>Démonstration</strong> · données fictives, base séparée · aucune action réelle
        </p>
      )}
      <header className="hud-card hud-brand">
        <div className="hud-brand__logo" aria-hidden="true">
          ◆
        </div>
        <div>
          <h1 className="hud-brand__title">AI Agency 3D</h1>
          <p className="hud-brand__subtitle">Agence commerciale virtuelle</p>
        </div>
        <details className="hud-health">
          <summary>
            <span
              className={`dot dot--${health.data?.status === 'ok' ? 'ok' : health.isLoading ? 'muted' : 'error'}`}
              aria-hidden="true"
            />
            Système
          </summary>
          <HealthStatus health={health.data} isLoading={health.isLoading} error={health.error} />
        </details>
        <AgentsSwitch />
        <button
          type="button"
          className="hud-logout"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Se déconnecter
        </button>
      </header>

      <nav className="hud-card hud-rooms" aria-label="Salles de l'agence">
        <p className="hud-rooms__title">Salles</p>
        <ul>
          {ROOM_IDS.map((id, index) => {
            const design = SPACE_DESIGNS[id];
            const active = selectedRoom === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`hud-room ${active ? 'hud-room--active' : ''} ${hoveredRoom === id ? 'hud-room--hover' : ''}`}
                  style={{ ['--accent' as string]: design.theme.accent }}
                  aria-pressed={active}
                  onClick={() => selectRoom(id)}
                  onMouseEnter={() => setHoveredRoom(id)}
                  onMouseLeave={() => setHoveredRoom(null)}
                >
                  <span className="hud-room__step">{index + 1}</span>
                  <span className="hud-room__icon" aria-hidden="true">
                    {design.icon}
                  </span>
                  {design.label}
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="button button--ghost hud-rooms__overview"
          onClick={showOverview}
        >
          ⤢ Vue d’ensemble
        </button>
      </nav>

      <p className="hud-help" aria-label="Commandes">
        <span>Clic : ouvrir une salle</span>
        <span>Glisser : se déplacer</span>
        <span>Molette : zoomer</span>
        <span>Clic droit : pivoter</span>
        <span>Échap : fermer</span>
      </p>
    </>
  );
}
