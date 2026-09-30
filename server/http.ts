// Small HTTP helpers for the JSON API: body parsing, responses, cookies, client address and origin checks.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
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

/** 32 random bytes, base64url: session cookies, WebSocket tickets, reset links, OAuth state. */
export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const sha256hex = (s: string) => sha256(s).toString('hex');

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'corpo_grande_demais');
    chunks.push(c as Buffer);
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

export function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function redirect(res: ServerResponse, to: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store', ...headers });
  res.end();
}

export function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HTTPS as the player sees it: nginx (and Cloudflare's tunnel) pass it in X-Forwarded-Proto. */
export const isHttps = (req: IncomingMessage) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';

export function cookie(req: IncomingMessage, name: string, value: string, maxAgeSeconds: number, path = '/') {
  // Secure only over HTTPS: on http:// (localhost, Radmin, LAN IP) a Secure cookie would never come back.
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
}

/** The address the player typed in the browser (scheme + host), e.g. http://26.12.3.4:8080. */
export const publicOrigin = (req: IncomingMessage) => `${isHttps(req) ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/;

/** The player's IP. X-Forwarded-For is trusted only when the request came through a local proxy (nginx, Vite). */
export function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? '';
  const fwd = String(req.headers['x-forwarded-for'] ?? '');
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
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.host === req.headers.host) return true;
  return CONFIG.origins.includes(url.origin);
}

export function userAgent(req: IncomingMessage) {
  return String(req.headers['user-agent'] ?? '').slice(0, 300);
}
