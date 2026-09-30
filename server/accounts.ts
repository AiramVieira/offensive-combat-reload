// Accounts, profiles, progress and audit: every SQL query about players lives here.
import { accountLevel } from '@shared/accountLevel';
import { sanitizeAppearance, type Appearance } from '@shared/appearance';
import { DELETION_GRACE_DAYS, formatTag, NAME_COOLDOWN_DAYS, type Participation, type ProfileResponse, type Totals } from '@shared/account';
import { levelForXp, PROG_WEAPONS, type Loadout, type ProgWeapon } from '@shared/progression';
import type { Sex } from '@shared/protocol';
import { transaction, type Db, type Queryable } from './db';
import { HttpError } from './http';

const DAY = 86400_000;

// --- Audit ----------------------------------------------------------------------------------------------

export type AuthEventType =
  | 'register'
  | 'login_ok'
  | 'login_fail'
  | 'lockout'
  | 'logout'
  | 'pwd_reset_request'
  | 'pwd_reset'
  | 'email_fail'
  | 'discord_login'
  | 'discord_link'
  | 'discord_unlink'
  | 'name_change'
  | 'delete_request'
  | 'delete_cancel'
  | 'anonymized'
  | 'ban'
  | 'unban'
  | 'role_grant'
  | 'role_revoke';

export interface AuditInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export function audit(db: Queryable, accountId: string | null, type: AuthEventType, info: AuditInfo = {}, detail: string | null = null) {
  // Never awaited by the caller's response path: an audit failure must not break a login.
  return db
    .query('INSERT INTO auth_event (account_id, type, detail, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [accountId, type, detail, info.ip ?? null, info.userAgent ?? null])
    .catch((err) => console.error('[auditoria]', err.message));
}

// --- Accounts and profiles ------------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  email: string | null;
  status: 'active' | 'suspended' | 'pending_deletion' | 'deleted';
  deletion_requested_at: Date | null;
}

/** A free discriminator for `name` (random first, then a scan), or null if all 9999 are taken. */
async function pickDiscriminator(db: Queryable, name: string, keep?: number): Promise<number | null> {
  const taken = new Set(
    (await db.query<{ d: number }>('SELECT discriminator AS d FROM player_profile WHERE lower(display_name) = lower($1)', [name])).rows.map((r) => r.d),
  );
  if (keep && !taken.has(keep)) return keep;
  for (let i = 0; i < 20; i++) {
    const d = 1 + Math.floor(Math.random() * 9999);
    if (!taken.has(d)) return d;
  }
  for (let d = 1; d <= 9999; d++) if (!taken.has(d)) return d;
  return null;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

/** Creates the account, its profile, stats row and weapon rows. Returns the account id. */
export async function createAccount(db: Db, opts: { email?: string; passwordHash?: string; discordId?: string; name: string; sex: Sex }): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transaction(db, async (c) => {
        const { rows } = await c.query<{ id: string }>('INSERT INTO account (email) VALUES ($1) RETURNING id', [opts.email ?? null]);
        const accountId = rows[0].id;
        if (opts.passwordHash) await c.query('INSERT INTO password_credential (account_id, password_hash) VALUES ($1, $2)', [accountId, opts.passwordHash]);
        if (opts.discordId) await c.query("INSERT INTO auth_identity (account_id, provider, provider_subject) VALUES ($1, 'discord', $2)", [accountId, opts.discordId]);
        const d = await pickDiscriminator(c, opts.name);
        if (d === null) throw new HttpError(409, 'nome_esgotado');
        const p = await c.query<{ id: string }>('INSERT INTO player_profile (account_id, display_name, discriminator, sex) VALUES ($1, $2, $3, $4) RETURNING id', [accountId, opts.name, d, opts.sex]);
        const profileId = p.rows[0].id;
        await c.query('INSERT INTO display_name_history (profile_id, display_name, discriminator) VALUES ($1, $2, $3)', [profileId, opts.name, d]);
        await c.query('INSERT INTO player_stats (profile_id) VALUES ($1)', [profileId]);
        for (const w of PROG_WEAPONS) await c.query('INSERT INTO weapon_progress (profile_id, weapon) VALUES ($1, $2)', [profileId, w]);
        return accountId;
      });
    } catch (err) {
      // Two sign-ups racing for the same Name#1234 or e-mail: retry the tag, report the e-mail.
      if (!isUniqueViolation(err)) throw err;
      if (String((err as { constraint?: string }).constraint).includes('email')) throw new HttpError(409, 'email_em_uso');
    }
  }
  throw new HttpError(409, 'nome_esgotado');
}

