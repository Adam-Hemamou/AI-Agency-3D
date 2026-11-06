import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createMissionRequestSchema, type CreateProspectRequest } from '@agency/shared';
import type { TransactionHook } from '../db/transactionHook.ts';
import { AppError } from '../errors/AppError.ts';
import { createProspectService } from '../prospects/prospectService.ts';
import { createTestAgent, createTestPrisma, resetDatabase } from '../test/testDb.ts';
import { createMissionService, INTERRUPTED_ERROR_CODE, type Actor } from './missionService.ts';

/**
 * Récupération des traitements interrompus, contre la base de test (ai_agency_test).
 * L'horloge est pilotée : « maintenant » avance sans attendre.
 */

const prisma = createTestPrisma();
let now = new Date('2026-11-06T08:00:00.000Z');
const clock = () => now;
const missions = createMissionService(prisma, { clock });
const prospects = createProspectService({ prisma, missions, simulationMode: true, clock });

const agent: Actor = { type: 'agent', id: 'agent-analyste' };
const user: Actor = { type: 'user', id: 'owner' };
const HOUR = 60 * 60_000;
const STALE = { staleAfterMs: HOUR };

const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

/** Mission attribuée à l'agent, démarrée maintenant. */
async function startedMission() {
  const input = createMissionRequestSchema.parse({
    type: 'analysis.score',
    room: 'analysis',
    agentId: agent.id,
  });
  const { mission } = await missions.create(input, user);
  await missions.applyAction(mission.id, { action: 'start' }, agent);
  return mission.id;
}

