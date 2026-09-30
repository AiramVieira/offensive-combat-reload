// Knife (F): quick swing that kills in one hit, with a short lunge toward a nearby target (section 6).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import type { MeleeData } from '@shared/weapons';
import type { Physics } from '../world/physics';
import type { Target } from '../gameplay/targets';

const LOS_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);
const BODY_RADIUS = 0.3;
const CHEST_HEIGHT = 1.1;

export class Melee {
  /** Seconds since the swing started, or null when idle. */
  private t: number | null = null;
  private cooldown = 0;
  private resolved = false;
  target: Target | null = null;

  constructor(public data: MeleeData) {}

  /** Another level of the melee weapon (longer reach); takes effect on the next swing. */
  setData(d: MeleeData) {
    this.data = d;
  }

  get progress(): number | null {
    return this.t === null ? null : Math.min(1, this.t / this.data.duracao);
  }

  get swinging() {
    return this.t !== null;
  }

  /** The lunge lasts from the start of the swing until the hit resolves. */
  get lunging() {
    return this.t !== null && !this.resolved && this.target !== null;
  }

  tryStart(target: Target | null): boolean {
    if (this.t !== null || this.cooldown > 0) return false;
    this.t = 0;
    this.cooldown = this.data.intervalo;
    this.target = target;
    this.resolved = false;
    return true;
  }

  /** Returns 'impact' on the tick the blade connects (hit or miss). */
  update(dt: number): 'impact' | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.t === null) return null;
    this.t += dt;
    let ev: 'impact' | null = null;
    if (!this.resolved && this.t >= this.data.impacto) {
      this.resolved = true;
      ev = 'impact';
    }
    if (this.t >= this.data.duracao) {
      this.t = null;
      this.target = null;
    }
    return ev;
  }
}

/**
 * Nearest living target within `range` (eye to body surface, horizontally), inside the view cone and with
 * a clear line of sight.
 */
export function findMeleeTarget(physics: Physics, targets: Iterable<Target>, eye: THREE.Vector3, yaw: number, range: number, angleDeg: number): { target: Target; dist: number } | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cosMax = Math.cos((angleDeg * Math.PI) / 180);
  let best: { target: Target; dist: number } | null = null;
  for (const d of targets) {
    if (d.dead) continue;
    const p = d.position;
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const dy = p.y + CHEST_HEIGHT - eye.y;
    const horiz = Math.hypot(dx, dz);
    const dist = horiz - BODY_RADIUS;
    if (dist > range || Math.abs(dy) > 1.6) continue;
    if (horiz > 0.01 && (dx * fx + dz * fz) / horiz < cosMax) continue;
    const len = Math.hypot(dx, dy, dz);
    const ray = new RAPIER.Ray(eye, { x: dx / len, y: dy / len, z: dz / len });
    const hit = physics.world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, LOS_GROUPS);
    if (hit && hit.timeOfImpact < len - BODY_RADIUS) continue;
    if (!best || dist < best.dist) best = { target: d, dist };
  }
  return best;
}