export async function findAccountByEmail(db: Queryable, email: string) {
  const { rows } = await db.query<AccountRow & { password_hash: string | null }>(
    `SELECT a.id, a.email, a.status, a.deletion_requested_at, pc.password_hash
       FROM account a LEFT JOIN password_credential pc ON pc.account_id = a.id
      WHERE a.email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findAccountByDiscord(db: Queryable, discordId: string) {
  const { rows } = await db.query<AccountRow>(
    `SELECT a.id, a.email, a.status, a.deletion_requested_at
       FROM auth_identity i JOIN account a ON a.id = i.account_id
      WHERE i.provider = 'discord' AND i.provider_subject = $1`,
    [discordId],
  );
  return rows[0] ?? null;
}

export async function getAccount(db: Queryable, accountId: string) {
  const { rows } = await db.query<AccountRow>('SELECT id, email, status, deletion_requested_at FROM account WHERE id = $1', [accountId]);
  return rows[0] ?? null;
}

/** The active ban of an account, if any (expired or revoked ones don't count). */
export async function activeBan(db: Queryable, accountId: string) {
  const { rows } = await db.query<{ reason: string; expires_at: Date | null }>(
    `SELECT reason, expires_at FROM sanction
      WHERE account_id = $1 AND type = 'ban' AND revoked_at IS NULL AND starts_at <= now()
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at DESC NULLS FIRST LIMIT 1`,
    [accountId],
  );
  return rows[0] ?? null;
}

export async function providers(db: Queryable, accountId: string): Promise<('senha' | 'discord')[]> {
  const { rows } = await db.query<{ p: string }>(
    `SELECT 'senha' AS p FROM password_credential WHERE account_id = $1
     UNION ALL SELECT provider FROM auth_identity WHERE account_id = $1`,
    [accountId],
  );
  return rows.map((r) => r.p as 'senha' | 'discord');
}

interface ProfileRow {
  id: string;
  display_name: string;
  discriminator: number;
  sex: Sex;
  appearance: unknown;
  name_changed_at: Date | null;
}

/** The account's game profile (one per account for now; the oldest one). */
export async function profileOf(db: Queryable, accountId: string): Promise<ProfileRow> {
  const { rows } = await db.query<ProfileRow>(
    'SELECT id, display_name, discriminator, sex, appearance, name_changed_at FROM player_profile WHERE account_id = $1 ORDER BY created_at LIMIT 1',
    [accountId],
  );
  if (!rows[0]) throw new HttpError(404, 'nao_encontrado');
  return rows[0];
}

const deletionDate = (a: AccountRow) => (a.status === 'pending_deletion' && a.deletion_requested_at ? new Date(a.deletion_requested_at.getTime() + DELETION_GRACE_DAYS * DAY).toISOString() : null);

export async function me(db: Db, accountId: string) {
  const [account, profile, prov] = await Promise.all([getAccount(db, accountId), profileOf(db, accountId), providers(db, accountId)]);
  const { rows } = await db.query<{ xp: string }>('SELECT xp FROM player_stats WHERE profile_id = $1', [profile.id]);
  return {
    tag: formatTag(profile.display_name, profile.discriminator),
    nivel: accountLevel(Number(rows[0]?.xp ?? 0)).level,
    sexo: profile.sex,
    provedores: prov,
    exclusaoEm: account ? deletionDate(account) : null,
  };
}

async function weapons(db: Queryable, profileId: string) {
  const { rows } = await db.query<{ weapon: ProgWeapon; xp: string; equipped_level: number }>('SELECT weapon, xp, equipped_level FROM weapon_progress WHERE profile_id = $1', [profileId]);
  const out = {} as Record<ProgWeapon, { xp: number; nivel: number; equipado: number }>;
  for (const w of PROG_WEAPONS) {
    const r = rows.find((x) => x.weapon === w);
    const xp = Number(r?.xp ?? 0);
    const nivel = levelForXp(w, xp);
    out[w] = { xp, nivel, equipado: Math.min(r?.equipped_level ?? 1, nivel) };
  }
  return out;
}

export async function fullProfile(db: Db, accountId: string): Promise<ProfileResponse> {
  const [account, profile, prov] = await Promise.all([getAccount(db, accountId), profileOf(db, accountId), providers(db, accountId)]);
  const [stats, armas, parts] = await Promise.all([
    db.query('SELECT * FROM player_stats WHERE profile_id = $1', [profile.id]),
    weapons(db, profile.id),
    db.query(
      `SELECT session_name, joined_at, left_at, kills, deaths, score, humiliations, account_xp
         FROM session_participation WHERE profile_id = $1 ORDER BY joined_at DESC LIMIT 10`,
      [profile.id],
    ),
  ]);
  const s = stats.rows[0] ?? {};
  const xp = Number(s.xp ?? 0);
  const lvl = accountLevel(xp);
  const totais: Totals = {
    abates: s.kills ?? 0,
    mortes: s.deaths ?? 0,
    cabeca: s.headshots ?? 0,
    passaro: s.groin_kills ?? 0,
    facadas: s.knife_kills ?? 0,
    pelasCostas: s.backstabs ?? 0,
    granadas: s.grenade_kills ?? 0,
    humilhacoes: s.humiliations ?? 0,
    segundosJogados: Number(s.seconds_played ?? 0),
    participacoes: s.matches_played ?? 0,
  };
  const participacoes: Participation[] = parts.rows.map((r) => ({
    sessao: r.session_name,
    entrada: r.joined_at.toISOString(),
    saida: r.left_at ? r.left_at.toISOString() : null,
    abates: r.kills,
    mortes: r.deaths,
    pontos: r.score,
    humilhacoes: r.humiliations,
    xp: r.account_xp,
  }));
  const libera = profile.name_changed_at ? new Date(profile.name_changed_at.getTime() + NAME_COOLDOWN_DAYS * DAY) : null;
  return {
    tag: formatTag(profile.display_name, profile.discriminator),
    nome: profile.display_name,
    sexo: profile.sex,
    aparencia: sanitizeAppearance(profile.appearance, profile.sex),
    nivel: lvl.level,
    xp,
    xpNoNivel: lvl.into,
    xpProximo: lvl.next,
    armas,
    totais,
    participacoes,
    nomeLiberaEm: libera && libera.getTime() > Date.now() ? libera.toISOString() : null,
    provedores: prov,
    exclusaoEm: account ? deletionDate(account) : null,
  };
}

/** Changes the display name: the first change is free, then one every NAME_COOLDOWN_DAYS days. */
export async function changeName(db: Db, accountId: string, name: string, info: AuditInfo) {
  await transaction(db, async (c) => {
    const { rows } = await c.query<ProfileRow>('SELECT id, display_name, discriminator, sex, appearance, name_changed_at FROM player_profile WHERE account_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE', [accountId]);
    const p = rows[0];
    if (!p) throw new HttpError(404, 'nao_encontrado');
    if (p.display_name === name) return;
    if (p.name_changed_at && p.name_changed_at.getTime() + NAME_COOLDOWN_DAYS * DAY > Date.now()) {
      throw new HttpError(429, 'cooldown_nome', { liberaEm: new Date(p.name_changed_at.getTime() + NAME_COOLDOWN_DAYS * DAY).toISOString() });
    }
    // Keeps the number when only the capitalization changes or the number is free under the new name.
    const sameName = p.display_name.toLowerCase() === name.toLowerCase();
    const disc = sameName ? p.discriminator : await pickDiscriminator(c, name, p.discriminator);
    if (disc === null) throw new HttpError(409, 'nome_esgotado');
    await c.query('UPDATE player_profile SET display_name = $2, discriminator = $3, name_changed_at = now() WHERE id = $1', [p.id, name, disc]);
    await c.query('INSERT INTO display_name_history (profile_id, display_name, discriminator) VALUES ($1, $2, $3)', [p.id, name, disc]);
    await audit(c, accountId, 'name_change', info, `${formatTag(p.display_name, p.discriminator)} -> ${formatTag(name, disc)}`);
  });
}

/** Changing the body type keeps the look, except a hair style of the other body (it falls back). */
export async function setSex(db: Queryable, accountId: string, sex: Sex) {
  const p = await profileOf(db, accountId);
  await db.query('UPDATE player_profile SET sex = $2, appearance = $3 WHERE id = $1', [p.id, sex, JSON.stringify(sanitizeAppearance(p.appearance, sex))]);
}

/** Saves the character's look (anything invalid falls back to a valid choice). */
export async function setAppearance(db: Queryable, accountId: string, raw: unknown): Promise<Appearance> {
  const p = await profileOf(db, accountId);
  const look = sanitizeAppearance(raw, p.sex);
  await db.query('UPDATE player_profile SET appearance = $2 WHERE id = $1', [p.id, JSON.stringify(look)]);
  return look;
}

/** Equips unlocked levels; a locked one fails the whole request. */
export async function setEquipped(db: Db, accountId: string, lo: Partial<Loadout>) {
  const profile = await profileOf(db, accountId);
  const current = await weapons(db, profile.id);
  for (const w of PROG_WEAPONS) {
    const level = lo[w];
    if (level === undefined) continue;
    if (!Number.isInteger(level) || level < 1 || level > current[w].nivel) throw new HttpError(400, 'nivel_bloqueado');
  }
  for (const w of PROG_WEAPONS) {
    if (lo[w] !== undefined) await db.query('UPDATE weapon_progress SET equipped_level = $3 WHERE profile_id = $1 AND weapon = $2', [profile.id, w, lo[w]]);
  }
}

// --- Deletion (LGPD) --------------------------------------------------------------------------------------

export async function requestDeletion(db: Queryable, accountId: string) {
  await db.query("UPDATE account SET status = 'pending_deletion', deletion_requested_at = now() WHERE id = $1 AND status = 'active'", [accountId]);
}

export async function cancelDeletion(db: Queryable, accountId: string) {
  await db.query("UPDATE account SET status = 'active', deletion_requested_at = NULL WHERE id = $1 AND status = 'pending_deletion'", [accountId]);
}

/**
 * Anonymizes accounts whose grace period is over: personal data goes, ids, stats and participations stay
 * (they back the history of other players' matches).
 */
export async function anonymizeExpired(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM account WHERE status = 'pending_deletion' AND deletion_requested_at < now() - make_interval(days => $1)`,
    [DELETION_GRACE_DAYS],
  );
  for (const { id } of rows) {
    await transaction(db, async (c) => {
      await c.query("UPDATE account SET email = NULL, email_verified_at = NULL, status = 'deleted', deleted_at = now() WHERE id = $1", [id]);
      await c.query('DELETE FROM password_credential WHERE account_id = $1', [id]);
      await c.query('DELETE FROM auth_identity WHERE account_id = $1', [id]);
      await c.query('DELETE FROM session WHERE account_id = $1', [id]);
      const profiles = await c.query<{ id: string }>('SELECT id FROM player_profile WHERE account_id = $1', [id]);
      for (const p of profiles.rows) {
        const d = await pickDiscriminator(c, 'Jogador excluído');
        await c.query("UPDATE player_profile SET display_name = 'Jogador excluído', discriminator = $2, avatar_url = NULL, bio = NULL WHERE id = $1", [p.id, d ?? 1]);
        await c.query('DELETE FROM display_name_history WHERE profile_id = $1', [p.id]);
      }
      await audit(c, id, 'anonymized');
    });
  }
  return rows.length;
}

