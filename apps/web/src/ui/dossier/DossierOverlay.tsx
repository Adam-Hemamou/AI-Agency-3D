import { useCallback, useEffect, useRef, useState } from 'react';
import './dossier.css';
import { useQuery } from '@tanstack/react-query';
import { missionSchema, missionTypeLabel, ROOM_LABELS } from '@agency/shared';
import { fetchJson } from '../../api/client';
import { useProspectDossier } from '../../api/prospects';
import { useAgencyStore, type OpenDossier } from '../../stores/agencyStore';
import { StatusBadge } from '../components/StatusBadge';
import { ProspectDossier } from './ProspectDossier';
import { EmptyState } from './primitives';
import { MissionRow } from './sections/Missions';

/** Durée de l'animation de fermeture (ms) : identique au CSS. */
const CLOSE_MS = 180;

function useMission(id: string | null) {
  return useQuery({
    queryKey: ['missions', id],
    queryFn: ({ signal }) => fetchJson(`/api/missions/${id}`, missionSchema, { signal }),
    enabled: id !== null,
    retry: false,
  });
}

/** Mission sans prospect : on affiche la mission elle-même, sans inventer de dossier. */
function MissionOnly({ missionId }: { missionId: string }) {
  const mission = useMission(missionId);
  if (mission.isLoading) return <LoadingState />;
  if (mission.error || !mission.data) {
    return <ErrorState message={mission.error?.message} onRetry={() => void mission.refetch()} />;
  }
  const m = mission.data;
  return (
    <div className="dossier__sheet dossier__sheet--solo">
      <div className="dossier__content">
        <EmptyState icon="📎" title="Mission sans prospect associé">
          Cette mission ({missionTypeLabel(m.type)}, {ROOM_LABELS[m.room]}) ne concerne aucun
          prospect : il n’existe donc pas de dossier à afficher.
        </EmptyState>
        <div className="d-solo-status">
          Statut : <StatusBadge status={m.status} />
        </div>
        {Object.keys(m.input).length > 0 && (
          <pre className="d-json" aria-label="Données d’entrée">
            {JSON.stringify(m.input, null, 2)}
          </pre>
        )}
        <ol className="d-missions">
          <MissionRow mission={m} highlighted defaultOpen />
        </ol>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="dossier__state" role="status">
      <span className="spinner" aria-hidden="true" /> Ouverture du dossier…
    </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="dossier__state dossier__state--error" role="alert">
      <p>Impossible d’ouvrir le dossier.</p>
      <p className="d-muted">{message ?? 'Réponse vide du serveur.'}</p>
      <button type="button" className="button" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}

function ProspectContent({ open }: { open: OpenDossier & { prospectId: string } }) {
  const setSection = useAgencyStore((s) => s.setDossierSection);
  const dossier = useProspectDossier(open.prospectId);
  if (dossier.isLoading) return <LoadingState />;
  if (dossier.error || !dossier.data) {
    return <ErrorState message={dossier.error?.message} onRetry={() => void dossier.refetch()} />;
  }
  return (
    <ProspectDossier
      dossier={dossier.data}
      section={open.section}
      missionId={open.missionId}
      onSection={setSection}
    />
  );
}

/**
 * Couche du dossier central : au-dessus de la scène 3D (qui ne reçoit plus les clics),
 * à côté du panneau de la salle qui reste visible et utilisable.
 * Croix, clic à l'extérieur ou Échap : ferme le dossier, jamais le panneau.
 */
export function DossierOverlay() {
  const open = useAgencyStore((s) => s.dossier);
  const closeDossier = useAgencyStore((s) => s.closeDossier);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      closeDossier();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      setClosing(false);
      closeDossier();
    }, CLOSE_MS);
  }, [closeDossier]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Échap ferme le dossier (le panneau l’ignore tant qu’un dossier est ouvert).
  // Une confirmation ouverte intercepte Échap avant (phase de capture) : elle seule se ferme.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  // Le focus clavier va au dossier quand il s'ouvre ou change de prospect.
  const key = open ? `${open.prospectId ?? ''}:${open.missionId}` : null;
  useEffect(() => {
    if (key) closeRef.current?.focus({ preventScroll: true });
  }, [key]);

  if (!open) return null;

  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      className="icon-button dossier__close"
      onClick={requestClose}
      aria-label="Fermer le dossier"
    >
      ✕
    </button>
  );

  return (
    <div className={`dossier-layer ${closing ? 'is-closing' : ''}`}>
      <div className="dossier-backdrop" onClick={requestClose} aria-hidden="true" />
      <section className="dossier" role="dialog" aria-label="Dossier du prospect" key={key}>
        {closeButton}
        {open.prospectId ? (
          <ProspectContent open={{ ...open, prospectId: open.prospectId }} />
        ) : (
          <MissionOnly missionId={open.missionId} />
        )}
      </section>
    </div>
  );
}
