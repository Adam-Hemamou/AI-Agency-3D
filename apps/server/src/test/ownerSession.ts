import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { SESSION_COOKIE_NAME } from '@agency/shared';
import { hashSessionToken } from '../auth/ownerAuth.ts';
import type { AppPrismaClient } from '../db/prisma.ts';

/** Adresse de l'interface simulée par les tests (même origine que l'API, comme via Vite). */
export const TEST_HOST = 'localhost:5173';
export const TEST_ORIGIN = `http://${TEST_HOST}`;

/**
 * Requêtes de l'utilisateur humain connecté. La session est créée directement dans la base de
 * test (sans passer par le mot de passe, testé à part) : à rappeler après chaque remise à zéro.
 */
export async function ownerClient(app: Express, prisma: AppPrismaClient) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await prisma.ownerSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      lastSeenAt: now,
    },
  });
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;
  const wrap = (test: request.Test) =>
    test.set('Host', TEST_HOST).set('Origin', TEST_ORIGIN).set('Cookie', cookie);
  return {
    cookie,
    get: (path: string) => wrap(request(app).get(path)),
    post: (path: string) => wrap(request(app).post(path)),
    patch: (path: string) => wrap(request(app).patch(path)),
  };
}

export type OwnerClient = Awaited<ReturnType<typeof ownerClient>>;
