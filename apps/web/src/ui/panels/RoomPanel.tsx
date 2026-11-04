import { useEffect, useRef } from 'react';
import {
  MISSION_STATUSES,
  ROOM_DESCRIPTIONS,
  ROOM_LABELS,
  missionTypeLabel,
  type MissionListItem,
  type MissionListResponse,
  type RoomId,
} from '@agency/shared';
import { STATUS_TONES, StatusBadge } from '../components/StatusBadge';

/**
 * Panneau d'une salle : nom, fonction, nombre de missions et liste.
 * Composant d'affichage pur : les données sont fournies par le conteneur (API).
 */

export interface RoomPanelProps {
  room: RoomId;
  accent: string;
  icon: string;
  data?: MissionListResponse;
  isLoading: boolean;
  error?: Error | null;
  onClose: () => void;
  onRetry: () => void;
  /** Ouvre le dossier lié à la mission. */
  onOpenMission?: (mission: MissionListItem) => void;
  /** Mission dont le dossier est ouvert (mise en évidence). */
  activeMissionId?: string | null;
}

type Mission = MissionListItem;

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function MissionItem({
  mission,
  active,
  onOpen,
}: {
  mission: Mission;
  active: boolean;
  onOpen?: (mission: Mission) => void;
}) {
  const prospect = mission.prospect;
  const typeLabel = missionTypeLabel(mission.type);
  return (
    <li>
      <button
        type="button"
        className={`mission-item ${active ? 'mission-item--active' : ''}`}
        onClick={() => onOpen?.(mission)}
        aria-current={active ? 'true' : undefined}
        title={prospect ? `Ouvrir le dossier ${prospect.reference}` : 'Voir la mission'}
      >
        <div className="mission-item__main">
          <span className="mission-item__type">{prospect ? prospect.creatorName : typeLabel}</span>
          <StatusBadge status={mission.status} />
        </div>
        {prospect ? (
          <div className="mission-item__prospect">
            <span className="mission-item__ref">{prospect.reference}</span>
            <span>{prospect.channelName}</span>
            <span aria-hidden="true">·</span>
            <span>{typeLabel}</span>
          </div>
        ) : (
          <div className="mission-item__prospect mission-item__prospect--none">
            Sans prospect associé
          </div>
        )}
        <div className="mission-item__meta">
          <span title="Priorité (1 à 5)">Priorité {mission.priority}</span>
          {mission.requiresValidation && (
            <span className="mission-item__tag">Validation humaine</span>
          )}
          <span>Créée le {dateFormat.format(new Date(mission.createdAt))}</span>
        </div>
      </button>
    </li>
  );
}

function StatusSummary({ items }: { items: Mission[] }) {
  const counts = MISSION_STATUSES.map((status) => ({
    status,
    count: items.filter((m) => m.status === status).length,
  })).filter((c) => c.count > 0);
  return (
    <ul className="status-summary" aria-label="Répartition par statut">
      {counts.map(({ status, count }) => (
        <li
          key={status}
          style={{ background: STATUS_TONES[status].bg, color: STATUS_TONES[status].fg }}
        >
          <strong>{count}</strong>{' '}
          <span className="status-summary__label">{STATUS_LABEL_SHORT[status]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Libellés courts pour le résumé (« 3 en cours »). */
const STATUS_LABEL_SHORT: Record<Mission['status'], string> = {
  pending: 'en attente',
  in_progress: 'en cours',
  awaiting_validation: 'à valider',
  paused: 'en pause',
  completed: 'terminée(s)',
  cancelled: 'annulée(s)',
  blocked: 'bloquée(s)',
};

function Body({
  data,
  isLoading,
  error,
  onRetry,
  onOpenMission,
  activeMissionId,
}: Pick<
  RoomPanelProps,
  'data' | 'isLoading' | 'error' | 'onRetry' | 'onOpenMission' | 'activeMissionId'
>) {
  if (isLoading) {
    return (
      <div className="room-panel__state" role="status">
        <span className="spinner" aria-hidden="true" /> Chargement des missions…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="room-panel__state room-panel__state--error" role="alert">
        <p>Impossible de charger les missions.</p>
        <p className="room-panel__hint">{error?.message ?? 'Réponse vide du serveur.'}</p>
        <button type="button" className="button" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="room-panel__empty">
        <div className="room-panel__empty-icon" aria-hidden="true">
          🗂️
        </div>
        <p className="room-panel__empty-title">Aucune mission dans cette salle</p>
        <p className="room-panel__hint">
          Les missions apparaîtront ici dès qu’elles seront créées.
        </p>
      </div>
    );
  }

  const partial = data.items.length < data.total;
  return (
    <>
      <StatusSummary items={data.items} />
      {partial && (
        <p className="room-panel__hint">
          Répartition calculée sur les {data.items.length} missions les plus prioritaires.
        </p>
      )}
      <ul className="mission-list" aria-label="Missions de la salle">
        {data.items.map((m) => (
          <MissionItem
            key={m.id}
            mission={m}
            active={m.id === activeMissionId}
            onOpen={onOpenMission}
          />
        ))}
      </ul>
      {partial && (
        <p className="room-panel__hint">… et {data.total - data.items.length} autre(s).</p>
      )}
    </>
  );
}

export function RoomPanel({
  room,
  accent,
  icon,
  data,
  isLoading,
  error,
  onClose,
  onRetry,
  onOpenMission,
  activeMissionId = null,
}: RoomPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Le focus clavier va au panneau quand il s'ouvre (accessibilité).
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [room]);

  const count = data?.total;
  return (
    <aside
      className="room-panel"
      aria-labelledby="room-panel-title"
      style={{ ['--accent' as string]: accent }}
    >
      <header className="room-panel__header">
        <div className="room-panel__icon" aria-hidden="true">
          {icon}
        </div>
        <div className="room-panel__titles">
          <h2 id="room-panel-title" className="room-panel__title">
            {ROOM_LABELS[room]}
          </h2>
          <p className="room-panel__description">{ROOM_DESCRIPTIONS[room]}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fermer le panneau"
        >
          ✕
        </button>
      </header>

      <div className="room-panel__count">
        <span className="room-panel__count-value" data-testid="mission-count">
          {count === undefined ? '–' : count}
        </span>
        <span className="room-panel__count-label">
          {count !== undefined && count > 1 ? 'missions' : 'mission'}
        </span>
        <button type="button" className="link-button" onClick={onRetry} disabled={isLoading}>
          Actualiser
        </button>
      </div>

      <div className="room-panel__body">
        <Body
          data={data}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          onOpenMission={onOpenMission}
          activeMissionId={activeMissionId}
        />
      </div>
    </aside>
  );
}
