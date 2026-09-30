// Humiliation (G near a fresh corpse): the player dances on the body in third person, vulnerable and
// unable to shoot. Completing the dance awards points; only death interrupts it.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, HUMILIATION } from '@shared/constants';
import type { Humiliable } from './targets';
import type { Physics } from '../world/physics';

const CAMERA_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);
const BLEND_IN = 0.35;
const BLEND_OUT = 0.3;
const ORBIT_RADIUS = 3.3;
const ORBIT_HEIGHT = 1.5;

export class Taunt {
  dummy: Humiliable | null = null;
  t = 0;
  startedAt = 0;
  private yaw = 0;
  private stopMusic: () => void = () => {};
  readonly duration = HUMILIATION.duration;
  private lookAt = new THREE.Vector3();
  private m = new THREE.Matrix4();

  get active() {
    return this.dummy !== null;
  }

  start(dummy: Humiliable, yaw: number, time: number, music: (duration: number) => () => void) {
    this.dummy = dummy;
    this.t = 0;
    this.startedAt = time;
    this.yaw = yaw;
    dummy.claim();
    this.stopMusic = music(this.duration);
  }

  /** Advances the dance; returns the dummy when it completes. */
  update(dt: number, time: number): Humiliable | null {
    if (!this.dummy) return null;
    this.t += dt;
    if (this.t < this.duration) return null;
    const d = this.dummy;
    d.finishHumiliation(time);
    this.dummy = null;
    return d;
  }

  cancel(time: number) {
    if (!this.dummy) return;
    this.dummy.releaseClaim(time);
    this.dummy = null;
    this.stopMusic();
  }

  /** 0 = first person, 1 = full third-person orbit; eases in at the start and back out at the end. */
  get blend(): number {
    if (!this.dummy) return 0;
    return THREE.MathUtils.smoothstep(this.t, 0, BLEND_IN) * (1 - THREE.MathUtils.smoothstep(this.t, this.duration - BLEND_OUT, this.duration));
  }

  /** Orbiting camera in front of the dancer, pulled in if a wall is in the way. */
  cameraPose(physics: Physics, feet: THREE.Vector3, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const a = this.yaw + 0.55 + this.t * 0.5;
    this.lookAt.set(feet.x, feet.y + 1.0, feet.z);
    const dir = new THREE.Vector3(-Math.sin(a), (ORBIT_HEIGHT - 1.0) / ORBIT_RADIUS, -Math.cos(a)).normalize();
    const full = Math.hypot(ORBIT_RADIUS, ORBIT_HEIGHT - 1.0);
    const hit = physics.world.castRay(new RAPIER.Ray(this.lookAt, dir), full, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, CAMERA_GROUPS);
    const dist = hit ? Math.max(0.6, hit.timeOfImpact - 0.25) : full;
    outPos.copy(this.lookAt).addScaledVector(dir, dist);
    this.m.lookAt(outPos, this.lookAt, THREE.Object3D.DEFAULT_UP);
    outQuat.setFromRotationMatrix(this.m);
  }
}
