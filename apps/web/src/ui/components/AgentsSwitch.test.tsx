import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsSwitch } from './AgentsSwitch';

const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const status = (enabled: boolean, envEnabled = true) => ({
  enabled: enabled && envEnabled,
  envEnabled,
  switchEnabled: enabled,
  updatedAt: null,
});

function stub(initial: ReturnType<typeof status>) {
  let current = initial;
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { enabled: boolean };
        posts.push(body);
        current = status(body.enabled, current.envEnabled);
      }
      return json(current);
    }),
  );
  return posts;
}

function renderSwitch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentsSwitch />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('arrêt d’urgence des agents', () => {
  it('arrête les agents en un clic', async () => {
    const posts = stub(status(true));
    renderSwitch();
    fireEvent.click(await screen.findByRole('button', { name: 'Arrêt d’urgence' }));
    expect(await screen.findByText('Agents arrêtés')).toBeInTheDocument();
    expect(posts).toEqual([{ enabled: false }]);
  });

  it('demande confirmation avant de réactiver', async () => {
    const posts = stub(status(false));
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderSwitch();
    const button = await screen.findByRole('button', { name: 'Réactiver' });
    fireEvent.click(button);
    expect(posts).toEqual([]);
    fireEvent.click(button);
    await waitFor(() => expect(posts).toEqual([{ enabled: true }]));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('n’offre pas de réactivation quand .env impose l’arrêt', async () => {
    stub(status(true, false));
    renderSwitch();
    expect(await screen.findByText('Agents arrêtés')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('(arrêt imposé par .env)')).toBeInTheDocument();
  });
});
