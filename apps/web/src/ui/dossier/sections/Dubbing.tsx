import { useState } from 'react';
import type { ProductionOf, ProspectDossier } from '@agency/shared';
import { actorLabel, formatDate, formatDateTime, formatDuration, formatTimecode } from '../format';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Fields,
  Missing,
  ProductionBadge,
  VersionPicker,
} from '../primitives';

const GENERATION_LABELS = {
  not_started: { label: 'Non lancée', tone: 'neutral' },
  simulated: { label: 'Simulée', tone: 'info' },
  failed: { label: 'Échec', tone: 'error' },
  generated: { label: 'Générée', tone: 'ok' },
} as const;

/** Studio de doublage : vidéo source, configuration, résultat et tentatives. */
export function DubbingSection({ dossier }: { dossier: ProspectDossier }) {
  const excerpts = dossier.productions.filter(
    (p): p is ProductionOf<'video_excerpt'> => p.kind === 'video_excerpt',
  );
  const dubbings = dossier.productions.filter(
    (p): p is ProductionOf<'dubbing'> => p.kind === 'dubbing',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (excerpts.length === 0 && dubbings.length === 0) {
    const mission = dossier.missions.find((m) => m.room === 'dubbing');
    return (
      <EmptyState icon="🎙️" title="Aucun doublage préparé">
        {mission
          ? 'Une mission de doublage est ouverte : l’extrait et la démonstration apparaîtront ici.'
          : 'Le prospect n’est pas encore passé par le studio de doublage.'}
      </EmptyState>
    );
  }

  const excerpt = excerpts[0];
  const dubbing = dubbings.find((d) => d.id === selectedId) ?? dubbings[0];
  const generation = dubbing ? GENERATION_LABELS[dubbing.content.generationStatus] : null;

  return (
    <div className="d-section d-grid">
      <Card
        title="Vidéo source"
        icon="🎞️"
        aside={excerpt && <ProductionBadge status={excerpt.status} />}
      >
        {excerpt ? (
          <>
            <Fields>
              <Field label="Titre">{excerpt.content.title}</Field>
              <Field label="Adresse">{excerpt.content.videoUrl}</Field>
              <Field label="Publiée le">
                {excerpt.content.publishedAt && formatDate(excerpt.content.publishedAt)}
              </Field>
              <Field label="Durée totale">
                {excerpt.content.durationSeconds !== null &&
                  formatDuration(excerpt.content.durationSeconds)}
              </Field>
              <Field label="Extrait">
                {formatTimecode(excerpt.content.excerptStart)} →{' '}
                {formatTimecode(excerpt.content.excerptEnd)} (
                {excerpt.content.excerptEnd - excerpt.content.excerptStart} s)
              </Field>
              <Field label="Pourquoi cet extrait">{excerpt.content.reason}</Field>
            </Fields>
            {excerpt.content.rightsNote && (
              <p className="d-alert d-alert--warn">⚖️ {excerpt.content.rightsNote}</p>
            )}
          </>
        ) : (
          <Missing label="Aucun extrait sélectionné" />
        )}
      </Card>

      <Card title="Configuration" icon="🎛️">
        {dubbing ? (
          <Fields>
            <Field label="Langue source">{dubbing.content.sourceLanguage}</Field>
            <Field label="Langue cible">{dubbing.content.targetLanguage}</Field>
            <Field label="Voix">{dubbing.content.voice}</Field>
            <Field label="Outil">{dubbing.content.tool}</Field>
            {Object.entries(dubbing.content.settings).map(([key, value]) => (
              <Field key={key} label={key}>
                {value}
              </Field>
            ))}
          </Fields>
        ) : (
          <Missing label="Aucune configuration" />
        )}
      </Card>

      <Card
        title="Résultat"
        icon="▶️"
        className="d-grid__wide"
        aside={generation && <Badge tone={generation.tone}>{generation.label}</Badge>}
      >
        {dubbing ? (
          <>
            <VersionPicker
              items={dubbings}
              selectedId={dubbing.id}
              onSelect={setSelectedId}
              label="Versions du doublage"
            />
            <div className="d-player">
              <div className="d-player__screen" aria-hidden="true">
                <span className="d-player__play">▶</span>
                <span className="d-player__lang">
                  {dubbing.content.sourceLanguage} → {dubbing.content.targetLanguage}
                </span>
              </div>
              <p className="d-player__caption">
                {dubbing.content.resultUrl
                  ? dubbing.content.resultUrl
                  : 'Aperçu simulé — aucun fichier vidéo ou audio réel n’a été produit.'}
              </p>
            </div>
            <Fields>
              <Field label="Statut">
                <ProductionBadge status={dubbing.status} />
              </Field>
              <Field label="Généré le">
                {dubbing.content.generatedAt && formatDateTime(dubbing.content.generatedAt)}
              </Field>
              <Field label="Préparé par">{actorLabel(dubbing.actorType, dubbing.actorId)}</Field>
              <Field label="Notes">{dubbing.content.notes}</Field>
            </Fields>
            <h5 className="d-subtitle">Historique des tentatives</h5>
            {dubbing.content.attempts.length === 0 ? (
              <Missing label="Aucune tentative" />
            ) : (
              <ul className="d-attempts">
                {dubbing.content.attempts.map((a) => (
                  <li key={a.at} className={`d-attempt d-attempt--${a.status}`}>
                    <strong>{GENERATION_LABELS[a.status].label}</strong>
                    <span className="d-muted">{formatDateTime(a.at)}</span>
                    {a.note && <span>{a.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="d-actions">
              <button
                type="button"
                className="button"
                disabled
                title="Désactivé : aucune génération réelle sans autorisation explicite"
              >
                Lancer une génération réelle (HeyGen)
              </button>
              <span className="d-muted">
                Désactivé : API payante, jamais déclenchée sans votre autorisation explicite.
              </span>
            </div>
          </>
        ) : (
          <Missing label="Aucun doublage préparé" />
        )}
      </Card>
    </div>
  );
}
