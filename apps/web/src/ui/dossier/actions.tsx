import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDossierAction, type DossierAction } from '../../api/prospects';

/**
 * Exécution des actions du dossier : confirmation, état « en cours »,
 * message de réussite ou d'échec. Toute action passe par l'API.
 */

interface Feedback {
  tone: 'ok' | 'error';
  message: string;
}

interface DossierActions {
  perform: (action: DossierAction, success: string) => Promise<boolean>;
  pending: boolean;
  confirm: (request: ConfirmRequest) => void;
}

const Context = createContext<DossierActions | null>(null);

export function useDossierActions(): DossierActions {
  const value = useContext(Context);
  if (!value) throw new Error('useDossierActions doit être utilisé dans un dossier');
  return value;
}

export interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Champ de saisie facultatif ou obligatoire (motif, consigne). */
  input?: { label: string; placeholder?: string; required?: boolean };
  run: (text: string) => { action: DossierAction; success: string };
}

export function DossierActionsProvider({
  prospectId,
  children,
}: {
  prospectId: string;
  children: ReactNode;
}) {
  const mutation = useDossierAction(prospectId);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), feedback.tone === 'ok' ? 3500 : 7000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const perform = useCallback(
    async (action: DossierAction, success: string) => {
      try {
        await mutation.mutateAsync(action);
        setFeedback({ tone: 'ok', message: success });
        return true;
      } catch (error) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : 'L’action a échoué',
        });
        return false;
      }
    },
    [mutation],
  );

  return (
    <Context.Provider value={{ perform, pending: mutation.isPending, confirm: setRequest }}>
      {children}
      {request && (
        <ConfirmDialog
          request={request}
          pending={mutation.isPending}
          onCancel={() => setRequest(null)}
          onConfirm={async (text) => {
            const { action, success } = request.run(text);
            if (await perform(action, success)) setRequest(null);
          }}
        />
      )}
      {feedback && (
        <div
          className={`d-toast d-toast--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true">{feedback.tone === 'ok' ? '✓' : '⚠'}</span> {feedback.message}
          <button
            type="button"
            className="d-toast__close"
            onClick={() => setFeedback(null)}
            aria-label="Masquer le message"
          >
            ✕
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

function ConfirmDialog({
  request,
  pending,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const titleId = useId();
  const inputId = useId();
  const firstRef = useRef<HTMLTextAreaElement & HTMLButtonElement>(null);
  const missing = request.input?.required === true && text.trim() === '';

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  // Échap annule la confirmation (sans fermer le dossier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onCancel]);

  return (
    <div className="d-confirm" role="presentation">
      <div
        className="d-confirm__box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId} className="d-confirm__title">
          {request.title}
        </h3>
        <div className="d-confirm__message">{request.message}</div>
        {request.input && (
          <div className="d-confirm__field">
            <label htmlFor={inputId}>
              {request.input.label}
              {!request.input.required && (
                <span className="d-confirm__optional"> (facultatif)</span>
              )}
            </label>
            <textarea
              id={inputId}
              ref={firstRef}
              rows={3}
              value={text}
              placeholder={request.input.placeholder}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        <div className="d-confirm__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Annuler
          </button>
          <button
            type="button"
            ref={request.input ? undefined : firstRef}
            className={`button ${request.tone === 'danger' ? 'button--danger' : 'button--primary'}`}
            onClick={() => onConfirm(text.trim())}
            disabled={pending || missing}
          >
            {pending ? 'Enregistrement…' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
