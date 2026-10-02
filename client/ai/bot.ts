// A bot is a player driven by code (section 14: "Bots com navmesh e árvore de comportamento simples").
// It uses exactly what a human uses: the shared movement step, a Weapon (fire rate, spread, recoil), the
// same hitboxes and avatar. Only the decisions are artificial:
//
//   perceive  field of view + line of sight; remembers where it last saw each enemy; turns to face whoever
//             shoots it
//   roam      walk/sprint to random points of the navmesh
//   engage    reaction delay, aim that converges on the target (turn speed + tracking error), bursts to
//             control recoil, strafing, keeps a preferred distance, knife when very close
//   chase     go to the last known position, then give up
//   flee      low health: run away while health regenerates
//   taunt     after a kill, sometimes walk to the corpse and dance (vulnerable, like a human)
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, HEALTH, HUMILIATION, MOVE } from '@shared/constants';
import { configureController, CONTROLLER_OFFSET, createMoveState, eyeHeight, HALF_STAND, stepMovement, type MoveBody, type MoveInput, type MoveState } from '@shared/movement';
import { MELEE, WEAPONS, type HitRegion } from '@shared/weapons';
import type { Sex } from '@shared/protocol';
import { bodyStats, randomAppearance, type Appearance, type BodyStats } from '@shared/appearance';
import { Avatar } from '../entities/avatar';
import { isBehind } from '../entities/hitboxes';
import { CharacterRig, type HitPose } from '../entities/rig';
import type { HitboxRegistry, Target } from '../gameplay/targets';
import type { Corpse } from '../gameplay/corpse';
import { Weapon } from '../weapons/weapon';
import type { SpawnPoint } from '../world/blockoutMap';
import type { NavMap } from './navmesh';

const PLAYER_GROUPS = groups(GROUP.PLAYER, GROUP.WORLD | GROUP.BLOCKER);
const LOS_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);
const DEG = Math.PI / 180;

/** Anything that fights: bots and the local player. */
export interface Combatant extends Target {
  readonly id: number;
  readonly sex: Sex;
  /** How the character looks (bodies keep it). */
  readonly look: Appearance;
  eye(out: THREE.Vector3): THREE.Vector3;
}

export interface BotSkill {
  /** Seconds between spotting a target and the first shot. */
  reaction: number;
  /** Max aim turn speed (rad/s). */
  turnSpeed: number;
  /** Aim wobble (rad) right after acquiring a target; shrinks while tracking. */
  aimError: number;
  /** Fraction of the weapon's recoil the bot pulls down. */
  recoilControl: number;
  /** Trigger held (s) and pause between bursts (s). */
  burst: [number, number];
  pause: [number, number];
  headshotChance: number;
  /** Field of view (rad). */
  fov: number;
  tauntChance: number;
}

export type BotSkillName = 'facil' | 'normal' | 'dificil';

export const BOT_SKILLS: Record<BotSkillName, BotSkill> = {
  facil: { reaction: 0.55, turnSpeed: 2.6, aimError: 6 * DEG, recoilControl: 0.3, burst: [0.2, 0.35], pause: [0.45, 0.8], headshotChance: 0.05, fov: 100 * DEG, tauntChance: 0.35 },
  normal: { reaction: 0.35, turnSpeed: 4.2, aimError: 3.5 * DEG, recoilControl: 0.6, burst: [0.3, 0.5], pause: [0.3, 0.55], headshotChance: 0.15, fov: 115 * DEG, tauntChance: 0.5 },
  dificil: { reaction: 0.2, turnSpeed: 6.5, aimError: 1.8 * DEG, recoilControl: 0.85, burst: [0.45, 0.7], pause: [0.2, 0.35], headshotChance: 0.3, fov: 130 * DEG, tauntChance: 0.65 },
};

/** What the manager offers a bot each tick. */
export interface BotWorld {
  time: number;
  physics: { world: RAPIER.World };
  nav: NavMap;
  combatants(): Combatant[];
  corpses(): Iterable<Corpse>;
  /** Resolve one bullet fired by `bot` (spread in radians). */
  fire(bot: Bot, spread: number): void;
  stab(bot: Bot, target: Combatant): void;
  tauntStarted(bot: Bot, corpse: Corpse): void;
  tauntFinished(bot: Bot, corpse: Corpse): void;
}

