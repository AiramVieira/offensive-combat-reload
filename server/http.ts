// Small HTTP helpers for the JSON API: body parsing, responses, cookies, client address and origin checks.
// Requests and responses are the web-standard ones that Bun.serve works with.
import { CONFIG } from './config';

const MAX_BODY = 16 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Response headers; an array value repeats the header (several Set-Cookie). */
export type HeaderMap = Record<string, string | string[]>;

/** 32 random bytes, base64url: session cookies, WebSocket tickets, reset links, OAuth state. */
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const sha256 = (s: string) => Bun.CryptoHasher.hash('sha256', s);
export const sha256hex = (s: string) => Bun.CryptoHasher.hash('sha256', s, 'hex');

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw new HttpError(413, 'corpo_grande_demais');
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    for await (const c of req.body) {
      size += c.byteLength;
      if (size > MAX_BODY) throw new HttpError(413, 'corpo_grande_demais');
      chunks.push(c);
    }
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'json_invalido');
}

function headers(base: Record<string, string>, extra: HeaderMap): Headers {
  const h = new Headers(base);
  for (const [name, value] of Object.entries(extra)) for (const v of [value].flat()) h.append(name, v);
  return h;
}

export function json(status: number, body?: unknown, extra: HeaderMap = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra),
  });
}

export function redirect(to: string, extra: HeaderMap = {}): Response {
  return new Response(null, { status: 302, headers: headers({ location: to, 'cache-control': 'no-store' }, extra) });
}

export function readCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HTTPS as the player sees it: nginx (and Cloudflare's tunnel) pass it in X-Forwarded-Proto. */
export const isHttps = (req: Request) => (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';

export function cookie(req: Request, name: string, value: string, maxAgeSeconds: number, path = '/') {
  // Secure only over HTTPS: on http:// (localhost, Radmin, LAN IP) a Secure cookie would never come back.
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
}

/** The address the player typed in the browser (scheme + host), e.g. http://26.12.3.4:8080. */
export const publicOrigin = (req: Request) => `${isHttps(req) ? 'https' : 'http'}://${req.headers.get('host') ?? 'localhost'}`;

/** Who opened each request's connection: app.ts records it from Bun's server.requestIP(). */
const peers = new WeakMap<Request, string>();
export const setPeer = (req: Request, address: string) => peers.set(req, address);

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/;

/** The player's IP. X-Forwarded-For is trusted only when the request came through a local proxy (nginx, Vite). */
export function clientIp(req: Request): string {
  const direct = peers.get(req) ?? '';
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  if (fwd && PRIVATE.test(direct)) {
    // nginx appends the address it saw at the end.
    const last = fwd.split(',').pop()!.trim();
    if (last) return last.replace(/^::ffff:/, '');
  }
  return direct.replace(/^::ffff:/, '') || '0.0.0.0';
}

/**
 * CSRF and cross-site WebSocket hijacking protection: the Origin header must be this same site (same host
 * the request was sent to) or one listed in ORIGENS_PERMITIDAS. Browsers always send Origin on these.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.host === req.headers.get('host')) return true;
  return CONFIG.origins.includes(url.origin);
}

export function userAgent(req: Request) {
  return (req.headers.get('user-agent') ?? '').slice(0, 300);
}
