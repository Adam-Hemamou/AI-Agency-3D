import { describe, expect, it, vi } from 'vitest';
import { createShutdown, type ShutdownDeps } from './shutdown.ts';

function setup(overrides: Partial<ShutdownDeps> = {}) {
  const deps = {
    closeServers: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    exit: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  return { deps, shutdown: createShutdown(deps) };
}

describe('arrêt sur signal', () => {
  it('ferme les écoutes, puis la base, puis sort avec le code 0', async () => {
    const order: string[] = [];
    const { deps, shutdown } = setup({
      closeServers: vi.fn(async () => void order.push('écoutes')),
      disconnect: vi.fn(async () => void order.push('base')),
      exit: vi.fn((code: number) => void order.push(`exit ${code}`)),
    });
    await shutdown('SIGINT');
    expect(order).toEqual(['écoutes', 'base', 'exit 0']);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('un deuxième Ctrl+C pendant l’arrêt sort immédiatement (code 1)', async () => {
    let finishClosing!: () => void;
    const { deps, shutdown } = setup({
      // Fermeture qui traîne (requête en cours).
      closeServers: vi.fn(() => new Promise<void>((resolve) => (finishClosing = resolve))),
    });
    const first = shutdown('SIGINT');
    await Promise.resolve();
    expect(deps.exit).not.toHaveBeenCalled();

    await shutdown('SIGINT');
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('arrêt immédiat'));
    expect(deps.closeServers).toHaveBeenCalledTimes(1);

    finishClosing();
    await first;
  });

  it('sort avec le code 1 si une fermeture échoue, sans sauter la base', async () => {
    const { deps, shutdown } = setup({
      closeServers: vi.fn(async () => {
        throw new Error('échec');
      }),
    });
    await shutdown('SIGTERM');
    expect(deps.disconnect).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('sort avec le code 1 si la déconnexion de la base échoue', async () => {
    const { deps, shutdown } = setup({
      disconnect: vi.fn(async () => {
        throw new Error('échec');
      }),
    });
    await shutdown('SIGINT');
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
