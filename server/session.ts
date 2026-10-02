// One free-for-all game session. The server owns health, damage, kills, score, respawns and corpses;
// clients report their movement and what their shots hit, and every report is sanity-checked here with
// the same shared rules the client uses (weapon data, grenade levels, score table).
//
// Every player is a signed-in account: kills, humiliations and time alive feed the account's progress
// (server/progress.ts), which app.ts writes to the database.
//
// Not yet (next netcode step, section 14): server-side movement simulation, rewinding hitboxes for lag
// compensation, and interest culling. Movement is trusted; hits are validated against server positions
// with a lag tolerance.
import type { ServerWebSocket } from 'bun';
import { HEALTH, HUMILIATION, SCORE } from '@shared/constants';
import { clampExplosionDamage, computeDamage, explosionDamage, GRENADES, grenadeLevel, HIT_REGIONS, LETHAL_DAMAGE, minPenetrationKeep, WEAPONS, type HitRegion } from '@shared/weapons';
import { ACCOUNT_XP } from '@shared/accountLevel';
import { bodyStats } from '@shared/appearance';
import type { MapId } from '@shared/maps';
import { knifeData, levelInfo, rifleData, sanitizeLoadout, weaponOfKill, type Loadout } from '@shared/progression';
import { accountLevelOf, addAccountXp, addTime, addWeaponXp, equip, equippedOf, progressMsg, type LevelUp, type LiveAccount } from './progress';
import { NET, ONLINE_GRENADE_LEVEL, type Award, type ClientMsg, type CorpseInfo, type KillKind, type NetState, type PlayerInfo, type ServerMsg, type Sex, type SessionInfo, type Vec3 } from '@shared/protocol';

const RIFLE = WEAPONS.rifle_padrao;
const PEN_MIN_KEEP = minPenetrationKeep(RIFLE);
const GRENADE = GRENADES.granada_frag;
const GRENADE_LVL = grenadeLevel(GRENADE, ONLINE_GRENADE_LEVEL);
/** Eye and chest height: the same for every body (height is only a look). */
const EYE = 1.6;
const CHEST = 1.1;
/** Extra meters allowed between what the client saw and the server's latest positions (latency). */
const LAG_SLACK = 4;

export interface Conn {
  ws: ServerWebSocket<unknown>;
  id: number;
  name: string;
  sex: Sex;
  session: Session | null;
  /** The signed-in account behind this connection (from the WebSocket ticket). */
  account: LiveAccount;
  send(msg: ServerMsg): void;
}

interface SPlayer {
  conn: Conn;
  id: number;
  name: string;
  sex: Sex;
  /** Equipped weapon levels (unlocked ones only): damage, fire rate and knife reach follow them. */
  loadout: Loadout;
  /** What the character's look does in the game: height (eye, hitboxes) and max health. */
  body: ReturnType<typeof bodyStats>;
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
  grenades: Map<number, { thrownAt: number; fuse: number; impact: boolean; mine: boolean; origin: Vec3; speed: number }>;
  dance: { corpse: number; since: number } | null;
}

interface Corpse extends CorpseInfo {
  createdAt: number;
  humiliated: boolean;
  claimedBy: number | null;
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const eye = (p: SPlayer): Vec3 => [p.state.p[0], p.state.p[1] + EYE, p.state.p[2]];
const chest = (p: SPlayer): Vec3 => [p.state.p[0], p.state.p[1] + CHEST, p.state.p[2]];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);

