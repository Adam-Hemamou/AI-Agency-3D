/**
 * npm run owner:password            → mot de passe de la base réelle (DATABASE_URL)
 * npm run owner:password -- --demo  → mot de passe de la base de démonstration
 *
 * Définit (ou remplace) le mot de passe administrateur. Le mot de passe est saisi sans être
 * affiché ; seule son empreinte est enregistrée. Toutes les sessions ouvertes sont fermées.
 * Seule une personne ayant accès au terminal de cette machine peut donc le changer.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { checkOwnerPassword } from '@agency/shared';
import { resolveDemoDatabaseUrl } from '../config/demo.ts';
import { createPrismaClient } from '../db/prisma.ts';
import { createOwnerAuthService } from './ownerAuth.ts';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
loadDotenv({ path: ROOT_ENV_FILE, quiet: true });

const demo = process.argv.includes('--demo');
const url = demo ? resolveDemoDatabaseUrl(process.env) : process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant dans le fichier .env');
  process.exit(1);
}

/** Saisie masquée (rien n'est affiché pendant la frappe). */
function ask(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const password = await ask('Nouveau mot de passe administrateur : ');
const problem = checkOwnerPassword(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
if (process.stdin.isTTY && (await ask('Confirmez le mot de passe : ')) !== password) {
  console.error('Les deux saisies sont différentes : rien n’a été modifié.');
  process.exit(1);
}

const prisma = createPrismaClient(url);
try {
  await createOwnerAuthService({ prisma }).setPassword(password);
  console.log(
    `Mot de passe enregistré${demo ? ' (démonstration)' : ''}. Les sessions ouvertes ont été fermées.`,
  );
} finally {
  await prisma.$disconnect();
}
