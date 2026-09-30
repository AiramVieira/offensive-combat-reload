// Character hitboxes (section 6): simple shapes attached to a kinematic body, never the visual mesh.
// Shared by training dummies and remote players so both are hit exactly the same way.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
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

// Local space: origin at the feet, facing -Z.
const HITBOXES: HitboxDef[] = [
  { region: 'cabeca', shape: 'ball', r: 0.22, pos: [0, 1.62, 0] },
  { region: 'tronco', shape: 'capsule', r: 0.26, half: 0.26, pos: [0, 1.1, 0] },
  { region: 'bracos', shape: 'capsule', r: 0.085, half: 0.24, pos: [-0.4, 1.08, 0], rotZ: 0.12 },
  { region: 'bracos', shape: 'capsule', r: 0.085, half: 0.24, pos: [0.4, 1.08, 0], rotZ: -0.12 },
  { region: 'pernas', shape: 'capsule', r: 0.12, half: 0.28, pos: [-0.14, 0.42, 0] },
  { region: 'pernas', shape: 'capsule', r: 0.12, half: 0.28, pos: [0.14, 0.42, 0] },
];

/**
 * Groin zone, in local space (front half of the pelvis). It overlaps the lower torso and upper legs, so a
 * torso/leg hit whose point lands inside this box is reclassified as 'virilha' ("No pássaro!").
 */
export const GROIN = { min: new THREE.Vector3(-0.13, 0.7, -0.35), max: new THREE.Vector3(0.13, 0.95, 0.02) };

export interface CharacterColliders {
  colliders: RAPIER.Collider[];
  debug: THREE.Group;
}

/** Creates hitbox + movement-blocker colliders on `body` and registers them for `entity`. */
export function createCharacterColliders(world: RAPIER.World, body: RAPIER.RigidBody, entity: Target, registry: HitboxRegistry): CharacterColliders {
  const colliders: RAPIER.Collider[] = [];
  const debug = new THREE.Group();
  const debugMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  for (const h of HITBOXES) {
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
  const groinSize = new THREE.Vector3().subVectors(GROIN.max, GROIN.min);
  const groinDebug = new THREE.Mesh(new THREE.BoxGeometry(groinSize.x, groinSize.y, groinSize.z), new THREE.MeshBasicMaterial({ color: 0xffe14d, wireframe: true }));
  groinDebug.position.addVectors(GROIN.min, GROIN.max).multiplyScalar(0.5);
  debug.add(groinDebug);
  // Movement blocker so players can't walk through each other (does not stop bullets).
  colliders.push(world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35).setTranslation(0, 0.9, 0).setCollisionGroups(BLOCKER_GROUPS), body));
  debug.visible = false;
  return { colliders, debug };
}

const tmp = new THREE.Vector3();

export function refineRegion(point: THREE.Vector3, region: HitRegion, feet: THREE.Vector3, yaw: number): HitRegion {
  if (region !== 'tronco' && region !== 'pernas') return region;
  const local = tmp.copy(point).sub(feet).applyAxisAngle(UP, -yaw);
  const inside = local.x >= GROIN.min.x && local.x <= GROIN.max.x && local.y >= GROIN.min.y && local.y <= GROIN.max.y && local.z >= GROIN.min.z && local.z <= GROIN.max.z;
  return inside ? 'virilha' : region;
}

export function isBehind(point: THREE.Vector3, feet: THREE.Vector3, yaw: number): boolean {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return fx * (point.x - feet.x) + fz * (point.z - feet.z) < 0;
}
