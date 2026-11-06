/**
 * Arrêt du serveur sur signal (Ctrl+C…) :
 * - premier signal : arrêt propre (fermeture des écoutes, délai maximal compris, puis de la base) ;
 * - signal suivant pendant l'arrêt : sortie immédiate, sans rien attendre.
 */

interface ShutdownLog {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}

export interface ShutdownDeps {
  /** Ferme toutes les écoutes (le délai maximal est géré par closeServers). */
  closeServers: () => Promise<void>;
  /** Ferme la connexion à la base. */
  disconnect: () => Promise<void>;
  exit: (code: number) => void;
  log: ShutdownLog;
}

export function createShutdown({
  closeServers,
  disconnect,
  exit,
  log,
}: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) {
      log.warn(`${signal} reçu à nouveau : arrêt immédiat.`);
      exit(1);
      return;
    }
    started = true;
    log.info(`${signal} reçu, arrêt en cours… (${signal} à nouveau pour forcer)`);
    let exitCode = 0;
    try {
      await closeServers();
      log.info('Écoutes fermées.');
    } catch (error) {
      log.error('Fermeture des écoutes incomplète', error);
      exitCode = 1;
    }
    try {
      await disconnect();
    } catch (error) {
      log.error('Fermeture de la connexion à la base incomplète', error);
      exitCode = 1;
    }
    exit(exitCode);
  };
}
