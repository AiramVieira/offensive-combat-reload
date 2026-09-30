// Offensive Combat game server: lobby + free-for-all sessions over WebSocket (section 14).
//
//   npm run server         WebSocket on :8787/ws (Vite's dev server proxies /ws to it)
//   npm run build && npm start   one port for everything: serves dist/ and the WebSocket
//   HOST=127.0.0.1 PORT=8787     behind nginx (deploy/): only nginx is reachable from outside
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { asSex, NET, sanitizeName, type ClientMsg, type ServerMsg } from '@shared/protocol';
import { Session, type Conn } from './session';

const PORT = Number(process.env.PORT ?? NET.port);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const MAX_MSGS_PER_SEC = 150;
const now = () => performance.now();

// --- Lobby ------------------------------------------------------------------------------------------
const sessions = new Map<string, Session>();
const conns = new Set<Conn>();
let nextId = 1;

function sessionList() {
  return [...sessions.values()].map((s) => s.info).sort((a, b) => Number(b.permanent) - Number(a.permanent) || b.players - a.players);
}

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

function createSession(name: string, permanent = false): Session {
  let id: string;
  do id = Math.random().toString(36).slice(2, 8);
  while (sessions.has(id));
  const s = new Session(permanent ? 'principal' : id, name, permanent, now, sessionsChanged);
  sessions.set(s.id, s);
  return s;
}

createSession('Rua dos Vizinhos', true);

// --- HTTP: static files from dist/ (production) -----------------------------------------------------
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

const server = http.createServer(async (req, res) => {
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

// --- WebSocket --------------------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: NET.path, maxPayload: 16 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = {
    ws,
    id: nextId++,
    name: '',
    sex: 'm',
    session: null,
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
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
        const name = sanitizeName(msg.name, NET.nameMax);
        if (!name) return conn.send({ t: 'error', message: 'Escolha um nome.' });
        conn.name = name;
        conn.sex = asSex(msg.sex);
        return conn.send({ t: 'welcome', id: conn.id, name, sessions: sessionList() });
      }
      case 'list':
        return conn.send({ t: 'sessions', list: sessionList() });
      case 'create':
      case 'join': {
        if (!conn.name) return conn.send({ t: 'error', message: 'Diga seu nome primeiro.' });
        if (conn.session) conn.session.leave(conn);
        let s: Session | undefined;
        if (msg.t === 'create') {
          const name = sanitizeName(msg.name, NET.sessionNameMax) || `Sala de ${conn.name}`;
          s = createSession(name);
        } else {
          s = sessions.get(String(msg.session));
          if (!s) return conn.send({ t: 'error', message: 'Essa sessão não existe mais.' });
          if (s.full) return conn.send({ t: 'error', message: 'Sessão lotada.' });
        }
        s.join(conn);
        return;
      }
      case 'leave':
        conn.session?.leave(conn);
        conn.send({ t: 'sessions', list: sessionList() });
        return;
      case 'ping':
        if (!conn.session) return conn.send({ t: 'pong', c: Number(msg.c) || 0, s: now() });
        break;
    }
    conn.session?.handle(conn, msg);
  });

  ws.on('close', () => {
    conn.session?.leave(conn);
    conns.delete(conn);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[servidor] Offensive Combat em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (WebSocket ${NET.path})`);
});

// Containers and process managers stop with SIGTERM: close sockets so players see "connection lost".
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    for (const c of wss.clients) c.close(1001, 'servidor reiniciando');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