export class Session {
  readonly players = new Map<number, SPlayer>();
  private corpses = new Map<number, Corpse>();
  private nextCorpse = 1;
  private timer: Timer;
  private scoreTimer = 0;
  /** Bun pub/sub topic every player of this session is subscribed to. */
  private readonly topic: string;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly map: MapId,
    readonly permanent: boolean,
    private now: () => number,
    private onChange: () => void,
    /** server.publish: sends to every socket subscribed to the topic. */
    private publish: (topic: string, data: string) => void,
  ) {
    this.topic = `sessao:${id}`;
    this.timer = setInterval(() => this.tick(), 1000 / NET.tickRate);
  }

  get info(): SessionInfo {
    return { id: this.id, name: this.name, map: this.map, players: this.players.size, max: NET.maxPlayers, permanent: this.permanent };
  }

  get full() {
    return this.players.size >= NET.maxPlayers;
  }

  dispose() {
    clearInterval(this.timer);
  }

  /** `withLook`: include the appearance (only when a player appears, it doesn't change mid-session). */
  private playerInfo(p: SPlayer, withLook = false): PlayerInfo {
    return {
      id: p.id,
      name: p.name,
      nivel: accountLevelOf(p.conn.account),
      sex: p.sex,
      lo: p.loadout,
      ...(withLook ? { ap: p.conn.account.profile.appearance } : {}),
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      humiliations: p.humiliations,
      alive: p.alive,
      ping: p.ping,
    };
  }

  /** To everyone in the session, serialized once; `except` is the player whose action caused it. */
  private broadcast(msg: ServerMsg, except?: number) {
    const data = JSON.stringify(msg);
    // ws.publish reaches every subscriber but the socket itself. A closed socket was already unsubscribed.
    const sender = except === undefined ? undefined : this.players.get(except)?.conn.ws;
    if (sender?.readyState === WebSocket.OPEN) sender.publish(this.topic, data);
    else this.publish(this.topic, data);
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
      loadout: equippedOf(conn.account),
      body: bodyStats(conn.account.profile.appearance),
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
    conn.ws.subscribe(this.topic);
    conn.send({
      t: 'joined',
      session: this.info,
      you: p.id,
      players: [...this.players.values()].map((x) => this.playerInfo(x, true)),
      corpses: [...this.corpses.values()].filter((c) => !c.humiliated).map(({ id, victim, name: n, sex, ap, p: pos, yaw, until }) => ({ id, victim, name: n, sex, ap, p: pos, yaw, until })),
      time: this.now(),
    });
    this.broadcast({ t: 'playerJoined', player: this.playerInfo(p, true) }, p.id);
    this.onChange();
  }

  leave(conn: Conn) {
    const p = this.players.get(conn.id);
    if (!p) return;
    this.players.delete(conn.id);
    conn.session = null;
    conn.ws.unsubscribe(this.topic);
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
        if (!p.alive || !vec(msg.o) || !vec(msg.e) || now - p.lastShotRelay < (60000 / rifleData(p.loadout.rifle).cadencia) * 0.7) return;
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
        // Land mines (grenade level 2) stay until they go off or their owner respawns.
        const mine = !!msg.mine && levelInfo('granada', p.loadout.granada).tipo === 'mina';
        const live = [...p.grenades.values()];
        if (p.grenades.has(msg.id) || (mine ? live.filter((g) => g.mine).length >= 3 : live.filter((g) => !g.mine).length >= 4)) return;
        const impact = !mine && !!msg.impact && GRENADE.impacto;
        const fuse = mine ? 0 : Math.max(0, Math.min(impact ? GRENADE.tempoMaximoVoo : GRENADE.pavio, msg.fuse));
        const speed = Math.hypot(msg.v[0], msg.v[1], msg.v[2]);
        p.grenades.set(msg.id, { thrownAt: now, fuse, impact, mine, origin: msg.p, speed });
        this.broadcast({ t: 'grenade', owner: p.id, id: msg.id, p: msg.p, v: msg.v, fuse, impact, ...(mine ? { mine } : {}) }, p.id);
        return;
      }
      case 'boom':
        return this.onBoom(p, msg, now);
      case 'loadout':
        equip(p.conn.account, sanitizeLoadout(msg.lo));
        p.loadout = equippedOf(p.conn.account);
        // Everyone else draws the new weapons in this player's hands.
        this.broadcast({ t: 'playerLoadout', id: p.id, lo: p.loadout }, p.id);
        return;
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
        p.health = p.body.maxHealth;
        p.lastDamageAt = 0;
        p.dance = null;
        p.state = { p: msg.p, yaw: msg.yaw, pitch: 0, f: 0 };
        // Mines last only for the life they were planted in (clients drop them on 'spawned' too).
        for (const [id, g] of p.grenades) if (g.mine) p.grenades.delete(id);
        this.broadcast({ t: 'spawned', id: p.id, p: msg.p, yaw: msg.yaw });
        return;
      }
    }
  }

  private onHit(p: SPlayer, targetId: number, region: HitRegion, reportedDist: number, reportedKeep: number | undefined, now: number) {
    const target = this.players.get(targetId);
    if (!target || target === p || !p.alive || !target.alive || !finite(reportedDist)) return;
    if (!(HIT_REGIONS as readonly string[]).includes(region)) return;
    // Fire-rate check: no more confirmed hits per second than the rifle can fire (+ slack for jitter).
    p.hitTimes = p.hitTimes.filter((t) => now - t < 1000);
    const rifle = rifleData(p.loadout.rifle);
    if (p.hitTimes.length >= Math.ceil(rifle.cadencia / 60) + 2) return;
    // Distance check against the server's view of both players.
    const serverDist = dist3(eye(p), chest(target));
    if (serverDist > rifle.alcanceMaximo || Math.abs(serverDist - reportedDist) > LAG_SLACK + serverDist * 0.1) return;
    p.hitTimes.push(now);
    const dist = Math.min(reportedDist, rifle.alcanceMaximo);
    const kind: KillKind = region === 'cabeca' ? 'head' : region === 'virilha' ? 'groin' : 'gun';
    const awards: Award[] = [];
    if (kind === 'head') awards.push({ label: 'headshot', value: SCORE.headshot });
    if (kind === 'groin') awards.push({ label: 'groin', value: SCORE.groin });
    if (dist > SCORE.longShotDistance) awards.push({ label: 'longShot', value: SCORE.longShot });
    // Went through wood/glass: never less than the weapon allows, never more than a clean hit.
    const keep = finite(reportedKeep) ? Math.min(1, Math.max(PEN_MIN_KEEP, reportedKeep!)) : 1;
    this.damage(target, p, computeDamage(rifle, dist, region, keep), kind, eye(p), awards);
  }

  private onStab(p: SPlayer, targetId: number, behind: boolean, now: number) {
    const target = this.players.get(targetId);
    if (!target || target === p || !p.alive || !target.alive) return;
    const knife = knifeData(p.loadout.faca);
    if (now - p.lastStab < knife.intervalo * 1000 * 0.75) return;
    const d = Math.hypot(p.state.p[0] - target.state.p[0], p.state.p[2] - target.state.p[2]);
    if (d > knife.alcanceInvestida + 1.5) return;
    p.lastStab = now;
    const awards: Award[] = [{ label: 'knife', value: SCORE.knife }];
    if (behind) awards.push({ label: 'backstab', value: SCORE.backstab });
    this.damage(target, p, knife.letal ? LETHAL_DAMAGE : 55, 'knife', eye(p), awards);
  }

  private onBoom(p: SPlayer, msg: Extract<ClientMsg, { t: 'boom' }>, now: number) {
    const g = p.grenades.get(msg.id);
    if (!g || !vec(msg.p) || !Array.isArray(msg.hits)) return;
    const t = (now - g.thrownAt) / 1000;
    if (g.mine) {
      if (dist3(g.origin, msg.p) > 1.5) return; // mines don't move
    } else if (g.impact) {
      // Impact grenades go off whenever they touch something: the blast must be somewhere the throw
      // could have reached by now (speed, gravity, latency slack), within the flight time limit.
      const reach = g.speed * t + 4.9 * t * t + 3;
      if (t > g.fuse + 1 || dist3(g.origin, msg.p) > reach) return;
    } else if (t < g.fuse - 0.5) return; // can't explode much earlier than its fuse allows
    p.grenades.delete(msg.id);
    this.broadcast({ t: 'boom', owner: p.id, id: msg.id, p: msg.p }, p.id);
    const seen = new Set<number>();
    for (const h of msg.hits.slice(0, NET.maxPlayers)) {
      const target = this.players.get(h?.target);
      if (!target || !target.alive || seen.has(target.id) || !finite(h.dist)) continue;
      seen.add(target.id);
      const serverDist = dist3(msg.p, chest(target));
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
      const d = p.conn.account.delta;
      d.humiliations++;
      d.score += SCORE.humiliation;
      this.progress(p, [addAccountXp(p.conn.account, ACCOUNT_XP.perHumiliation)]);
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
    victim.conn.account.delta.deaths++;
    if (attacker && attacker !== victim) {
      awards.push({ label: 'kill', value: SCORE.kill }, ...bonus);
      const points = awards.reduce((s, a) => s + a.value, 0);
      attacker.kills++;
      attacker.score += points;
      // Progress: the kill's points go to the weapon that made it; the account gets its own XP.
      const acct = attacker.conn.account;
      const d = acct.delta;
      d.kills++;
      d.score += points;
      if (kind === 'head') d.headshots++;
      if (kind === 'groin') d.groinKills++;
      if (kind === 'knife') d.knifeKills++;
      if (kind === 'grenade') d.grenadeKills++;
      if (awards.some((a) => a.label === 'backstab')) d.backstabs++;
      const w = weaponOfKill(kind);
      this.progress(attacker, [w ? addWeaponXp(acct, w, points) : null, addAccountXp(acct, ACCOUNT_XP.perKill)]);
    }
    const corpse: Corpse = {
      id: this.nextCorpse++,
      victim: victim.id,
      name: victim.name,
      sex: victim.sex,
      ap: victim.conn.account.profile.appearance,
      p: victim.state.p,
      yaw: victim.state.yaw,
      until: now + NET.corpseWindow * 1000,
      createdAt: now,
      humiliated: false,
      claimedBy: null,
    };
    this.corpses.set(corpse.id, corpse);
    const players = [this.playerInfo(victim), ...(attacker && attacker !== victim ? [this.playerInfo(attacker)] : [])];
    const { id, victim: v, name, sex, ap, p, yaw, until } = corpse;
    this.broadcast({ t: 'kill', victim: victim.id, attacker: attacker?.id ?? null, kind, awards, corpse: { id, victim: v, name, sex, ap, p, yaw, until }, players });
  }

  private tick() {
    const now = this.now();
    const dt = 1 / NET.tickRate;
    for (const p of this.players.values()) {
      if (p.alive && p.health < p.body.maxHealth && now - p.lastDamageAt > HEALTH.regenDelay * 1000) {
        p.health = Math.min(p.body.maxHealth, p.health + HEALTH.regenPerSecond * dt);
      }
      const xpBefore = p.conn.account.profile.xp;
      const up = addTime(p.conn.account, dt, p.alive);
      if (p.conn.account.profile.xp !== xpBefore) this.progress(p, [up]);
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

  /** Tells the player their new progress; a weapon that leveled up may have been equipped. */
  private progress(p: SPlayer, ups: (LevelUp | null)[]) {
    p.loadout = equippedOf(p.conn.account);
    const levelUps = ups.filter((u): u is LevelUp => !!u);
    if (!levelUps.length) p.conn.send(progressMsg(p.conn.account));
    for (const up of levelUps) p.conn.send(progressMsg(p.conn.account, up));
  }
}
