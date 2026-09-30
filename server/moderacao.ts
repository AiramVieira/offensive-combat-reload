// Staff actions (run from tools/admin.ts): bans as sanction history, staff roles, and the audit trail.
// A ban also revokes the account's sessions and closes its game connection on every server.
import { accountByTag, audit } from './accounts';
import type { Deps } from './auth/sessions';
import { revokeAll } from './auth/sessions';

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

export async function ban(deps: Deps, tag: string, reason: string, duration: string, by: string | null = null) {
  const accountId = await resolve(deps, tag);
  const ms = parseDuration(duration);
  const { rows } = await deps.db.query<{ expires_at: Date | null }>(
    `INSERT INTO sanction (account_id, type, reason, issued_by, expires_at)
     VALUES ($1, 'ban', $2, $3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE now() + ($4::bigint * interval '1 millisecond') END)
     RETURNING expires_at`,
    [accountId, reason, by, ms],
  );
  await revokeAll(deps, accountId);
  await audit(deps.db, accountId, 'ban', {}, `${reason} (${duration})`);
  return rows[0].expires_at;
}

export async function unban(deps: Deps, tag: string) {
  const accountId = await resolve(deps, tag);
  const { rowCount } = await deps.db.query(
    `UPDATE sanction SET revoked_at = now()
      WHERE account_id = $1 AND type = 'ban' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [accountId],
  );
  await audit(deps.db, accountId, 'unban');
  return rowCount ?? 0;
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
