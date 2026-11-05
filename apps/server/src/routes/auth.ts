import { Router, type Response } from 'express';
import {
  ERROR_CODES,
  OWNER_SESSION_HOURS,
  SESSION_COOKIE_NAME,
  loginRequestSchema,
  type SessionResponse,
} from '@agency/shared';
import type { LoginThrottle } from '../auth/loginThrottle.ts';
import type { OwnerAuthService } from '../auth/ownerAuth.ts';
import { AppError } from '../errors/AppError.ts';
import { parseOrThrow } from '../lib/validate.ts';

/**
 * Connexion de l'utilisateur humain. Le cookie de session :
 * - HttpOnly : le JavaScript de la page ne peut pas le lire (un script injecté ne peut pas le voler) ;
 * - SameSite=Strict : jamais envoyé depuis un autre site ;
 * - Path=/api, durée de 12 heures. Pas de « Secure » : l'API locale est en http sur 127.0.0.1.
 */
function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: OWNER_SESSION_HOURS * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: 'strict', path: '/api' });
}

export function authRouter(owner: OwnerAuthService, throttle: LoginThrottle): Router {
  const router = Router();

  router.get('/session', (_req, res) => {
    const session = res.locals.ownerSession;
    const body: SessionResponse = {
      authenticated: Boolean(session),
      expiresAt: session ? session.expiresAt.toISOString() : null,
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.post('/login', async (req, res) => {
    if (res.locals.agent) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN_ACTOR,
        'Un agent ne peut pas ouvrir de session humaine',
        403,
      );
    }
    const throttleKey = req.ip ?? 'local';
    throttle.check(throttleKey);
    const { password } = parseOrThrow(loginRequestSchema, req.body, 'Connexion');
    let session: { token: string; expiresAt: Date };
    try {
      session = await owner.login(password);
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.UNAUTHENTICATED) {
        throttle.failure(throttleKey);
      }
      throw error;
    }
    throttle.success(throttleKey);
    setSessionCookie(res, session.token);
    const body: SessionResponse = {
      authenticated: true,
      expiresAt: session.expiresAt.toISOString(),
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.post('/logout', async (_req, res) => {
    const session = res.locals.ownerSession;
    if (session) await owner.logout(session.id);
    clearSessionCookie(res);
    const body: SessionResponse = { authenticated: false, expiresAt: null };
    res.json(body);
  });

  return router;
}
