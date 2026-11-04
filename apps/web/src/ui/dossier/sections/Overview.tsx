import {
  PROSPECT_STAGE_LABELS,
  PROSPECT_STAGE_ROOMS,
  RELATIONSHIP_STATUS_LABELS,
  ROOM_LABELS,
  type ProspectDossier,
} from '@agency/shared';
import { useAgencyStore } from '../../../stores/agencyStore';
import { formatCompact, formatDate, formatDateTime, formatInt, formatRelative } from '../format';
import { Card, Field, Fields, Missing, PriorityDots } from '../primitives';
import { Timeline } from './Timeline';

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="d-stat">
      <span className="d-stat__value" title={value === null ? undefined : formatInt(value)}>
        {value === null ? '—' : formatCompact(value)}
      </span>
      <span className="d-stat__label">{label}</span>
    </div>
  );
}

/** Vue générale : identité, statistiques, situation et parcours récent. */
export function OverviewSection({ dossier }: { dossier: ProspectDossier }) {
  const p = dossier.prospect;
  const setSection = useAgencyStore((s) => s.setDossierSection);
  const room = PROSPECT_STAGE_ROOMS[p.stage];
  const latestAnalysis = dossier.analyses[0];

  return (
    <div className="d-section d-grid">
      <Card title="Chaîne" icon="📺">
        <Fields>
          <Field label="Créateur">{p.creatorName}</Field>
          <Field label="Chaîne">{p.channelName}</Field>
          <Field label="Identifiant">{p.channelHandle}</Field>
          <Field label="Adresse">
            {p.channelUrl && (
              <a href={p.channelUrl} target="_blank" rel="noreferrer noopener">
                {p.channelUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </Field>
          <Field label="Catégorie">{p.category}</Field>
          <Field label="Pays">{p.country}</Field>
        </Fields>
        <p className="d-description">{p.description ?? <Missing label="Aucune description" />}</p>
      </Card>

      <Card title="Situation" icon="🧭">
        <Fields>
          <Field label="Statut global">
            <span className={`d-stage d-stage--${p.stage}`}>{PROSPECT_STAGE_LABELS[p.stage]}</span>
          </Field>
          <Field label="Salle actuelle">{room ? ROOM_LABELS[room] : 'Hors parcours'}</Field>
          <Field label="Relation">
            {p.relationshipStatus && RELATIONSHIP_STATUS_LABELS[p.relationshipStatus]}
          </Field>
          <Field label="Priorité">
            <PriorityDots value={p.priority} />
          </Field>
          <Field label="Découvert le">{formatDate(p.discoveredAt)}</Field>
          <Field label="Dernière activité">
            {formatDateTime(p.lastActivityAt)}{' '}
            <span className="d-muted">({formatRelative(p.lastActivityAt)})</span>
          </Field>
          <Field label="Prochaine action">
            {p.nextAction &&
              `${p.nextAction}${p.nextActionAt ? ` — ${formatDate(p.nextActionAt)}` : ''}`}
          </Field>
        </Fields>
        {p.doNotContact && (
          <p className="d-alert d-alert--error">
            ⛔ Ne plus contacter ce prospect
            {p.doNotContactReason ? ` : ${p.doNotContactReason}` : '.'}
          </p>
        )}
      </Card>

      <Card title="Statistiques YouTube" icon="📈">
        <div className="d-stats">
          <Stat label="abonnés" value={p.subscriberCount} />
          <Stat label="vues" value={p.viewCount} />
          <Stat label="vidéos" value={p.videoCount} />
        </div>
        <p className="d-caption">
          {p.statsSource ? (
            <>
              Source : {p.statsSource}
              {p.statsUpdatedAt && ` · relevé le ${formatDate(p.statsUpdatedAt)}`}
            </>
          ) : (
            'Aucune statistique relevée.'
          )}
        </p>
      </Card>

      <Card title="En bref" icon="💡">
        {latestAnalysis ? (
          <>
            <p className="d-lead">{latestAnalysis.summary}</p>
            <p className="d-muted">
              Analyse v{latestAnalysis.version} du {formatDate(latestAnalysis.createdAt)}
              {latestAnalysis.score !== null && ` · score ${latestAnalysis.score}/100`}
            </p>
          </>
        ) : (
          <p className="d-muted">
            {p.discovery?.reason ?? 'Aucune analyse pour le moment.'}
            <br />
            Aucune analyse n’a encore été réalisée.
          </p>
        )}
      </Card>

      <Card
        title="Parcours récent"
        icon="🕑"
        className="d-grid__wide"
        aside={
          <button type="button" className="link-button" onClick={() => setSection('timeline')}>
            Tout l’historique ({dossier.events.length})
          </button>
        }
      >
        <Timeline events={dossier.events} limit={5} newestFirst />
      </Card>
    </div>
  );
}
