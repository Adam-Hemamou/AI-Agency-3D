import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentControl } from '../agents/agentControl.ts';
import type { AgentService, AuthenticatedAgent } from '../agents/agentService.ts';
import { createApp } from '../app.ts';
import { agentActor } from '../auth/actors.ts';
import { AGENT_ROUTES, findAgentRoute } from '../auth/agentAccess.ts';
import type { DatabaseProbe } from '../db/prisma.ts';
import type { MissionService } from '../missions/missionService.ts';
import {
  closeServer,
  closeServers,
  isAllowedPeer,
  isTailnetPathAllowed,
  isTailnetRequestAllowed,
  isTailscaleAddress,
  normalizeRemoteAddress,
  startTailnetListener,
} from './tailnet.ts';

/**
 * Les tests écoutent sur 127.0.0.1 (pas d'interface Tailscale en test) : la machine « autorisée »
 * y est 127.0.0.1, et une machine « non autorisée » est simulée par une autre adresse attendue.
 */
const LOCAL = '127.0.0.1';
const VPS = '100.90.2.20';
const ID = '0190f3a2-7c1e-7b3a-9d4e-1a2b3c4d5e6f';

const upDb: DatabaseProbe = { ping: async () => {} };
const app = createApp({
  db: upDb,
  missions: {} as MissionService,
  version: '0.1.0',
  simulationMode: true,
});

/** Application avec un agent reconnu (clé VALID_KEY) et l'arrêt d'urgence levé. */
const VALID_KEY = 'agk_cle_de_test_valide';
const NOW = new Date('2026-11-06T00:00:00Z');
const vpsAgent = {
  actor: agentActor('agent-vps'),
  agent: {
    id: 'agent-vps',
    name: 'Agent VPS',
    description: null,
    room: null,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  },
  key: {
    id: 'key-vps',
    agentId: 'agent-vps',
    prefix: 'agk_cle',
    label: 'VPS',
    createdAt: NOW,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  },
  permissions: new Set(['missions:read']),
} as unknown as AuthenticatedAgent;
const agentApp = createApp({
  db: upDb,
  missions: {} as MissionService,
  version: '0.1.0',
  simulationMode: true,
  agents: {
    authenticate: async (token: string) => (token === VALID_KEY ? vpsAgent : null),
  } as unknown as AgentService,
  agentControl: { isEnabled: () => true } as unknown as AgentControl,
});

const opened: Server[] = [];
afterEach(async () => {
  await closeServers(opened.splice(0), { timeoutMs: 100 });
});

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

interface Reply {
  status: number;
  body: string;
}

/** Requête HTTP brute (méthode, chemin et en-têtes maîtrisés). Rejette si la connexion est coupée. */
function send(
  port: number,
  path: string,
  {
    method = 'GET',
    host = `${LOCAL}:${port}`,
    headers = {},
  }: { method?: string; host?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const options = { host: LOCAL, port, path, method, headers: { ...headers, host } };
    const req = request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(allowedPeer: string, extra: { onRouteRejected?: () => void } = {}) {
  const server = await startTailnetListener(app, {
    host: LOCAL,
    port: 0,
    allowedPeer,
    ...extra,
  });
  opened.push(server);
  return server;
}

async function listenLocal(handler: Parameters<typeof createServer>[1] = app) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, LOCAL, resolve));
  opened.push(server);
  return server;
}

describe('adresses Tailscale', () => {
  it('reconnaît la plage 100.64.0.0/10 uniquement', () => {
    expect(isTailscaleAddress('100.90.1.10')).toBe(true);
    expect(isTailscaleAddress(VPS)).toBe(true);
    expect(isTailscaleAddress('100.64.0.0')).toBe(true);
    expect(isTailscaleAddress('100.127.255.255')).toBe(true);
    for (const ip of ['0.0.0.0', '127.0.0.1', '192.168.1.10', '100.63.255.255', '100.128.0.1']) {
      expect(isTailscaleAddress(ip)).toBe(false);
    }
  });

  it('refuse toute écriture ambiguë d’une adresse (même dans la plage Tailscale)', () => {
    const ambiguous = [
      '0x64.90.2.20', // hexadécimal
      '1e2.90.2.20', // notation scientifique
      '100.90.2.020', // zéro en tête
      '100.90.1.010',
      '0100.90.2.20',
      '100.64.0.', // segment vide
      '100..2.20',
      '.100.90.2',
      '+100.90.2.20', // signe
      '100. 90.2.20', // espaces
      ' 100.90.2.20',
      '100.90.2.20 ',
      '100.90.2', // trop court / trop long
      '100.90.2.20.1',
      '100.90.2.256', // hors bornes
      '100.90.2.-1',
      '100.6553615', // formes abrégées
      '1683620372',
      '::ffff:100.90.2.20', // IPv6
      '::',
      'localhost',
      '',
    ];
    for (const ip of ambiguous) expect(isTailscaleAddress(ip), ip).toBe(false);
  });

  it('compare l’adresse distante exactement, y compris sous forme IPv6 mappée', () => {
    expect(normalizeRemoteAddress('::ffff:100.90.2.20')).toBe(VPS);
    expect(isAllowedPeer(VPS, VPS)).toBe(true);
    expect(isAllowedPeer('::ffff:100.90.2.20', VPS)).toBe(true);
    expect(isAllowedPeer('100.90.2.21', VPS)).toBe(false);
    expect(isAllowedPeer('100.90.2.2', VPS)).toBe(false);
    expect(isAllowedPeer(undefined, VPS)).toBe(false);
    expect(isAllowedPeer('', '')).toBe(false);
  });
});

