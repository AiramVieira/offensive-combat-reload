// Staff actions (run from tools/admin.ts): bans and chat mutes as sanction history, staff roles, and the
// audit trail. A ban also revokes the account's sessions and closes its game connection on every server; a
// mute reaches the account's running match through Redis (MUTE_CHANNEL).
import { accountByTag, audit, type SanctionType } from './accounts';
import type { Deps } from './auth/sessions';
import { revokeAll } from './auth/sessions';
import { MUTE_CHANNEL } from './redis';

export class ModerationError extends Error {}

async function resolve(deps: Deps, tag: string): Promise<string> {
  const id = await accountByTag(deps.db, tag);
  if (!id) throw new ModerationError(`Conta não encontrada: ${tag}`);
  return id;
}

/** "7d", "12h", "30m" → milliseconds; "permanente" → null. */
export function parseDuration(s: string): number | null {
  if (/^perm/i.test(s)) return null;
  const m = /^(\d+)\s*([dhm])$/i.exec(s.trim());
  if (!m) throw new ModerationError(`Duração inválida: ${s} (use 7d, 12h, 30m ou permanente)`);
  const n = Number(m[1]);
  return n * { d: 86400_000, h: 3600_000, m: 60_000 }[m[2].toLowerCase() as 'd' | 'h' | 'm'];
}

/** Adds a sanction of `type` for `duration` ("7d", "permanente"...); returns when it ends (null: never). */
async function sanction(deps: Deps, accountId: string, type: SanctionType, reason: string, duration: string, by: string | null) {
  const ms = parseDuration(duration);
  const { rows } = await deps.db.query<{ expires_at: Date | null }>(
    `INSERT INTO sanction (account_id, type, reason, issued_by, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::bigint IS NULL THEN NULL ELSE now() + ($5::bigint * interval '1 millisecond') END)
     RETURNING expires_at`,
    [accountId, type, reason, by, ms],
  );
  return rows[0].expires_at;
}

/** Revokes the account's active sanctions of `type`; returns how many there were. */
async function lift(deps: Deps, accountId: string, type: SanctionType) {
  const { rowCount } = await deps.db.query(
    `UPDATE sanction SET revoked_at = now()
      WHERE account_id = $1 AND type = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [accountId, type],
  );
  return rowCount ?? 0;
}

export async function ban(deps: Deps, tag: string, reason: string, duration: string, by: string | null = null) {
  const accountId = await resolve(deps, tag);
  const until = await sanction(deps, accountId, 'ban', reason, duration, by);
  await revokeAll(deps, accountId);
  await audit(deps.db, accountId, 'ban', {}, `${reason} (${duration})`);
  return until;
}

export async function unban(deps: Deps, tag: string) {
  const accountId = await resolve(deps, tag);
  const n = await lift(deps, accountId, 'ban');
  await audit(deps.db, accountId, 'unban');
  return n;
}

/** Chat mute: the account keeps playing, its chat lines are dropped (in a running match too). */
export async function mute(deps: Deps, tag: string, reason: string, duration: string, by: string | null = null) {
  const accountId = await resolve(deps, tag);
  const until = await sanction(deps, accountId, 'chat_mute', reason, duration, by);
  await deps.redis.publish(MUTE_CHANNEL, accountId);
  await audit(deps.db, accountId, 'chat_mute', {}, `${reason} (${duration})`);
  return until;
}

export async function unmute(deps: Deps, tag: string) {
  const accountId = await resolve(deps, tag);
  const n = await lift(deps, accountId, 'chat_mute');
  await deps.redis.publish(MUTE_CHANNEL, accountId);
  await audit(deps.db, accountId, 'chat_unmute');
  return n;
}

export async function setRole(deps: Deps, tag: string, role: string, remove: boolean, by: string | null = null) {
  const accountId = await resolve(deps, tag);
  const known = await deps.db.query('SELECT 1 FROM role WHERE name = $1', [role]);
  if (!known.rowCount) throw new ModerationError(`Papel desconhecido: ${role} (admin ou moderador)`);
  if (remove) await deps.db.query('DELETE FROM account_role WHERE account_id = $1 AND role = $2', [accountId, role]);
  else await deps.db.query('INSERT INTO account_role (account_id, role, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [accountId, role, by]);
  await audit(deps.db, accountId, remove ? 'role_revoke' : 'role_grant', {}, role);
}

export async function sanctions(deps: Deps, tag: string) {
  const accountId = await resolve(deps, tag);
  const { rows } = await deps.db.query<{ type: string; reason: string; starts_at: Date; expires_at: Date | null; revoked_at: Date | null }>(
    'SELECT type, reason, starts_at, expires_at, revoked_at FROM sanction WHERE account_id = $1 ORDER BY starts_at DESC',
    [accountId],
  );
  const roles = await deps.db.query<{ role: string }>('SELECT role FROM account_role WHERE account_id = $1 ORDER BY role', [accountId]);
  return { sanctions: rows, roles: roles.rows.map((r) => r.role) };
}
