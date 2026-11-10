/**
 * Lance l'API en développement (« npm run dev -w @agency/server », donc tsx watch) SANS entrée
 * clavier, de la même façon sous Windows et sous Linux. Utilisé par « npm run dev » à la racine.
 *
 * Pourquoi : sous Windows, « tsx » est un fichier .cmd ; à Ctrl+C, cmd.exe demande « Terminer le
 * programme de commandes (O/N) ? » et attend une réponse au clavier, ce qui bloque l'arrêt. Sans
 * entrée clavier, la question reçoit une fin de fichier et l'arrêt se poursuit. Cela remplace
 * « < NUL », propre à Windows (sous Linux, le shell cherche un fichier nommé NUL et échoue).
 *
 * Arrêt :
 * - Ctrl+C parvient directement à tous les processus du terminal, l'API comprise. Le lanceur ne
 *   relaie donc PAS ce signal : l'API le recevrait deux fois, et un deuxième signal force son arrêt
 *   immédiat. Il attend seulement la fin de l'API, puis se termine avec le même code.
 * - SIGTERM et SIGHUP (envoyés au lanceur seul) sont relayés à l'API.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = ['run', 'dev', '-w', '@agency/server'];
const stdio = ['ignore', 'inherit', 'inherit'];

// Lancé par npm : on réutilise le même npm, directement par Node (aucun shell, aucun fichier .cmd).
const npmCli = process.env.npm_execpath;
const child =
  npmCli && /\.[cm]?js$/.test(npmCli)
    ? spawn(process.execPath, [npmCli, ...args], { stdio })
    : spawn('npm', args, { stdio, shell: process.platform === 'win32' });

let exited = false;

process.on('SIGINT', () => {
  // Déjà reçu par l'API (voir plus haut) : on attend sa fin.
});
for (const signal of ['SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!exited) child.kill(signal);
  });
}

child.on('error', (error) => {
  process.stderr.write(`Lancement de l'API impossible : ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  exited = true;
  process.exit(code ?? (signal ? 1 : 0));
});
