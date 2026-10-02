// Network protocol shared by client and server (section 14). JSON over WebSocket for this first online
// version; the message shapes are kept small so a binary encoding can replace JSON later without changing
// the game code.
import type { HitRegion } from './weapons';
import { HUMILIATION } from './constants';
import type { Loadout, ProgWeapon } from './progression';
import type { Appearance } from './appearance';
import type { MapId } from './maps';

export const NET = {
  /** Server simulation/broadcast rate. */
  tickRate: 20,
  /** Client state upload rate. */
  stateRate: 20,
  /** Remote players are drawn this far in the past, interpolating between two snapshots. */
  interpDelayMs: 100,
  maxPlayers: 10,
  nameMax: 16,
  sessionNameMax: 24,
  /** Longest chat message (characters). */
  chatMax: 120,
  /** Chat flood limit: a burst of this many messages, then one every chatEveryMs. */
  chatBurst: 4,
  chatEveryMs: 1500,
  /** Free-for-all respawn delay (long enough to watch your own humiliation). */
  respawnDelay: 5,
  corpseWindow: HUMILIATION.window,
  port: 8787,
  path: '/ws',
} as const;

/** Everyone throws this grenade level online until progression exists (level 1 = non-lethal). */
export const ONLINE_GRENADE_LEVEL = 1;

export type Vec3 = [number, number, number];

/** Bit flags describing what a player is doing, for remote animation. */
export const FLAG = {
  crouch: 1,
  sprint: 2,
  ads: 4,
  reload: 8,
  dance: 16,
  cook: 32,
  grounded: 64,
  knife: 128,
  slide: 256,
} as const;

export interface NetState {
  /** Feet position. */
  p: Vec3;
  yaw: number;
  pitch: number;
  f: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  map: MapId;
  players: number;
  max: number;
  permanent: boolean;
}

/** Character body chosen on the home screen: masculino / feminino. */
export type Sex = 'm' | 'f';
export const asSex = (v: unknown): Sex => (v === 'f' ? 'f' : 'm');

export interface PlayerInfo {
  id: number;
  /** Name#1234 of the player's account. */
  name: string;
  /** Account level (shown on the scoreboard). */
  nivel: number;
  sex: Sex;
  /** Equipped level of each weapon (for weapon names in the kill feed). */
  lo?: Loadout;
  /** How the character looks (sent when the player appears: 'joined' and 'playerJoined'). */
  ap?: Appearance;
  kills: number;
  deaths: number;
  score: number;
  humiliations: number;
  alive: boolean;
  ping: number;
}

export type KillKind = 'gun' | 'head' | 'groin' | 'knife' | 'grenade' | 'fall' | 'void' | 'explosion' | 'dog';
export type AwardLabel = 'kill' | 'headshot' | 'groin' | 'knife' | 'backstab' | 'longShot' | 'humiliation';
export interface Award {
  label: AwardLabel;
  value: number;
}

export interface CorpseInfo {
  id: number;
  victim: number;
  name: string;
  sex: Sex;
  /** The body looks like the player did. */
  ap?: Appearance;
  p: Vec3;
  yaw: number;
  /** Server time (ms) when the humiliation window closes. */
  until: number;
}

// --- Client → server --------------------------------------------------------------------------------
export type ClientMsg =
  /** Identity comes from the ticket the connection was opened with; name and body come from the account. */
  | { t: 'hello' }
  | { t: 'list' }
  /** An unknown map falls back to the default one. */
  | { t: 'create'; name: string; map?: MapId }
  | { t: 'join'; session: string }
  | { t: 'leave' }
  | { t: 'state'; s: NetState }
  | { t: 'shot'; o: Vec3; e: Vec3 }
  /** keep: damage fraction left after the bullet went through wood/glass (absent = clean hit). */
  | { t: 'hit'; target: number; region: HitRegion; dist: number; keep?: number }
  | { t: 'swing' }
  | { t: 'stab'; target: number; behind: boolean }
  /** impact: explodes on its first contact instead of by fuse (fuse is then the flight time limit). */
  | { t: 'grenade'; id: number; p: Vec3; v: Vec3; fuse: number; impact?: boolean; mine?: boolean }
  /** Equipped weapon levels; the server ignores levels the account hasn't unlocked. */
  | { t: 'loadout'; lo: Loadout }
  | { t: 'boom'; id: number; p: Vec3; hits: { target: number; dist: number }[] }
  | { t: 'selfDamage'; amount: number; cause: 'fall' | 'void' | 'dog' }
  | { t: 'taunt'; corpse: number }
  | { t: 'tauntEnd'; corpse: number; done: boolean }
  | { t: 'respawn'; p: Vec3; yaw: number }
  /** An environmental gag was triggered (e.g. "hidrante:1"); relayed so everyone sees it. */
  | { t: 'prop'; id: string }
  /** A line in the session's chat (sanitized and rate-limited by the server). */
  | { t: 'chat'; text: string }
  /** `rtt` = the client's last measured round trip (ms), shown on the scoreboard. */
  | { t: 'ping'; c: number; rtt?: number };

