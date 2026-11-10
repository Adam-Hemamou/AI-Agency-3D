import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MODEL_DEFAULTS, AGENT_ROLE_PERMISSIONS, HUMAN_ACTOR_ID } from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createCampaignService } from '../campaigns/campaignService.ts';
import { createMissionService } from '../missions/missionService.ts';
import { createTestPrisma, resetDatabase } from '../test/testDb.ts';
import {
  PROSPECTORS,
  installProspectorAgents,
  type InstallOptions,
  type StepReport,
} from './prospectorAgents.ts';

/**
 * Installateur des deux prospecteurs, sur la base de TEST : création complète, idempotence
 * (relancé, il n'écrit rien), réglages de l'utilisateur préservés, campagnes désactivées.
 */

const prisma = createTestPrisma();
const missions = createMissionService(prisma);
const agents = createAgentService({ prisma });
const profiles = createAgentProfileService({ prisma });
const campaigns = createCampaignService({ prisma, missions });
const PROMPTS = new URL('../../../../automations/n8n/prospecteur/', import.meta.url);
const repoPrompt = (file: string) => readFileSync(fileURLToPath(new URL(file, PROMPTS)), 'utf8');

const [FR_EN, EN_FR] = PROSPECTORS as [(typeof PROSPECTORS)[0], (typeof PROSPECTORS)[0]];

function install(options: InstallOptions = {}, readPrompt = repoPrompt) {
  return installProspectorAgents({ prisma, agents, profiles, campaigns, readPrompt }, options);
}

const statuses = (steps: StepReport[]) => [...new Set(steps.map((s) => s.status))];
const step = (steps: StepReport[], agentId: string, name: StepReport['step']) =>
  steps.find((s) => s.agentId === agentId && s.step === name);

/** Empreinte de CHAQUE table de la base de test : toute écriture la modifie. */
async function databaseFingerprint(): Promise<Record<string, string>> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() ORDER BY table_name`;
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ Checksum: bigint | number | null }[]>(
      `CHECKSUM TABLE \`${name}\``,
    );
    result[name] = String(row?.Checksum);
  }
  return result;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  // Aucune trace laissée dans la base de test (agents, clés, campagnes installés par les tests).
  await resetDatabase();
  await prisma.$disconnect();
});

describe('installateur des prospecteurs : simulation', () => {
  it('par défaut, rien n’est écrit ; le rapport dit tout ce qui serait créé', async () => {
    const before = await databaseFingerprint();
    const result = await install();
    expect(result.apply).toBe(false);
    expect(statuses(result.steps)).toEqual(['created']);
    expect(result.steps).toHaveLength(12); // 6 étapes × 2 agents
    expect(result.issuedKeys).toEqual([]);
    expect(await databaseFingerprint()).toEqual(before);
  });
});

describe('installateur des prospecteurs : première installation', () => {
  it('crée deux agents indépendants, complets, avec des campagnes désactivées', async () => {
    const result = await install({ apply: true });
    expect(statuses(result.steps)).toEqual(['created']);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(result.issuedKeys.map((k) => k.agentId)).toEqual([FR_EN.id, EN_FR.id]);

    for (const def of [FR_EN, EN_FR]) {
      const agent = await prisma.agent.findUniqueOrThrow({
        where: { id: def.id },
        include: { permissions: true, profile: true, prompts: true, apiKeys: true },
      });
      expect(agent).toMatchObject({ name: def.name, room: 'prospecting', status: 'active' });
      expect(agent.permissions.map((p) => p.permission).sort()).toEqual(
        [...AGENT_ROLE_PERMISSIONS.prospector].sort(),
      );
      expect(agent.permissions.map((p) => p.permission)).toContain('creators:assess');
      expect(agent.profile).toMatchObject({
        role: 'prospector',
        model: AGENT_MODEL_DEFAULTS.model,
        numPredict: 1024,
        activePromptVersion: 1,
        updatedBy: HUMAN_ACTOR_ID,
      });
      expect(agent.prompts).toHaveLength(1);
      expect(agent.prompts[0]!.systemPrompt).toBe(repoPrompt(def.promptFile).trim());
      expect(agent.apiKeys).toHaveLength(1);
      expect(agent.apiKeys[0]!.secretHash).not.toContain(
        result.issuedKeys.find((k) => k.agentId === def.id)!.apiKey,
      );

      const campaign = await prisma.prospectingCampaign.findUniqueOrThrow({
        where: { name: def.campaign.name },
      });
      expect(campaign).toMatchObject({ enabled: false, agentId: def.id });
    }
    // Deux prompts distincts, et aucune mission créée.
    const prompts = await prisma.agentPrompt.findMany();
    expect(new Set(prompts.map((p) => p.systemPrompt)).size).toBe(2);
    expect(await prisma.mission.count()).toBe(0);
  });

  it('le planificateur ne crée aucune mission pour ces campagnes désactivées', async () => {
    await install({ apply: true });
    const scheduled = await campaigns.generateDailyMissions();
    expect(scheduled.created).toEqual([]);
    expect(await prisma.mission.count()).toBe(0);
  });
});

