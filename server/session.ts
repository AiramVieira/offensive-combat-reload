// One free-for-all game session. The server owns health, damage, kills, score, respawns and corpses;
// clients report their movement and what their shots hit, and every report is sanity-checked here with
// the same shared rules the client uses (weapon data, grenade levels, score table).
//
// Not yet (next netcode step, section 14): server-side movement simulation, rewinding hitboxes for lag
// compensation, and interest culling. Movement is trusted; hits are validated against server positions
// with a lag tolerance.
import type { WebSocket } from 'ws';
import { HEALTH, HUMILIATION, SCORE } from '@shared/constants';
import { clampExplosionDamage, computeDamage, explosionDamage, GRENADES, grenadeLevel, LETHAL_DAMAGE, MELEE, minPenetrationKeep, WEAPONS, type HitRegion } from '@shared/weapons';
import { NET, ONLINE_GRENADE_LEVEL, type Award, type ClientMsg, type CorpseInfo, type KillKind, type NetState, type PlayerInfo, type ServerMsg, type Sex, type SessionInfo, type Vec3 } from '@shared/protocol';

const RIFLE = WEAPONS.rifle_padrao;
const PEN_MIN_KEEP = minPenetrationKeep(RIFLE);
const KNIFE = MELEE.faca;
const GRENADE = GRENADES.granada_frag;
const GRENADE_LVL = grenadeLevel(GRENADE, ONLINE_GRENADE_LEVEL);
const EYE = 1.6;
/** Extra meters allowed between what the client saw and the server's latest positions (latency). */
const LAG_SLACK = 4;

export interface Conn {
  ws: WebSocket;
  id: number;
  name: string;
  sex: Sex;
  session: Session | null;
  send(msg: ServerMsg): void;
}

interface SPlayer {
  conn: Conn;
  id: number;
  name: string;
  sex: Sex;
  state: NetState;
  alive: boolean;
  health: number;
  lastDamageAt: number;
  deadAt: number;
  kills: number;
  deaths: number;
  score: number;
  humiliations: number;
  ping: number;
  hitTimes: number[];
  lastStab: number;
  lastShotRelay: number;
  lastProp: number;
  grenades: Map<number, { thrownAt: number; fuse: number }>;
  dance: { corpse: number; since: number } | null;
}

interface Corpse extends CorpseInfo {
  createdAt: number;
  humiliated: boolean;
  claimedBy: number | null;
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const eye = (s: NetState): Vec3 => [s.p[0], s.p[1] + EYE, s.p[2]];
const chest = (s: NetState): Vec3 => [s.p[0], s.p[1] + 1.1, s.p[2]];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);

