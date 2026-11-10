import {
  AGENT_ROLE_PERMISSIONS,
  createAgentPromptRequestSchema,
  createAgentRequestSchema,
  createCampaignRequestSchema,
  issueAgentKeyRequestSchema,
  type AgentPermission,
  type CreateCampaignRequest,
  type LanguageDirection,
  type UpdateAgentProfileRequest,
} from '@agency/shared';
import type { AgentProfileService } from '../agents/agentProfileService.ts';
import type { AgentService } from '../agents/agentService.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import type { CampaignService } from '../campaigns/campaignService.ts';
import type { AppPrismaClient } from '../db/prisma.ts';

/**
 * Installation des deux prospecteurs (FR → EN et EN → FR) dans le CRM : identité, permissions,
 * profil IA, prompt, clé API et campagne de départ DÉSACTIVÉE.
 *
 * - Passe uniquement par les services du CRM (mêmes règles que l'API), au nom de l'utilisateur.
 * - IDEMPOTENTE : relancée, elle ne crée aucun doublon (ni agent, ni clé, ni version de prompt, ni
 *   campagne). Ce qui existe déjà n'est jamais écrasé : un écart est SIGNALÉ, pas corrigé, sauf les
 *   permissions requises manquantes (ajoutées, sans retirer les autres).
 * - Simulation par défaut (apply: false) : rien n'est écrit, le rapport dit ce qui serait fait.
 * - N'active aucune campagne : aucune mission n'est créée.
 */

const ROOM = 'prospecting';
/** Permissions du rôle prospecteur (dont creators:assess, l'évaluation linguistique). */
export const PROSPECTOR_PERMISSIONS: readonly AgentPermission[] = AGENT_ROLE_PERMISSIONS.prospector;
/** Profil IA de départ (autres paramètres : AGENT_MODEL_DEFAULTS, Qwen3:8b). */
export const PROSPECTOR_PROFILE: UpdateAgentProfileRequest = {
  role: 'prospector',
  numPredict: 1024,
};

export interface ProspectorDefinition {
  id: string;
  name: string;
  description: string;
  direction: LanguageDirection;
  /** Fichier du prompt, dans automations/n8n/prospecteur/. */
  promptFile: string;
  keyLabel: string;
  campaign: CreateCampaignRequest;
}

/** Campagne de départ : petite cible, objectif réduit, toujours créée DÉSACTIVÉE. */
const START: Omit<CreateCampaignRequest, 'name' | 'keywords'> = {
  minSubscribers: 10_000,
  maxSubscribers: 1_000_000,
  maxDaysSinceLastVideo: 30,
  dailyTarget: 3,
  reevaluationDays: 90,
  priority: 3,
  // Pays vides : un pays déclaré n'indique ni la nationalité ni l'audience.
  countries: [],
  enabled: false,
};

export const PROSPECTORS: readonly ProspectorDefinition[] = [
  {
    id: 'agent-prospecteur-fr-en',
    name: 'Prospecteur FR → EN',
    description:
      'Recherche des créateurs YouTube qui publient principalement en français et dont le contenu pourrait toucher une audience anglophone.',
    direction: 'fr-en',
    promptFile: 'prompt-fr-en-v1.md',
    keyLabel: 'n8n – Prospecteur FR → EN',
    campaign: {
      ...START,
      name: 'FR → EN – campagne de départ',
      description:
        'Créateurs francophones (contenu en français) au potentiel anglophone. Créée désactivée par l’installateur.',
      themes: ['tutoriels', 'vulgarisation', 'cuisine'],
      keywords: ['tutoriel', 'explication simple', 'recette facile'],
      languages: ['fr'],
      agentId: 'agent-prospecteur-fr-en',
    },
  },
  {
    id: 'agent-prospecteur-en-fr',
    name: 'Prospecteur EN → FR',
    description:
      'Recherche des créateurs YouTube qui publient principalement en anglais et dont le contenu pourrait toucher une audience francophone.',
    direction: 'en-fr',
    promptFile: 'prompt-en-fr-v1.md',
    keyLabel: 'n8n – Prospecteur EN → FR',
    campaign: {
      ...START,
      name: 'EN → FR – campagne de départ',
      description:
        'Créateurs anglophones (contenu en anglais) au potentiel francophone. Créée désactivée par l’installateur.',
      themes: ['tutorials', 'science explained', 'cooking'],
      keywords: ['tutorial', 'explained simply', 'easy recipe'],
      languages: ['en'],
      agentId: 'agent-prospecteur-en-fr',
    },
  },
];

export type StepName = 'agent' | 'permissions' | 'profile' | 'prompt' | 'key' | 'campaign';
/**
 * created / updated : écrit (ou à écrire en simulation) ; present : déjà conforme, rien à faire ;
 * drift : écart avec la définition, SIGNALÉ et laissé tel quel.
 */
