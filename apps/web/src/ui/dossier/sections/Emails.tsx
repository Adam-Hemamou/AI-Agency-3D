import { useState } from 'react';
import type { ProductionOf, ProspectDossier } from '@agency/shared';
import { useDossierActions } from '../actions';
import { actorLabel, formatDateTime } from '../format';
import { Card, EmptyState, ExternalLink, Missing, ProductionBadge } from '../primitives';
import { DecisionHistory } from './Decision';

type Email = ProductionOf<'email'>;

function EmailEditor({
  email,
  onCancel,
  onSaved,
}: {
  email: Email;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { perform, pending } = useDossierActions();
  const [subject, setSubject] = useState(email.content.subject);
  const [body, setBody] = useState(email.content.body);
  const unchanged = subject === email.content.subject && body === email.content.body;

  return (
    <form
      className="d-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await perform(
          { kind: 'editEmail', body: { productionId: email.id, subject, body } },
          'Nouvelle version du brouillon enregistrée.',
        );
        if (ok) onSaved();
      }}
    >
      <label>
        Objet
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          maxLength={250}
        />
      </label>
      <label>
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} required />
      </label>
      <p className="d-muted">
        L’enregistrement crée une nouvelle version : la version {email.version} reste dans
        l’historique.
      </p>
      <div className="d-actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          disabled={pending}
        >
          Annuler
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={pending || unchanged || !subject.trim() || !body.trim()}
        >
          {pending ? 'Enregistrement…' : 'Enregistrer la nouvelle version'}
        </button>
      </div>
    </form>
  );
}

function EmailView({ email }: { email: Email }) {
  const c = email.content;
  return (
    <article className="d-mail" aria-label={`E-mail, version ${email.version}`}>
      <dl className="d-mail__headers">
        <div>
          <dt>À</dt>
          <dd>
            {c.recipientName ? `${c.recipientName} ` : ''}
            {c.to ? (
              <span className="d-muted">&lt;{c.to}&gt;</span>
            ) : (
              <Missing label="Adresse inconnue" />
            )}
          </dd>
        </div>
        <div>
          <dt>Objet</dt>
          <dd>
            <strong>{c.subject}</strong>
          </dd>
        </div>
        <div>
          <dt>Créé</dt>
          <dd>
            {formatDateTime(email.createdAt)} · {actorLabel(email.actorType, email.actorId)}
          </dd>
        </div>
      </dl>
      <div className="d-mail__body">{c.body}</div>
      {c.demoUrl && (
        <p className="d-mail__demo">
          🎬 Lien vers la démonstration : <ExternalLink url={c.demoUrl} newTab={false} />
        </p>
      )}
    </article>
  );
}

