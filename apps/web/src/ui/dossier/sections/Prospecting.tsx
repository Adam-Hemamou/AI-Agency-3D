import type { ProspectDossier } from '@agency/shared';
import { actorLabel, formatDateTime } from '../format';
import { BulletList, Card, Chips, EmptyState, Field, Fields } from '../primitives';

/** Salle de prospection : pourquoi ce créateur a été identifié. */
export function ProspectingSection({ dossier }: { dossier: ProspectDossier }) {
  const p = dossier.prospect;
  const d = p.discovery;
  const discoveredEvent = dossier.events.find((e) => e.type === 'discovered');

  if (!d) {
    return (
      <EmptyState icon="🔍" title="Aucune information de découverte">
        Le contexte de la découverte n’a pas été enregistré pour ce prospect.
      </EmptyState>
    );
  }

  return (
    <div className="d-section d-grid">
      <Card title="Découverte" icon="🔍">
        <Fields>
          <Field label="Date">{formatDateTime(p.discoveredAt)}</Field>
          <Field label="Source">{d.source}</Field>
          <Field label="Découvert par">
            {d.discoveredBy
              ? actorLabel('agent', d.discoveredBy)
              : discoveredEvent && actorLabel(discoveredEvent.actorType, discoveredEvent.actorId)}
          </Field>
          <Field label="Motif de sélection">{d.reason}</Field>
          <Field label="Mots-clés">
            <Chips items={d.keywords} />
          </Field>
        </Fields>
        <h5 className="d-subtitle">Critères de recherche</h5>
        <BulletList items={d.criteria} empty="Aucun critère enregistré" />
      </Card>

      <Card title="Qualification initiale" icon="🎯">
        <Fields>
          <Field label="Correspondance avec la cible">{d.qualification.targetFit}</Field>
          <Field label="Intérêt potentiel">{d.qualification.potentialInterest}</Field>
          <Field label="Première observation">{d.qualification.firstObservation}</Field>
          <Field label="Motif de transmission">{d.qualification.transferReason}</Field>
        </Fields>
        <h5 className="d-subtitle">Informations manquantes</h5>
        {d.qualification.missingInfo.length > 0 ? (
          <Chips items={d.qualification.missingInfo} tone="warn" />
        ) : (
          <p className="d-muted">Aucune information manquante signalée.</p>
        )}
      </Card>

      <Card title="Contact" icon="✉️">
        <Fields>
          <Field label="Nom">{p.contactName}</Field>
          <Field label="Adresse e-mail">{p.contactEmail}</Field>
          <Field label="Source du contact">{p.contactSource}</Field>
        </Fields>
      </Card>
    </div>
  );
}
