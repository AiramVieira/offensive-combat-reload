// What the combat code needs from anything that can be shot, stabbed or blown up (training dummies
// offline, other players online), and from anything that can be humiliated (their corpses).
import * as THREE from 'three';
import type { HitRegion } from '@shared/weapons';

export interface Target {
  readonly name: string;
  /** Feet position (interpolated for remote players). */
  readonly position: THREE.Vector3;
  readonly dead: boolean;
  /** Best known health, used by non-lethal grenades (the server re-checks online). */
  readonly health: number;
  /** Reclassifies a torso/leg hit as 'virilha' when it lands in the groin zone. */
  refineRegion(point: THREE.Vector3, region: HitRegion): HitRegion;
  isBehind(point: THREE.Vector3): boolean;
}

export interface TargetHit {
  entity: Target;
  region: HitRegion;
}

/** Collider handle → which target and body region it belongs to. Shared by every target type. */
export type HitboxRegistry = Map<number, TargetHit>;

export interface Humiliable {
  readonly name: string;
  canHumiliate(time: number): boolean;
  humiliationTimeLeft(time: number): number;
  corpseCenter(out: THREE.Vector3): THREE.Vector3;
  claim(): void;
  releaseClaim(time: number): void;
  finishHumiliation(time: number): void;
}

const tmpCenter = new THREE.Vector3();

/** Nearest corpse that can still be humiliated within `radius` of the player's feet. */
export function nearestHumiliable<T extends Humiliable>(items: Iterable<T>, feet: THREE.Vector3, radius: number, time: number): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const h of items) {
    if (!h.canHumiliate(time)) continue;
    const c = h.corpseCenter(tmpCenter);
    if (Math.abs(c.y - feet.y) > 1.5) continue;
    const d = Math.hypot(c.x - feet.x, c.z - feet.z);
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