export type StepStatus = 'created' | 'updated' | 'present' | 'drift';

export interface StepReport {
  agentId: string;
  step: StepName;
  status: StepStatus;
  detail: string;
}

export interface IssuedKey {
  agentId: string;
  prefix: string;
  /** Clé complète : affichée UNE fois, jamais enregistrée en clair. */
  apiKey: string;
}

export interface InstallResult {
  apply: boolean;
  steps: StepReport[];
  issuedKeys: IssuedKey[];
  /** Vérifications finales (mode application uniquement). */
  checks: { label: string; ok: boolean }[];
}

export interface InstallDeps {
  prisma: AppPrismaClient;
  agents: AgentService;
  profiles: AgentProfileService;
  campaigns: CampaignService;
  /** Texte du prompt d'un fichier de automations/n8n/prospecteur/. */
  readPrompt: (file: string) => string;
  clock?: () => Date;
}

export interface InstallOptions {
  /** false (défaut) : simulation, aucune écriture. */
  apply?: boolean;
  /** Prompt du dépôt différent de la version active : en créer (ou réactiver) la version. */
  updatePrompts?: boolean;
  definitions?: readonly ProspectorDefinition[];
}

export async function installProspectorAgents(
  deps: InstallDeps,
  { apply = false, updatePrompts = false, definitions = PROSPECTORS }: InstallOptions = {},
): Promise<InstallResult> {
  const { prisma, agents, profiles, campaigns, readPrompt, clock = () => new Date() } = deps;
  const steps: StepReport[] = [];
  const issuedKeys: IssuedKey[] = [];

  for (const def of definitions) {
    const report = (step: StepName, status: StepStatus, detail: string) =>
      steps.push({ agentId: def.id, step, status, detail });
    // Lu avant toute écriture : la simulation n'écrit rien.
    const systemPrompt = createAgentPromptRequestSchema.parse({
      systemPrompt: readPrompt(def.promptFile),
    }).systemPrompt;

    // 1. Identité et permissions -------------------------------------------------------------
    const existing = await prisma.agent.findUnique({
      where: { id: def.id },
      include: { permissions: true },
    });
    let active = true;
    if (!existing) {
      report('agent', 'created', `${def.name}, salle ${ROOM}`);
      report('permissions', 'created', PROSPECTOR_PERMISSIONS.join(', '));
      if (apply) {
        await agents.create(
          createAgentRequestSchema.parse({
            id: def.id,
            name: def.name,
            description: def.description,
            room: ROOM,
            permissions: [...PROSPECTOR_PERMISSIONS],
          }),
          HUMAN_ACTOR,
        );
      }
    } else {
      const drifts: string[] = [];
      if (existing.room !== ROOM) drifts.push(`salle « ${existing.room ?? 'aucune'} »`);
      if (existing.status !== 'active') {
        drifts.push(`statut « ${existing.status} »`);
        active = false;
      }
      report(
        'agent',
        drifts.length ? 'drift' : 'present',
        drifts.length ? `Laissé tel quel : ${drifts.join(', ')}` : 'Déjà présent',
      );
      const granted = existing.permissions.map((p) => p.permission as AgentPermission);
      const missing = PROSPECTOR_PERMISSIONS.filter((p) => !granted.includes(p));
      if (missing.length === 0) {
        report('permissions', 'present', 'Toutes les permissions du rôle sont accordées');
      } else {
        report('permissions', 'updated', `Ajoutées : ${missing.join(', ')}`);
        if (apply) {
          await agents.update(def.id, { permissions: [...granted, ...missing] }, HUMAN_ACTOR);
        }
      }
    }

    // 2. Profil IA : créé s'il est absent, jamais écrasé ---------------------------------------
    const profile = existing
      ? await prisma.agentProfile.findUnique({ where: { agentId: def.id } })
      : null;
    if (!profile) {
      report('profile', 'created', 'Rôle prospecteur, Qwen3:8b, numPredict 1024');
      if (apply) await profiles.updateProfile(def.id, PROSPECTOR_PROFILE, HUMAN_ACTOR);
    } else if (profile.role !== 'prospector') {
      report('profile', 'drift', `Laissé tel quel : rôle « ${profile.role ?? 'aucun'} »`);
    } else {
      report('profile', 'present', `Déjà présent (modèle ${profile.model})`);
    }

    // 3. Prompt : une version n'est créée que si son texte n'existe pas encore -----------------
    const versions = existing
      ? await prisma.agentPrompt.findMany({
          where: { agentId: def.id },
          orderBy: { version: 'desc' },
          select: { version: true, systemPrompt: true },
        })
      : [];
    const activeVersion = profile?.activePromptVersion ?? null;
    const same = versions.find((v) => v.systemPrompt === systemPrompt);
    const note = `Installateur des prospecteurs (automations/n8n/prospecteur/${def.promptFile})`;
    if (versions.length === 0) {
      report('prompt', 'created', `Version 1 active (${def.promptFile})`);
      if (apply) {
        await profiles.createPrompt(
          def.id,
          createAgentPromptRequestSchema.parse({ systemPrompt, note, activate: true }),
          HUMAN_ACTOR,
        );
      }
    } else if (same && same.version === activeVersion) {
      report('prompt', 'present', `Version ${same.version} active, identique au dépôt`);
    } else if (!updatePrompts) {
      report(
        'prompt',
        'drift',
        same
          ? `Le texte du dépôt correspond à la version ${same.version}, mais la version active est ${activeVersion ?? 'aucune'} : laissé tel quel (--update-prompts pour la réactiver)`
          : `Le prompt du dépôt diffère de la version active (${activeVersion ?? 'aucune'}) : laissé tel quel (--update-prompts pour créer une nouvelle version)`,
      );
    } else if (same) {
      report('prompt', 'updated', `Version ${same.version} réactivée`);
      if (apply) await profiles.activatePrompt(def.id, same.version, HUMAN_ACTOR);
    } else {
      report('prompt', 'updated', `Nouvelle version ${versions[0]!.version + 1} active`);
      if (apply) {
        await profiles.createPrompt(
          def.id,
          createAgentPromptRequestSchema.parse({ systemPrompt, note, activate: true }),
          HUMAN_ACTOR,
        );
      }
    }

    // 4. Clé API : seulement si l'agent n'en a aucune utilisable --------------------------------
    const now = clock();
    const usableKeys = existing
      ? await prisma.agentApiKey.count({
          where: {
            agentId: def.id,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        })
      : 0;
    if (usableKeys > 0) {
      report(
        'key',
        'present',
        `${usableKeys} clé(s) utilisable(s) conservée(s), jamais réaffichée(s)`,
      );
    } else if (!active) {
      report('key', 'drift', 'Agent désactivé : aucune clé créée');
    } else {
      report('key', 'created', `Clé « ${def.keyLabel} », affichée une seule fois`);
      if (apply) {
        const issued = await agents.issueKey(
          def.id,
          issueAgentKeyRequestSchema.parse({ label: def.keyLabel }),
          HUMAN_ACTOR,
        );
        issuedKeys.push({ agentId: def.id, prefix: issued.key.prefix, apiKey: issued.apiKey });
      }
    }

    // 5. Campagne de départ : créée DÉSACTIVÉE si son nom est libre, jamais modifiée ------------
    const campaign = await prisma.prospectingCampaign.findUnique({
      where: { name: def.campaign.name },
    });
    if (!campaign) {
      report('campaign', 'created', `« ${def.campaign.name} », désactivée`);
      if (apply) {
        await campaigns.create(
          createCampaignRequestSchema.parse({ ...def.campaign, enabled: false }),
          HUMAN_ACTOR,
        );
      }
    } else {
      const drifts: string[] = [];
      if (campaign.agentId !== def.id) drifts.push(`attribuée à ${campaign.agentId ?? 'personne'}`);
      if (campaign.enabled) drifts.push('ACTIVE');
      report(
        'campaign',
        drifts.length ? 'drift' : 'present',
        drifts.length
          ? `« ${campaign.name} » laissée telle quelle : ${drifts.join(', ')}`
          : `« ${campaign.name} » déjà présente, désactivée`,
      );
    }
  }

  return {
    apply,
    steps,
    issuedKeys,
    checks: apply ? await finalChecks(prisma, definitions) : [],
  };
}

/** Après application : permission d'évaluation accordée, campagne attribuée à son agent. */
async function finalChecks(
  prisma: AppPrismaClient,
  definitions: readonly ProspectorDefinition[],
): Promise<{ label: string; ok: boolean }[]> {
  const checks: { label: string; ok: boolean }[] = [];
  for (const def of definitions) {
    const agent = await prisma.agent.findUnique({
      where: { id: def.id },
      include: { permissions: true },
    });
    checks.push({
      label: `${def.id} : permission creators:assess`,
      ok: agent?.permissions.some((p) => p.permission === 'creators:assess') ?? false,
    });
    const campaign = await prisma.prospectingCampaign.findUnique({
      where: { name: def.campaign.name },
    });
    checks.push({
      label: `${def.id} : campagne « ${def.campaign.name} » attribuée à l’agent`,
      ok: campaign?.agentId === def.id,
    });
  }
  return checks;
}
