/**
 * Processus « serveur » interrompu, lancé par idempotency.int.test.ts.
 * Usage : node --import tsx interruptedWrite.ts <url-base> <agentId> <clé> <before-commit|after-commit>
 *
 * - before-commit : la clé est posée dans la transaction, puis le processus s'arrête de lui-même
 *   au milieu (il attend indéfiniment) ; le test le tue avant la validation.
 * - after-commit : la transaction est validée, puis le processus attend indéfiniment au moment
 *   d'envoyer la réponse ; le test le tue avant qu'elle parte.
 * Le processus écrit « PRET » sur sa sortie quand il est au point d'interruption.
 */
import { createPrismaClient } from '../../db/prisma.ts';
import { createIdempotencyStore } from '../../agents/idempotency.ts';
import { createMissionService } from '../../missions/missionService.ts';
import { createProspectService } from '../../prospects/prospectService.ts';

const [url, agentId, key, mode] = process.argv.slice(2);
if (!url || !agentId || !key || (mode !== 'before-commit' && mode !== 'after-commit')) {
  console.error('arguments invalides');
  process.exit(1);
}

const prisma = createPrismaClient(url);
const missions = createMissionService(prisma);
const prospects = createProspectService({ prisma, missions, simulationMode: true });
const store = createIdempotencyStore(prisma);
const forever = () => new Promise<never>(() => {});

export const INTERRUPTED_BODY = {
  creatorName: 'Interrompu',
  channelName: 'Interrompu',
  channelHandle: '@interrompu',
  discovery: {
    source: 'Test',
    reason: 'Interruption',
    qualification: { targetFit: 'Oui', potentialInterest: 'Élevé', firstObservation: 'RAS' },
  },
};

await store.run(
  {
    agentId,
    key,
    method: 'POST',
    path: '/api/agent/prospects',
    body: INTERRUPTED_BODY,
    status: 201,
  },
  (hook) =>
    prospects.createProspect(
      INTERRUPTED_BODY,
      { type: 'agent', id: agentId },
      {
        hook: {
          begin: async (tx) => {
            await hook.begin(tx);
            if (mode === 'before-commit') {
              console.log('PRET');
              await forever();
            }
          },
          end: hook.end,
        },
      },
    ),
  async () => {
    console.log('PRET');
    return forever();
  },
);