/**
 * Un exemple par route de la liste blanche des agents (auth/agentAccess.ts).
 * Si une route y est ajoutée, le test de couverture échoue tant qu'elle n'est pas listée ici.
 */
const AGENT_ENDPOINT_SAMPLES: readonly [method: string, path: string][] = [
  ['GET', '/api/health'],
  ['GET', '/api/agents/me'],
  ['GET', '/api/agent/quotas'],
  ['GET', '/api/agent/profile'],
  ['GET', '/api/agent/missions'],
  ['GET', `/api/agent/missions/${ID}`],
  ['GET', '/api/agent/prospects/lookup?email=contact%40exemple.fr'],
  ['GET', `/api/agent/prospects/${ID}/context`],
  ['POST', '/api/agent/prospects'],
  ['PATCH', `/api/agent/prospects/${ID}`],
  ['POST', `/api/agent/prospects/${ID}/analyses`],
  ['POST', `/api/agent/prospects/${ID}/productions`],
  ['POST', `/api/agent/prospects/${ID}/stage`],
  ['POST', `/api/agent/prospects/${ID}/events`],
  ['POST', `/api/agent/missions/${ID}/transitions`],
];
describe('routes accessibles via Tailscale', () => {
  it('les exemples couvrent toutes les routes de la liste blanche des agents', () => {
    const covered = new Set(
      AGENT_ENDPOINT_SAMPLES.map(([method, url]) => findAgentRoute(method, url.split('?')[0]!)),
    );
    expect(covered.has(null)).toBe(false);
    expect(covered.size).toBe(AGENT_ROUTES.length);
  });

  it('accepte toutes les routes de la liste blanche des agents, avec leur méthode', () => {
    for (const [method, url] of AGENT_ENDPOINT_SAMPLES) {
      expect(isTailnetRequestAllowed(method, url), `${method} ${url}`).toBe(true);
    }
    expect(isTailnetPathAllowed('/api/health/')).toBe(true);
    expect(isTailnetPathAllowed('/api/agent/quotas/')).toBe(true);
  });

  it('n’accepte /api/agents/me qu’en GET, sur le chemin exact', () => {
    expect(isTailnetRequestAllowed('GET', '/api/agents/me')).toBe(true);
    for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', undefined]) {
      expect(isTailnetRequestAllowed(method, '/api/agents/me'), String(method)).toBe(false);
    }
    for (const url of [
      '/api/agents/me/',
      '/api/agents/me/keys',
      '/api/agents/me/../emergency-stop',
      '/api/agents//me',
      '/api/agents/me%2F',
      '/api/agents/ME',
      '/API/agents/me',
      'http://100.90.1.10:3001/api/agents/me',
      '/api/agents/me#',
    ]) {
      expect(isTailnetRequestAllowed('GET', url), url).toBe(false);
    }
  });

  it('refuse les routes de l’interface et de l’administration', () => {
    for (const url of [
      '/api/auth/login',
      '/api/auth/session',
      '/api/auth/logout',
      '/api/missions',
      `/api/missions/${ID}`,
      '/api/prospects',
      '/api/agents',
      '/api/agents/quotas',
      '/api/agents/emergency-stop',
      `/api/agents/${ID}`,
      `/api/agents/${ID}/keys`,
      // Gestion des profils et des prompts : jamais depuis le VPS.
      `/api/agents/${ID}/profile`,
      `/api/agents/${ID}/prompts`,
      `/api/agents/${ID}/prompts/1`,
      `/api/agents/${ID}/prompts/1/activate`,
      '/',
      '/api',
      '/api/',
    ]) {
      for (const method of ['GET', 'POST', 'PATCH']) {
        expect(isTailnetRequestAllowed(method, url), `${method} ${url}`).toBe(false);
      }
    }
  });

  it('refuse toute forme de chemin inhabituelle plutôt que de l’interpréter', () => {
    for (const url of [
      '/api/agent/../auth/login',
      '/api/agent/./quotas',
      '/api/agent/%2e%2e/auth/login',
      '/api/agent/%2E%2E/auth/login',
      '/api/agent/missions%2F..%2F..%2Fauth',
      '/api/agent/..%5cauth',
      '/api/agent/missions\\..\\..\\auth',
      '/api/agent//quotas',
      '/api/agent/quotas//',
      '//api/agent/quotas',
      '/API/AGENT/quotas',
      '/Api/Health',
      '/api/agent',
      '/api/agent/',
      '/api/agents/../agent/quotas',
      '/api/agentx/quotas',
      '/api/health/x',
      '/api/healthz',
      '/api/health..',
      '/api/agent/missions;x',
      'http://100.90.1.10:3001/api/auth/login',
      'api/agent/quotas',
      '*',
      '',
      undefined,
    ]) {
      expect(isTailnetRequestAllowed('GET', url), String(url)).toBe(false);
    }
  });
});

