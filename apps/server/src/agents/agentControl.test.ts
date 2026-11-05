import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errors/errorHandler.ts';
import { agentKillSwitch, createAgentControl } from './agentControl.ts';

function appWith(control: ReturnType<typeof createAgentControl>) {
  const app = express();
  app.use(agentKillSwitch(control));
  app.get('/x', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('arrêt d’urgence', () => {
  it('actif par défaut, coupé par .env ou par l’interrupteur', async () => {
    expect(createAgentControl({}).isEnabled()).toBe(true);
    expect(createAgentControl({ envEnabled: false }).isEnabled()).toBe(false);
    const control = createAgentControl({});
    await control.setEnabled(false);
    expect(control.status()).toMatchObject({
      enabled: false,
      envEnabled: true,
      switchEnabled: false,
    });
    await control.setEnabled(true);
    expect(control.isEnabled()).toBe(true);
  });

  it('l’interrupteur ne lève jamais un arrêt imposé par .env', async () => {
    const control = createAgentControl({ envEnabled: false });
    await control.setEnabled(true);
    expect(control.isEnabled()).toBe(false);
  });

  it.each([
    ['Authorization', 'Bearer agk_x'],
    ['Authorization', 'nimporte quoi'],
    ['X-Api-Key', 'agk_x'],
    ['X-Agent-Key', 'agk_x'],
  ])('arrêté : toute requête portant %s est refusée (503)', async (header, value) => {
    const res = await request(appWith(createAgentControl({ envEnabled: false })))
      .get('/x')
      .set(header, value);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AGENTS_DISABLED');
  });

  it('arrêté : les requêtes sans clé (l’utilisateur) passent', async () => {
    const res = await request(appWith(createAgentControl({ envEnabled: false }))).get('/x');
    expect(res.status).toBe(200);
  });

  it('un arrêt non enregistré reste effectif ; une réactivation non enregistrée est annulée', async () => {
    const failing = {
      agentSwitch: {
        upsert: async () => {
          throw new Error('base injoignable');
        },
      },
    } as never;
    const control = createAgentControl({ prisma: failing });
    await expect(control.setEnabled(false)).rejects.toThrow('base injoignable');
    expect(control.isEnabled()).toBe(false);
    await expect(control.setEnabled(true)).rejects.toThrow('base injoignable');
    expect(control.isEnabled()).toBe(false);
  });
});
