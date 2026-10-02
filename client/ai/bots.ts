// Offline free-for-all against bots: owns the bots, resolves their shots and knives, applies every damage
// between combatants (bots and the local player) with the same rules as the server, keeps the score, the
// corpses and the respawns. The local player is just another Combatant here.
import * as THREE from 'three';
import { HUMILIATION, SCORE } from '@shared/constants';
import { computeDamage, LETHAL_DAMAGE, MELEE, WEAPONS, type HitRegion } from '@shared/weapons';
import type { Award, KillKind, PlayerInfo, Sex } from '@shared/protocol';
import { Bot, BOT_SKILLS, type BotSkillName, type BotWorld, type Combatant } from './bot';
import type { NavMap } from './navmesh';
import { Corpse, groundBelow } from '../gameplay/corpse';
import { pickSafeSpawn } from '../gameplay/spawnPicker';
import type { HitboxRegistry } from '../gameplay/targets';
import { applySpread, traceShot } from '../weapons/hitscan';
import type { Effects } from '../render/effects';
import type { Sfx } from '../audio/sfx';
import type { Physics } from '../world/physics';
import type { SpawnPoint } from '../world/blockoutMap';

const RESPAWN = 5;
/** Spawn protection (section 6): invulnerable and ignored for 2 s, cancelled by your own first shot. */
const SPAWN_PROTECTION = 2;
const RIFLE = WEAPONS.rifle_padrao;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

const BOT_NAMES: [string, Sex][] = [
  ['Bot Clebinho', 'm'], ['Sgt. Parafuso', 'm'], ['Cabo Chip', 'm'], ['Dona Bateria', 'f'], ['Tenente Wi-Fi', 'f'], ['Soldado Bug', 'm'],
  ['Capitão Lag', 'm'], ['Recruta 404', 'm'], ['Major Pixel', 'f'], ['Robô Zé', 'm'], ['Vovó Turbo', 'f'], ['Sargenta Selfie', 'f'],
];

export interface HitInfo {
  kind: KillKind;
  region?: HitRegion;
  dist?: number;
  behind?: boolean;
}

export interface BotHooks {
  /** Damage to the local player; returns the health left (the game applies it and handles death). */
  damagePlayer(amount: number, attacker: Combatant, from: THREE.Vector3): number;
  kill(victim: Combatant, killer: Combatant | null, kind: KillKind, awards: Award[], corpse: Corpse): void;
  tauntStarted(dancer: Combatant, corpse: Corpse): void;
  humiliation(dancer: Combatant, corpse: Corpse, awards: Award[]): void;
}

export interface BotOptions {
  physics: Physics;
  scene: THREE.Scene;
  registry: HitboxRegistry;
  nav: NavMap;
  spawns: SpawnPoint[];
  effects: Effects;
  sfx: Sfx;
  /** Local player as a combatant (id 0). */
  player: Combatant;
  listener(): THREE.Vector3;
  count: number;
  skill: BotSkillName;
  hooks: BotHooks;
}

export class BotManager {
  readonly bots: Bot[] = [];
  readonly corpses = new Map<number, Corpse>();
  private scores = new Map<number, PlayerInfo>();
  private nextCorpse = 1;
  private time = 0;
  private protectedUntil = new Map<number, number>();
  private world: BotWorld;

