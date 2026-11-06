import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveredMission } from './missionService.ts';
import { STALE_CHECK_INTERVAL_MS, startStaleRecovery } from './staleRecovery.ts';

const recovered: RecoveredMission = {
  missionId: 'm1',
  agentId: 'agent-a',
  effects: { analyses: 0, productions: 0, decisions: 0, events: 0, output: false },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('récupération périodique des missions interrompues', () => {
  it('vérifie au démarrage puis toutes les 5 minutes', async () => {
    const recover = vi.fn().mockResolvedValue([]);
    const job = startStaleRecovery({ recover });
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(STALE_CHECK_INTERVAL_MS);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(STALE_CHECK_INTERVAL_MS).toBe(5 * 60_000);
    job.stop();
  });

  it('signale chaque mission bloquée', async () => {
    const onRecovered = vi.fn();
    const job = startStaleRecovery({
      recover: vi.fn().mockResolvedValue([recovered]),
      onRecovered,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecovered).toHaveBeenCalledWith(recovered);
    job.stop();
  });

  it('deux passages ne se chevauchent jamais', async () => {
    let finish!: () => void;
    const recover = vi.fn(
      () => new Promise<RecoveredMission[]>((resolve) => (finish = () => resolve([]))),
    );
    const job = startStaleRecovery({ recover, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3500); // trois échéances pendant le premier passage
    expect(recover).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(recover).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('une erreur est signalée sans arrêter les passages suivants', async () => {
    const onError = vi.fn();
    const recover = vi
      .fn()
      .mockRejectedValueOnce(new Error('base injoignable'))
      .mockResolvedValue([]);
    const job = startStaleRecovery({ recover, intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(recover).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('plus aucun passage après l’arrêt (arrêt de l’API)', async () => {
    const recover = vi.fn().mockResolvedValue([]);
    const job = startStaleRecovery({ recover, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    job.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recover).toHaveBeenCalledTimes(1);
    await job.runOnce();
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
