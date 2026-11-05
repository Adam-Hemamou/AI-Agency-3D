import type { ReactNode } from 'react';
import { useSession } from '../../api/auth';
import { LoginScreen } from './LoginScreen';

/** N'affiche l'agence (et ne charge ses données) qu'une fois l'utilisateur connecté. */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending) {
    return (
      <p className="login__loading" role="status">
        Chargement…
      </p>
    );
  }
  if (!session.data?.authenticated) return <LoginScreen />;
  return <>{children}</>;
}