type Mode = 'roam' | 'engage' | 'chase' | 'flee' | 'toTaunt' | 'taunt';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const angleDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function nameplate(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = '800 28px Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.fillStyle = '#ff8a80';
  g.strokeText(name, 128, 24);
  g.fillText(name, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.3, 0.24, 1);
  s.position.y = 2.15;
  return s;
}

export class Bot implements Combatant {
  health: number = HEALTH.max;
  dead = true;
  deathAt = -99;
  lastDamageAt = -99;
  lastAttacker: Combatant | null = null;
  lastAttackedAt = -99;
  /** Aim (view) angles, same convention as the player camera. */
  yaw = 0;
  pitch = 0;
  readonly weapon: Weapon;
  readonly rig: CharacterRig;
  readonly mb: MoveBody;
  readonly move: MoveState = createMoveState();
  /** Every bot gets a random look, with the same game effects as a player's (health, speed, reload). */
  readonly look: Appearance;
  readonly bodyStats: BodyStats;
  private avatar: Avatar;
  private plate: THREE.Sprite;
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3(0, -100, 0);

  // Brain.
  private mode: Mode = 'roam';
  target: Combatant | null = null;
  private targetVisible = false;
  private lastSeenPos = new THREE.Vector3();
  private lastSeenAt = -99;
  private reactionLeft = 0;
  private aimNoise = new THREE.Vector2();
  private aimHead = false;
  private thinkT = Math.random() * 0.15;
  private goal: THREE.Vector3 | null = null;
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private repathAt = 0;
  private stuckCheckAt = 0;
  private stuckFrom = new THREE.Vector3();
  private stuckCount = 0;
  private jumpNext = false;
  private strafeSign = 1;
  private strafeUntil = 0;
  private crouchUntil = 0;
  private fleeUntil = 0;
  private lastFleeAt = -99;
  private burstLeft = 0;
  private pauseLeft = 0;
  private knifeCooldown = 0;
  private knifeAnim = 0;
  private lastKillAt = -99;
  private tauntCorpse: Corpse | null = null;
  tauntT = 0;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(
    readonly id: number,
    readonly name: string,
    readonly sex: Sex,
    readonly skill: BotSkill,
    world: RAPIER.World,
    private scene: THREE.Scene,
    registry: HitboxRegistry,
  ) {
    this.look = randomAppearance(sex);
    this.bodyStats = bodyStats(this.look);
    this.health = this.bodyStats.maxHealth;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(HALF_STAND, MOVE.radius).setCollisionGroups(PLAYER_GROUPS), body);
    const controller = world.createCharacterController(CONTROLLER_OFFSET);
    configureController(controller);
    this.rig = new CharacterRig(world, this, registry, this.bodyStats.missing);
    this.mb = { world, body, collider, controller, ignoreBody: this.rig.body };
    this.weapon = new Weapon(WEAPONS.rifle_padrao, {
      shoot: (spread) => this.onShoot?.(spread),
      dryFire: () => {},
      reloadStart: () => {},
      reloadEnd: () => {},
    });
    this.weapon.reloadMul = this.bodyStats.reloadMul;
    this.avatar = new Avatar(scene, this.look, sex);
    this.plate = nameplate(name);
    this.plate.position.y *= this.bodyStats.visualScale;
    this.avatar.root.add(this.plate, this.rig.debug);
  }

  /** Set by the manager: resolves the bullet (needs the world services). */
  onShoot: ((spread: number) => void) | null = null;

  get position(): THREE.Vector3 {
    return this.curr;
  }

  get alive() {
    return !this.dead;
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.curr.x, this.curr.y + eyeHeight(this.move), this.curr.z);
  }

  refineRegion(point: THREE.Vector3, region: HitRegion): HitRegion {
    return this.rig.refineRegion(point, region);
  }

  isBehind(point: THREE.Vector3): boolean {
    return isBehind(point, this.curr, this.yaw);
  }

  setDebug(v: boolean) {
    this.rig.setDebug(v);
  }

  /** Spawn-protection blink (visibility of the body only). */
  setBlink(visible: boolean) {
    if (!this.dead) this.avatar.visible = visible;
  }

  // --- Life cycle ---------------------------------------------------------------------------------------

  spawn(sp: SpawnPoint) {
    const c = { x: sp.position.x, y: sp.position.y + HALF_STAND, z: sp.position.z };
    if (this.move.crouched) this.mb.collider.setHalfHeight(HALF_STAND);
    this.mb.body.setTranslation(c, true);
    this.mb.body.setNextKinematicTranslation(c);
    this.mb.collider.setTranslation(c);
    Object.assign(this.move, createMoveState(), { airPeakY: sp.position.y });
    this.curr.set(sp.position.x, sp.position.y, sp.position.z);
    this.prev.copy(this.curr);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.health = this.bodyStats.maxHealth;
    this.dead = false;
    this.weapon.refill();
    this.mode = 'roam';
    this.target = null;
    this.goal = null;
    this.path = [];
    this.tauntCorpse = null;
    this.lastAttacker = null;
  }

  die(time: number) {
    this.dead = true;
    this.deathAt = time;
    this.health = 0;
    if (this.tauntCorpse && this.tauntCorpse.claimedBy === this.id) this.tauntCorpse.claimedBy = null;
    this.tauntCorpse = null;
    this.mode = 'roam';
    this.rig.follow(this.curr, this.yaw, false, this.currentPose(), 0);
    this.avatar.visible = false;
  }

  notifyKill(time: number) {
    this.lastKillAt = time;
  }

  get dancing() {
    return this.mode === 'taunt';
  }

  // --- Brain --------------------------------------------------------------------------------------------

  private visibleFrom(eye: THREE.Vector3, c: Combatant, headToo: boolean): boolean {
    const check = (h: number) => {
      this.tmp2.copy(c.position).setY(c.position.y + h);
      const d = this.tmp2.sub(eye);
      const len = d.length();
      if (len < 0.01) return true;
      d.divideScalar(len);
      const hit = this.mb.world.castRay(new RAPIER.Ray(eye, d), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, LOS_GROUPS);
      return !hit || hit.timeOfImpact > len - 0.3;
    };
    return check(1.15) || (headToo && check(1.6));
  }

  private perceive(w: BotWorld) {
    const eye = this.eye(this.tmp.clone());
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const c of w.combatants()) {
      if (c === this || c.dead) continue;
      const dx = c.position.x - eye.x;
      const dz = c.position.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 75) continue;
      const attackedByIt = c === this.lastAttacker && w.time - this.lastAttackedAt < 2;
      // Outside the field of view you're only noticed very close, or if you just shot this bot.
      const inFov = dist < 0.01 || Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / dist))) < this.skill.fov / 2;
      if (!inFov && !attackedByIt && dist > 4) continue;
      if (!this.visibleFrom(eye, c, true)) continue;
      const score = dist * (c === this.target ? 0.6 : 1) * (attackedByIt ? 0.5 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Shot by someone it can't see: turn toward them.
    if (!best && this.lastAttacker && !this.lastAttacker.dead && w.time - this.lastAttackedAt < 0.3) {
      this.lastSeenPos.copy(this.lastAttacker.position);
      this.lastSeenAt = w.time;
      this.target = this.lastAttacker;
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        // New target (or reacquired): react, and start with a wide aim error that tightens.
        this.reactionLeft = this.skill.reaction * rand(0.8, 1.3) * (best === this.target ? 0.5 : 1);
        this.aimNoise.set(rand(-1, 1), rand(-1, 1)).multiplyScalar(this.skill.aimError * 1.6);
        this.aimHead = Math.random() < this.skill.headshotChance;
      }
      this.target = best;
      this.targetVisible = true;
      this.lastSeenPos.copy(best.position);
      this.lastSeenAt = w.time;
    } else {
      this.targetVisible = false;
      if (this.target?.dead) this.target = null;
    }
  }

  private decide(w: BotWorld) {
    if (this.mode === 'taunt') return;
    const t = w.time;
    if (this.targetVisible && this.target) {
      const dist = this.target.position.distanceTo(this.curr);
      if (this.health < 35 && t - this.lastFleeAt > 8 && dist > 5) {
        this.mode = 'flee';
        this.lastFleeAt = t;
        this.fleeUntil = t + rand(2, 3.5);
        const away = this.tmp.subVectors(this.curr, this.target.position).setY(0).normalize().multiplyScalar(14).add(this.curr);
        this.setGoal(w, w.nav.randomAround(away, 5) ?? w.nav.randomPoint());
      } else if (this.mode !== 'flee' || t > this.fleeUntil) {
        this.mode = 'engage';
      }
      return;
    }
    if (this.mode === 'flee' && t < this.fleeUntil) return;
    if (this.target && t - this.lastSeenAt < 5) {
      if (this.mode !== 'chase') {
        this.mode = 'chase';
        this.setGoal(w, this.lastSeenPos.clone());
      }
      return;
    }
    this.target = null;
    // Recent kill and a fresh corpse nearby: go dance on it (sometimes).
    if (this.mode !== 'toTaunt' && t - this.lastKillAt < 6) {
      for (const c of w.corpses()) {
        const center = c.corpseCenter(new THREE.Vector3());
        if (c.availableTo(this.id) && center.distanceTo(this.curr) < 22 && c.humiliationTimeLeft() > 2.5) {
          this.lastKillAt = -99;
          if (Math.random() < this.skill.tauntChance) {
            this.mode = 'toTaunt';
            this.tauntCorpse = c;
            this.setGoal(w, center);
            return;
          }
        }
      }
    }
    if (this.mode === 'toTaunt') {
      const c = this.tauntCorpse;
      if (!c || !c.availableTo(this.id)) this.mode = 'roam';
      else return;
    }
    if (this.mode !== 'roam') {
      this.mode = 'roam';
      this.goal = null;
    }
    if (!this.goal || this.pathIdx >= this.path.length) this.setGoal(w, w.nav.randomPoint());
  }

  private setGoal(w: BotWorld, goal: THREE.Vector3 | null) {
    this.goal = goal;
    this.path = [];
    this.pathIdx = 0;
    if (!goal) return;
    const p = w.nav.path(this.curr, goal);
    if (p) {
      this.path = p;
      this.pathIdx = 1;
    }
    this.repathAt = w.time + 1;
  }

  /** Horizontal unit direction toward the next path corner, or null when arrived. */
  private followPath(): THREE.Vector3 | null {
    while (this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const d = new THREE.Vector3(wp.x - this.curr.x, 0, wp.z - this.curr.z);
      if (d.length() > 0.45) return d.normalize();
      this.pathIdx++;
    }
    return null;
  }

  // --- Tick ---------------------------------------------------------------------------------------------

  fixedUpdate(dt: number, w: BotWorld) {
    this.prev.copy(this.curr);
    if (this.dead) return;
    const t = w.time;

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.12;
      this.perceive(w);
      this.decide(w);
    }
    this.reactionLeft -= dt;
    this.knifeCooldown -= dt;
    this.knifeAnim -= dt;

    // Where to move, and where to look.
    let moveDir: THREE.Vector3 | null = null;
    let sprint = false;
    let ads = false;
    let lookAt: THREE.Vector3 | null = null;
    const target = this.target;
    const engaging = this.mode === 'engage' && target && this.targetVisible;

    if (this.mode === 'taunt') {
      this.tauntT += dt;
      if (this.tauntT >= HUMILIATION.duration && this.tauntCorpse) {
        const c = this.tauntCorpse;
        this.tauntCorpse = null;
        this.mode = 'roam';
        this.goal = null;
        w.tauntFinished(this, c);
      }
    } else if (engaging && target) {
      const dist = target.position.distanceTo(this.curr);
      lookAt = this.tmp2.copy(target.position).setY(target.position.y + (this.aimHead ? 1.6 : 1.15));
      if (dist < 2.2 && this.knifeCooldown <= 0) {
        this.knifeCooldown = MELEE.faca.intervalo + 0.3;
        this.knifeAnim = 0.35;
        w.stab(this, target);
      }
      const toTarget = new THREE.Vector3(target.position.x - this.curr.x, 0, target.position.z - this.curr.z).normalize();
      if (t > this.strafeUntil) {
        this.strafeSign = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + rand(0.5, 1.4);
        if (Math.random() < 0.18) this.crouchUntil = t + rand(0.6, 1.4);
      }
      const side = new THREE.Vector3(-toTarget.z, 0, toTarget.x).multiplyScalar(this.strafeSign);
      if (dist > 24) {
        // Close the distance along the navmesh.
        if (t > this.repathAt) this.setGoal(w, target.position.clone());
        moveDir = this.followPath() ?? toTarget;
      } else if (dist < 3.5) {
        moveDir = toTarget.clone().add(side.multiplyScalar(0.5)).normalize(); // rush for the knife
      } else if (dist < 7) {
        moveDir = toTarget.clone().negate().add(side).normalize();
      } else {
        moveDir = side;
      }
      ads = dist > 12;
    } else {
      if (this.mode === 'toTaunt' && this.tauntCorpse) {
        const c = this.tauntCorpse;
        const center = c.corpseCenter(new THREE.Vector3());
        if (Math.hypot(center.x - this.curr.x, center.z - this.curr.z) < 1.2 && c.availableTo(this.id)) {
          c.claimedBy = this.id;
          this.mode = 'taunt';
          this.tauntT = 0;
          w.tauntStarted(this, c);
        }
      }
      if (this.mode !== 'taunt') {
        moveDir = this.followPath();
        if (!moveDir && this.mode === 'chase') {
          // Reached the last known spot and nobody's there: look around, then roam.
          this.lastSeenAt = Math.min(this.lastSeenAt, t - 4);
        }
        const remaining = this.path.length ? this.path[this.path.length - 1].distanceTo(this.curr) : 0;
        sprint = (this.mode === 'roam' || this.mode === 'flee') && remaining > 8;
        if (this.mode === 'chase' && this.target) lookAt = this.tmp2.copy(this.lastSeenPos).setY(this.lastSeenPos.y + 1.3);
      }
    }

    // Stuck: jump, then re-path, then give up on this goal.
    if (t > this.stuckCheckAt) {
      const wantsToMove = !!moveDir && this.mode !== 'taunt';
      if (wantsToMove && this.stuckFrom.distanceTo(this.curr) < 0.35) {
        this.stuckCount++;
        this.jumpNext = true;
        if (this.stuckCount >= 2 && this.goal) this.setGoal(w, this.goal);
        if (this.stuckCount >= 4) {
          this.setGoal(w, w.nav.randomPoint());
          this.stuckCount = 0;
        }
      } else {
        this.stuckCount = 0;
      }
      this.stuckFrom.copy(this.curr);
      this.stuckCheckAt = t + 0.8;
    }

    // Aim: turn toward the target (or along the path), limited by turn speed, with a wobble that tightens
    // while tracking; pull recoil down according to skill.
    this.aimNoise.multiplyScalar(Math.exp(-1.2 * dt));
    const eye = this.eye(new THREE.Vector3());
    let wantYaw = this.yaw;
    let wantPitch = 0;
    if (lookAt) {
      const d = new THREE.Vector3().subVectors(lookAt, eye);
      wantYaw = Math.atan2(-d.x, -d.z) + this.aimNoise.x;
      wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + this.aimNoise.y - this.weapon.recoilPitch * DEG * this.skill.recoilControl;
    } else if (moveDir) {
      wantYaw = Math.atan2(-moveDir.x, -moveDir.z);
    }
    const maxTurn = this.skill.turnSpeed * dt;
    const dy = angleDiff(this.yaw, wantYaw);
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    this.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - this.pitch));
    const aimError = Math.abs(dy) + Math.abs(wantPitch - this.pitch);

    // Movement through the shared step (same physics as the player).
    const f = -Math.sin(this.yaw);
    const r = -Math.cos(this.yaw);
    const input: MoveInput = {
      forward: moveDir ? moveDir.x * f + moveDir.z * r : 0,
      right: moveDir ? moveDir.x * Math.cos(this.yaw) - moveDir.z * Math.sin(this.yaw) : 0,
      jump: this.jumpNext,
      crouch: engaging ? t < this.crouchUntil : false,
      sprint: sprint && this.mode !== 'taunt',
      ads,
      yaw: this.yaw,
      speedMul: this.weapon.data.movimento * this.bodyStats.speedMul,
      lunge: null,
    };
    this.jumpNext = false;
    stepMovement(this.mb, this.move, input, dt);
    const tr = this.mb.body.nextTranslation();
    const half = this.move.crouched ? this.mb.collider.halfHeight() : HALF_STAND;
    this.curr.set(tr.x, tr.y - half, tr.z);
    this.rig.follow(this.curr, this.yaw, true, this.currentPose(), dt);

    // Trigger: after the reaction delay, when on target, in bursts.
    let fire = false;
    if (engaging && this.reactionLeft <= 0 && this.knifeAnim <= 0) {
      const dist = target!.position.distanceTo(this.curr);
      const cone = 2.5 * DEG + 0.6 / Math.max(3, dist);
      if (this.pauseLeft > 0) this.pauseLeft -= dt;
      else if (aimError < cone) {
        if (this.burstLeft <= 0) this.burstLeft = rand(...this.skill.burst) * (dist < 10 ? 1.8 : 1);
        this.burstLeft -= dt;
        fire = true;
        if (this.burstLeft <= 0) this.pauseLeft = rand(...this.skill.pause);
      }
    }
    const reload = this.weapon.mag === 0 || (!this.targetVisible && this.weapon.mag < 12 && !this.weapon.reloading);
    this.weapon.update(dt, {
      fireHeld: fire,
      firePressed: false,
      adsHeld: ads,
      reloadPressed: reload,
      sprinting: this.move.sprinting,
      grounded: this.move.grounded,
      crouched: this.move.crouched,
      speed: Math.hypot(this.move.vel.x, this.move.vel.z),
    });
  }

  render(alpha: number, dt: number) {
    this.avatar.visible = !this.dead;
    if (this.dead) return;
    this.avatar.root.position.lerpVectors(this.prev, this.curr, alpha);
    this.avatar.root.rotation.y = this.yaw;
    const pose = this.currentPose();
    if (pose.kind === 'dance') this.avatar.dance(pose.t);
    else if (pose.kind === 'armed') this.avatar.pose(dt, pose.pose);
  }

  /** What the body is doing: the avatar plays it and the hitboxes follow it. */
  private currentPose(): HitPose {
    if (this.mode === 'taunt') return { kind: 'dance', t: this.tauntT };
    return {
      kind: 'armed',
      pose: {
        speed: Math.hypot(this.move.vel.x, this.move.vel.z),
        vel: { x: this.move.vel.x, z: this.move.vel.z },
        yaw: this.yaw,
        grounded: this.move.grounded,
        sprint: this.move.sprinting,
        crouch: this.move.crouched,
        slide: this.move.sliding,
        pitch: this.pitch,
        ads: this.weapon.ads > 0.5,
        reload: this.weapon.reloading,
        knife: this.knifeAnim > 0,
        cook: false,
      },
    };
  }

  /** A shot: recoil on the avatar. */
  fired() {
    this.avatar.fire();
  }

  /** Hit by a bullet from `from`: the torso jerks. */
  hitReact(from: THREE.Vector3) {
    this.avatar.hitReact(from);
  }

  /** Approximate muzzle position (tracers). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * 0.6, 1.4, -Math.cos(this.yaw) * 0.6).add(this.curr);
  }

  dispose() {
    this.mb.world.removeRigidBody(this.mb.body);
    this.rig.dispose();
    this.scene.remove(this.avatar.root);
  }
}