// --- Game progress --------------------------------------------------------------------------------------

/** What the game server keeps in memory for a connected account. */
export interface GameProfile {
  accountId: string;
  profileId: string;
  tag: string;
  sex: Sex;
  appearance: Appearance;
  xp: number;
  weapons: Record<ProgWeapon, { xp: number; equipped: number }>;
}

export async function loadGameProfile(db: Db, accountId: string): Promise<GameProfile> {
  const profile = await profileOf(db, accountId);
  const [stats, armas] = await Promise.all([db.query<{ xp: string }>('SELECT xp FROM player_stats WHERE profile_id = $1', [profile.id]), weapons(db, profile.id)]);
  const w = {} as GameProfile['weapons'];
  for (const k of PROG_WEAPONS) w[k] = { xp: armas[k].xp, equipped: armas[k].equipado };
  return {
    accountId,
    profileId: profile.id,
    tag: formatTag(profile.display_name, profile.discriminator),
    sex: profile.sex,
    appearance: sanitizeAppearance(profile.appearance, profile.sex),
    xp: Number(stats.rows[0]?.xp ?? 0),
    weapons: w,
  };
}

/** Progress earned since the last write; added (not overwritten) to the database. */
export interface ProgressDelta {
  accountXp: number;
  weaponXp: Record<ProgWeapon, number>;
  kills: number;
  deaths: number;
  headshots: number;
  groinKills: number;
  knifeKills: number;
  backstabs: number;
  grenadeKills: number;
  humiliations: number;
  secondsPlayed: number;
  score: number;
}

