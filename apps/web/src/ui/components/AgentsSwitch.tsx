import { useAgentsSwitch, useSetAgentsEnabled } from '../../api/agentsSwitch';

/**
 * Arrêt d'urgence des agents : un clic les arrête immédiatement ; la réactivation demande
 * une confirmation. Si AGENTS_ENABLED=false dans .env, la réactivation est impossible ici.
 */
export function AgentsSwitch() {
  const status = useAgentsSwitch();
  const setEnabled = useSetAgentsEnabled();
  if (!status.data) return null;
  const { enabled, envEnabled } = status.data;

  function toggle() {
    if (enabled) {
      setEnabled.mutate(false);
      return;
    }
    if (window.confirm('Réactiver les agents ? Ils pourront de nouveau écrire dans le CRM.')) {
      setEnabled.mutate(true);
    }
  }

  return (
    <div className="hud-agents" role="group" aria-label="Arrêt d’urgence des agents">
      <span className={`dot dot--${enabled ? 'ok' : 'error'}`} aria-hidden="true" />
      <span className="hud-agents__label">{enabled ? 'Agents actifs' : 'Agents arrêtés'}</span>
      {envEnabled ? (
        <button
          type="button"
          className={`hud-agents__button ${enabled ? 'hud-agents__button--stop' : ''}`}
          onClick={toggle}
          disabled={setEnabled.isPending}
        >
          {enabled ? 'Arrêt d’urgence' : 'Réactiver'}
        </button>
      ) : (
        <span className="hud-agents__note" title="AGENTS_ENABLED=false dans le fichier .env">
          (arrêt imposé par .env)
        </span>
      )}
      {setEnabled.error && (
        <span className="hud-agents__note" role="alert">
          {setEnabled.error.message}
        </span>
      )}
    </div>
  );
}
