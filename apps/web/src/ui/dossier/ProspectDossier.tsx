import { useId } from 'react';
import {
  DOSSIER_SECTIONS,
  DOSSIER_SECTION_LABELS,
  PROSPECT_STAGE_LABELS,
  PROSPECT_STAGE_ROOMS,
  ROOM_IDS,
  ROOM_LABELS,
  type DossierSection,
  type ProspectDossier as Dossier,
} from '@agency/shared';
import { SPACE_DESIGNS } from '../../scene/rooms/roomDesigns';
import { DossierActionsProvider } from './actions';
import { formatDate, formatRelative, isPast } from './format';
import { Avatar, PriorityDots } from './primitives';
import { AnalysisSection } from './sections/Analysis';
import { CommercialSection } from './sections/Commercial';
import { DecisionSection } from './sections/Decision';
import { DubbingSection } from './sections/Dubbing';
import { EmailsSection } from './sections/Emails';
import { FollowupSection } from './sections/Followup';
import { MissionsSection } from './sections/Missions';
import { OverviewSection } from './sections/Overview';
import { ProspectingSection } from './sections/Prospecting';
import { TimelineSection } from './sections/Timeline';

const SECTION_ICONS: Record<DossierSection, string> = {
  overview: '🗂️',
  prospecting: '🔍',
  analysis: '🌍',
  decision: '✅',
  dubbing: '🎙️',
  commercial: '✍️',
  emails: '📧',
  followup: '🤝',
  timeline: '🕑',
  missions: '📋',
};

/** Tampon « encre » apposé sur la couverture selon l'étape. */
const STAMP_TONES: Partial<Record<Dossier['prospect']['stage'], string>> = {
  review: 'warn',
  refused: 'error',
  converted: 'ok',
  archived: 'muted',
};