export class Session {
  readonly players = new Map<number, SPlayer>();
  private corpses = new Map<number, Corpse>();
  private nextCorpse = 1;
  private timer: NodeJS.Timeout;
  private scoreTimer = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly permanent: boolean,
    private now: () => number,
    private onChange: () => void,
  ) {
    this.timer = setInterval(() => this.tick(), 1000 / NET.tickRate);
  }

  get info(): SessionInfo {
    return { id: this.id, name: this.name, players: this.players.size, max: NET.maxPlayers, permanent: this.permanent };
  }

  get full() {
    return this.players.size >= NET.maxPlayers;
  }

  dispose() {
    clearInterval(this.timer);
  }

  private playerInfo(p: SPlayer): PlayerInfo {
    return { id: p.id, name: p.name, sex: p.sex, kills: p.kills, deaths: p.deaths, score: p.score, humiliations: p.humiliations, alive: p.alive, ping: p.ping };
  }

  private broadcast(msg: ServerMsg, except?: number) {
    for (const p of this.players.values()) if (p.id !== except) p.conn.send(msg);
  }

  // --- Membership -------------------------------------------------------------------------------------

  join(conn: Conn) {
    // Unique display names inside the session.
    let name = conn.name;
    const taken = new Set([...this.players.values()].map((p) => p.name));
    for (let n = 2; taken.has(name); n++) name = `${conn.name.slice(0, NET.nameMax - 4)} (${n})`;
    const p: SPlayer = {
      conn,
      id: conn.id,
      name,
      sex: conn.sex,
      state: { p: [0, -50, 0], yaw: 0, pitch: 0, f: 0 },
      // Joins dead: the client picks a spawn and sends 'respawn' right away.
      alive: false,
      health: 0,
      lastDamageAt: 0,
      deadAt: this.now() - NET.respawnDelay * 1000,
      kills: 0,
      deaths: 0,
      score: 0,
      humiliations: 0,
      ping: 0,
      hitTimes: [],
      lastStab: 0,
      lastShotRelay: 0,
      lastProp: 0,
      grenades: new Map(),
      dance: null,
    };
    this.players.set(p.id, p);
    conn.session = this;
    conn.send({
      t: 'joined',
      session: this.info,
      you: p.id,
      players: [...this.players.values()].map((x) => this.playerInfo(x)),
      corpses: [...this.corpses.values()].filter((c) => !c.humiliated).map(({ id, victim, name: n, sex, p: pos, yaw, until }) => ({ id, victim, name: n, sex, p: pos, yaw, until })),
      time: this.now(),
    });
    this.broadcast({ t: 'playerJoined', player: this.playerInfo(p) }, p.id);
    this.onChange();
  }

  leave(conn: Conn) {
    const p = this.players.get(conn.id);
    if (!p) return;
    this.players.delete(conn.id);
    conn.session = null;
    for (const c of this.corpses.values()) if (c.claimedBy === p.id) c.claimedBy = null;
    this.broadcast({ t: 'playerLeft', id: p.id });
    this.onChange();
  }

  // --- Messages ---------------------------------------------------------------------------------------

  handle(conn: Conn, msg: ClientMsg) {
    const p = this.players.get(conn.id);
    if (!p) return;
    const now = this.now();
    switch (msg.t) {
      case 'state': {
        const s = msg.s;
        if (!s || !vec(s.p) || !finite(s.yaw) || !finite(s.pitch) || !finite(s.f)) return;
        if (p.alive) p.state = { p: s.p, yaw: s.yaw, pitch: Math.max(-1.6, Math.min(1.6, s.pitch)), f: s.f | 0 };
        return;
      }
      case 'ping':
        if (finite(msg.rtt)) p.ping = Math.round(Math.min(9999, Math.max(0, msg.rtt)));
        if (finite(msg.c)) conn.send({ t: 'pong', c: msg.c, s: now });
        return;
      case 'shot': {
        // Cosmetic relay (tracer + sound for others), rate-limited to the rifle's fire rate.
        if (!p.alive || !vec(msg.o) || !vec(msg.e) || now - p.lastShotRelay < (60000 / RIFLE.cadencia) * 0.7) return;
        p.lastShotRelay = now;
        this.broadcast({ t: 'shot', id: p.id, o: msg.o, e: msg.e }, p.id);
        return;
      }
      case 'prop': {
        // Cosmetic relay; ids look like "hidrante:1", limited to a few per second per player.
        if (typeof msg.id !== 'string' || !/^[a-z]{1,16}(:\d{1,3})?$/.test(msg.id) || now - p.lastProp < 150) return;
        p.lastProp = now;
        this.broadcast({ t: 'prop', id: msg.id, by: p.id }, p.id);
        return;
      }
      case 'swing':
        if (p.alive) this.broadcast({ t: 'swing', id: p.id }, p.id);
        return;
      case 'hit':
        return this.onHit(p, msg.target, msg.region, msg.dist, msg.keep, now);
      case 'stab':
        return this.onStab(p, msg.target, !!msg.behind, now);
      case 'grenade': {
        if (!p.alive || !finite(msg.id) || !vec(msg.p) || !vec(msg.v) || !finite(msg.fuse)) return;
        if (p.grenades.size >= 4 || p.grenades.has(msg.id)) return;
        const fuse = Math.max(0, Math.min(GRENADE.pavio, msg.fuse));
        p.grenades.set(msg.id, { thrownAt: now, fuse });
        this.broadcast({ t: 'grenade', owner: p.id, id: msg.id, p: msg.p, v: msg.v, fuse }, p.id);
        return;
      }
      case 'boom':
        return this.onBoom(p, msg, now);
      case 'selfDamage': {
        if (!p.alive || !finite(msg.amount) || msg.amount <= 0) return;
        const cause: KillKind = msg.cause === 'void' ? 'void' : msg.cause === 'dog' ? 'dog' : 'fall';
        this.damage(p, null, Math.min(LETHAL_DAMAGE, msg.amount), cause, null, []);
        return;
      }
      case 'taunt':
        return this.onTaunt(p, msg.corpse, now);
      case 'tauntEnd':
        return this.onTauntEnd(p, msg.corpse, !!msg.done, now);
      case 'respawn': {
        if (p.alive || !vec(msg.p) || !finite(msg.yaw)) return;
        if (now - p.deadAt < NET.respawnDelay * 1000 - 250) return;
        p.alive = true;
        p.health = HEALTH.max;
        p.lastDamageAt = 0;
        p.dance = null;
        p.state = { p: msg.p, yaw: msg.yaw, pitch: 0, f: 0 };
        this.broadcast({ t: 'spawned', id: p.id, p: msg.p, yaw: msg.yaw });
        return;
      }
    }
  }

  private onHit(p: SPlayer, targetId: number, region: HitRegion, reportedDist: number, reportedKeep: number | undefined, now: number) {
    const target = this.players.get(targetId);
    if (!target || target === p || !p.alive || !target.alive || !finite(reportedDist)) return;
    if (!['cabeca', 'tronco', 'bracos', 'pernas', 'virilha'].includes(region)) return;
    // Fire-rate check: no more confirmed hits per second than the rifle can fire (+ slack for jitter).
    p.hitTimes = p.hitTimes.filter((t) => now - t < 1000);
    if (p.hitTimes.length >= Math.ceil(RIFLE.cadencia / 60) + 2) return;
    // Distance check against the server's view of both players.
    const serverDist = dist3(eye(p.state), chest(target.state));
    if (serverDist > RIFLE.alcanceMaximo || Math.abs(serverDist - reportedDist) > LAG_SLACK + serverDist * 0.1) return;
    p.hitTimes.push(now);
    const dist = Math.min(reportedDist, RIFLE.alcanceMaximo);
    const kind: KillKind = region === 'cabeca' ? 'head' : region === 'virilha' ? 'groin' : 'gun';
    const awards: Award[] = [];
    if (kind === 'head') awards.push({ label: 'headshot', value: SCORE.headshot });
    if (kind === 'groin') awards.push({ label: 'groin', value: SCORE.groin });
    if (dist > SCORE.longShotDistance) awards.push({ label: 'longShot', value: SCORE.longShot });
    // Went through wood/glass: never less than the weapon allows, never more than a clean hit.
    const keep = finite(reportedKeep) ? Math.min(1, Math.max(PEN_MIN_KEEP, reportedKeep!)) : 1;
    this.damage(target, p, computeDamage(RIFLE, dist, region, keep), kind, eye(p.state), awards);
  }

  private onStab(p: SPlayer, targetId: number, behind: boolean, now: number) {
    const target = this.players.get(targetId);
    if (!target || target === p || !p.alive || !target.alive) return;
    if (now - p.lastStab < KNIFE.intervalo * 1000 * 0.75) return;
    const d = Math.hypot(p.state.p[0] - target.state.p[0], p.state.p[2] - target.state.p[2]);
    if (d > KNIFE.alcanceInvestida + 1.5) return;
    p.lastStab = now;
    const awards: Award[] = [{ label: 'knife', value: SCORE.knife }];
    if (behind) awards.push({ label: 'backstab', value: SCORE.backstab });
    this.damage(target, p, KNIFE.letal ? LETHAL_DAMAGE : 55, 'knife', eye(p.state), awards);
  }

  private onBoom(p: SPlayer, msg: Extract<ClientMsg, { t: 'boom' }>, now: number) {
    const g = p.grenades.get(msg.id);
    if (!g || !vec(msg.p) || !Array.isArray(msg.hits)) return;
    // Can't explode much earlier than its fuse allows.
    if (now - g.thrownAt < g.fuse * 1000 - 500) return;
    p.grenades.delete(msg.id);
    this.broadcast({ t: 'boom', owner: p.id, id: msg.id, p: msg.p }, p.id);
    const seen = new Set<number>();
    for (const h of msg.hits.slice(0, NET.maxPlayers)) {
      const target = this.players.get(h?.target);
      if (!target || !target.alive || seen.has(target.id) || !finite(h.dist)) continue;
      seen.add(target.id);
      const serverDist = dist3(msg.p, chest(target.state));
      if (serverDist > GRENADE_LVL.raioDano + 3 || Math.abs(serverDist - h.dist) > 3) continue;
      // Non-lethal levels protect other players only: your own grenade can kill you.
      const raw = explosionDamage(GRENADE_LVL, h.dist);
      const dmg = target === p ? raw : clampExplosionDamage(GRENADE_LVL, raw, target.health);
      if (dmg > 0) this.damage(target, target === p ? null : p, dmg, target === p ? 'explosion' : 'grenade', msg.p, []);
    }
  }

  private onTaunt(p: SPlayer, corpseId: number, now: number) {
    const c = this.corpses.get(corpseId);
    if (!c || !p.alive || p.dance || c.humiliated || c.claimedBy !== null || now > c.until || c.victim === p.id) return;
    if (Math.hypot(p.state.p[0] - c.p[0], p.state.p[2] - c.p[2]) > HUMILIATION.radius + 1.5) return;
    c.claimedBy = p.id;
    p.dance = { corpse: c.id, since: now };
    this.broadcast({ t: 'taunt', id: p.id, corpse: c.id });
  }

  private onTauntEnd(p: SPlayer, corpseId: number, done: boolean, now: number) {
    const c = this.corpses.get(corpseId);
    if (!p.dance || p.dance.corpse !== corpseId || !c) return;
    const completed = done && now - p.dance.since >= HUMILIATION.duration * 1000 - 400;
    p.dance = null;
    c.claimedBy = null;
    const awards: Award[] = [];
    if (completed) {
      c.humiliated = true;
      p.humiliations++;
      p.score += SCORE.humiliation;
      awards.push({ label: 'humiliation', value: SCORE.humiliation });
    } else {
      c.until = Math.max(c.until, now + 1500);
    }
    this.broadcast({ t: 'tauntEnd', id: p.id, corpse: c.id, done: completed, awards, players: [this.playerInfo(p)] });
  }

  // --- Rules ------------------------------------------------------------------------------------------

  private damage(target: SPlayer, attacker: SPlayer | null, amount: number, kind: KillKind, from: Vec3 | null, bonus: Award[]) {
    if (!target.alive || amount <= 0) return;
    const dealt = Math.min(target.health, amount);
    target.health -= dealt;
    target.lastDamageAt = this.now();
    this.broadcast({ t: 'damage', target: target.id, attacker: attacker?.id ?? null, amount: dealt, health: target.health, from });
    if (target.health <= 0) this.kill(target, attacker, kind, bonus);
  }

  private kill(victim: SPlayer, attacker: SPlayer | null, kind: KillKind, bonus: Award[]) {
    const now = this.now();
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.deadAt = now;
    victim.grenades.clear();
    // Only death ends a dance (damage doesn't): the corpse is released without points.
    if (victim.dance) this.onTauntEnd(victim, victim.dance.corpse, false, now);
    const awards: Award[] = [];
    if (attacker && attacker !== victim) {
      awards.push({ label: 'kill', value: SCORE.kill }, ...bonus);
      attacker.kills++;
      attacker.score += awards.reduce((s, a) => s + a.value, 0);
    }
    const corpse: Corpse = {
      id: this.nextCorpse++,
      victim: victim.id,
      name: victim.name,
      sex: victim.sex,
      p: victim.state.p,
      yaw: victim.state.yaw,
      until: now + NET.corpseWindow * 1000,
      createdAt: now,
      humiliated: false,
      claimedBy: null,
    };
    this.corpses.set(corpse.id, corpse);
    const players = [this.playerInfo(victim), ...(attacker && attacker !== victim ? [this.playerInfo(attacker)] : [])];
    const { id, victim: v, name, sex, p, yaw, until } = corpse;
    this.broadcast({ t: 'kill', victim: victim.id, attacker: attacker?.id ?? null, kind, awards, corpse: { id, victim: v, name, sex, p, yaw, until }, players });
  }

  private tick() {
    const now = this.now();
    const dt = 1 / NET.tickRate;
    for (const p of this.players.values()) {
      if (p.alive && p.health < HEALTH.max && now - p.lastDamageAt > HEALTH.regenDelay * 1000) {
        p.health = Math.min(HEALTH.max, p.health + HEALTH.regenPerSecond * dt);
      }
    }
    for (const c of this.corpses.values()) {
      if (c.claimedBy === null && now > c.until + 2000) this.corpses.delete(c.id);
    }
    if (this.players.size === 0) return;
    this.broadcast({
      t: 'snap',
      time: now,
      players: [...this.players.values()].map((p) => ({ id: p.id, s: p.state, h: Math.ceil(p.health), alive: p.alive })),
    });
    this.scoreTimer += dt;
    if (this.scoreTimer >= 1) {
      this.scoreTimer = 0;
      this.broadcast({ t: 'scores', players: [...this.players.values()].map((p) => this.playerInfo(p)) });
    }
  }

}
