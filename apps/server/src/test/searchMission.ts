import { randomUUID } from 'node:crypto';
import { PIPELINE_MISSION_TYPES, createMissionRequestSchema } from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentControl } from '../agents/agentControl.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createRunService } from '../agents/runService.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import type { AppPrismaClient } from '../db/prisma.ts';
import type { MissionService } from '../missions/missionService.ts';

/**
 * Mission de recherche EN COURS d'un agent, préparée par le vrai chemin : prompt actif, mission
 * search_creators attribuée à l'agent en salle de prospection, puis prise de mission (runs.claim),
 * qui démarre la mission et crée son exécution. Un agent ne peut créer de prospect que dans ce cadre.
 *
 * Une seule mission par agent et par base (mise en cache jusqu'à resetDatabase) : forget() vide le cache.
 */
export function searchMissions(prisma: AppPrismaClient, missions: MissionService) {
  const agents = createAgentService({ prisma });
  const profiles = createAgentProfileService({ prisma });
  const control = createAgentControl({ prisma });
  const runs = createRunService({ prisma, missions, control });
  const cache = new Map<string, Promise<string>>();

  async function start(agentId: string, givenKey?: string): Promise<string> {
    // Agent créé sans clé (directement en base) : une clé lui est remise, comme le ferait l'utilisateur.
    const apiKey =
      givenKey ??
      (await agents.issueKey(agentId, { label: 'test', expiresAt: null }, HUMAN_ACTOR)).apiKey;
    const authenticated = await agents.authenticate(apiKey);
    if (!authenticated) throw new Error(`searchMissions : clé invalide pour ${agentId}`);
    const profile = await profiles.getProfile(agentId);
    if (profile.activePromptVersion === null) {
      await profiles.createPrompt(
        agentId,
        { systemPrompt: `Prompt de test de ${agentId}`, note: null, activate: true },
        HUMAN_ACTOR,
      );
    }
    const input = createMissionRequestSchema.parse({
      type: PIPELINE_MISSION_TYPES.search,
      room: 'prospecting',
      agentId,
      priority: 5,
    });
    const { mission } = await missions.create(input, HUMAN_ACTOR);
    await control.load();
    const claimed = await runs.claim(authenticated, `test-search-${randomUUID()}`);
    if (claimed?.mission.id !== mission.id) {
      throw new Error(
        `searchMissions : la prise de ${agentId} n'a pas renvoyé sa mission de recherche`,
      );
    }
    return mission.id;
  }

  return {
    /** Identifiant de la mission de recherche en cours de l'agent (créée au premier appel). */
    of(agent: { id: string; key?: string }): Promise<string> {
      // Promesse mise en cache : des appels simultanés partagent la même mission.
      let pending = cache.get(agent.id);
      if (!pending) {
        pending = start(agent.id, agent.key);
        cache.set(agent.id, pending);
      }
      return pending;
    },
    /** À appeler après resetDatabase. */
    forget() {
      cache.clear();
    },
  };
}
