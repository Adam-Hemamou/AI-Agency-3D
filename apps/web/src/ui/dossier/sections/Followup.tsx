import { useState, type FormEvent } from 'react';
import {
  MESSAGE_KIND_LABELS,
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUS_LABELS,
  canSendFollowup,
  type ProspectDossier,
  type RelationshipStatus,
} from '@agency/shared';
import { useDossierActions } from '../actions';
import { actorLabel, formatDate, formatDateTime, formatRelative, isPast } from '../format';
import { Card, EmptyState, Field, Fields, Missing } from '../primitives';

/** Date ISO → valeur d'un champ <input type="date"> (heure locale). */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function StatusForm({ dossier }: { dossier: ProspectDossier }) {
  const p = dossier.prospect;
  const { perform, pending } = useDossierActions();
  const [status, setStatus] = useState<RelationshipStatus>(
    p.relationshipStatus ?? 'awaiting_reply',
  );
  const [nextAction, setNextAction] = useState(p.nextAction ?? '');
  const [nextDate, setNextDate] = useState(toDateInput(p.nextActionAt));
  const closed = p.stage !== 'followup';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void perform(
      {
        kind: 'updateFollowup',
        body: {
          ...(status !== p.relationshipStatus && { relationshipStatus: status }),
          nextAction: nextAction.trim() || null,
          nextActionAt: nextDate ? new Date(`${nextDate}T09:00:00`).toISOString() : null,
          expectedVersion: p.version,
        },
      },
      'Suivi mis à jour.',
    );
  };

  const overdue = isPast(p.nextActionAt);
  return (
    <form className="d-form" onSubmit={submit}>
      {overdue && p.stage === 'followup' && (
        <p className="d-alert d-alert--warn">
          ⏰ Prochaine action en retard ({formatRelative(p.nextActionAt!)}).
        </p>
      )}
      <label>
        Statut de la relation
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as RelationshipStatus)}
          disabled={closed}
        >
          {RELATIONSHIP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RELATIONSHIP_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prochaine action
        <input
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          placeholder="Ex. : relancer avec le lien de la démo"
          maxLength={500}
        />
      </label>
      <label>
        Date prévue
        <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
      </label>
      <div className="d-actions">
        <button type="submit" className="button button--primary" disabled={pending}>
          Enregistrer le suivi
        </button>
      </div>
      {closed && (
        <p className="d-muted">La relation est close : son statut ne peut plus être modifié.</p>
      )}
    </form>
  );
}

function MessageForm({
  kind,
  disabledReason,
}: {
  kind: 'reply' | 'followup';
  disabledReason: string | null;
}) {
  const { perform, pending } = useDossierActions();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const isFollowup = kind === 'followup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await perform(
      isFollowup
        ? { kind: 'followup', body: { subject, body } }
        : { kind: 'reply', body: { body, ...(subject.trim() && { subject }) } },
      isFollowup ? 'Relance enregistrée (simulation).' : 'Réponse enregistrée.',
    );
    if (ok) {
      setSubject('');
      setBody('');
    }
  };

  return (
    <form className="d-form" onSubmit={submit}>
      {disabledReason && <p className="d-alert d-alert--error">⛔ {disabledReason}</p>}
      <label>
        Objet{!isFollowup && ' (facultatif)'}
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required={isFollowup}
          disabled={disabledReason !== null}
          maxLength={250}
        />
      </label>
      <label>
        {isFollowup ? 'Message de relance' : 'Contenu de la réponse reçue'}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          disabled={disabledReason !== null}
        />
      </label>
      <div className="d-actions">
        <button
          type="submit"
          className="button"
          disabled={pending || disabledReason !== null || !body.trim()}
        >
          {isFollowup ? '🔁 Enregistrer la relance (simulation)' : '💬 Enregistrer la réponse'}
        </button>
        {isFollowup && <span className="d-muted">Aucun e-mail réel n’est envoyé.</span>}
      </div>
    </form>
  );
}