  constructor(private o: BotOptions) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < o.count; i++) {
      const [name, sex] = names[i % names.length];
      const bot = new Bot(i + 1, name, sex, BOT_SKILLS[o.skill], o.physics.world, o.scene, o.registry);
      bot.onShoot = (spread) => this.fire(bot, spread);
      this.bots.push(bot);
    }
    this.score(o.player);
    for (const b of this.bots) this.score(b);
    const self = this;
    this.world = {
      get time() {
        return self.time;
      },
      physics: o.physics,
      nav: o.nav,
      combatants: () => this.combatants().filter((c) => !this.isProtected(c)),
      corpses: () => this.corpses.values(),
      fire: (bot, spread) => this.fire(bot, spread),
      stab: (bot, target) => this.stab(bot, target),
      tauntStarted: (bot, corpse) => o.hooks.tauntStarted(bot, corpse),
      tauntFinished: (bot, corpse) => this.finishTaunt(bot, corpse),
    };
    // Everyone starts spread over the map.
    for (const b of this.bots) {
      b.spawn(this.pickSpawn(b));
      this.protect(b);
    }
  }

  combatants(): Combatant[] {
    return [this.o.player, ...this.bots];
  }

  private score(c: Combatant): PlayerInfo {
    let s = this.scores.get(c.id);
    if (!s) {
      s = { id: c.id, name: c.name, nivel: 0, sex: c.sex, kills: 0, deaths: 0, score: 0, humiliations: 0, alive: !c.dead, ping: 0 };
      this.scores.set(c.id, s);
    }
    return s;
  }

  standings(): PlayerInfo[] {
    for (const c of this.combatants()) {
      const s = this.score(c);
      s.alive = !c.dead;
      s.name = c.name;
    }
    return [...this.scores.values()];
  }

  /** Section 6 spawn choice (see gameplay/spawnPicker.ts), against every other living combatant. */
  pickSpawn(forWho: Combatant): SpawnPoint {
    const threats = this.combatants()
      .filter((c) => c !== forWho && !c.dead)
      .map((c) => ({ feet: c.position, eye: c.eye(new THREE.Vector3()) }));
    return pickSafeSpawn(this.o.spawns, threats, this.o.physics);
  }

  protect(c: Combatant) {
    this.protectedUntil.set(c.id, this.time + SPAWN_PROTECTION);
  }

  isProtected(c: Combatant): boolean {
    return (this.protectedUntil.get(c.id) ?? -1) > this.time;
  }

  /** Firing cancels your own spawn protection. */
  unprotect(c: Combatant) {
    this.protectedUntil.delete(c.id);
  }

  // --- Combat -------------------------------------------------------------------------------------------

  /** Applies damage between combatants with the server's rules (awards, kills, corpses). */
  hit(victim: Combatant, attacker: Combatant, amount: number, info: HitInfo): { dealt: number; killed: boolean } {
    if (victim.dead || amount <= 0 || (victim !== attacker && this.isProtected(victim))) return { dealt: 0, killed: false };
    let left: number;
    let dealt: number;
    if (victim === this.o.player) {
      const before = victim.health;
      left = this.o.hooks.damagePlayer(amount, attacker, attacker.position);
      dealt = before - left;
    } else {
      const bot = victim as Bot;
      if (attacker !== bot) bot.hitReact(attacker.position);
      dealt = Math.min(bot.health, amount);
      bot.health -= dealt;
      bot.lastDamageAt = this.time;
      bot.lastAttacker = attacker;
      bot.lastAttackedAt = this.time;
      left = bot.health;
    }
    if (left > 0) return { dealt, killed: false };
    this.kill(victim, attacker, info);
    return { dealt, killed: true };
  }

  /** `killer` null or the victim itself = suicide / environment. */
  kill(victim: Combatant, killer: Combatant | null, info: HitInfo) {
    const vs = this.score(victim);
    vs.deaths++;
    const awards: Award[] = [];
    if (killer && killer !== victim) {
      awards.push({ label: 'kill', value: SCORE.kill });
      if (info.kind === 'head') awards.push({ label: 'headshot', value: SCORE.headshot });
      if (info.kind === 'groin') awards.push({ label: 'groin', value: SCORE.groin });
      if (info.kind === 'knife') awards.push({ label: 'knife', value: SCORE.knife });
      if (info.kind === 'knife' && info.behind) awards.push({ label: 'backstab', value: SCORE.backstab });
      if (info.dist && info.dist > SCORE.longShotDistance) awards.push({ label: 'longShot', value: SCORE.longShot });
      const ks = this.score(killer);
      ks.kills++;
      ks.score += awards.reduce((s, a) => s + a.value, 0);
      if (killer instanceof Bot) killer.notifyKill(this.time);
    }
    const p = victim.position;
    const yaw = victim instanceof Bot ? victim.yaw : (victim as Combatant & { yaw?: number }).yaw ?? 0;
    const corpse = new Corpse(
      { id: this.nextCorpse++, victim: victim.id, name: victim.name, sex: victim.sex, ap: victim.look, p: [p.x, p.y, p.z], yaw, until: this.time + HUMILIATION.window },
      this.o.player.id,
      this.o.scene,
      groundBelow(this.o.physics.world, [p.x, p.y, p.z]),
      {
        now: () => this.time,
        // The local player dancing: points when the dance completes.
        finish: (c) => this.finishTaunt(this.o.player, c),
      },
    );
    this.corpses.set(corpse.info.id, corpse);
    if (victim instanceof Bot) victim.die(this.time);
    this.o.hooks.kill(victim, killer && killer !== victim ? killer : null, info.kind, awards, corpse);
  }

  private finishTaunt(dancer: Combatant, corpse: Corpse) {
    corpse.markHumiliated();
    const s = this.score(dancer);
    s.humiliations++;
    s.score += SCORE.humiliation;
    this.o.hooks.humiliation(dancer, corpse, [{ label: 'humiliation', value: SCORE.humiliation }]);
  }

  private fire(bot: Bot, spread: number) {
    this.unprotect(bot);
    const eye = bot.eye(new THREE.Vector3());
    const p = bot.pitch + bot.weapon.recoilPitch * DEG;
    const y = bot.yaw - bot.weapon.recoilYaw * DEG;
    const aim = new THREE.Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    const dir = applySpread(aim, spread, new THREE.Vector3());
    const { hit, through, keep, end } = traceShot(this.o.physics, this.o.registry, eye, dir, RIFLE.alcanceMaximo, bot.rig.body, RIFLE.penetracao);
    const muzzle = bot.muzzle(new THREE.Vector3());
    bot.fired();
    const listener = this.o.listener();
    const dist = listener.distanceTo(muzzle);
    this.o.sfx.gunshot(Math.min(0.8, 10 / (dist + 6)));
    if (Math.random() < 0.5) this.o.effects.tracer(muzzle, end);
    for (const p of through) {
      this.o.effects.decal(p.point, p.normal);
      this.o.effects.decal(p.exit, p.exitNormal);
      this.o.effects.burst('debris', p.exit, dir, 3, 0x9a6a3a);
      if (dist < 30) this.o.sfx.impact(p.surface.material);
      p.surface.onShot?.(p.point);
    }
    if (!hit) return;
    if (hit.target) {
      const victim = hit.target.entity as Combatant;
      if (!('id' in victim)) return; // dummies aren't in bot matches
      const region = victim.refineRegion(hit.point, hit.target.region);
      const kind: KillKind = region === 'cabeca' ? 'head' : region === 'virilha' ? 'groin' : 'gun';
      this.o.effects.burst(region === 'cabeca' || region === 'virilha' ? 'star' : 'confetti', hit.point, dir.clone().negate(), 6);
      this.hit(victim, bot, computeDamage(RIFLE, hit.distance, region, keep), { kind, region, dist: hit.distance });
    } else {
      this.o.effects.decal(hit.point, hit.normal);
      this.o.effects.burst('debris', hit.point, hit.normal, 3, 0x9a8f80);
      if (hit.surface && dist < 30) this.o.sfx.impact(hit.surface.material);
      hit.surface?.onShot?.(hit.point);
    }
  }

  private stab(bot: Bot, target: Combatant) {
    const d = Math.hypot(target.position.x - bot.position.x, target.position.z - bot.position.z);
    if (d > MELEE.faca.alcance + 0.4) return;
    const eye = bot.eye(new THREE.Vector3());
    if (this.o.listener().distanceTo(eye) < 15) this.o.sfx.knifeHit();
    this.o.effects.burst('star', target.position.clone().setY(target.position.y + 1.1), UP, 10);
    this.hit(target, bot, LETHAL_DAMAGE, { kind: 'knife', behind: target.isBehind(eye) });
  }

  // --- Tick ---------------------------------------------------------------------------------------------

  fixedUpdate(dt: number, time: number) {
    this.time = time;
    for (const b of this.bots) {
      if (b.dead) {
        if (time - b.deathAt >= RESPAWN) {
          b.spawn(this.pickSpawn(b));
          this.protect(b);
        }
        continue;
      }
      // Same regeneration rule as players.
      if (b.health < b.bodyStats.maxHealth && time - b.lastDamageAt > 4) b.health = Math.min(b.bodyStats.maxHealth, b.health + 25 * dt);
      b.fixedUpdate(dt, this.world);
      if (b.position.y < -20) this.kill(b, null, { kind: 'void' });
    }
  }

  render(alpha: number, dt: number) {
    const blink = Math.floor(performance.now() / 90) % 2 === 0;
    for (const b of this.bots) {
      b.render(alpha, dt);
      // Spawn-protected bots blink.
      if (!b.dead && this.isProtected(b)) b.setBlink(blink);
      else b.setBlink(true);
    }
    for (const [id, c] of this.corpses) {
      c.render(dt);
      if (c.gone) {
        c.dispose();
        this.corpses.delete(id);
      }
    }
  }

  setDebug(v: boolean) {
    for (const b of this.bots) b.setDebug(v);
  }
}
