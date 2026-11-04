import { useState } from 'react';
import {
  MISSION_ACTION_LABELS,
  VALIDATION_DECISION_LABELS,
  ROOM_LABELS,
  missionTypeLabel,
  type Mission,
  type MissionEvent,
  type MissionEventAction,
} from '@agency/shared';
import { useMissionEvents } from '../../../api/prospects';
import { SPACE_DESIGNS } from '../../../scene/rooms/roomDesigns';
import { StatusBadge } from '../../components/StatusBadge';
import { actorLabel, formatDateTime } from '../format';
import { EmptyState } from '../primitives';

const EVENT_LABELS: Record<MissionEventAction, string> = {
  created: 'Création',
  ...MISSION_ACTION_LABELS,
  ...VALIDATION_DECISION_LABELS,
};

function MissionEvents({ missionId }: { missionId: string }) {
  const events = useMissionEvents(missionId);
  if (events.isLoading) return <p className="d-muted">Chargement de l’historique…</p>;
  if (events.error || !events.data) {
    return <p className="d-alert d-alert--error">Historique indisponible.</p>;
  }
  return (
    <ol className="d-mission-events">
      {events.data.items.map((e: MissionEvent) => (
        <li key={e.id}>
          <strong>{EVENT_LABELS[e.action]}</strong>
          <span className="d-muted">
            {formatDateTime(e.createdAt)} · {actorLabel(e.actorType, e.actorId)}
          </span>
          {e.reason && <span className="d-mission-events__reason">« {e.reason} »</span>}
        </li>
      ))}
    </ol>
  );
}

export function MissionRow({
  mission,
  highlighted,
  defaultOpen = false,
}: {
  mission: Mission;
  highlighted: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const design = SPACE_DESIGNS[mission.room];
  return (
    <li
      className={`d-mission ${highlighted ? 'is-highlighted' : ''}`}
      style={{ ['--room' as string]: design.theme.accent }}
    >
      <button
        type="button"
        className="d-mission__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="d-mission__room" aria-hidden="true">
          {design.icon}
        </span>
        <span className="d-mission__titles">
          <strong>{missionTypeLabel(mission.type)}</strong>
          <span className="d-muted">
            {ROOM_LABELS[mission.room]} · créée le {formatDateTime(mission.createdAt)}
            {mission.finishedAt && ` · close le ${formatDateTime(mission.finishedAt)}`}
          </span>
        </span>
        <StatusBadge status={mission.status} />
        <span className="d-mission__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="d-mission__body">
          <MissionEvents missionId={mission.id} />
        </div>
      )}
    </li>
  );
}

/** Toutes les missions du prospect, salle par salle, avec leur historique propre. */
export function MissionsSection({
  missions,
  activeMissionId,
}: {
  missions: Mission[];
  activeMissionId: string;
}) {
  if (missions.length === 0) {
    return <EmptyState title="Aucune mission pour ce prospect" />;
  }
  return (
    <div className="d-section">
      <p className="d-section__intro">
        Chaque mission garde son propre historique ; toutes renvoient vers ce même dossier.
      </p>
      <ol className="d-missions">
        {missions.map((m) => (
          <MissionRow key={m.id} mission={m} highlighted={m.id === activeMissionId} />
        ))}
      </ol>
    </div>
  );
}