describe('installateur des prospecteurs : idempotence', () => {
  it('relancé, il n’écrit rien : aucune clé, aucune version, aucune campagne en plus', async () => {
    await install({ apply: true });
    const before = await databaseFingerprint();
    const again = await install({ apply: true });
    expect(statuses(again.steps)).toEqual(['present']);
    expect(again.issuedKeys).toEqual([]);
    expect(again.checks.every((c) => c.ok)).toBe(true);
    expect(await databaseFingerprint()).toEqual(before);
  });

  it('préserve les réglages de l’utilisateur ; rajoute seulement une permission requise retirée', async () => {
    await install({ apply: true });
    await profiles.updateProfile(FR_EN.id, { temperature: 0.5 }, HUMAN_ACTOR);
    const changed = [
      ...AGENT_ROLE_PERMISSIONS.prospector.filter((p) => p !== 'creators:assess'),
      'analyses:read' as const,
    ];
    await agents.update(FR_EN.id, { permissions: changed }, HUMAN_ACTOR);

    const result = await install({ apply: true });
    expect(step(result.steps, FR_EN.id, 'permissions')).toMatchObject({
      status: 'updated',
      detail: 'Ajoutées : creators:assess',
    });
    const permissions = (
      await prisma.agentPermission.findMany({ where: { agentId: FR_EN.id } })
    ).map((p) => p.permission);
    expect(permissions).toContain('creators:assess');
    expect(permissions).toContain('analyses:read'); // ajoutée par l'utilisateur : conservée
    const profile = await prisma.agentProfile.findUniqueOrThrow({ where: { agentId: FR_EN.id } });
    expect(profile.temperature).toBe(0.5);
  });

  it('campagne activée par l’utilisateur : signalée, jamais modifiée', async () => {
    await install({ apply: true });
    const campaign = await prisma.prospectingCampaign.findUniqueOrThrow({
      where: { name: EN_FR.campaign.name },
    });
    await campaigns.update(
      campaign.id,
      { expectedVersion: campaign.version, enabled: true },
      HUMAN_ACTOR,
    );
    const result = await install({ apply: true });
    expect(step(result.steps, EN_FR.id, 'campaign')).toMatchObject({ status: 'drift' });
    expect(step(result.steps, EN_FR.id, 'campaign')?.detail).toContain('ACTIVE');
    const after = await prisma.prospectingCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.enabled).toBe(true);
  });
});

describe('installateur des prospecteurs : prompts', () => {
  const edited = (file: string) => `${repoPrompt(file).trim()}\n\nConsigne ajoutée.`;

  it('prompt du dépôt modifié : signalé sans changement, puis nouvelle version avec --update-prompts', async () => {
    await install({ apply: true });

    const drift = await install({ apply: true }, edited);
    expect(step(drift.steps, FR_EN.id, 'prompt')?.status).toBe('drift');
    expect(await prisma.agentPrompt.count({ where: { agentId: FR_EN.id } })).toBe(1);

    const updated = await install({ apply: true, updatePrompts: true }, edited);
    expect(step(updated.steps, FR_EN.id, 'prompt')?.status).toBe('updated');
    const profile = await prisma.agentProfile.findUniqueOrThrow({ where: { agentId: FR_EN.id } });
    expect(profile.activePromptVersion).toBe(2);

    // Retour au texte d'origine : la version 1 est réactivée, aucune version 3.
    const back = await install({ apply: true, updatePrompts: true });
    expect(step(back.steps, FR_EN.id, 'prompt')).toMatchObject({
      status: 'updated',
      detail: 'Version 1 réactivée',
    });
    expect(await prisma.agentPrompt.count({ where: { agentId: FR_EN.id } })).toBe(2);
  });
});

describe('installateur des prospecteurs : clés', () => {
  it('clé révoquée : une nouvelle est émise ; agent désactivé : aucune clé', async () => {
    const first = await install({ apply: true });
    const key = await prisma.agentApiKey.findFirstOrThrow({ where: { agentId: FR_EN.id } });
    await agents.revokeKey(FR_EN.id, key.id, HUMAN_ACTOR);

    const reissued = await install({ apply: true });
    expect(reissued.issuedKeys.map((k) => k.agentId)).toEqual([FR_EN.id]);
    expect(reissued.issuedKeys[0]!.apiKey).not.toBe(
      first.issuedKeys.find((k) => k.agentId === FR_EN.id)!.apiKey,
    );

    await agents.update(EN_FR.id, { status: 'disabled' }, HUMAN_ACTOR);
    for (const k of await prisma.agentApiKey.findMany({ where: { agentId: EN_FR.id } })) {
      await agents.revokeKey(EN_FR.id, k.id, HUMAN_ACTOR);
    }
    const disabled = await install({ apply: true });
    expect(step(disabled.steps, EN_FR.id, 'agent')?.status).toBe('drift');
    expect(step(disabled.steps, EN_FR.id, 'key')?.status).toBe('drift');
    expect(disabled.issuedKeys).toEqual([]);
  });
});
