import { CAMPAIGN_SCHEDULER_INTERVAL_MINUTES } from '@agency/shared';
import type { ScheduledMission, SkippedCampaign } from './campaignService.ts';

export interface CampaignSchedulerOptions {
  /** campaigns.generateDailyMissions. */
  generate: () => Promise<{
    created: ScheduledMission[];
    cancelled: ScheduledMission[];
    skipped: SkippedCampaign[];
  }>;
  intervalMs?: number;
  onCreated?: (mission: ScheduledMission) => void;
  onCancelled?: (mission: ScheduledMission) => void;
  onSkipped?: (campaign: SkippedCampaign) => void;
  onError?: (error: unknown) => void;
}

/**
 * Création des missions de recherche du jour : tout de suite, puis à intervalle régulier (le premier
 * passage après minuit, heure de Paris, crée les missions du nouveau jour). Deux passages ne se
 * chevauchent jamais ; rejouer un passage ne crée rien de plus (index unique campagne + jour).
 */
export function startCampaignScheduler({
  generate,
  intervalMs = CAMPAIGN_SCHEDULER_INTERVAL_MINUTES * 60_000,
  onCreated,
  onCancelled,
  onSkipped,
  onError,
}: CampaignSchedulerOptions): { stop: () => void; runOnce: () => Promise<void> } {
  let running: Promise<void> | null = null;
  let stopped = false;

  const runOnce = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= generate()
      .then(({ created, cancelled, skipped }) => {
        cancelled.forEach((m) => onCancelled?.(m));
        skipped.forEach((c) => onSkipped?.(c));
        created.forEach((m) => onCreated?.(m));
      })
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
