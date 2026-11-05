import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ERROR_CODES, OWNER_SESSION_HOURS, checkOwnerPassword } from '@agency/shared';
import type { AppPrismaClient } from '../db/prisma.ts';
import { AppError } from '../errors/AppError.ts';
import { systemClock, type Clock } from '../missions/missionService.ts';
import { hashPassword, verifyPassword } from './password.ts';

/**
 * Authentification de l'utilisateur humain : SEUL point d'écriture des tables
 * owner_credentials et owner_sessions.
 * - mot de passe défini uniquement depuis le terminal (npm run owner:password) ;
 * - session de 12 heures, fixe ; jeton aléatoire de 256 bits, seule son empreinte est stockée ;
 * - déconnexion et changement de mot de passe ferment les sessions.
 */

const OWNER_ID = 'owner';
const SESSION_MS = OWNER_SESSION_HOURS * 60 * 60 * 1000;
/** La date de dernière activité n'est réécrite qu'au-delà de ce délai. */
const LAST_SEEN_REFRESH_MS = 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Empreinte d'un jeton de session (seule valeur stockée en base). */
export const hashSessionToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');
const hashToken = hashSessionToken;

export interface OwnerSessionInfo {
  id: string;
  expiresAt: Date;
}

export function createOwnerAuthService({
  prisma,
  clock = systemClock,
}: {
  prisma: AppPrismaClient;
  clock?: Clock;
}) {
  return {
    async hasPassword(): Promise<boolean> {
      return (await prisma.ownerCredential.count({ where: { id: OWNER_ID } })) > 0;
    },

    /** Définit ou remplace le mot de passe. Toutes les sessions ouvertes sont fermées. */
    async setPassword(password: string): Promise<void> {
      const problem = checkOwnerPassword(password);
      if (problem) throw AppError.validation(problem);
      const passwordHash = await hashPassword(password);
      const now = clock();
      await prisma.$transaction([
        prisma.ownerCredential.upsert({
          where: { id: OWNER_ID },
          create: { id: OWNER_ID, passwordHash, updatedAt: now },
          update: { passwordHash, updatedAt: now },
        }),
        prisma.ownerSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } }),
      ]);
    },

    /** Ouvre une session. Renvoie le jeton à placer dans le cookie (jamais stocké en clair). */
    async login(password: string): Promise<{ token: string; expiresAt: Date }> {
      const credential = await prisma.ownerCredential.findUnique({ where: { id: OWNER_ID } });
      if (!credential) {
        throw new AppError(
          ERROR_CODES.OWNER_PASSWORD_NOT_SET,
          'Aucun mot de passe administrateur : lancez « npm run owner:password » dans le terminal',
          409,
        );
      }
      if (!(await verifyPassword(password, credential.passwordHash))) {
        throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Mot de passe incorrect', 401);
      }
      const now = clock();
      // Ménage : les sessions expirées depuis plus d'un jour ne servent plus à rien.
      await prisma.ownerSession.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_MS);
      await prisma.ownerSession.create({
        data: { tokenHash: hashToken(token), createdAt: now, expiresAt, lastSeenAt: now },
      });
      return { token, expiresAt };
    },

    /** Session valide correspondant au jeton, ou null (inconnue, expirée, fermée). */
    async authenticate(token: string): Promise<OwnerSessionInfo | null> {
      if (!TOKEN_PATTERN.test(token)) return null;
      const tokenHash = hashToken(token);
      const session = await prisma.ownerSession.findUnique({ where: { tokenHash } });
      if (!session) return null;
      // Défense en profondeur : la recherche est exacte, la comparaison aussi en temps constant.
      if (!timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(tokenHash))) return null;
      const now = clock();
      if (session.revokedAt || session.expiresAt <= now) return null;
      if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
        await prisma.ownerSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      }
      return { id: session.id, expiresAt: session.expiresAt };
    },

    async logout(sessionId: string): Promise<void> {
      await prisma.ownerSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: clock() },
      });
    },
  };
}

export type OwnerAuthService = ReturnType<typeof createOwnerAuthService>;