describe('écoute Tailscale', () => {
  it('laisse passer la machine autorisée jusqu’à l’application', async () => {
    const server = await listen(LOCAL);
    expect((await send(portOf(server), '/api/health')).status).toBe(200);
  });

  it('coupe la connexion de toute autre machine, sans réponse HTTP', async () => {
    const onRejected = vi.fn();
    const handler = vi.fn();
    const server = await startTailnetListener(handler, {
      host: LOCAL,
      port: 0,
      allowedPeer: VPS,
      onRejected,
    });
    opened.push(server);
    await expect(send(portOf(server), '/api/health')).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(LOCAL);
  });

  it('refuse les autres routes AVANT l’application (403), y compris la connexion', async () => {
    const handler = vi.fn();
    const onRouteRejected = vi.fn();
    const server = await startTailnetListener(handler, {
      host: LOCAL,
      port: 0,
      allowedPeer: LOCAL,
      onRouteRejected,
    });
    opened.push(server);
    const port = portOf(server);
    for (const [method, path] of [
      ['POST', '/api/auth/login'],
      ['GET', '/api/missions'],
      ['POST', '/api/agents/emergency-stop'],
      ['GET', '/api/agent/../auth/session'],
    ] as const) {
      const reply = await send(port, path, { method });
      expect(reply.status, `${method} ${path}`).toBe(403);
      expect(JSON.parse(reply.body)).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(onRouteRejected).toHaveBeenCalledWith('POST', '/api/auth/login');
  });

  it('transmet les routes des agents à l’application, qui garde ses protections', async () => {
    const port = portOf(await listen(LOCAL));
    // hostGuard : un nom d'hôte non autorisé reste refusé.
    expect((await send(port, '/api/health', { host: 'evil.example' })).status).toBe(403);
    // requireAuthentication : aucune route d'agent sans clé.
    const unauthenticated = await send(port, '/api/agent/quotas');
    expect(unauthenticated.status).toBe(401);
    expect(JSON.parse(unauthenticated.body)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  describe('GET /api/agents/me', () => {
    async function listenAgents(onRouteRejected?: () => void) {
      const server = await startTailnetListener(agentApp, {
        host: LOCAL,
        port: 0,
        allowedPeer: LOCAL,
        onRouteRejected,
      });
      opened.push(server);
      return portOf(server);
    }
    const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

    it('répond à un agent muni d’une clé valide', async () => {
      const port = await listenAgents();
      const reply = await send(port, '/api/agents/me', { headers: bearer(VALID_KEY) });
      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body)).toMatchObject({
        agent: { id: 'agent-vps', permissions: ['missions:read'] },
        key: { id: 'key-vps' },
      });
    });

    it('refuse une requête sans authentification ou avec une clé invalide (401)', async () => {
      const port = await listenAgents();
      const anonymous = await send(port, '/api/agents/me');
      expect(anonymous.status).toBe(401);
      expect(JSON.parse(anonymous.body)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const wrongKey = await send(port, '/api/agents/me', { headers: bearer('agk_inconnue') });
      expect(wrongKey.status).toBe(401);
      // Clé hors du schéma Bearer : refusée elle aussi.
      const misplaced = await send(port, '/api/agents/me', { headers: { 'x-api-key': VALID_KEY } });
      expect(misplaced.status).toBe(401);
    });

    it('refuse toute autre méthode AVANT l’application (403), même avec une clé valide', async () => {
      const onRouteRejected = vi.fn();
      const port = await listenAgents(onRouteRejected);
      const methods = ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      for (const method of methods) {
        const reply = await send(port, '/api/agents/me', { method, headers: bearer(VALID_KEY) });
        expect(reply.status, method).toBe(403);
        if (method !== 'HEAD') {
          expect(JSON.parse(reply.body)).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } });
        }
      }
      expect(onRouteRejected).toHaveBeenCalledTimes(methods.length);
    });

    it('n’ouvre pas les routes voisines d’administration des agents', async () => {
      const port = await listenAgents();
      for (const path of ['/api/agents', '/api/agents/emergency-stop', `/api/agents/${ID}`]) {
        const reply = await send(port, path, { headers: bearer(VALID_KEY) });
        expect(reply.status, path).toBe(403);
        expect(JSON.parse(reply.body)).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } });
      }
    });
  });

  it('l’écoute locale garde l’accès à toutes les routes', async () => {
    const port = portOf(await listenLocal());
    // Atteint l'application (401 : identité requise), au lieu du refus 403 de l'écoute Tailscale.
    expect((await send(port, '/api/missions')).status).toBe(401);
    expect((await send(port, '/api/auth/session')).status).not.toBe(403);
  });

  it('échoue proprement si l’adresse ou le port est indisponible', async () => {
    const occupied = await listen(LOCAL);
    await expect(
      startTailnetListener(app, { host: LOCAL, port: portOf(occupied), allowedPeer: LOCAL }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('arrêt du serveur', () => {
  it('ferme les deux écoutes (locale et Tailscale), même avec une connexion keep-alive ouverte', async () => {
    const local = createServer(app);
    await new Promise<void>((resolve) => local.listen(0, LOCAL, resolve));
    const tailnet = await startTailnetListener(app, { host: LOCAL, port: 0, allowedPeer: LOCAL });

    // Connexions keep-alive (agent par défaut) laissées ouvertes après la réponse.
    expect((await send(portOf(local), '/api/health')).status).toBe(200);
    expect((await send(portOf(tailnet), '/api/health')).status).toBe(200);

    await closeServers([local, tailnet]);
    expect(local.listening).toBe(false);
    expect(tailnet.listening).toBe(false);
  });

  it('laisse une requête en cours se terminer si elle finit avant le délai', async () => {
    let arrived!: () => void;
    const reached = new Promise<void>((resolve) => (arrived = resolve));
    const server = await listenLocal((_req, res) => {
      arrived();
      setTimeout(() => res.end('fini'), 50);
    });
    const onForced = vi.fn();
    const reply = send(portOf(server), '/lente');
    await reached;

    const started = Date.now();
    await closeServer(server, { timeoutMs: 2000, onForced });
    expect(await reply).toEqual({ status: 200, body: 'fini' });
    expect(onForced).not.toHaveBeenCalled();
    // Fermeture dès la fin de la requête, sans attendre le délai (connexion keep-alive comprise).
    expect(Date.now() - started).toBeLessThan(1000);
    expect(server.listening).toBe(false);
  });

  it('coupe une requête bloquée au-delà du délai et termine la fermeture', async () => {
    let arrived!: () => void;
    const reached = new Promise<void>((resolve) => (arrived = resolve));
    // Ne répond jamais.
    const server = await listenLocal(() => arrived());
    const onForced = vi.fn();
    const reply = send(portOf(server), '/bloquee');
    reply.catch(() => {}); // rejet attendu, vérifié plus bas
    await reached;

    const started = Date.now();
    await closeServer(server, { timeoutMs: 100, onForced });
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(onForced).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
    await expect(reply).rejects.toThrow();
  });

  it('utilise un délai de 5 secondes par défaut', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const fake = {
        listening: true,
        close: vi.fn(),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
      };
      void closeServer(fake as unknown as Server);
      expect(fake.closeIdleConnections).toHaveBeenCalled();
      vi.advanceTimersByTime(4999);
      expect(fake.closeAllConnections).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fake.closeAllConnections).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignore une écoute absente ou jamais démarrée', async () => {
    await expect(closeServers([undefined, createServer()])).resolves.toBeUndefined();
    await expect(closeServer(createServer())).resolves.toBeUndefined();
  });

  it('ferme toutes les écoutes même si l’une échoue, puis signale l’erreur', async () => {
    const failing = {
      listening: true,
      close: (cb: (error?: Error) => void) => cb(new Error('échec de fermeture')),
      closeIdleConnections: () => {},
      closeAllConnections: () => {},
    } as unknown as Server;
    const ok = await startTailnetListener(app, { host: LOCAL, port: 0, allowedPeer: LOCAL });
    await expect(closeServers([failing, ok])).rejects.toThrow('échec de fermeture');
    expect(ok.listening).toBe(false);
  });
});
