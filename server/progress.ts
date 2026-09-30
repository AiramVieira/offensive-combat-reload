// A connected account's progress, kept in memory by the game server: points only come from events the
// server validated (kills, humiliations, time alive). The delta since the last write is flushed to the
// database every minute and when the player leaves a session (app.ts).
import { ACCOUNT_XP, accountLevel } from '@shared/accountLevel';
import { levelForXp, PROG_WEAPONS, type Loadout, type ProgWeapon } from '@shared/progression';
import type { ServerMsg } from '@shared/protocol';
import { emptyDelta, type GameProfile, type ProgressDelta } from './accounts';

export interface LiveAccount {
  profile: GameProfile;
  /** Earned since the last database write. */
  delta: ProgressDelta;
  /** Participation row of the current session (opened asynchronously on join). */
  participation: Promise<string | null> | null;
  /** Seconds alive toward the next "minute alive" award. */
  aliveCarry: number;
}

export const liveAccount = (profile: GameProfile): LiveAccount => ({ profile, delta: emptyDelta(), participation: null, aliveCarry: 0 });

export const accountLevelOf = (a: LiveAccount) => accountLevel(a.profile.xp).level;

export const equippedOf = (a: LiveAccount): Loadout => ({ rifle: a.profile.weapons.rifle.equipped, faca: a.profile.weapons.faca.equipped, granada: a.profile.weapons.granada.equipped });

export type LevelUp = { tipo: ProgWeapon | 'conta'; nivel: number };

/** Adds weapon points; returns the new level when it goes up (equipped too if the best was equipped). */
export function addWeaponXp(a: LiveAccount, w: ProgWeapon, points: number): LevelUp | null {
  if (points <= 0) return null;
  const pts = Math.round(points);
  const wp = a.profile.weapons[w];
  const before = levelForXp(w, wp.xp);
  wp.xp += pts;
  a.delta.weaponXp[w] += pts;
  const after = levelForXp(w, wp.xp);
  if (after === before) return null;
  if (wp.equipped === before) wp.equipped = after;
  return { tipo: w, nivel: after };
}

export function addAccountXp(a: LiveAccount, xp: number): LevelUp | null {
  if (xp <= 0) return null;
  const before = accountLevelOf(a);
  a.profile.xp += xp;
  a.delta.accountXp += xp;
  const after = accountLevelOf(a);
  return after > before ? { tipo: 'conta', nivel: after } : null;
}

/** Time in a session; every full minute alive earns account XP. Returns a level-up, if any. */
export function addTime(a: LiveAccount, dt: number, alive: boolean): LevelUp | null {
  a.delta.secondsPlayed += dt;
  if (!alive) return null;
  a.aliveCarry += dt;
  if (a.aliveCarry < 60) return null;
  a.aliveCarry -= 60;
  return addAccountXp(a, ACCOUNT_XP.perMinuteAlive);
}

/** Only unlocked levels can be equipped; others keep the current level. */
export function equip(a: LiveAccount, lo: Loadout) {
  for (const w of PROG_WEAPONS) {
    const wp = a.profile.weapons[w];
    if (lo[w] >= 1 && lo[w] <= levelForXp(w, wp.xp)) wp.equipped = lo[w];
  }
}

export function progressMsg(a: LiveAccount, subiu?: LevelUp | null): Extract<ServerMsg, { t: 'progresso' }> {
  const armas = {} as Extract<ServerMsg, { t: 'progresso' }>['armas'];
  for (const w of PROG_WEAPONS) {
    const wp = a.profile.weapons[w];
    armas[w] = { xp: wp.xp, nivel: levelForXp(w, wp.xp), equipado: wp.equipped };
  }
  return { t: 'progresso', armas, conta: { xp: a.profile.xp, nivel: accountLevelOf(a) }, ...(subiu ? { subiu } : {}) };
}

/** Puts a delta that failed to be written back, so the next flush retries it. */
export function mergeDelta(into: ProgressDelta, d: ProgressDelta) {
  for (const k of Object.keys(d) as (keyof ProgressDelta)[]) {
    if (k === 'weaponXp') for (const w of PROG_WEAPONS) into.weaponXp[w] += d.weaponXp[w];
    else into[k] += d[k];
  }
}

export const deltaIsEmpty = (d: ProgressDelta) =>
  Object.entries(d).every(([k, v]) => (k === 'weaponXp' ? PROG_WEAPONS.every((w) => (v as Record<ProgWeapon, number>)[w] === 0) : v === 0));
