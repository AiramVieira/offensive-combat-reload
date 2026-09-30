// Local player: Rapier kinematic capsule driven by the shared movement step, plus health rules (section 6).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, HEALTH, MOVE } from '@shared/constants';
import { configureController, CONTROLLER_OFFSET, createMoveState, eyeHeight, feetY, HALF_STAND, stepMovement, type MoveBody, type MoveInput, type MoveState } from '@shared/movement';
import type { Physics, SurfaceMaterial } from '../world/physics';
import type { SpawnPoint } from '../world/blockoutMap';

const PLAYER_GROUPS = groups(GROUP.PLAYER, GROUP.WORLD | GROUP.BLOCKER);
const GROUND_PROBE_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);
const RESPAWN_DELAY = 3;

export type DeathCause = 'fall' | 'void' | 'explosion' | 'dog' | 'killed';

export interface PlayerEvents {
  jumped: boolean;
  landed: boolean;
  fallHeight: number;
  damaged: number;
  footstep: number; // 0 = none, otherwise loudness
  died: DeathCause | null;
  /** Online: damage the server should apply to us (fall / out of the map). */
  selfDamage: { amount: number; cause: 'fall' | 'void' } | null;
}

export class LocalPlayer {
  yaw = 0;
  pitch = 0;
  health: number = HEALTH.max;
  /** From the character's build (heavier bodies have more health). */
  maxHealth: number = HEALTH.max;
  /** From the character's height: the eye (and the view) sits higher or lower. */
  eyeScale = 1;
  dead = false;
  deathAt = 0;
  lastDamageAt = -99;
  readonly move: MoveState = createMoveState();
  readonly mb: MoveBody;
  private prevEye = new THREE.Vector3();
  private currEye = new THREE.Vector3();
  private stride = 0;
  /** Online: the server owns health and death; the player only reports self damage. */
  netControlled = false;
  respawnDelay = RESPAWN_DELAY;
  private voidReported = false;

  constructor(private physics: Physics, private killY: number) {
    const world = physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(HALF_STAND, MOVE.radius).setCollisionGroups(PLAYER_GROUPS), body);
    const controller = world.createCharacterController(CONTROLLER_OFFSET);
    configureController(controller);
    this.mb = { world, body, collider, controller };
  }

  spawn(sp: SpawnPoint) {
    const c = { x: sp.position.x, y: sp.position.y + HALF_STAND, z: sp.position.z };
    if (this.move.crouched) this.mb.collider.setHalfHeight(HALF_STAND);
    this.mb.body.setTranslation(c, true);
    this.mb.body.setNextKinematicTranslation(c);
    this.mb.collider.setTranslation(c);
    Object.assign(this.move, createMoveState(), { airPeakY: sp.position.y });
    this.pendingDeath = null;
    this.voidReported = false;
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.dead = false;
    this.snapshotEye();
    this.prevEye.copy(this.currEye);
  }

  get feet(): number {
    return feetY(this.mb, this.move);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.move.vel.x, this.move.vel.z);
  }

  /** Lateral velocity relative to the view (positive = moving right). */
  get strafeSpeed(): number {
    return this.move.vel.x * Math.cos(this.yaw) - this.move.vel.z * Math.sin(this.yaw);
  }

  private pendingDeath: DeathCause | null = null;

  /** Applies damage; `cause` is reported as the death reason on the next tick if this kills. */
  damage(amount: number, time: number, cause: DeathCause | null = null): number {
    if (this.dead || amount <= 0) return 0;
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    this.lastDamageAt = time;
    if (this.health <= 0 && cause) this.pendingDeath = cause;
    return dealt;
  }

  fixedStep(dt: number, input: MoveInput, time: number): PlayerEvents {
    const ev: PlayerEvents = { jumped: false, landed: false, fallHeight: 0, damaged: 0, footstep: 0, died: null, selfDamage: null };
    this.prevEye.copy(this.currEye);
    if (this.dead) return ev;

    stepMovement(this.mb, this.move, input, dt);
    ev.jumped = this.move.jumped;
    ev.landed = this.move.landed;
    ev.fallHeight = this.move.fallHeight;

    // Fall damage above 6 m (section 4).
    if (ev.landed && ev.fallHeight > MOVE.fallDamageHeight) {
      const amount = Math.round((ev.fallHeight - MOVE.fallDamageHeight) * MOVE.fallDamagePerMeter + 10);
      if (this.netControlled) ev.selfDamage = { amount, cause: 'fall' };
      else {
        ev.damaged = this.damage(amount, time);
        if (this.health <= 0) ev.died = 'fall';
      }
    }

    // Footsteps: stride length scales with speed; crouch-walking is silent.
    const speed = this.horizontalSpeed;
    if (this.move.grounded && speed > 1) {
      this.stride += speed * dt;
      const strideLen = this.move.sprinting ? 2.6 : 2.0;
      if (this.stride >= strideLen) {
        this.stride = 0;
        ev.footstep = this.move.crouched ? 0 : this.move.sprinting ? 1.3 : 0.8;
      }
    }

    // Regeneration: 25 HP/s after 4 s without damage (online the server regenerates and syncs it).
    if (!this.netControlled && this.health < this.maxHealth && time - this.lastDamageAt > HEALTH.regenDelay) {
      this.health = Math.min(this.maxHealth, this.health + HEALTH.regenPerSecond * dt);
    }

    if (this.pendingDeath && !ev.died) ev.died = this.pendingDeath;
    this.pendingDeath = null;
    if (this.feet < this.killY && !ev.died) {
      if (this.netControlled) {
        if (!this.voidReported) ev.selfDamage = { amount: 9999, cause: 'void' };
        this.voidReported = true;
      } else {
        this.health = 0;
        ev.died = 'void';
      }
    }
    if (ev.died) {
      this.dead = true;
      this.deathAt = time;
    }
    this.snapshotEye(true);
    return ev;
  }

  canRespawn(time: number) {
    return this.dead && time - this.deathAt >= this.respawnDelay;
  }

  respawnIn(time: number) {
    return Math.max(0, this.respawnDelay - (time - this.deathAt));
  }

  /** Thrown by the world (hydrant): sets the velocity and leaves the ground; air rules keep the push. */
  launch(vx: number, vy: number, vz: number) {
    if (this.dead) return;
    const v = this.move.vel;
    v.x += vx;
    v.y = Math.max(v.y, vy);
    v.z += vz;
    this.move.grounded = false;
    this.move.sliding = false;
    this.move.airPeakY = this.feet;
  }

  /** Server-decided death (online). */
  kill(time: number) {
    if (this.dead) return;
    this.dead = true;
    this.deathAt = time;
    this.health = 0;
  }

  /** Eye position after the pending kinematic move of this tick. */
  private snapshotEye(pending = false) {
    const t = pending ? this.mb.body.nextTranslation() : this.mb.body.translation();
    const half = this.move.crouched ? this.mb.collider.halfHeight() : HALF_STAND;
    this.currEye.set(t.x, t.y - half + eyeHeight(this.move) * this.eyeScale, t.z);
  }

  eye(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prevEye, this.currEye, alpha);
  }

  groundMaterial(): SurfaceMaterial {
    const t = this.mb.body.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: this.feet + 0.1, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, 0.5, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, GROUND_PROBE_GROUPS);
    return (hit && this.physics.surfaces.get(hit.collider.handle)?.material) || 'concrete';
  }
}
