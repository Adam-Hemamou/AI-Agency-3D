import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Faux serveur : session fermée au départ, seul « bon-mot-de-passe » ouvre une session. */
function stubServer() {
  const calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/api/auth/session') return json(200, { authenticated: false, expiresAt: null });
      if (path === '/api/auth/login') {
        const { password } = JSON.parse(String(init?.body));
        return password === 'bon-mot-de-passe'
          ? json(200, { authenticated: true, expiresAt: '2026-11-06T20:00:00.000Z' })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Mot de passe incorrect' } });
      }
      return json(404, {});
    }),
  );
  return calls;
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>Agence confidentielle</p>
      </AuthGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connexion à l’interface', () => {
  it('n’affiche pas l’agence sans session', async () => {
    stubServer();
    renderGate();
    expect(await screen.findByLabelText('Mot de passe administrateur')).toBeInTheDocument();
    expect(screen.queryByText('Agence confidentielle')).toBeNull();
  });

  it('affiche l’erreur d’un mauvais mot de passe', async () => {
    stubServer();
    renderGate();
    fireEvent.change(await screen.findByLabelText('Mot de passe administrateur'), {
      target: { value: 'mauvais' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect');
    expect(screen.queryByText('Agence confidentielle')).toBeNull();
  });

  it('ouvre l’agence avec le bon mot de passe', async () => {
    const calls = stubServer();
    renderGate();
    fireEvent.change(await screen.findByLabelText('Mot de passe administrateur'), {
      target: { value: 'bon-mot-de-passe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Agence confidentielle')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({
      password: 'bon-mot-de-passe',
    });
  });
});