// --- Server → client --------------------------------------------------------------------------------
export type ServerMsg =
  | { t: 'welcome'; id: number; name: string; sessions: SessionInfo[] }
  | { t: 'sessions'; list: SessionInfo[] }
  | { t: 'joined'; session: SessionInfo; you: number; players: PlayerInfo[]; corpses: CorpseInfo[]; time: number }
  | { t: 'error'; message: string }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number }
  | { t: 'snap'; time: number; players: { id: number; s: NetState; h: number; alive: boolean }[] }
  | { t: 'shot'; id: number; o: Vec3; e: Vec3 }
  | { t: 'swing'; id: number }
  | { t: 'damage'; target: number; attacker: number | null; amount: number; health: number; from: Vec3 | null }
  | { t: 'kill'; victim: number; attacker: number | null; kind: KillKind; awards: Award[]; corpse: CorpseInfo; players: PlayerInfo[] }
  | { t: 'spawned'; id: number; p: Vec3; yaw: number }
  | { t: 'grenade'; owner: number; id: number; p: Vec3; v: Vec3; fuse: number; impact?: boolean; mine?: boolean }
  | { t: 'boom'; owner: number; id: number; p: Vec3 }
  | { t: 'taunt'; id: number; corpse: number }
  | { t: 'tauntEnd'; id: number; corpse: number; done: boolean; awards: Award[]; players: PlayerInfo[] }
  | { t: 'scores'; players: PlayerInfo[] }
  /** A player changed their equipped weapon levels: everyone else sees the new models. */
  | { t: 'playerLoadout'; id: number; lo: Loadout }
  | { t: 'prop'; id: string; by: number }
  /** A chat line, to everyone in the session (the sender too: what they see is what the server accepted). */
  | { t: 'chat'; id: number; name: string; text: string }
  /** The player's chat line was dropped: their account is muted, or they're sending too fast. */
  | { t: 'chatRefused'; reason: 'muted' | 'slow' }
  | { t: 'pong'; c: number; s: number }
  /** The account's progress changed (points only come from the server online). */
  | { t: 'progresso'; armas: Record<ProgWeapon, { xp: number; nivel: number; equipado: number }>; conta: { xp: number; nivel: number }; subiu?: { tipo: ProgWeapon | 'conta'; nivel: number } };

/** WebSocket close codes sent by the server. */
export const CLOSE = {
  /** Session revoked: logout, password reset, ban or account deletion. */
  revoked: 4001,
  /** The same account connected somewhere else. */
  replaced: 4002,
} as const;

export function sanitizeName(raw: unknown, max: number): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s;
}

/**
 * A chat line as everyone will see it: no control characters, no bidirectional overrides (they could flip a
 * line to fake another player's name), single spaces, NET.chatMax characters. Shown with textContent, never
 * as HTML, so "<3" stays.
 */
export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .slice(0, NET.chatMax * 4)
    // Line breaks and tabs first, so they become spaces instead of gluing words together.
    .replace(/\s+/g, ' ')
    // Zero-width joiners stay: emoji sequences (👨‍👩‍👧) are made with them.
    .replace(/[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  // By code points, so an emoji at the end isn't cut in half.
  return Array.from(s).slice(0, NET.chatMax).join('').trim();
}
