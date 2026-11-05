import { useState } from 'react';
import type { ProductionOf, ProspectDossier } from '@agency/shared';
import { actorLabel, formatDateTime } from '../format';
import {
  BulletList,
  Card,
  Chips,
  EmptyState,
  ExternalLink,
  Field,
  Fields,
  ProductionBadge,
  VersionPicker,
} from '../primitives';

/** Salle commerciale : stratégie et proposition, toutes versions conservées. */
export function CommercialSection({ dossier }: { dossier: ProspectDossier }) {
  const proposals = dossier.productions.filter(
    (p): p is ProductionOf<'proposal'> => p.kind === 'proposal',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (proposals.length === 0) {
    const mission = dossier.missions.find((m) => m.room === 'copywriting');
    return (
      <EmptyState icon="✍️" title="Aucune proposition commerciale">
        {mission
          ? 'La proposition est en cours de rédaction dans la salle commerciale.'
          : 'Le prospect n’est pas encore arrivé dans la salle commerciale.'}
      </EmptyState>
    );
  }

  const proposal = proposals.find((p) => p.id === selectedId) ?? proposals[0]!;
  const c = proposal.content;
  return (
    <div className="d-section">
      <VersionPicker
        items={proposals}
        selectedId={proposal.id}
        onSelect={setSelectedId}
        label="Versions de la proposition"
      />
      <div className="d-grid">
        <Card
          title="Proposition commerciale"
          icon="📄"
          className="d-grid__wide d-proposal"
          aside={<ProductionBadge status={proposal.status} />}
        >
          <p className="d-proposal__type">{c.serviceType}</p>
          <p className="d-lead">{c.valueProposition}</p>
          <p>{c.offerDescription}</p>
          <Fields>
            <Field label="Langues">
              <Chips items={c.languages} />
            </Field>
            <Field label="Démonstration">{c.demoUrl && <ExternalLink url={c.demoUrl} />}</Field>
            <Field label="Version">
              v{proposal.version} · {formatDateTime(proposal.createdAt)} ·{' '}
              {actorLabel(proposal.actorType, proposal.actorId)}
            </Field>
          </Fields>
        </Card>

        <Card title="Profil du prospect" icon="👤">
          <p>{c.profileSummary}</p>
          <h5 className="d-subtitle">Besoins potentiels</h5>
          <BulletList items={c.needs} empty="Aucun besoin identifié" />
        </Card>

        <Card title="Arguments personnalisés" icon="🎯">
          <BulletList items={c.arguments} />
        </Card>

        <Card title="Bénéfices du doublage" icon="🌐">
          <BulletList items={c.benefits} />
        </Card>

        <Card title="Recommandations de l’IA" icon="🤖">
          <BulletList items={c.recommendations} empty="Aucune recommandation" />
        </Card>
      </div>
    </div>
  );
}
