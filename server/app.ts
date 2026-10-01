// The game server as a function (index.ts starts it; tests start their own on a free port):
// the account API, static files from dist/, and the WebSocket with the lobby and free-for-all sessions.
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE, NET, sanitizeName, type ClientMsg, type ServerMsg } from '@shared/protocol';
import { DEFAULT_MAP, isMapId, MAPS, type MapId } from '@shared/maps';
import { activeBan, emptyDelta, flushProgress, getAccount, loadGameProfile, openParticipation } from './accounts';
import { handleApi, ticketKey } from './api';
import type { Deps } from './auth/sessions';
import { CONFIG } from './config';
import { createDb, migrate } from './db';
import { originAllowed } from './http';
import { scheduleJobs } from './jobs';
import { deltaIsEmpty, equippedOf, liveAccount, mergeDelta, progressMsg, type LiveAccount } from './progress';
import { createRedis, REVOCATION_CHANNEL } from './redis';
import { Session, type Conn } from './session';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const MAX_MSGS_PER_SEC = 150;
/** Progress is written at least this often while playing. */
const FLUSH_EVERY_MS = 60_000;
const now = () => performance.now();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

export interface GameServer {
  server: http.Server;
  port: number;
  deps: Deps;
  close(): Promise<void>;
}

interface Options {
  port: number;
  host: string;
  databaseUrl?: string;
  redisUrl?: string;
  /** Housekeeping jobs (partitions, anonymization); off in tests. */
  jobs?: boolean;
}