export const emptyDelta = (): ProgressDelta => ({
  accountXp: 0,
  weaponXp: { rifle: 0, faca: 0, granada: 0 },
  kills: 0,
  deaths: 0,
  headshots: 0,
  groinKills: 0,
  knifeKills: 0,
  backstabs: 0,
  grenadeKills: 0,
  humiliations: 0,
  secondsPlayed: 0,
  score: 0,
});

export async function openParticipation(db: Db, profileId: string, sessionName: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('INSERT INTO session_participation (profile_id, session_name) VALUES ($1, $2) RETURNING id', [profileId, sessionName]);
  await db.query('UPDATE player_stats SET matches_played = matches_played + 1, updated_at = now() WHERE profile_id = $1', [profileId]);
  return rows[0].id;
}

/** Writes a delta in one transaction: stats, weapons, the participation row and (optionally) closes it. */
export async function flushProgress(db: Db, profileId: string, participationId: string | null, d: ProgressDelta, close: boolean, equipped?: Loadout) {
  await transaction(db, async (c) => {
    const r = await c.query<{ xp: string }>(
      `UPDATE player_stats SET xp = xp + $2, kills = kills + $3, deaths = deaths + $4, headshots = headshots + $5,
              groin_kills = groin_kills + $6, knife_kills = knife_kills + $7, backstabs = backstabs + $8,
              grenade_kills = grenade_kills + $9, humiliations = humiliations + $10, seconds_played = seconds_played + $11,
              updated_at = now()
        WHERE profile_id = $1 RETURNING xp`,
      [profileId, d.accountXp, d.kills, d.deaths, d.headshots, d.groinKills, d.knifeKills, d.backstabs, d.grenadeKills, d.humiliations, Math.round(d.secondsPlayed)],
    );
    if (r.rows[0]) await c.query('UPDATE player_stats SET level = $2 WHERE profile_id = $1', [profileId, accountLevel(Number(r.rows[0].xp)).level]);
    for (const w of PROG_WEAPONS) {
      if (d.weaponXp[w] > 0 || equipped) {
        await c.query('UPDATE weapon_progress SET xp = xp + $3, equipped_level = COALESCE($4, equipped_level) WHERE profile_id = $1 AND weapon = $2', [profileId, w, d.weaponXp[w], equipped?.[w] ?? null]);
      }
    }
    if (participationId) {
      await c.query(
        `UPDATE session_participation SET kills = kills + $2, deaths = deaths + $3, score = score + $4,
                humiliations = humiliations + $5, account_xp = account_xp + $6, left_at = CASE WHEN $7 THEN now() ELSE left_at END
          WHERE id = $1`,
        [participationId, d.kills, d.deaths, d.score, d.humiliations, d.accountXp, close],
      );
    }
  });
}

// --- Staff ------------------------------------------------------------------------------------------------

/** Finds an account by Name#1234. */
export async function accountByTag(db: Queryable, tag: string): Promise<string | null> {
  const m = /^(.+)#(\d{1,4})$/.exec(tag.trim());
  if (!m) return null;
  const { rows } = await db.query<{ account_id: string }>('SELECT account_id FROM player_profile WHERE lower(display_name) = lower($1) AND discriminator = $2', [m[1], Number(m[2])]);
  return rows[0]?.account_id ?? null;
}