/** Salle de suivi : relation, échanges, relances, notes internes. */
export function FollowupSection({ dossier }: { dossier: ProspectDossier }) {
  const p = dossier.prospect;
  const { confirm, perform, pending } = useDossierActions();
  const [note, setNote] = useState('');
  const notes = dossier.events.filter((e) => e.type === 'note_added');
  const followupCheck = canSendFollowup(p);

  if (dossier.messages.length === 0 && !['followup', 'converted', 'archived'].includes(p.stage)) {
    return (
      <EmptyState icon="🤝" title="Le suivi n’a pas commencé">
        Le suivi commence après l’envoi du premier e-mail (salle de validation des e-mails).
      </EmptyState>
    );
  }

  const toggleContact = () =>
    p.doNotContact
      ? confirm({
          title: 'Autoriser de nouveau le contact ?',
          message: <p>À ne faire que si le prospect l’a explicitement demandé.</p>,
          confirmLabel: 'Autoriser le contact',
          run: () => ({
            action: { kind: 'updateFollowup', body: { doNotContact: false } },
            success: 'Contact de nouveau autorisé.',
          }),
        })
      : confirm({
          title: 'Ne plus contacter ce prospect ?',
          message: <p>Toutes les relances seront bloquées.</p>,
          confirmLabel: 'Ne plus contacter',
          tone: 'danger',
          input: { label: 'Motif', placeholder: 'Ex. : demande explicite du créateur' },
          run: (reason) => ({
            action: {
              kind: 'updateFollowup',
              body: { doNotContact: true, ...(reason && { doNotContactReason: reason }) },
            },
            success: 'Le prospect ne sera plus contacté.',
          }),
        });

  return (
    <div className="d-section d-grid">
      <Card title="Suivi commercial" icon="📌">
        <Fields>
          <Field label="Relation">
            {p.relationshipStatus && (
              <span className={`d-relation d-relation--${p.relationshipStatus}`}>
                {RELATIONSHIP_STATUS_LABELS[p.relationshipStatus]}
              </span>
            )}
          </Field>
          <Field label="Dernière interaction">
            {dossier.messages.at(-1) && formatDateTime(dossier.messages.at(-1)!.occurredAt)}
          </Field>
          <Field label="Prochaine relance">{p.nextActionAt && formatDate(p.nextActionAt)}</Field>
        </Fields>
        <StatusForm key={p.version} dossier={dossier} />
        <div className={`d-contact ${p.doNotContact ? 'is-blocked' : ''}`}>
          <span>
            {p.doNotContact
              ? `⛔ Ne plus contacter${p.doNotContactReason ? ` — ${p.doNotContactReason}` : ''}`
              : '✓ Contact autorisé'}
          </span>
          <button type="button" className="link-button" onClick={toggleContact} disabled={pending}>
            {p.doNotContact ? 'Autoriser de nouveau' : 'Ne plus contacter'}
          </button>
        </div>
      </Card>

      <Card title="Historique des échanges" icon="💬">
        {dossier.messages.length === 0 ? (
          <Missing label="Aucun échange" />
        ) : (
          <ol className="d-thread">
            {dossier.messages.map((m) => (
              <li key={m.id} className={`d-msg d-msg--${m.direction}`}>
                <p className="d-msg__meta">
                  <strong>{MESSAGE_KIND_LABELS[m.kind]}</strong>
                  {m.delivery === 'simulated' && (
                    <span className="d-badge d-badge--info">Simulé</span>
                  )}
                  <span>{formatDateTime(m.occurredAt)}</span>
                </p>
                {m.subject && <p className="d-msg__subject">{m.subject}</p>}
                <p className="d-msg__body">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Réponse reçue" icon="📥">
        <MessageForm kind="reply" disabledReason={null} />
      </Card>

      <Card title="Relance" icon="🔁">
        <MessageForm
          kind="followup"
          disabledReason={followupCheck.allowed ? null : followupCheck.reason}
        />
      </Card>

      <Card title="Notes internes" icon="📝" className="d-grid__wide">
        {notes.length === 0 ? (
          <Missing label="Aucune note" />
        ) : (
          <ul className="d-notes">
            {[...notes].reverse().map((n) => (
              <li key={n.id}>
                <p>{n.details}</p>
                <span className="d-muted">
                  {formatDateTime(n.createdAt)} · {actorLabel(n.actorType, n.actorId)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="d-form d-form--inline"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await perform({ kind: 'note', body: { text: note } }, 'Note ajoutée.')) setNote('');
          }}
        >
          <textarea
            aria-label="Nouvelle note"
            placeholder="Ajouter une note interne…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <button type="submit" className="button" disabled={pending || !note.trim()}>
            Ajouter
          </button>
        </form>
      </Card>
    </div>
  );
}
