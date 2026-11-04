import { DECISION_KIND_LABELS, type Decision, type ProspectDossier } from '@agency/shared';
import { useAgencyStore } from '../../../stores/agencyStore';
import { useDossierActions } from '../actions';
import { actorLabel, formatCompact, formatDateTime } from '../format';
import { Card, EmptyState, InsightList, Missing } from '../primitives';
import { ScoreGauge } from './Analysis';

const PROSPECT_DECISION_KINDS: Decision['kind'][] = [
  'prospect_approved',
  'prospect_rejected',
  'reanalysis_requested',
];

const DECISION_TONES: Record<Decision['kind'], string> = {
  prospect_approved: 'ok',
  prospect_rejected: 'error',
  reanalysis_requested: 'warn',
  email_approved: 'ok',
  email_rejected: 'error',
  email_changes_requested: 'warn',
};

export function DecisionHistory({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) return <Missing label="Aucune décision enregistrée" />;
  return (
    <ul className="d-decisions">
      {[...decisions].reverse().map((d) => (
        <li key={d.id} className={`d-decision d-decision--${DECISION_TONES[d.kind]}`}>
          <strong>{DECISION_KIND_LABELS[d.kind]}</strong>
          <span className="d-muted">
            {formatDateTime(d.createdAt)} · {actorLabel(d.actorType, d.actorId)}
          </span>
          {d.reason && <p className="d-decision__reason">« {d.reason} »</p>}
        </li>
      ))}
    </ul>
  );
}

/** Mon bureau : tout ce qu'il faut pour décider, et la zone de décision. */
export function DecisionSection({ dossier }: { dossier: ProspectDossier }) {
  const p = dossier.prospect;
  const analysis = dossier.analyses[0];
  const setSection = useAgencyStore((s) => s.setDossierSection);
  const { confirm, pending } = useDossierActions();
  const review = dossier.missions.find(
    (m) => m.room === 'director' && m.status === 'awaiting_validation',
  );
  const decisions = dossier.decisions.filter((d) => PROSPECT_DECISION_KINDS.includes(d.kind));
  const hypotheses = analysis
    ? [
        ...analysis.content.international.signals,
        ...analysis.content.international.markets,
        ...analysis.content.commercial.opportunities,
        ...analysis.content.commercial.risks,
      ].filter((i) => i.kind === 'hypothesis')
    : [];

  const decide = (decision: 'approve' | 'reject' | 'request_reanalysis') => {
    if (!review) return;
    const base = { missionId: review.id, expectedVersion: p.version };
    if (decision === 'approve') {
      confirm({
        title: 'Valider ce prospect ?',
        message: (
          <p>
            <strong>{p.creatorName}</strong> sera transmis au studio de doublage, où une mission de
            démonstration sera créée.
          </p>
        ),
        confirmLabel: 'Valider le prospect',
        run: () => ({
          action: { kind: 'decide', body: { ...base, decision } },
          success: 'Prospect validé : transmis au studio de doublage.',
        }),
      });
    } else if (decision === 'reject') {
      confirm({
        title: 'Refuser ce prospect ?',
        message: <p>Le dossier sera clos. Il restera consultable, avec tout son historique.</p>,
        confirmLabel: 'Refuser le prospect',
        tone: 'danger',
        input: { label: 'Motif du refus', placeholder: 'Ex. : format peu adapté au doublage' },
        run: (reason) => ({
          action: { kind: 'decide', body: { ...base, decision, ...(reason && { reason }) } },
          success: 'Prospect refusé.',
        }),
      });
    } else {
      confirm({
        title: 'Demander une nouvelle analyse ?',
        message: (
          <p>
            Le prospect retourne en salle d’analyse. L’analyse actuelle est conservée dans
            l’historique.
          </p>
        ),
        confirmLabel: 'Demander une nouvelle analyse',
        input: {
          label: 'Consigne pour l’analyse',
          placeholder: 'Ex. : vérifier l’audience hispanophone',
        },
        run: (instruction) => ({
          action: {
            kind: 'decide',
            body: { ...base, decision, ...(instruction && { instruction }) },
          },
          success: 'Nouvelle analyse demandée.',
        }),
      });
    }
  };

  return (
    <div className="d-section d-grid">
      <Card title="Décision" icon="⚖️" className="d-grid__wide d-decision-zone">
        {review ? (
          <>
            <p>Ce prospect attend votre décision depuis le {formatDateTime(review.updatedAt)}.</p>
            <div className="d-actions">
              <button
                type="button"
                className="button button--success"
                disabled={pending}
                onClick={() => decide('approve')}
              >
                ✓ Valider le prospect
              </button>
              <button
                type="button"
                className="button button--warn"
                disabled={pending}
                onClick={() => decide('request_reanalysis')}
              >
                ↻ Demander une nouvelle analyse
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={pending}
                onClick={() => decide('reject')}
              >
                ✕ Refuser le prospect
              </button>
            </div>
          </>
        ) : (
          <p className="d-muted">
            Aucune décision en attente pour ce prospect
            {decisions.length > 0 ? ' : voir les décisions déjà prises ci-dessous.' : '.'}
          </p>
        )}
        <h5 className="d-subtitle">Décisions enregistrées</h5>
        <DecisionHistory decisions={decisions} />
      </Card>

      <Card title="Qui est-ce ?" icon="👤">
        <p className="d-lead">
          {p.creatorName} — {p.channelName}
        </p>
        <p className="d-muted">
          {p.category ?? 'Catégorie inconnue'}
          {p.subscriberCount !== null && ` · ${formatCompact(p.subscriberCount)} abonnés`}
          {p.country && ` · ${p.country}`}
        </p>
        <h5 className="d-subtitle">Pourquoi a-t-il été découvert ?</h5>
        <p>{p.discovery?.reason ?? <Missing />}</p>
      </Card>

      <Card
        title="Ce que l’analyse a révélé"
        icon="📊"
        aside={
          analysis && (
            <button type="button" className="link-button" onClick={() => setSection('analysis')}>
              Analyse complète
            </button>
          )
        }
      >
        {analysis ? (
          <div className="d-mini-result">
            <ScoreGauge score={analysis.score} />
            <div>
              <p>{analysis.summary}</p>
              <p className="d-muted">{analysis.conclusion}</p>
            </div>
          </div>
        ) : (
          <EmptyState icon="🌍" title="Prospect sans analyse">
            Aucune analyse n’a été enregistrée : la décision serait prise sans éléments.
          </EmptyState>
        )}
      </Card>

      {analysis && (
        <>
          <Card title="Points forts" icon="➕">
            <InsightList items={analysis.content.commercial.strengths} empty="Aucun" />
          </Card>
          <Card title="Points faibles" icon="➖">
            <InsightList items={analysis.content.commercial.weaknesses} empty="Aucun" />
          </Card>
          <Card title="Recommandations de l’IA" icon="🤖">
            <ul className="d-bullets">
              {analysis.content.commercial.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Card>
          <Card title="Incertitudes" icon="❓">
            <ul className="d-bullets">
              {analysis.content.uncertainties.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            {hypotheses.length > 0 && (
              <p className="d-muted">
                {hypotheses.length} affirmation(s) de l’analyse sont des hypothèses de l’IA, non
                vérifiées.
              </p>
            )}
            {analysis.content.uncertainties.length === 0 && hypotheses.length === 0 && (
              <Missing label="Aucune incertitude signalée" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
