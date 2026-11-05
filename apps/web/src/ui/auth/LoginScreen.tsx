import { useState, type FormEvent } from 'react';
import { useLogin } from '../../api/auth';
import { ApiClientError } from '../../api/client';

/**
 * Connexion de l'utilisateur. Le mot de passe se définit dans le terminal
 * (npm run owner:password) : aucune création de compte depuis l'interface.
 */
export function LoginScreen() {
  const [password, setPassword] = useState('');
  const login = useLogin();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) login.mutate(password, { onSuccess: () => setPassword('') });
  }

  const error = login.error instanceof ApiClientError ? login.error : null;

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit} aria-labelledby="login-title">
        <div className="login__logo" aria-hidden="true">
          ◆
        </div>
        <h1 id="login-title" className="login__title">
          AI Agency 3D
        </h1>
        <p className="login__subtitle">Connectez-vous pour accéder à l’agence.</p>
        <label className="login__label" htmlFor="login-password">
          Mot de passe administrateur
        </label>
        <input
          id="login-password"
          className="login__input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={login.isPending}
        />
        {error && (
          <p className="login__error" role="alert">
            {error.code === 'NETWORK_ERROR' ? 'Le serveur est injoignable.' : error.message}
          </p>
        )}
        <button className="login__submit" type="submit" disabled={!password || login.isPending}>
          {login.isPending ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="login__hint">
          Pas encore de mot de passe ? Dans un terminal : <code>npm run owner:password</code>
        </p>
      </form>
    </main>
  );
}
