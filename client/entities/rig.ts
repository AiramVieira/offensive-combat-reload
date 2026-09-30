// Hitboxes + movement blocker for a character that moves with its own controller (the local player, bots).
// A separate kinematic body follows the character each tick; its colliders are registered as `entity` so
// shots, knives and grenades find it. The character's controller ignores this body (MoveBody.ignoreBody).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BodyStats } from '@shared/appearance';
import type { HitboxRegistry, Target } from '../gameplay/targets';
import { createCharacterColliders, DEFAULT_BODY } from './hitboxes';

const CROUCH_DROP = 0.35;
const UP = new THREE.Vector3(0, 1, 0);

export class CharacterRig {
  readonly body: RAPIER.RigidBody;
  private colliders: RAPIER.Collider[];
  readonly debug: THREE.Group;
  private enabled = true;
  private q = new THREE.Quaternion();

  constructor(private world: RAPIER.World, entity: Target, registry: HitboxRegistry, shape: Pick<BodyStats, 'scale' | 'width' | 'missing'> = DEFAULT_BODY) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    const cc = createCharacterColliders(world, this.body, entity, registry, shape);
    this.colliders = cc.colliders;
    this.debug = cc.debug;
  }

  /** Moves the hitboxes to the character (applied on the next physics step). Dead = no colliders. */
  follow(feet: THREE.Vector3, yaw: number, crouched: boolean, alive: boolean) {
    if (alive !== this.enabled) {
      this.enabled = alive;
      for (const c of this.colliders) c.setEnabled(alive);
    }
    if (!alive) return;
    this.q.setFromAxisAngle(UP, yaw);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y - (crouched ? CROUCH_DROP : 0), z: feet.z });
    this.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
  }

  dispose() {
    this.world.removeRigidBody(this.body);
  }
}
