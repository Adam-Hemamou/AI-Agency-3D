import { ROOM_LABELS, type ProspectEvent } from '@agency/shared';
import { SPACE_DESIGNS } from '../../../scene/rooms/roomDesigns';
import { actorLabel, formatDay, formatTime } from '../format';
import { EmptyState } from '../primitives';

/** Icônes par type d'événement (en plus de la couleur de la salle). */
const EVENT_ICONS: Record<ProspectEvent['type'], string> = {
  discovered: '🔍',
  stage_changed: '➜',
  analysis_added: '📊',
  production_added: '📎',
  production_status_changed: '🔄',
  decision_recorded: '⚖️',
  email_sent: '📨',
  reply_received: '💬',
  followup_sent: '🔁',
  followup_updated: '📌',
  note_added: '📝',
  mission_linked: '🔗',
};

/**
 * Timeline du parcours : uniquement les événements réellement enregistrés,
 * regroupés par jour. Les étapes anciennes restent visibles dans toutes les salles.
 */
export function Timeline({
  events,
  limit,
  newestFirst = false,
}: {
  events: ProspectEvent[];
  limit?: number;
  newestFirst?: boolean;
}) {
  if (events.length === 0) {
    return <EmptyState title="Aucun événement enregistré">Le parcours apparaîtra ici.</EmptyState>;
  }
  let list = newestFirst ? [...events].reverse() : events;
  if (limit) list = list.slice(0, limit);

  const groups: { day: string; items: ProspectEvent[] }[] = [];
  for (const event of list) {
    const day = formatDay(event.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(event);
    else groups.push({ day, items: [event] });
  }

  return (
    <ol className="d-timeline" aria-label="Historique du prospect">
      {groups.map((group) => (
        <li key={group.day} className="d-timeline__day">
          <p className="d-timeline__date">{group.day}</p>
          <ol>
            {group.items.map((event) => {
              const design = event.room ? SPACE_DESIGNS[event.room] : null;
              return (
                <li
                  key={event.id}
                  className={`d-timeline__item d-timeline__item--${event.type}`}
                  style={{ ['--room' as string]: design?.theme.accent ?? '#9a8f80' }}
                >
                  <span className="d-timeline__dot" aria-hidden="true">
                    {EVENT_ICONS[event.type]}
                  </span>
                  <div className="d-timeline__body">
                    <p className="d-timeline__title">
                      {event.title}
                      <time className="d-timeline__time" dateTime={event.createdAt}>
                        {formatTime(event.createdAt)}
                      </time>
                    </p>
                    {event.details && <p className="d-timeline__details">{event.details}</p>}
                    <p className="d-timeline__meta">
                      {event.room && (
                        <span>
                          {design?.icon} {ROOM_LABELS[event.room]}
                        </span>
                      )}
                      <span>{actorLabel(event.actorType, event.actorId)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

export function TimelineSection({ events }: { events: ProspectEvent[] }) {
  return (
    <div className="d-section">
      <p className="d-section__intro">
        Parcours complet du prospect dans l’agence, du plus ancien au plus récent. Seuls les
        événements réellement enregistrés apparaissent.
      </p>
      <Timeline events={events} />
    </div>
  );
}
