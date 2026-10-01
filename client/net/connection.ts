// WebSocket connection to the game server with clock sync (for snapshot interpolation) and ping. It opens
// with a single-use ticket from the account API (the browser can't send auth headers on a WebSocket).
import { NET, type ClientMsg, type ServerMsg } from '@shared/protocol';
import { api } from './api';

type Handler<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;

export class Connection {
  private handlers = new Map<string, ((msg: ServerMsg) => void)[]>();
  /** Messages queued by hold(), dispatched by release(). */
  private held: ServerMsg[] | null = null;
  /** Estimated serverTime - performance.now(), smoothed. */
  private offset = 0;
  private synced = false;
  rtt = 0;
  private pingTimer: number;
  /** Close code: CLOSE.revoked / CLOSE.replaced from the server, anything else is a lost connection. */
  onClose: (code: number) => void = () => {};

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'pong') this.onPong(msg.c, msg.s);
      if (this.held) this.held.push(msg);
      else this.dispatch(msg);
    });
    ws.addEventListener('close', (ev) => {
      clearInterval(this.pingTimer);
      this.onClose(ev.code);
    });
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now(), rtt: this.rtt }), 1000);
    this.send({ t: 'ping', c: performance.now() });
  }

  /**
   * Same origin as the page: Vite proxies /ws in dev, the game server serves both in production. Throws
   * the API's error when there is no signed-in session.
   */
  static async open(): Promise<Connection> {
    const { ticket } = await api<{ ticket: string }>('POST', '/api/ws-ticket');
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${NET.path}?ticket=${encodeURIComponent(ticket)}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const fail = () => reject(new Error('não foi possível conectar ao servidor'));
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', fail);
        resolve(new Connection(ws));
      });
      ws.addEventListener('error', fail, { once: true });
    });
  }

  get open() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on<T extends ServerMsg['t']>(type: T, fn: Handler<T>) {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as (msg: ServerMsg) => void);
    this.handlers.set(type, list);
  }

  private dispatch(msg: ServerMsg) {
    for (const h of this.handlers.get(msg.t) ?? []) h(msg);
  }

  /**
   * Queues incoming messages instead of dispatching them (the clock keeps syncing). The game holds them
   * from 'joined' until its handlers exist: building the map in between would otherwise lose kills, joins
   * and corpses sent meanwhile.
   */
  hold() {
    this.held ??= [];
  }

  /** Dispatches everything queued by hold(), in order, and goes back to live dispatch. */
  release() {
    const queued = this.held ?? [];
    this.held = null;
    for (const msg of queued) this.dispatch(msg);
  }

  /** Resolves with the next message of `type` (used by the home screen's request/response steps). */
  next<T extends ServerMsg['t']>(type: T, orError = true): Promise<Extract<ServerMsg, { t: T }>> {
    return new Promise((resolve, reject) => {
      let done = false;
      this.on(type, (m) => {
        if (!done) {
          done = true;
          resolve(m);
        }
      });
      if (orError)
        this.on('error', (m) => {
          if (!done) {
            done = true;
            reject(new Error(m.message));
          }
        });
    });
  }

  private onPong(clientSent: number, serverTime: number) {
    const now = performance.now();
    const rtt = now - clientSent;
    this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    const sample = serverTime + rtt / 2 - now;
    this.offset = this.synced ? this.offset * 0.9 + sample * 0.1 : sample;
    this.synced = true;
  }

  /** Rough clock sync before the first pong arrives (ignores latency). */
  seed(serverTime: number) {
    if (!this.synced) this.offset = serverTime - performance.now();
  }

  /** Current server time (ms), estimated. */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  close() {
    clearInterval(this.pingTimer);
    this.ws.close();
  }
}
