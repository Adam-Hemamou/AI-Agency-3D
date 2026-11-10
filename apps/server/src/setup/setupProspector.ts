/**
 * Installation du Prospecteur YouTube dans le CRM (base principale) : identité, permissions,
 * profil IA, prompt v1, clé API pour n8n et campagne de test. Passe par les services du CRM
 * (mêmes règles que l'API) ; aucune écriture directe en base.
 *
 * Usage (depuis apps/server, APRÈS la migration 20261109100000_prospecting_campaigns) :
 *   npx tsx src/setup/setupProspector.ts
 *
 * - Refuse de s'exécuter si agent-prospecteur existe déjà (rien n'est modifié).
 * - La clé API complète n'est affichée qu'UNE fois : la copier dans n8n (identifiant
 *   « CRM – agent-prospecteur »), elle n'est stockée nulle part en clair.
 * - La campagne de test est créée ACTIVE : la mission du jour apparaît au passage suivant du
 *   planificateur (5 minutes au plus après le démarrage de l'API).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  AGENT_ROLE_PERMISSIONS,
  createAgentPromptRequestSchema,
  createAgentRequestSchema,
  createCampaignRequestSchema,
  issueAgentKeyRequestSchema,
} from '@agency/shared';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { HUMAN_ACTOR } from '../auth/actors.ts';
import { createCampaignService } from '../campaigns/campaignService.ts';
import { createPrismaClient } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';

const AGENT_ID = 'agent-prospecteur';

/** Campagne de test : à adapter AVANT de lancer le script (modifiable ensuite par l'API). */
const CAMPAGNE_TEST = {
  name: 'Test – cuisine francophone',
  description: 'Campagne de test du Prospecteur : petite cible, objectif quotidien réduit.',
  themes: ['cuisine', 'recettes'],
  keywords: ['recette facile', 'cuisine maison', 'recette rapide'],
  languages: ['fr'],
  countries: ['FR'],
  minSubscribers: 10_000,
  maxSubscribers: 1_000_000,
  maxDaysSinceLastVideo: 30,
  dailyTarget: 3,
  agentId: AGENT_ID,
  enabled: true,
};

const ROOT = new URL('../../../../', import.meta.url);
loadDotenv({ path: fileURLToPath(new URL('.env', ROOT)), quiet: true });
const PROMPT = readFileSync(
  fileURLToPath(new URL('automations/n8n/prospecteur/prompt-v1.md', ROOT)),
  'utf8',
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL absent du fichier .env : arrêt.');
  process.exit(1);
}

const prisma = createPrismaClient(url);
const missions = createMissionService(prisma);
const agents = createAgentService({ prisma });
const profiles = createAgentProfileService({ prisma });
const campaigns = createCampaignService({ prisma, missions });

try {
  if (await prisma.agent.findUnique({ where: { id: AGENT_ID } })) {
    console.error(`${AGENT_ID} existe déjà : rien n'a été modifié.`);
    process.exitCode = 1;
  } else {
    await agents.create(
      createAgentRequestSchema.parse({
        id: AGENT_ID,
        name: 'Prospecteur',
        description: 'Recherche des créateurs YouTube, les qualifie et les enregistre.',
        room: 'prospecting',
        permissions: [...AGENT_ROLE_PERMISSIONS.prospector],
      }),
      HUMAN_ACTOR,
    );
    console.log(`Agent ${AGENT_ID} créé (salle de prospection, permissions du rôle prospecteur).`);

    await profiles.updateProfile(AGENT_ID, { role: 'prospector', numPredict: 1024 }, HUMAN_ACTOR);
    const prompt = await profiles.createPrompt(
      AGENT_ID,
      createAgentPromptRequestSchema.parse({
        systemPrompt: PROMPT,
        note: 'Version initiale (automations/n8n/prospecteur/prompt-v1.md)',
        activate: true,
      }),
      HUMAN_ACTOR,
    );
    console.log(`Profil IA réglé, prompt v${prompt.version} actif.`);

    const campaign = await campaigns.create(
      createCampaignRequestSchema.parse(CAMPAGNE_TEST),
      HUMAN_ACTOR,
    );
    console.log(
      `Campagne « ${campaign.name} » créée et active (objectif : ${campaign.dailyTarget} par jour).`,
    );

    const issued = await agents.issueKey(
      AGENT_ID,
      issueAgentKeyRequestSchema.parse({ label: 'n8n – Prospecteur YouTube' }),
      HUMAN_ACTOR,
    );
    console.log('\nClé API à copier MAINTENANT dans n8n (elle ne sera plus jamais affichée) :');
    console.log(`  Authorization: Bearer ${issued.apiKey}`);
  }
} finally {
  await prisma.$disconnect();
}
