// Browser sessions: an opaque random value in an HttpOnly cookie; the database keeps only its SHA-256.
// The server itself plays the BFF role: the browser never holds a token it could leak to scripts.
import type { IncomingMessage } from 'node:http';
import type { Db } from '../db';
import { cookie, randomToken, readCookies, sha256, userAgent, clientIp } from '../http';
import { REVOCATION_CHANNEL, type RedisClient } from '../redis';

export const SESSION_COOKIE = 'oc_sessao';
const TTL_DAYS = 30;
const TTL_SECONDS = TTL_DAYS * 86400;
/** Sliding expiry is written at most this often per session. */
const RENEW_EVERY_MS = 3600_000;

export interface Deps {
  db: Db;
  redis: RedisClient;
}

export interface AuthSession {
  sessionId: string;
  accountId: string;
  /** Set-Cookie to send back when the expiry slid forward. */
  renewed: string | null;
}

/** Creates a session and returns its Set-Cookie header. */
export async function createSession(db: Db, req: IncomingMessage, accountId: string): Promise<string> {
  const token = randomToken();
  await db.query(
    `INSERT INTO session (account_id, token_hash, device_label, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [accountId, sha256(token), userAgent(req).slice(0, 120), clientIp(req), TTL_DAYS],
  );
  return cookie(req, SESSION_COOKIE, token, TTL_SECONDS);
}

export const clearSessionCookie = (req: IncomingMessage) => cookie(req, SESSION_COOKIE, '', 0);

/** The session behind the request's cookie, if valid (not revoked, not expired, account not deleted). */
export async function authenticate(db: Db, req: IncomingMessage): Promise<AuthSession | null> {
  const token = readCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query<{ id: string; account_id: string; last_used_at: Date }>(
    `SELECT s.id, s.account_id, s.last_used_at FROM session s JOIN account a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status <> 'deleted'`,
    [sha256(token)],
  );
  const s = rows[0];
  if (!s) return null;
  let renewed: string | null = null;
  if (Date.now() - s.last_used_at.getTime() > RENEW_EVERY_MS) {
    await db.query('UPDATE session SET last_used_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1', [s.id, TTL_DAYS]);
    renewed = cookie(req, SESSION_COOKIE, token, TTL_SECONDS);
  }
  return { sessionId: s.id, accountId: s.account_id, renewed };
}

/** Ends one session and closes the account's game connections (they were opened from some session). */
export async function revokeSession(deps: Deps, s: AuthSession) {
  await deps.db.query('UPDATE session SET revoked_at = now() WHERE id = $1', [s.sessionId]);
  await deps.redis.publish(REVOCATION_CHANNEL, s.accountId);
}

/** Ends every session of an account (password reset, ban, deletion) and closes its game connections. */
export async function revokeAll(deps: Deps, accountId: string) {
  await deps.db.query('UPDATE session SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
  await deps.redis.publish(REVOCATION_CHANNEL, accountId);
}
