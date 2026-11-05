/**
 * npm run db:check-duplicates            → base réelle (DATABASE_URL)
 * npm run db:check-duplicates -- --demo  → base de démonstration
 *
 * LECTURE SEULE. À lancer AVANT d'appliquer la migration du lot B : signale les dossiers qui
 * désignent déjà la même chaîne. La migration ne supprime rien : le plus ancien dossier de chaque
 * groupe reçoit la clé de comparaison, les autres restent tels quels, à examiner à la main.
 * Code de sortie : 0 si aucun doublon, 2 si des doublons existent.
 */
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { resolveDemoDatabaseUrl } from '../config/demo.ts';
import { duplicateReport } from '../prospects/duplicateReport.ts';
import { createPrismaClient } from './prisma.ts';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
loadDotenv({ path: ROOT_ENV_FILE, quiet: true });

const demo = process.argv.includes('--demo');
const url = demo ? resolveDemoDatabaseUrl(process.env) : process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant dans le fichier .env');
  process.exit(1);
}

const prisma = createPrismaClient(url);
try {
  // Uniquement des colonnes antérieures à la migration : fonctionne avant comme après.
  const rows = await prisma.prospect.findMany({
    select: {
      id: true,
      reference: true,
      channelHandle: true,
      channelUrl: true,
      youtubeChannelId: true,
      createdAt: true,
    },
  });
  const [migrated] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospects' AND COLUMN_NAME = 'channel_handle_key'`;
  const groups = duplicateReport(rows);

  console.log(`Base : ${new URL(url).pathname.slice(1)} — ${rows.length} dossier(s).`);
  console.log(
    Number(migrated?.n ?? 0) > 0
      ? 'Migration du lot B : déjà appliquée.'
      : 'Migration du lot B : pas encore appliquée.',
  );
  const noIdentifier = rows.filter((r) => !r.youtubeChannelId && !r.channelHandle && !r.channelUrl);
  if (noIdentifier.length) {
    console.log(
      `${noIdentifier.length} dossier(s) sans identifiant de chaîne (doublons indétectables) : ` +
        noIdentifier.map((r) => r.reference).join(', '),
    );
  }
  if (groups.length === 0) {
    console.log('Aucun doublon : la migration peut être appliquée sans réserve.');
  } else {
    console.log(
      `${groups.length} groupe(s) de doublons (le premier dossier de chaque groupe gardera la clé) :`,
    );
    for (const g of groups) {
      const label = g.field === 'channelHandle' ? 'nom de chaîne' : 'adresse';
      console.log(`  • ${label} « ${g.key} » : ${g.references.join(', ')}`);
    }
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
