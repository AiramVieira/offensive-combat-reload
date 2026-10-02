// Test helpers: a real game server on a free port, and a tiny browser (cookie jar + Origin header +
// its own IP through X-Forwarded-For, so per-IP limits don't leak between tests).
import type { ServerMsg } from '@shared/protocol';
import { startServer, type GameServer } from '../app';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

const wsUrl = (game: GameServer, ticket: string) => `ws://127.0.0.1:${game.port}/ws?ticket=${encodeURIComponent(ticket)}`;

export const startTestServer = () => startServer({ port: 0, host: '127.0.0.1', databaseUrl: TEST_DATABASE_URL, redisUrl: TEST_REDIS_URL, jobs: false });

let ipCounter = 1;
let emailCounter = 1;
export const uniqueEmail = () => `jogador${Date.now()}_${emailCounter++}@teste.com`;
export const uniqueIp = () => `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

export class Browser {
  cookies = new Map<string, string>();
  ip = uniqueIp();
  origin: string;

  constructor(
    readonly game: GameServer,
    origin?: string,
  ) {
    this.origin = origin ?? `http://127.0.0.1:${game.port}`;
  }

  get base() {
    return `http://127.0.0.1:${this.game.port}`;
  }

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      method,
      redirect: 'manual',
      headers: {
        origin: this.origin,
        'x-forwarded-for': this.ip,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /Max-Age=0/.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }

  async register(name = 'Testador', password = 'senha-boa-123') {
    const email = uniqueEmail();
    const r = await this.req('POST', '/api/auth/cadastro', { email, senha: password, nome: name });
    if (r.status !== 201) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return { email, password };
  }

  async ticket(): Promise<string> {
    const r = await this.req('POST', '/api/ws-ticket');
    if (r.status !== 200) throw new Error(`ticket falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.ticket;
  }
}

/** A game connection that records every message. */
export class Player {
  msgs: ServerMsg[] = [];
  closed: { code: number } | null = null;
  private waiters: { match: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      this.msgs.push(m);
      for (const w of [...this.waiters]) {
        if (w.match(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    ws.addEventListener('close', (ev) => (this.closed = { code: ev.code }));
  }

  static connect(game: GameServer, ticket: string, origin = `http://127.0.0.1:${game.port}`): Promise<Player> {
    return new Promise((resolve, reject) => {
      // Bun's WebSocket takes extra handshake headers; a browser sends Origin by itself.
      const ws = new WebSocket(wsUrl(game, ticket), { headers: { origin } });
      const p = new Player(ws);
      ws.addEventListener('open', () => resolve(p), { once: true });
      ws.addEventListener('close', (ev) => reject(new Error(`recusado: ${ev.code} ${ev.reason}`)), { once: true });
    });
  }

  /**
   * HTTP status of a handshake the server refuses. A WebSocket never sees it (it only reports close code
   * 1002), so this sends the upgrade request itself.
   */
  static async refusal(game: GameServer, ticket: string, origin = `http://127.0.0.1:${game.port}`): Promise<number> {
    const res = await fetch(wsUrl(game, ticket).replace(/^ws:/, 'http:'), {
      headers: { origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': btoa('offensive-combat') },
    });
    return res.status;
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  next<T extends ServerMsg['t']>(t: T, match: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, timeout = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const found = this.msgs.find((m) => m.t === t && match(m as Extract<ServerMsg, { t: T }>));
    if (found) {
      this.msgs.splice(this.msgs.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sem mensagem ${t}`)), timeout);
      this.waiters.push({
        match: (m) => m.t === t && match(m as Extract<ServerMsg, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          this.msgs.splice(this.msgs.indexOf(m), 1);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  waitClose(timeout = 5000): Promise<number> {
    if (this.closed) return Promise.resolve(this.closed.code);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('conexão não fechou')), timeout);
      this.ws.addEventListener(
        'close',
        (ev) => {
          clearTimeout(timer);
          resolve(ev.code);
        },
        { once: true },
      );
    });
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
