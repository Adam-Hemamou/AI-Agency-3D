import { createServer, type RequestListener, type Server } from 'node:http';
import { isIPv4, type Socket } from 'node:net';
import { ERROR_CODES, type ApiErrorBody } from '@agency/shared';

/**
 * Deuxième écoute de l'API, sur l'adresse Tailscale du PC, réservée à UNE machine du tailnet
 * (le VPS) et aux seules routes des agents. L'écoute locale 127.0.0.1 reste inchangée.
 *
 * Deux filtres, avant l'application :
 * 1. à la connexion TCP, avant toute lecture HTTP : une autre machine est coupée sans réponse ;
 * 2. à la requête : seules /api/health, /api/agent/… et GET /api/agents/me atteignent l'application.
 * Les protections de l'application (Host, Origin, authentification, permissions, débit, quotas,
 * arrêt d'urgence) s'appliquent ensuite normalement.
 */

/**
 * Adresse IPv4 Tailscale (100.64.0.0/10 : 100.64.0.0 à 100.127.255.255), en écriture décimale
 * stricte. net.isIPv4 refuse d'abord toute forme ambiguë (hexadécimal, 1e2, zéros en tête,
 * segment vide, espaces, signe…), qu'une résolution de nom pourrait sinon interpréter.
 */
export function isTailscaleAddress(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
  return a === 100 && b >= 64 && b <= 127;
}

/** Adresse distante d'une connexion, sans le préfixe IPv4 mappé en IPv6 (« ::ffff: »). */
export function normalizeRemoteAddress(address: string | undefined): string {
  if (!address) return '';
  const value = address.toLowerCase();
  return value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
}

/** La connexion vient-elle exactement de la machine autorisée ? */
export function isAllowedPeer(address: string | undefined, allowedPeer: string): boolean {
  const remote = normalizeRemoteAddress(address);
  return remote !== '' && remote === allowedPeer;
}

/** Segment de chemin sans ambiguïté : pas de « . » (donc ni « .. »), pas d'encodage « % ». */
const SAFE_SEGMENT = /^[A-Za-z0-9_~-]+$/;
const AGENT_PREFIX = '/api/agent/';

/**
 * Chemins acceptés sur l'écoute Tailscale : /api/health et /api/agent/… uniquement.
 * Comparaison stricte (casse comprise) : toute forme inhabituelle est refusée plutôt
 * qu'interprétée (URL absolue, « .. », « // », encodages, antislash, majuscules).
 */
export function isTailnetPathAllowed(url: string | undefined): boolean {
  if (!url?.startsWith('/')) return false;
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  if (path === '/api/health' || path === '/api/health/') return true;
  if (!path.startsWith(AGENT_PREFIX)) return false;
  const rest = path.slice(AGENT_PREFIX.length).replace(/\/$/, '');
  return rest !== '' && rest.split('/').every((segment) => SAFE_SEGMENT.test(segment));
}

/** Seule route d'agent hors /api/agent/… exposée : son identité, en lecture (GET, chemin exact). */
const AGENT_IDENTITY_PATH = '/api/agents/me';

/**
 * Requête acceptée sur l'écoute Tailscale : /api/health et /api/agent/… (toutes méthodes, la liste
 * blanche des agents décide ensuite), plus GET /api/agents/me exactement.
 */
export function isTailnetRequestAllowed(
  method: string | undefined,
  url: string | undefined,
): boolean {
  if (isTailnetPathAllowed(url)) return true;
  if (method !== 'GET' || !url) return false;
  const query = url.indexOf('?');
  return (query === -1 ? url : url.slice(0, query)) === AGENT_IDENTITY_PATH;
}

export interface TailnetListenerOptions {
  /** Adresse d'écoute (l'IP Tailscale du PC). */
  host: string;
  port: number;
  /** Seule adresse distante acceptée (l'IP Tailscale du VPS). */
  allowedPeer: string;
  /** Appelé pour chaque connexion refusée (journal). */
  onRejected?: (remoteAddress: string) => void;
  /** Appelé pour chaque requête refusée car hors des routes des agents (journal). */
  onRouteRejected?: (method: string, url: string) => void;
}

const ROUTE_REFUSED: ApiErrorBody = {
  error: {
    code: ERROR_CODES.FORBIDDEN_ORIGIN,
    message:
      'Route non accessible via Tailscale : seules /api/health, /api/agent/… et GET /api/agents/me le sont',
  },
};

/** Crée le serveur HTTP filtré (sans le démarrer). */
export function createTailnetServer(
  handler: RequestListener,
  {
    allowedPeer,
    onRejected,
    onRouteRejected,
  }: Pick<TailnetListenerOptions, 'allowedPeer' | 'onRejected' | 'onRouteRejected'>,
): Server {
  const server = createServer((req, res) => {
    if (!isTailnetRequestAllowed(req.method, req.url)) {
      onRouteRejected?.(req.method ?? '?', (req.url ?? '').slice(0, 200));
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(ROUTE_REFUSED));
      return;
    }
    handler(req, res);
  });
  // Placé AVANT le gestionnaire interne de Node : la connexion est coupée avant toute lecture.
  server.prependListener('connection', (socket: Socket) => {
    if (!isAllowedPeer(socket.remoteAddress, allowedPeer)) {
      onRejected?.(normalizeRemoteAddress(socket.remoteAddress) || '(inconnue)');
      socket.destroy();
    }
  });
  return server;
}

/** Démarre la deuxième écoute. Rejette si l'adresse est indisponible (Tailscale arrêté…). */
export function startTailnetListener(
  handler: RequestListener,
  options: TailnetListenerOptions,
): Promise<Server> {
  const server = createTailnetServer(handler, options);
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.port, options.host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

/** Délai maximal laissé aux requêtes en cours lors de l'arrêt. */
export const SHUTDOWN_TIMEOUT_MS = 5000;
/** Fréquence de fermeture des connexions devenues inactives pendant l'arrêt. */
const IDLE_SWEEP_MS = 50;

export interface CloseOptions {
  /** Au-delà, les connexions encore ouvertes sont coupées (closeAllConnections). */
  timeoutMs?: number;
  /** Appelé si des connexions ont dû être coupées de force. */
  onForced?: (server: Server) => void;
}

/**
 * Ferme une écoute : n'accepte plus de connexion, ferme les connexions inactives, laisse
 * les requêtes en cours finir pendant timeoutMs au plus, puis coupe ce qui reste.
 * Sans effet si l'écoute n'est pas démarrée.
 */
export function closeServer(
  server: Server,
  { timeoutMs = SHUTDOWN_TIMEOUT_MS, onForced }: CloseOptions = {},
): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onForced?.(server);
      server.closeAllConnections();
    }, timeoutMs);
    // Une requête qui se termine pendant l'arrêt laisse sa connexion keep-alive ouverte :
    // Node ne ferme les connexions inactives qu'à l'appel. On les referme donc régulièrement.
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
    timer.unref();
    sweep.unref();
    server.close((error) => {
      clearTimeout(timer);
      clearInterval(sweep);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

/** Ferme toutes les écoutes, même si l'une échoue ; rejette ensuite avec la première erreur. */
export async function closeServers(
  servers: readonly (Server | undefined)[],
  options: CloseOptions = {},
): Promise<void> {
  const results = await Promise.allSettled(
    servers.filter((s): s is Server => s !== undefined).map((s) => closeServer(s, options)),
  );
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
}
