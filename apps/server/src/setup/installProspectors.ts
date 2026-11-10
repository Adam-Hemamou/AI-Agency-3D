/**
 * Installe les deux prospecteurs (FR → EN et EN → FR) dans le CRM. Voir prospectorAgents.ts.
 *
 * Usage (depuis apps/server) :
 *   npx tsx src/setup/installProspectors.ts                 simulation sur la base de TEST
 *   npx tsx src/setup/installProspectors.ts --apply         installation sur la base de TEST
 *   npx tsx src/setup/installProspectors.ts --target=production --confirm=ai_agency [--apply]
 *
 * Relançable sans risque : rien n'est créé deux fois, rien d'existant n'est écrasé.
 * Les campagnes sont créées DÉSACTIVÉES : aucune mission, aucun appel YouTube.
 * Clés API : en production, affichées UNE fois (à copier dans n8n) ; en test, jamais en entier.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createAgentProfileService } from '../agents/agentProfileService.ts';
import { createAgentService } from '../agents/agentService.ts';
import { createCampaignService } from '../campaigns/campaignService.ts';
import {
  compareMigrations,
  listRepositoryMigrations,
  migrationProblem,
  readAppliedMigrations,
} from '../db/migrationCheck.ts';
import { createPrismaClient } from '../db/prisma.ts';
import { createMissionService } from '../missions/missionService.ts';
import { resolveInstallTarget, type InstallTarget } from './installTarget.ts';
import { installProspectorAgents, type StepStatus } from './prospectorAgents.ts';

const ROOT = new URL('../../../../', import.meta.url);
const PROMPTS_DIR = new URL('automations/n8n/prospecteur/', ROOT);
loadDotenv({ path: fileURLToPath(new URL('.env', ROOT)), quiet: true });

let target: InstallTarget;
try {
  target = resolveInstallTarget(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`REFUS : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const LABELS: Record<StepStatus, string> = {
  created: target.apply ? 'CRÉÉ' : 'À CRÉER',
  updated: target.apply ? 'MIS À JOUR' : 'À METTRE À JOUR',
  present: 'déjà présent',
  drift: 'ÉCART (laissé tel quel)',
};

console.log(
  `Base : ${target.database} (${target.kind === 'production' ? 'PRODUCTION' : 'test'}) — ${
    target.apply ? 'APPLICATION' : 'SIMULATION : rien ne sera écrit (ajoutez --apply)'
  }`,
);

const prisma = createPrismaClient(target.databaseUrl);
try {
  const problem = migrationProblem(
    compareMigrations(listRepositoryMigrations(), await readAppliedMigrations(prisma)),
    target.database,
  );
  if (problem) {
    console.error(`REFUS : base en retard sur le dépôt.\n${problem}`);
    process.exitCode = 1;
  } else {
    const missions = createMissionService(prisma);
    const result = await installProspectorAgents(
      {
        prisma,
        agents: createAgentService({ prisma }),
        profiles: createAgentProfileService({ prisma }),
        campaigns: createCampaignService({ prisma, missions }),
        readPrompt: (file) => readFileSync(fileURLToPath(new URL(file, PROMPTS_DIR)), 'utf8'),
      },
      { apply: target.apply, updatePrompts: target.updatePrompts },
    );

    let agent = '';
    for (const step of result.steps) {
      if (step.agentId !== agent) {
        agent = step.agentId;
        console.log(`\n${agent}`);
      }
      console.log(`  ${step.step.padEnd(12)} ${LABELS[step.status].padEnd(24)} ${step.detail}`);
    }
    for (const check of result.checks) {
      console.log(`${check.ok ? '  ✓' : '  ✗'} ${check.label}`);
    }
    if (result.checks.some((c) => !c.ok)) process.exitCode = 1;

    for (const key of result.issuedKeys) {
      if (target.kind === 'production') {
        console.log(
          `\nClé API de ${key.agentId}, à copier MAINTENANT dans n8n (jamais réaffichée) :`,
        );
        console.log(`  Authorization: Bearer ${key.apiKey}`);
      } else {
        console.log(`\nClé de test créée pour ${key.agentId} : ${key.prefix}… (non affichée)`);
      }
    }
    if (!target.apply) console.log('\nSimulation terminée : aucune écriture.');
  }
} finally {
  await prisma.$disconnect();
}