const baseProspect: CreateProspectRequest = {
  creatorName: 'Créateur Test',
  channelName: 'Chaîne Test',
  youtubeChannelId: 'TEST-1',
  discovery: {
    source: 'Test',
    reason: 'Prospect de test',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
};

/** Prospect créé par l'agent : sa mission de prospection lui est attribuée, puis démarrée. */
async function prospectWithStartedMission() {
  const d = await prospects.createProspect(baseProspect, agent);
  const mission = d.missions[0]!;
  later(60_000); // démarrée une minute après la découverte
  await missions.applyAction(mission.id, { action: 'start' }, agent);
  return { prospectId: d.prospect.id, missionId: mission.id };
}

/** Barrière : une promesse et la fonction qui la libère. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Suit l'état d'une promesse sans l'attendre. */
function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  now = new Date('2026-11-06T08:00:00.000Z');
  await resetDatabase();
  await createTestAgent(prisma, agent.id!);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('récupération des missions interrompues', () => {
  it('bloque une mission en cours sans activité depuis le délai, au nom du système', async () => {
    const id = await startedMission();
    later(HOUR + 60_000);
    const recovered = await missions.recoverStale(STALE);

    expect(recovered).toEqual([
      {
        missionId: id,
        agentId: agent.id,
        runId: null, // mission démarrée sans exécution : comportement historique conservé
        effects: { analyses: 0, productions: 0, decisions: 0, events: 0, output: false },
      },
    ]);
    const mission = await missions.get(id);
    expect(mission).toMatchObject({
      status: 'blocked',
      agentId: agent.id, // on sait qui la traitait
      lastErrorCode: INTERRUPTED_ERROR_CODE,
    });
    expect(mission.lastErrorMessage).toContain('aucune activité depuis plus de 60 min');
    expect(mission.lastErrorMessage).toContain('Aucun effet enregistré');
    const events = await missions.events(id);
    expect(events.at(-1)).toMatchObject({
      action: 'block',
      actorType: 'system',
      actorId: null,
      fromStatus: 'in_progress',
      toStatus: 'blocked',
    });
  });

  it('ne touche pas une mission dont la dernière modification est récente', async () => {
    const id = await startedMission();
    later(HOUR - 60_000);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(id)).status).toBe('in_progress');
  });

  it('respecte le délai configuré', async () => {
    const id = await startedMission();
    later(2 * HOUR);
    expect(await missions.recoverStale({ staleAfterMs: 3 * HOUR })).toEqual([]);
    expect((await missions.get(id)).status).toBe('in_progress');
    expect(await missions.recoverStale({ staleAfterMs: HOUR })).toHaveLength(1);
  });

  it('ne bloque pas une mission toujours en cours : une activité récente liée à la mission suffit', async () => {
    const { prospectId, missionId } = await prospectWithStartedMission();
    later(50 * 60_000);
    // L'agent signale qu'il avance (long traitement) : activité du dossier liée à la mission.
    await prospects.logActivity(prospectId, { title: 'Analyse en cours', missionId }, agent);
    later(30 * 60_000); // mission modifiée il y a 80 min, mais activité il y a 30 min
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(missionId)).status).toBe('in_progress');

    later(HOUR); // plus rien depuis 90 min : interrompue
    const [recovered] = await missions.recoverStale(STALE);
    expect(recovered?.missionId).toBe(missionId);
  });

  it('mission ayant déjà produit des effets : bloquée avec leur liste, jamais remise en attente', async () => {
    const { prospectId, missionId } = await prospectWithStartedMission();
    later(5 * 60_000);
    await prospects.logActivity(prospectId, { title: 'Chaîne relevée', missionId }, agent);
    later(2 * HOUR);

    const [recovered] = await missions.recoverStale(STALE);
    expect(recovered?.effects).toMatchObject({ events: 1, analyses: 0, output: false });
    const mission = await missions.get(missionId);
    expect(mission.status).toBe('blocked');
    expect(mission.lastErrorMessage).toContain('1 activité(s) du dossier');
    expect(mission.lastErrorMessage).toContain('Vérifiez-les avant de débloquer');

    // Les passages suivants ne la font plus évoluer : seule une décision humaine le peut.
    later(10 * HOUR);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(missionId)).status).toBe('blocked');
    const statuses = (await missions.events(missionId)).map((e) => e.toStatus);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(1); // seulement la création
  });

  it('les effets antérieurs au démarrage ne sont pas comptés', async () => {
    // La découverte (avant le démarrage) cite la mission : ce n'est pas un effet du traitement.
    const { missionId } = await prospectWithStartedMission();
    later(2 * HOUR);
    const [recovered] = await missions.recoverStale(STALE);
    expect(recovered?.missionId).toBe(missionId);
    expect(recovered?.effects.events).toBe(0);
  });

  it('ne touche ni les missions en attente, en pause, à valider, bloquées ou terminées', async () => {
    const make = async (requiresValidation = false) => {
      const input = createMissionRequestSchema.parse({
        type: 'analysis.score',
        room: 'analysis',
        agentId: agent.id,
        requiresValidation,
      });
      return (await missions.create(input, user)).mission.id;
    };
    const pending = await make();
    const paused = await make();
    await missions.applyAction(paused, { action: 'start' }, agent);
    await missions.applyAction(paused, { action: 'pause' }, agent);
    const awaiting = await make(true);
    await missions.applyAction(awaiting, { action: 'start' }, agent);
    await missions.applyAction(awaiting, { action: 'submit_for_validation' }, agent);
    const done = await make();
    await missions.applyAction(done, { action: 'start' }, agent);
    await missions.applyAction(done, { action: 'complete' }, agent);

    later(48 * HOUR);
    expect(await missions.recoverStale(STALE)).toEqual([]);
    expect((await missions.get(pending)).status).toBe('pending');
    expect((await missions.get(paused)).status).toBe('paused');
    expect((await missions.get(awaiting)).status).toBe('awaiting_validation');
    expect((await missions.get(done)).status).toBe('completed');
  });

  it('si l’agent agit au même moment, une seule des deux actions est enregistrée', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await startedMission();
      later(2 * HOUR);
      const [recovery, completion] = await Promise.allSettled([
        missions.recoverStale(STALE),
        missions.applyAction(id, { action: 'complete' }, agent),
      ]);
      expect(recovery.status).toBe('fulfilled');
      const mission = await missions.get(id);
      const afterStart = (await missions.events(id)).filter(
        (e) => e.action === 'block' || e.action === 'complete',
      );
      // Exactement un dénouement : terminée par l'agent OU bloquée par la récupération.
      expect(afterStart).toHaveLength(1);
      if (completion.status === 'fulfilled') expect(mission.status).toBe('completed');
      else expect(mission.status).toBe('blocked');
    }
  });

  it('écriture en cours de validation : la récupération l’attend, la voit et ne bloque pas', async () => {
    const { prospectId, missionId } = await prospectWithStartedMission();
    later(2 * HOUR); // la mission semble interrompue

    // L'activité est arrêtée juste avant la validation de sa transaction.
    const reached = gate();
    const release = gate();
    const hook: TransactionHook = {
      begin: async () => {},
      end: async () => {
        reached.open();
        await release.opened;
      },
    };
    const write = prospects.logActivity(prospectId, { title: 'Encore là', missionId }, agent, {
      hook,
    });
    await reached.opened;

    const recovery = missions.recoverStale(STALE);
    const recoveryState = track(recovery);
    await pause(300);
    expect(recoveryState.settled).toBe(false); // elle attend le verrou de la mission

    release.open();
    await write;
    expect(await recovery).toEqual([]); // l'activité, validée entre-temps, a été vue
    expect((await missions.get(missionId)).status).toBe('in_progress');
  });

  it('récupération en cours : l’écriture l’attend, voit la mission bloquée et est refusée', async () => {
    const { prospectId, missionId } = await prospectWithStartedMission();
    later(2 * HOUR);

    // Simule une récupération qui tient le verrou de la mission puis la bloque.
    const locked = gate();
    const release = gate();
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM missions WHERE id = ${missionId} FOR UPDATE`;
        locked.open();
        await release.opened;
        await tx.mission.update({ where: { id: missionId }, data: { status: 'blocked' } });
      },
      { timeout: 20_000 },
    );
    await locked.opened;

    const write = prospects.logActivity(prospectId, { title: 'Trop tard', missionId }, agent);
    const writeState = track(write);
    await pause(300);
    expect(writeState.settled).toBe(false); // elle attend le verrou de la mission

    release.open();
    await holder;
    const error = await write.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INVALID_TRANSITION', httpStatus: 409 });
    const events = (await prospects.getDossier(prospectId)).events;
    expect(events.some((e) => e.title === 'Trop tard')).toBe(false);
  });

  it('après un blocage par la récupération, l’agent ne peut plus rien y rattacher', async () => {
    const { prospectId, missionId } = await prospectWithStartedMission();
    later(2 * HOUR);
    expect(await missions.recoverStale(STALE)).toHaveLength(1);
    await expect(
      prospects.logActivity(prospectId, { title: 'Après coup', missionId }, agent),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const events = (await prospects.getDossier(prospectId)).events;
    expect(events.some((e) => e.title === 'Après coup')).toBe(false);
  });

  it('écriture et récupération simultanées : jamais un effet ignoré (5 essais)', async () => {
    for (let round = 0; round < 5; round++) {
      await resetDatabase();
      await createTestAgent(prisma, agent.id!);
      const { prospectId, missionId } = await prospectWithStartedMission();
      later(2 * HOUR);
      const [recovery, write] = await Promise.allSettled([
        missions.recoverStale(STALE),
        prospects.logActivity(prospectId, { title: 'Simultanée', missionId }, agent),
      ]);
      expect(recovery.status).toBe('fulfilled');
      const status = (await missions.get(missionId)).status;
      const recorded = (await prospects.getDossier(prospectId)).events.some(
        (e) => e.title === 'Simultanée',
      );
      if (write.status === 'fulfilled') {
        // L'activité est passée la première : la récupération l'a vue.
        expect(recorded).toBe(true);
        expect(status).toBe('in_progress');
      } else {
        // La récupération est passée la première : l'écriture a été refusée, rien d'enregistré.
        expect(write.reason).toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(recorded).toBe(false);
        expect(status).toBe('blocked');
      }
    }
  });

  it('après déblocage par l’utilisateur, la mission repart en attente et compte une tentative', async () => {
    const id = await startedMission();
    later(2 * HOUR);
    await missions.recoverStale(STALE);
    await missions.applyAction(id, { action: 'unblock' }, user);
    const restarted = await missions.applyAction(id, { action: 'start' }, agent);
    expect(restarted.mission).toMatchObject({
      status: 'in_progress',
      attemptCount: 2,
      lastErrorCode: null,
      agentId: agent.id,
    });
  });
});
