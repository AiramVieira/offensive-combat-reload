// Hitscan resolution against the Rapier world (map colliders + dummy hitboxes), with bullet penetration
// through thin wood, glass and paper (weapon data "penetracao").
// The same query will run authoritatively on the server with rewound hitboxes (section 14).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import type { PenetrationData } from '@shared/weapons';
import type { Physics, SurfaceInfo } from '../world/physics';
import type { HitboxRegistry, TargetHit } from '../gameplay/targets';

const BULLET_GROUPS = groups(GROUP.BULLET, GROUP.WORLD | GROUP.HITBOX);

export interface TraceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Total path length from the muzzle, through any surfaces crossed (drives damage falloff). */
  distance: number;
  target?: TargetHit;
  surface?: SurfaceInfo;
}

/** A surface the bullet went through: entry hole, exit hole. */
export interface Penetration {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  exit: THREE.Vector3;
  exitNormal: THREE.Vector3;
  surface: SurfaceInfo;
}

export interface ShotTrace {
  /** Where the bullet stopped (a target or a surface it can't cross), or null if it flew off. */
  hit: TraceHit | null;
  /** Surfaces crossed before that, in order. */
  through: Penetration[];
  /** Damage fraction left after crossing them (1 = clean hit). */
  keep: number;
  /** End of the tracer. */
  end: THREE.Vector3;
}

export function traceShot(
  physics: Physics,
  hitboxes: HitboxRegistry,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  /** The shooter's own hitbox body (never shoot yourself). */
  exclude?: RAPIER.RigidBody,
  penetration?: PenetrationData,
): ShotTrace {
  const through: Penetration[] = [];
  let keep = 1;
  let from = origin.clone();
  let traveled = 0;
  let lastCrossed: RAPIER.Collider | undefined;
  for (;;) {
    const hit = physics.world.castRayAndGetNormal(new RAPIER.Ray(from, dir), maxDist - traveled, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, BULLET_GROUPS, lastCrossed, exclude);
    if (!hit) return { hit: null, through, keep, end: from.clone().addScaledVector(dir, Math.min(120, maxDist - traveled)) };
    const point = from.clone().addScaledVector(dir, hit.timeOfImpact);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    const distance = traveled + hit.timeOfImpact;
    const target = hitboxes.get(hit.collider.handle);
    const surface = physics.surfaces.get(hit.collider.handle);
    const mat = !target && surface && penetration && through.length < penetration.maxSuperficies ? penetration.materiais[surface.material] : undefined;
    if (mat) {
      // Exit hole: cast back from the farthest point the bullet could still get out at. Starting inside the
      // surface (toi 0) or missing means it is thicker than that along this path: the bullet stops.
      const far = point.clone().addScaledVector(dir, mat.espessuraMax);
      const back = hit.collider.castRayAndGetNormal(new RAPIER.Ray(far, dir.clone().negate()), mat.espessuraMax, true);
      if (back && back.timeOfImpact > 1e-4) {
        const exit = far.addScaledVector(dir, -back.timeOfImpact);
        const exitNormal = new THREE.Vector3(back.normal.x, back.normal.y, back.normal.z);
        through.push({ point, normal, exit, exitNormal, surface: surface! });
        keep *= mat.dano;
        traveled = distance + (mat.espessuraMax - back.timeOfImpact) + EXIT_NUDGE;
        from = exit.clone().addScaledVector(dir, EXIT_NUDGE);
        lastCrossed = hit.collider;
        continue;
      }
    }
    return { hit: { point, normal, distance, target, surface }, through, keep, end: point };
  }
}

const EXIT_NUDGE = 0.005;

/** Random direction inside a cone of half-angle `spread` around `forward` (uniform over the disk). */
export function applySpread(forward: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  if (spread <= 0) return out.copy(forward);
  const up = Math.abs(forward.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  const theta = spread * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sin(theta);
  return out
    .copy(forward)
    .multiplyScalar(Math.cos(theta))
    .addScaledVector(right, Math.cos(phi) * s)
    .addScaledVector(realUp, Math.sin(phi) * s)
    .normalize();
}