/** Étapes du parcours (les 7 salles), avec la position actuelle du prospect. */
function Journey({ dossier }: { dossier: Dossier }) {
  const { stage } = dossier.prospect;
  const currentRoom = PROSPECT_STAGE_ROOMS[stage];
  const visited = new Set(dossier.missions.map((m) => m.room));
  const currentIndex = currentRoom ? ROOM_IDS.indexOf(currentRoom) : -1;
  const ended = stage === 'converted' || stage === 'refused' || stage === 'archived';

  return (
    <ol className="d-journey" aria-label="Parcours dans l’agence">
      {ROOM_IDS.map((room, index) => {
        const design = SPACE_DESIGNS[room];
        const state =
          room === currentRoom && !ended
            ? 'current'
            : room === currentRoom && stage === 'refused'
              ? 'stopped'
              : visited.has(room) || (stage === 'converted' && index <= currentIndex)
                ? 'done'
                : 'todo';
        return (
          <li
            key={room}
            className={`d-journey__step is-${state}`}
            style={{ ['--room' as string]: design.theme.accent }}
            title={`${ROOM_LABELS[room]}${state === 'current' ? ' (étape actuelle)' : ''}`}
          >
            <span className="d-journey__icon" aria-hidden="true">
              {design.icon}
            </span>
            <span className="d-journey__label">{ROOM_LABELS[room]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Cover({ dossier }: { dossier: Dossier }) {
  const p = dossier.prospect;
  const stampTone = STAMP_TONES[p.stage] ?? 'info';
  return (
    <aside className="dossier__cover" aria-label="Fiche d’identité">
      <div className="d-idcard">
        <svg className="d-clip" viewBox="0 0 30 80" aria-hidden="true">
          <path
            d="M10 70 V16 a8 8 0 0 1 16 0 V60 a12 12 0 0 1 -24 0 V22"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className="d-polaroid">
          <Avatar name={p.creatorName} url={p.avatarUrl} size={104} />
        </div>
        <p className="d-idcard__ref">Dossier n° {p.reference}</p>
        <h3 className="d-idcard__name">{p.creatorName}</h3>
        <p className="d-idcard__channel">{p.channelName}</p>
        <span className={`d-stamp d-stamp--${stampTone}`}>{PROSPECT_STAGE_LABELS[p.stage]}</span>
        <dl className="d-idcard__facts">
          <div>
            <dt>Priorité</dt>
            <dd>
              <PriorityDots value={p.priority} />
            </dd>
          </div>
          <div>
            <dt>Créé le</dt>
            <dd>{formatDate(p.createdAt)}</dd>
          </div>
          <div>
            <dt>Activité</dt>
            <dd>{formatRelative(p.lastActivityAt)}</dd>
          </div>
          {p.category && (
            <div>
              <dt>Niche</dt>
              <dd>{p.category}</dd>
            </div>
          )}
        </dl>
        {p.isDemo && <p className="d-idcard__demo">Données fictives</p>}
      </div>
      <Journey dossier={dossier} />
    </aside>
  );
}

function Section({
  section,
  dossier,
  missionId,
}: {
  section: DossierSection;
  dossier: Dossier;
  missionId: string;
}) {
  switch (section) {
    case 'overview':
      return <OverviewSection dossier={dossier} />;
    case 'prospecting':
      return <ProspectingSection dossier={dossier} />;
    case 'analysis':
      return <AnalysisSection dossier={dossier} />;
    case 'decision':
      return <DecisionSection dossier={dossier} />;
    case 'dubbing':
      return <DubbingSection dossier={dossier} />;
    case 'commercial':
      return <CommercialSection dossier={dossier} />;
    case 'emails':
      return <EmailsSection dossier={dossier} />;
    case 'followup':
      return <FollowupSection dossier={dossier} />;
    case 'timeline':
      return <TimelineSection events={dossier.events} />;
    case 'missions':
      return <MissionsSection missions={dossier.missions} activeMissionId={missionId} />;
  }
}

/** Badges des onglets : ce qui attend une action humaine. */
function sectionAlert(section: DossierSection, dossier: Dossier): boolean {
  const waiting = (room: string) =>
    dossier.missions.some((m) => m.room === room && m.status === 'awaiting_validation');
  if (section === 'decision') return waiting('director');
  if (section === 'emails') return waiting('email_review');
  if (section === 'followup') {
    const at = dossier.prospect.nextActionAt;
    return dossier.prospect.stage === 'followup' && isPast(at);
  }
  return false;
}

/**
 * Le dossier physique : couverture cartonnée (fiche d'identité, trombone, tampon)
 * et feuilles intérieures avec onglets. Interface HTML au-dessus de la scène 3D.
 */
export function ProspectDossier({
  dossier,
  section,
  missionId,
  onSection,
}: {
  dossier: Dossier;
  section: DossierSection;
  missionId: string;
  onSection: (section: DossierSection) => void;
}) {
  const titleId = useId();
  const tabsId = useId();
  const mission = dossier.missions.find((m) => m.id === missionId);

  return (
    <DossierActionsProvider prospectId={dossier.prospect.id}>
      <div className="dossier__tabs" role="tablist" aria-label="Sections du dossier">
        {DOSSIER_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`${tabsId}-${s}`}
            aria-selected={s === section}
            aria-controls={`${tabsId}-panel`}
            className={`dossier__tab ${s === section ? 'is-active' : ''}`}
            onClick={() => onSection(s)}
          >
            <span aria-hidden="true">{SECTION_ICONS[s]}</span> {DOSSIER_SECTION_LABELS[s]}
            {sectionAlert(s, dossier) && (
              <span className="dossier__tab-alert" aria-label="(action requise)" />
            )}
          </button>
        ))}
      </div>
      <div className="dossier__folder">
        <Cover dossier={dossier} />
        <div className="dossier__sheet">
          <header className="dossier__sheet-header">
            <div>
              <p className="dossier__kicker">
                {dossier.prospect.reference} · {dossier.prospect.channelName}
              </p>
              <h2 id={titleId} className="dossier__title">
                {SECTION_ICONS[section]} {DOSSIER_SECTION_LABELS[section]}
              </h2>
            </div>
            {mission && (
              <p className="dossier__context">
                Ouvert depuis : {SPACE_DESIGNS[mission.room].icon} {ROOM_LABELS[mission.room]}
              </p>
            )}
          </header>
          <div
            className="dossier__content"
            id={`${tabsId}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-${section}`}
          >
            <Section section={section} dossier={dossier} missionId={missionId} />
          </div>
        </div>
      </div>
    </DossierActionsProvider>
  );
}