/** Salle de validation des e-mails : relire, modifier, valider, refuser. Aucun envoi réel. */
export function EmailsSection({ dossier }: { dossier: ProspectDossier }) {
  const { confirm, pending } = useDossierActions();
  const emails = dossier.productions.filter((p): p is Email => p.kind === 'email');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const p = dossier.prospect;

  if (emails.length === 0) {
    return (
      <EmptyState icon="📧" title="Aucun e-mail préparé">
        L’e-mail sera rédigé après la proposition commerciale, puis soumis à votre validation.
      </EmptyState>
    );
  }

  const latest = emails[0]!;
  const email = emails.find((e) => e.id === selectedId) ?? latest;
  const isLatest = email.id === latest.id;
  const reviewMission = dossier.missions.find(
    (m) => m.room === 'email_review' && !['completed', 'cancelled'].includes(m.status),
  );
  const awaiting =
    isLatest &&
    latest.status === 'pending_review' &&
    reviewMission?.status === 'awaiting_validation';
  const editable =
    isLatest &&
    p.stage === 'email_review' &&
    reviewMission !== undefined &&
    ['pending_review', 'changes_requested'].includes(latest.status);
  const sendable = isLatest && latest.status === 'approved' && p.stage === 'email_review';
  const emailDecisions = dossier.decisions.filter((d) => d.kind.startsWith('email_'));
  const sent = dossier.messages.find(
    (m) => m.productionId === latest.id && m.direction === 'outbound',
  );

  const decide = (decision: 'approve' | 'reject' | 'request_changes') => {
    if (!reviewMission) return;
    const base = {
      missionId: reviewMission.id,
      productionId: latest.id,
      expectedVersion: p.version,
    };
    if (decision === 'approve') {
      confirm({
        title: 'Valider cet e-mail ?',
        message: (
          <p>
            L’e-mail sera marqué comme validé. <strong>Aucun envoi n’est déclenché</strong> :
            l’envoi reste une étape séparée.
          </p>
        ),
        confirmLabel: 'Valider l’e-mail',
        run: () => ({
          action: { kind: 'decideEmail', body: { ...base, decision } },
          success: 'E-mail validé.',
        }),
      });
    } else if (decision === 'request_changes') {
      confirm({
        title: 'Demander une modification ?',
        message: <p>L’e-mail repasse en rédaction. Précisez ce qui doit changer.</p>,
        confirmLabel: 'Demander la modification',
        input: {
          label: 'Modification attendue',
          required: true,
          placeholder: 'Ex. : ajouter le lien vers la démo',
        },
        run: (reason) => ({
          action: { kind: 'decideEmail', body: { ...base, decision, reason } },
          success: 'Modification demandée.',
        }),
      });
    } else {
      confirm({
        title: 'Refuser cet e-mail ?',
        message: <p>Le prospect retourne en salle commerciale pour une nouvelle approche.</p>,
        confirmLabel: 'Refuser l’e-mail',
        tone: 'danger',
        input: { label: 'Motif du refus' },
        run: (reason) => ({
          action: { kind: 'decideEmail', body: { ...base, decision, ...(reason && { reason }) } },
          success: 'E-mail refusé : retour en salle commerciale.',
        }),
      });
    }
  };

  const simulateSend = () =>
    confirm({
      title: 'Marquer l’e-mail comme envoyé ?',
      message: (
        <p>
          <strong>Simulation :</strong> aucun e-mail réel ne partira. L’envoi est seulement
          enregistré dans le dossier et le prospect passe en salle de suivi.
        </p>
      ),
      confirmLabel: 'Enregistrer l’envoi simulé',
      run: () => ({
        action: { kind: 'simulateSend', body: { productionId: latest.id } },
        success: 'Envoi simulé enregistré : le prospect passe en suivi.',
      }),
    });

  return (
    <div className="d-section d-mailbox">
      <nav className="d-mailbox__list" aria-label="Versions de l’e-mail">
        {emails.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`d-mailbox__item ${e.id === email.id ? 'is-active' : ''}`}
            aria-pressed={e.id === email.id}
            onClick={() => {
              setSelectedId(e.id);
              setEditing(false);
            }}
          >
            <span className="d-mailbox__version">Version {e.version}</span>
            <span className="d-mailbox__subject">{e.content.subject}</span>
            <ProductionBadge status={e.status} />
          </button>
        ))}
      </nav>

      <div className="d-mailbox__main">
        {!isLatest && (
          <p className="d-alert d-alert--info">Ancienne version, conservée pour l’historique.</p>
        )}
        {latest.status === 'changes_requested' && isLatest && (
          <p className="d-alert d-alert--warn">
            Modification demandée :{' '}
            {emailDecisions.filter((d) => d.kind === 'email_changes_requested').at(-1)?.reason}
          </p>
        )}
        {sent && isLatest && (
          <p className="d-alert d-alert--info">
            📨 Envoi enregistré le {formatDateTime(sent.occurredAt)}
            {sent.delivery === 'simulated' && ' (simulation : aucun e-mail réel n’est parti)'}.
          </p>
        )}

        {editing ? (
          <EmailEditor
            email={latest}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : (
          <EmailView email={email} />
        )}

        {!editing && (awaiting || editable || sendable) && (
          <div className="d-actions d-actions--bar">
            {awaiting && (
              <>
                <button
                  type="button"
                  className="button button--success"
                  disabled={pending}
                  onClick={() => decide('approve')}
                >
                  ✓ Valider l’e-mail
                </button>
                <button
                  type="button"
                  className="button button--warn"
                  disabled={pending}
                  onClick={() => decide('request_changes')}
                >
                  ✎ Demander une modification
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={pending}
                  onClick={() => decide('reject')}
                >
                  ✕ Refuser
                </button>
              </>
            )}
            {editable && (
              <button
                type="button"
                className="button"
                disabled={pending}
                onClick={() => setEditing(true)}
              >
                Modifier le brouillon
              </button>
            )}
            {sendable && (
              <button
                type="button"
                className="button button--primary"
                disabled={pending || p.doNotContact}
                onClick={simulateSend}
              >
                📨 Marquer comme envoyé (simulation)
              </button>
            )}
          </div>
        )}

        <Card title="Décisions sur les e-mails" icon="⚖️">
          <DecisionHistory decisions={emailDecisions} />
        </Card>
      </div>
    </div>
  );
}