export async function startServer(opts: Options): Promise<GameServer> {
  const db = createDb(opts.databaseUrl ?? CONFIG.databaseUrl);
  const redis = createRedis(opts.redisUrl ?? CONFIG.redisUrl);
  const sub = createRedis(opts.redisUrl ?? CONFIG.redisUrl);
  const deps: Deps = { db, redis };
  await migrate(db);
  const stopJobs = opts.jobs === false ? () => {} : scheduleJobs(db);

  // --- Lobby ----------------------------------------------------------------------------------------
  const sessions = new Map<string, Session>();
  const conns = new Set<Conn>();
  /** One game connection per account: a new one replaces the old. */
  const byAccount = new Map<string, Conn>();
  let nextId = 1;

  const sessionList = () =>
    [...sessions.values()].map((s) => s.info).sort((a, b) => Number(b.permanent) - Number(a.permanent) || b.players - a.players);

  let listDirty = false;
  function sessionsChanged() {
    // Coalesce bursts of joins/leaves into one lobby update.
    if (listDirty) return;
    listDirty = true;
    setTimeout(() => {
      listDirty = false;
      for (const s of [...sessions.values()]) {
        if (!s.permanent && s.players.size === 0) {
          s.dispose();
          sessions.delete(s.id);
        }
      }
      const list = sessionList();
      for (const c of conns) if (!c.session) c.send({ t: 'sessions', list });
    }, 100);
  }

  function createSession(name: string, map: MapId, permanentId?: string): Session {
    let id: string;
    do id = Math.random().toString(36).slice(2, 8);
    while (sessions.has(id));
    const s = new Session(permanentId ?? id, name, map, permanentId !== undefined, now, sessionsChanged);
    sessions.set(s.id, s);
    return s;
  }

  // One permanent session per map; "principal" keeps its id from when there was only the street.
  createSession(MAPS.rua.nome, 'rua', 'principal');
  createSession(MAPS.jardim.nome, 'jardim', 'jardim');

  // --- Progress persistence ---------------------------------------------------------------------------
  async function flush(a: LiveAccount, close: boolean) {
    const participation = a.participation;
    if (close) a.participation = null;
    if (deltaIsEmpty(a.delta) && !close) return;
    const d = a.delta;
    a.delta = emptyDelta();
    try {
      const pid = participation ? await participation : null;
      await flushProgress(db, a.profile.profileId, pid, d, close, equippedOf(a));
    } catch (err) {
      mergeDelta(a.delta, d);
      console.error('[progresso] gravação falhou, tento de novo no próximo ciclo:', (err as Error).message);
    }
  }

  const flushTimer = setInterval(() => {
    for (const c of conns) if (c.session) void flush(c.account, false);
  }, FLUSH_EVERY_MS);

  function leaveSession(conn: Conn) {
    if (!conn.session) return;
    conn.session.leave(conn);
    void flush(conn.account, true);
  }

  // --- Revocation: logout, password reset, ban or deletion closes the account's game connection -------
  await sub.subscribe(REVOCATION_CHANNEL);
  sub.on('message', (_channel, accountId) => {
    const c = byAccount.get(accountId);
    if (c) c.ws.close(CLOSE.revoked, 'sessao encerrada');
  });

  // --- HTTP: API + static files from dist/ (production) ------------------------------------------------
  const server = http.createServer(async (req, res) => {
    if (await handleApi(deps, req, res)) return;
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/]\.\.)+/, '');
      if (path === '/' || path === '\\') path = '/index.html';
      let file = join(DIST, path);
      if (!file.startsWith(DIST)) throw new Error('outside');
      try {
        if (!(await stat(file)).isFile()) throw new Error('dir');
      } catch {
        file = join(DIST, 'index.html');
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Offensive Combat: rode "npm run build" para servir o jogo por aqui, ou use "npm run dev".');
    }
  });

  // --- WebSocket: only with a single-use ticket from POST /api/ws-ticket -------------------------------
  const identities = new WeakMap<IncomingMessage, LiveAccount>();

  const wss = new WebSocketServer({
    server,
    path: NET.path,
    maxPayload: 16 * 1024,
    verifyClient: (info, done) => {
      (async () => {
        if (!originAllowed(info.req)) return done(false, 403);
        const ticket = new URL(info.req.url ?? '', 'http://x').searchParams.get('ticket');
        if (!ticket || ticket.length > 100) return done(false, 401);
        // Atomic and single use: a ticket seen in a log is already spent.
        const accountId = await redis.getdel(ticketKey(ticket));
        if (!accountId) return done(false, 401);
        const account = await getAccount(db, accountId);
        if (!account || account.status !== 'active' || (await activeBan(db, accountId))) return done(false, 403);
        identities.set(info.req, liveAccount(await loadGameProfile(db, accountId)));
        done(true);
      })().catch((err) => {
        console.error('[ws] handshake:', (err as Error).message);
        done(false, 500);
      });
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const account = identities.get(req)!;
    const { profile } = account;
    const conn: Conn = {
      ws,
      id: nextId++,
      name: '',
      sex: profile.sex,
      session: null,
      account,
      send(msg: ServerMsg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    const previous = byAccount.get(profile.accountId);
    if (previous) previous.ws.close(CLOSE.replaced, 'conta conectada em outro lugar');
    byAccount.set(profile.accountId, conn);
    conns.add(conn);
    let bucket = MAX_MSGS_PER_SEC;
    let bucketAt = now();

    ws.on('message', (raw) => {
      // Token bucket: drop floods instead of processing them.
      const t = now();
      bucket = Math.min(MAX_MSGS_PER_SEC, bucket + ((t - bucketAt) / 1000) * MAX_MSGS_PER_SEC);
      bucketAt = t;
      if (bucket < 1) return;
      bucket--;

      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'hello': {
          // Name and body come from the account, never from the message.
          conn.name = profile.tag;
          conn.send({ t: 'welcome', id: conn.id, name: conn.name, sessions: sessionList() });
          conn.send(progressMsg(account));
          return;
        }
        case 'list':
          return conn.send({ t: 'sessions', list: sessionList() });
        case 'create':
        case 'join': {
          if (!conn.name) return conn.send({ t: 'error', message: 'Diga olá primeiro.' });
          leaveSession(conn);
          let s: Session | undefined;
          if (msg.t === 'create') {
            const name = sanitizeName(msg.name, NET.sessionNameMax) || `Sala de ${profile.tag.split('#')[0]}`;
            s = createSession(name, isMapId(msg.map) ? msg.map : DEFAULT_MAP);
          } else {
            s = sessions.get(String(msg.session));
            if (!s) return conn.send({ t: 'error', message: 'Essa sessão não existe mais.' });
            if (s.full) return conn.send({ t: 'error', message: 'Sessão lotada.' });
          }
          s.join(conn);
          account.participation = openParticipation(db, profile.profileId, s.name).catch((err) => {
            console.error('[progresso] participação:', (err as Error).message);
            return null;
          });
          return;
        }
        case 'leave':
          leaveSession(conn);
          conn.send({ t: 'sessions', list: sessionList() });
          return;
        case 'ping':
          if (!conn.session) return conn.send({ t: 'pong', c: Number(msg.c) || 0, s: now() });
          break;
      }
      conn.session?.handle(conn, msg);
    });

    ws.on('close', () => {
      leaveSession(conn);
      conns.delete(conn);
      if (byAccount.get(profile.accountId) === conn) byAccount.delete(profile.accountId);
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    server,
    port,
    deps,
    async close() {
      clearInterval(flushTimer);
      stopJobs();
      for (const c of wss.clients) c.close(1001, 'servidor reiniciando');
      // Progress of whoever is still playing is written before the process goes away.
      await Promise.all([...conns].filter((c) => c.session).map((c) => flush(c.account, true)));
      for (const s of sessions.values()) s.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sub.disconnect();
      redis.disconnect();
      await db.end();
    },
  };
}
