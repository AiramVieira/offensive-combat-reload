// Character hitboxes (section 6): simple shapes attached to a kinematic body, never the visual mesh.
// Shared by training dummies, bots, the local player and remote players so all are hit the same way. The
// body's customization changes them: height scales everything, the build widens the torso, and a missing
// arm, hand or leg (PCD) removes or shortens that hitbox.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BodyStats } from '@shared/appearance';
import { GROUP, groups } from '@shared/constants';
import type { HitRegion } from '@shared/weapons';
import type { HitboxRegistry, Target } from '../gameplay/targets';

const HITBOX_GROUPS = groups(GROUP.HITBOX, GROUP.BULLET);
// Blocks players and bounces grenades; bullets use the hitboxes instead.
const BLOCKER_GROUPS = groups(GROUP.BLOCKER, GROUP.PLAYER | GROUP.PROJECTILE);
const UP = new THREE.Vector3(0, 1, 0);

interface HitboxDef {
  region: HitRegion;
  shape: 'ball' | 'capsule';
  r: number;
  half?: number;
  pos: [number, number, number];
  rotZ?: number;
}

/** An average body (medium height and build, nothing missing). */
export const DEFAULT_BODY: Pick<BodyStats, 'scale' | 'width' | 'missing'> = {
  scale: 1,
  width: 1,
  missing: { armL: false, armR: false, handL: false, handR: false, legL: false, legR: false },
};

/** Hitboxes of a body, in local space: origin at the feet, facing -Z. */
function hitboxDefs(b: Pick<BodyStats, 'scale' | 'width' | 'missing'>): HitboxDef[] {
  const s = b.scale;
  const limb = 1 + (b.width - 1) * 0.6;
  const shoulder = 0.4 * (1 + (b.width - 1) * 0.7);
  const defs: HitboxDef[] = [
    { region: 'cabeca', shape: 'ball', r: 0.22, pos: [0, 1.62, 0] },
    { region: 'tronco', shape: 'capsule', r: 0.26 * b.width, half: 0.26, pos: [0, 1.1, 0] },
  ];
  for (const side of [-1, 1] as const) {
    const left = side < 0;
    if (!(left ? b.missing.armL : b.missing.armR)) {
      // Without the hand the arm ends at the wrist: a shorter capsule, higher up.
      const noHand = left ? b.missing.handL : b.missing.handR;
      defs.push({ region: 'bracos', shape: 'capsule', r: 0.085 * limb, half: noHand ? 0.18 : 0.24, pos: [side * shoulder, noHand ? 1.14 : 1.08, 0], rotZ: -side * 0.12 });
    }
    // Without the leg only the stump of the thigh is left.
    if (left ? b.missing.legL : b.missing.legR) defs.push({ region: 'pernas', shape: 'capsule', r: 0.12 * limb, half: 0.05, pos: [side * 0.14, 0.72, 0] });
    else defs.push({ region: 'pernas', shape: 'capsule', r: 0.12 * limb, half: 0.28, pos: [side * 0.14, 0.42, 0] });
  }
  // Height scales every shape from the feet.
  return defs.map((d) => ({ ...d, r: d.r * s, half: d.half === undefined ? undefined : d.half * s, pos: [d.pos[0] * s, d.pos[1] * s, d.pos[2] * s] }));
}

/**
 * Groin zone, in local space (front half of the pelvis). It overlaps the lower torso and upper legs, so a
 * torso/leg hit whose point lands inside this box is reclassified as 'virilha' ("No pássaro!").
 */
export const GROIN = { min: new THREE.Vector3(-0.13, 0.7, -0.35), max: new THREE.Vector3(0.13, 0.95, 0.02) };

export interface CharacterColliders {
  colliders: RAPIER.Collider[];
  debug: THREE.Group;
}

/**
 * Creates hitbox + movement-blocker colliders on `body` and registers them for `entity`. The movement
 * blocker is the same for every body (customization never changes where you fit).
 */
export function createCharacterColliders(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  entity: Target,
  registry: HitboxRegistry,
  shape: Pick<BodyStats, 'scale' | 'width' | 'missing'> = DEFAULT_BODY,
): CharacterColliders {
  const colliders: RAPIER.Collider[] = [];
  const debug = new THREE.Group();
  const debugMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  for (const h of hitboxDefs(shape)) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, h.rotZ ?? 0));
    const desc = (h.shape === 'ball' ? RAPIER.ColliderDesc.ball(h.r) : RAPIER.ColliderDesc.capsule(h.half!, h.r))
      .setTranslation(...h.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(HITBOX_GROUPS);
    const col = world.createCollider(desc, body);
    registry.set(col.handle, { entity, region: h.region });
    colliders.push(col);
    const dm = new THREE.Mesh(h.shape === 'ball' ? new THREE.SphereGeometry(h.r, 10, 8) : new THREE.CapsuleGeometry(h.r, h.half! * 2, 4, 8), debugMat);
    dm.position.set(...h.pos);
    dm.quaternion.copy(q);
    debug.add(dm);
  }
  const groinSize = new THREE.Vector3().subVectors(GROIN.max, GROIN.min).multiplyScalar(shape.scale);
  const groinDebug = new THREE.Mesh(new THREE.BoxGeometry(groinSize.x, groinSize.y, groinSize.z), new THREE.MeshBasicMaterial({ color: 0xffe14d, wireframe: true }));
  groinDebug.position.addVectors(GROIN.min, GROIN.max).multiplyScalar(0.5 * shape.scale);
  debug.add(groinDebug);
  // Movement blocker so players can't walk through each other (does not stop bullets).
  colliders.push(world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35).setTranslation(0, 0.9, 0).setCollisionGroups(BLOCKER_GROUPS), body));
  debug.visible = false;
  return { colliders, debug };
}

const tmp = new THREE.Vector3();

/** `scale` = the body's height scale (the groin zone grows and shrinks with it). */
export function refineRegion(point: THREE.Vector3, region: HitRegion, feet: THREE.Vector3, yaw: number, scale = 1): HitRegion {
  if (region !== 'tronco' && region !== 'pernas') return region;
  const local = tmp.copy(point).sub(feet).applyAxisAngle(UP, -yaw).divideScalar(scale);
  const inside = local.x >= GROIN.min.x && local.x <= GROIN.max.x && local.y >= GROIN.min.y && local.y <= GROIN.max.y && local.z >= GROIN.min.z && local.z <= GROIN.max.z;
  return inside ? 'virilha' : region;
}

export function isBehind(point: THREE.Vector3, feet: THREE.Vector3, yaw: number): boolean {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return fx * (point.x - feet.x) + fz * (point.z - feet.z) < 0;
}
