import type { RecoveredMission } from './missionService.ts';

/** Fréquence de la vérification des missions interrompues. */
export const STALE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface StaleRecoveryOptions {
  /** missions.recoverStale, déjà lié au délai d'inactivité. */
  recover: () => Promise<RecoveredMission[]>;
  intervalMs?: number;
  onRecovered?: (mission: RecoveredMission) => void;
  onError?: (error: unknown) => void;
}

/**
 * Lance la récupération des traitements interrompus : tout de suite, puis à intervalle régulier.
 * Deux passages ne se chevauchent jamais. Retourne la fonction d'arrêt (à appeler à l'arrêt de l'API).
 */
export function startStaleRecovery({
  recover,
  intervalMs = STALE_CHECK_INTERVAL_MS,
  onRecovered,
  onError,
}: StaleRecoveryOptions): { stop: () => void; runOnce: () => Promise<void> } {
  let running: Promise<void> | null = null;
  let stopped = false;

  const runOnce = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= recover()
      .then((missions) => missions.forEach((m) => onRecovered?.(m)))
      .catch((error: unknown) => onError?.(error))
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref();
  void runOnce();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce,
  };
}
