// Hitboxes + movement blocker of a character (the local player, bots, remote players, training dummies).
// A kinematic body follows the character's feet and yaw; its 15 hitbox colliders (entities/hitboxes.ts) are
// moved every update to the bones of a standard skeleton that plays the same pose as the visible character
// (CharacterAnimator), so crouching, aiming or reloading move the hitboxes and clothes never do. The
// skeleton has the standard proportions for everyone: height and build are only looks (style guide).
// Colliders are registered as `entity` so shots, knives and grenades find it; the character's own controller
// ignores this body (MoveBody.ignoreBody). Dead = no colliders, from the same tick.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import type { HitRegion } from '@shared/weapons';
import { CharacterAnimator, type AvatarPose, type Posable } from '../character/animator';
import { createCanonicalSkeleton } from '../character/rig';
import type { HitboxRegistry, Target } from '../gameplay/targets';
import { GROIN, GROIN_FROM, NOTHING_MISSING, zonesFor, type Missing, type ZoneDef } from './hitboxes';

const HITBOX_GROUPS = groups(GROUP.HITBOX, GROUP.BULLET);
// Blocks players and bounces grenades; bullets use the hitboxes instead.
const BLOCKER_GROUPS = groups(GROUP.BLOCKER, GROUP.PLAYER | GROUP.PROJECTILE);
const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** The pose the hitboxes take (the same the visible character plays). */
export type HitPose = { kind: 'armed'; pose: AvatarPose } | { kind: 'idle'; t: number } | { kind: 'walk'; speed: number } | { kind: 'dance'; t: number };

interface Shape {
  zone: ZoneDef;
  collider: RAPIER.Collider;
  /** Center in the bone's space, and the rotation that lays a capsule (Y) along its axis. */
  center: THREE.Vector3;
  align: THREE.Quaternion;
  debug: THREE.Mesh;
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpBoneQ = new THREE.Quaternion();
const tmpD = new THREE.Vector3();

export class CharacterRig {
  readonly body: RAPIER.RigidBody;
  /** Wireframes of the hitboxes, in the character's local space (feet at the origin, facing -Z). */
  readonly debug = new THREE.Group();
  private shapes: Shape[] = [];
  private blocker: RAPIER.Collider;
  private enabled = true;
  private q = new THREE.Quaternion();
  /** The standard skeleton the hitboxes ride on. */
  private poser: Posable & { holder: THREE.Group };
  private animator: CharacterAnimator;
  private feet = new THREE.Vector3();
  private yaw = 0;
  private groinDebug: THREE.Mesh;

  constructor(
    private world: RAPIER.World,
    entity: Target,
    registry: HitboxRegistry,
    missing: Missing = NOTHING_MISSING,
  ) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    const { root, bones } = createCanonicalSkeleton('m');
    const holder = new THREE.Group();
    holder.add(root);
    this.poser = { bones: Object.fromEntries(bones.map((b) => [b.name, b])), body: holder, holder, setGrip: () => {} };
    this.animator = new CharacterAnimator(this.poser);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
    for (const zone of zonesFor(missing)) {
      const a = new THREE.Vector3(...zone.a);
      const b = zone.b ? new THREE.Vector3(...zone.b) : null;
      const half = b ? a.distanceTo(b) / 2 : 0;
      const desc = b ? RAPIER.ColliderDesc.capsule(half, zone.r) : RAPIER.ColliderDesc.ball(zone.r);
      const collider = world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      registry.set(collider.handle, { entity, region: zone.region });
      const debug = new THREE.Mesh(b ? new THREE.CapsuleGeometry(zone.r, half * 2, 3, 8) : new THREE.SphereGeometry(zone.r, 10, 8), mat);
      this.debug.add(debug);
      const align = b ? new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()) : new THREE.Quaternion();
      this.shapes.push({ zone, collider, center: b ? a.clone().add(b).multiplyScalar(0.5) : a, align, debug });
    }
    // Movement blocker so players can't walk through each other (does not stop bullets).
    this.blocker = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35).setTranslation(0, 0.9, 0).setCollisionGroups(BLOCKER_GROUPS), this.body);
    // The skeleton stays out of the scene: its world matrices are in the body's space.
    // The groin zone (yellow), riding on the hips bone.
    const size = new THREE.Vector3().subVectors(GROIN.max, GROIN.min);
    this.groinDebug = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ color: 0xffe14d, wireframe: true }));
    this.debug.add(this.groinDebug);
    this.debug.visible = false;
    this.place();
  }

  /**
   * Moves the hitboxes to the character: feet and yaw for the body (applied on the next physics step), the
   * pose for the shapes (applied now). Dead = no colliders.
   */
  follow(feet: THREE.Vector3, yaw: number, alive: boolean, pose: HitPose, dt: number) {
    if (alive !== this.enabled) {
      this.enabled = alive;
      for (const s of this.shapes) s.collider.setEnabled(alive);
      this.blocker.setEnabled(alive);
    }
    if (!alive) return;
    this.feet.copy(feet);
    this.yaw = yaw;
    this.q.setFromAxisAngle(UP, yaw);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y, z: feet.z });
    this.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    switch (pose.kind) {
      case 'armed':
        this.animator.pose(dt, pose.pose);
        break;
      case 'idle':
        this.animator.idle(pose.t);
        break;
      case 'walk':
        this.animator.walk(dt, pose.speed);
        break;
      case 'dance':
        this.animator.dance(pose.t);
        break;
    }
    this.place();
  }

  /** Puts every collider on its bone (in the body's space) and the wireframes with them. */
  private place() {
    this.poser.holder.updateMatrixWorld(true);
    for (const s of this.shapes) {
      const bone = this.poser.bones[s.zone.bone];
      tmpM.copy(bone.matrixWorld);
      tmpP.copy(s.center).applyMatrix4(tmpM);
      tmpBoneQ.setFromRotationMatrix(tmpM);
      tmpQ.copy(tmpBoneQ).multiply(s.align);
      s.collider.setTranslationWrtParent({ x: tmpP.x, y: tmpP.y, z: tmpP.z });
      s.collider.setRotationWrtParent({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
      if (this.debug.visible) {
        s.debug.position.copy(tmpP);
        s.debug.quaternion.copy(tmpQ);
      }
    }
    if (this.debug.visible) {
      const hips = this.poser.bones.hips.matrixWorld;
      this.groinDebug.position.addVectors(GROIN.min, GROIN.max).multiplyScalar(0.5).applyMatrix4(hips);
      this.groinDebug.quaternion.setFromRotationMatrix(hips);
    }
  }

  /** A hips, abdomen or thigh hit inside the groin zone (in the hips bone's space) becomes 'virilha'. */
  refineRegion(point: THREE.Vector3, region: HitRegion): HitRegion {
    if (!GROIN_FROM.has(region)) return region;
    // World → character space → hips bone space.
    tmpD.copy(point).sub(this.feet).applyAxisAngle(UP, -this.yaw);
    tmpM.copy(this.poser.bones.hips.matrixWorld).invert();
    tmpD.applyMatrix4(tmpM);
    const g = GROIN;
    const inside = tmpD.x >= g.min.x && tmpD.x <= g.max.x && tmpD.y >= g.min.y && tmpD.y <= g.max.y && tmpD.z >= g.min.z && tmpD.z <= g.max.z;
    return inside ? 'virilha' : region;
  }

  setDebug(v: boolean) {
    this.debug.visible = v;
    if (v) this.place();
  }

  dispose() {
    this.world.removeRigidBody(this.body);
  }
}
