// A killed character's body (section 8): falls to the floor, shows the humiliation countdown, can be danced
// on once, then sinks away. Used online (the server arbitrates through the hooks) and offline against bots
// (everything local).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, HUMILIATION, MOVE } from '@shared/constants';
import type { Vec3 } from '@shared/protocol';
import { defaultAppearance, type Appearance } from '@shared/appearance';
import { Avatar } from '../entities/avatar';
import { CorpseTimer } from '../ui/corpseTimer';
import type { Humiliable } from './targets';
import type { Sex } from '@shared/protocol';

const UP = new THREE.Vector3(0, 1, 0);
const WORLD_ONLY = groups(GROUP.BULLET, GROUP.WORLD);

export interface CorpseData {
  id: number;
  /** Id of the character who died (the local player's id when it's our own body). */
  victim: number;
  name: string;
  /** Body type of whoever died (masculino / feminino). */
  sex?: Sex;
  /** How they looked: the body keeps it. */
  ap?: Appearance;
  /** Feet position at the moment of death (may be mid-air). */
  p: Vec3;
  yaw: number;
  /** When the humiliation window closes, in the hooks' clock (seconds). */
  until: number;
}

export interface CorpseHooks {
  /** Current time in seconds, same clock as `until`. */
  now(): number;
  /** The local player started / abandoned / finished dancing on this corpse. */
  claim?(c: Corpse): void;
  release?(c: Corpse): void;
  finish?(c: Corpse): void;
}

/** Floor height under a point (the point itself if there is none, e.g. falling out of the map). */
export function groundBelow(world: RAPIER.World, p: Vec3): number {
  const hit = world.castRay(new RAPIER.Ray({ x: p[0], y: p[1] + 0.3, z: p[2] }, { x: 0, y: -1, z: 0 }), 80, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
  return hit ? p[1] + 0.3 - hit.timeOfImpact : p[1];
}

export class Corpse implements Humiliable {
  humiliated = false;
  /** Id of whoever is dancing on it right now. */
  claimedBy: number | null = null;
  gone = false;
  private avatar: Avatar;
  private timer = new CorpseTimer();
  private age = 0;
  private doneAt: number | null = null;
  /** Current height of the body: it falls from where the character died down to `groundY`. */
  private y: number;
  private fallV = 0;

  constructor(
    readonly info: CorpseData,
    /** Id of the local player: their own corpse shows no countdown and can't be self-humiliated. */
    private me: number,
    private scene: THREE.Scene,
    private groundY: number,
    private hooks: CorpseHooks,
  ) {
    this.y = info.p[1];
    this.avatar = new Avatar(scene, info.ap ?? defaultAppearance(info.sex ?? 'm'), info.sex ?? 'm');
    this.avatar.root.position.set(...info.p);
    this.avatar.root.rotation.y = info.yaw;
    this.avatar.visible = true;
    this.avatar.root.add(this.timer.sprite);
    this.timer.sprite.position.set(0, 0.85, 0.9);
  }

  get name() {
    return this.info.name;
  }

  private get left() {
    return this.info.until - this.hooks.now();
  }

  /** Can the local player start dancing on it? */
  canHumiliate(): boolean {
    return this.availableTo(this.me);
  }

  /** Can character `id` start dancing on it (bots use this too)? */
  availableTo(id: number): boolean {
    return !this.humiliated && this.claimedBy === null && this.left > 0 && this.info.victim !== id;
  }

  humiliationTimeLeft(): number {
    return Math.max(0, this.left);
  }

  corpseCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0.25, 0.9).applyAxisAngle(UP, this.info.yaw).add(new THREE.Vector3(this.info.p[0], this.y, this.info.p[2]));
  }

  // Humiliable (the local player's dance).
  claim() {
    this.claimedBy = this.me;
    this.hooks.claim?.(this);
  }

  releaseClaim() {
    this.claimedBy = null;
    this.hooks.release?.(this);
  }

  finishHumiliation() {
    this.markHumiliated();
    this.hooks.finish?.(this);
  }

  markHumiliated() {
    if (this.humiliated && this.doneAt !== null) return;
    this.humiliated = true;
    this.claimedBy = null;
    this.doneAt = this.age;
  }

  render(dt: number) {
    this.age += dt;
    // Falls under gravity until it hits the floor (never floats where a mid-air death happened).
    if (this.y > this.groundY) {
      this.fallV += MOVE.gravity * dt;
      this.y = Math.max(this.groundY, this.y - this.fallV * dt);
    }
    this.avatar.root.position.y = this.y;
    this.avatar.die(this.age, 1);
    // Seconds into sinking away (negative = still visible).
    let sink = -1;
    if (this.humiliated) {
      const since = this.age - (this.doneAt ?? this.age);
      if (since < 1.6) this.timer.done();
      else {
        this.timer.hide();
        sink = since - 1.6;
      }
    } else if (this.claimedBy !== null) {
      this.timer.hide();
    } else if (this.left > 0) {
      if (this.info.victim !== this.me) this.timer.countdown(this.left, HUMILIATION.window);
      else this.timer.hide();
    } else {
      this.timer.hide();
      sink = -this.left;
    }
    if (sink >= 0) {
      this.avatar.root.position.y = this.y - Math.min(1, sink / 0.8) * 0.6;
      if (sink > 0.8) this.gone = true;
    }
  }

  dispose() {
    this.scene.remove(this.avatar.root);
  }
}
