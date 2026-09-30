// Third-person character: the local player during humiliations, and every remote player online.
// Built from primitives on pivot groups so poses are animated procedurally until real glTF clips exist.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import { PALETTE, toon } from '../render/materials';

const HAIR = 0x3b2418;

export interface AvatarColors {
  shirt: number;
  cap: number;
  stripe: number;
}

export const LOCAL_COLORS: AvatarColors = { shirt: PALETTE.teamA, cap: PALETTE.teamB, stripe: 0xffc89a };
/** Free-for-all: everybody else is red (section 9). */
export const ENEMY_COLORS: AvatarColors = { shirt: 0xe0463c, cap: 0x2a2a30, stripe: 0xffb0a8 };

export interface AvatarPose {
  /** Horizontal speed (m/s), drives the walk cycle. */
  speed: number;
  crouch: boolean;
  slide?: boolean;
  /** View pitch (radians): the torso and rifle follow it. */
  pitch: number;
  ads: boolean;
  reload: boolean;
  knife: boolean;
  cook: boolean;
}

export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private rifleHands = new THREE.Group();
  private rifleBack: THREE.Mesh;
  private walkPhase = 0;

  constructor(scene: THREE.Scene, colors: AvatarColors = LOCAL_COLORS, readonly sex: Sex = 'm') {
    const female = sex === 'f';
    const skin = toon(PALETTE.skin);
    const shirt = toon(colors.shirt);
    const pants = toon(0x4a5a32);
    const dark = toon(0x222226);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    this.hips.position.y = 0.82;
    this.body.add(this.hips);

    // Legs hang from hip pivots.
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0, 0);
      mesh(new THREE.CapsuleGeometry(0.12, 0.5, 4, 8), pants, leg, 0, -0.38, 0);
      mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), dark, leg, 0, -0.77, -0.04);
      this.hips.add(leg);
    }

    this.torso.position.y = 0.05;
    this.hips.add(this.torso);
    mesh(new THREE.CapsuleGeometry(0.26, 0.48, 4, 12), shirt, this.torso, 0, 0.28, 0).scale.set(female ? 1.02 : 1.15, 1, 0.8);
    mesh(new THREE.BoxGeometry(0.62, 0.07, 0.44), toon(colors.stripe), this.torso, 0, 0.48, 0); // team stripe
    this.rifleBack = mesh(new THREE.BoxGeometry(0.14, 0.5, 0.08), dark, this.torso, 0.1, 0.35, 0.26);
    this.rifleBack.rotation.z = 0.5;

    // Arms hang from shoulder pivots.
    const shoulder = female ? 0.33 : 0.36;
    for (const [arm, x] of [[this.armL, -shoulder], [this.armR, shoulder]] as const) {
      arm.position.set(x, 0.55, 0);
      mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), shirt, arm, 0, -0.25, 0);
      mesh(new THREE.SphereGeometry(0.11, 10, 8), skin, arm, 0, -0.55, 0);
      this.torso.add(arm);
    }

    // Rifle held in front of the chest (hidden while dancing, when it goes on the back).
    this.rifleHands.position.set(0.08, 0.42, -0.36);
    mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark, this.rifleHands);
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), dark, this.rifleHands, 0, 0.02, -0.44);
    mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), toon(0x6b5a45), this.rifleHands, 0, -0.1, -0.05);
    this.torso.add(this.rifleHands);

    // Head: skin, backwards cap and sunglasses (cosmetic slots from section 12).
    this.head.position.y = 0.78;
    this.torso.add(this.head);
    mesh(new THREE.SphereGeometry(0.25, 16, 12), skin, this.head, 0, 0.02, 0);
    mesh(new THREE.CylinderGeometry(0.255, 0.26, 0.14, 16), toon(colors.cap), this.head, 0, 0.16, 0);
    mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), toon(colors.cap), this.head, 0, 0.1, 0.3);
    mesh(new THREE.BoxGeometry(0.36, 0.08, 0.04), dark, this.head, 0, 0.05, -0.235);
    if (female) {
      // Hair out from under the cap: over the back and sides, locks framing the face, a ponytail through
      // the cap's back opening with a scrunchie in the cap color, and lipstick.
      const hair = toon(HAIR);
      mesh(new THREE.SphereGeometry(0.262, 16, 12), hair, this.head, 0, 0, 0.05).scale.set(1.03, 0.95, 0.96);
      for (const x of [-0.225, 0.225]) mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), hair, this.head, x, -0.08, -0.07);
      mesh(new THREE.TorusGeometry(0.06, 0.025, 6, 12), toon(colors.cap), this.head, 0, 0.02, 0.29).rotation.x = 0.4;
      const tail = mesh(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), hair, this.head, 0, -0.14, 0.33);
      tail.rotation.x = 0.45;
      mesh(new THREE.BoxGeometry(0.09, 0.025, 0.02), toon(0xd9606e), this.head, 0, -0.11, -0.238);
    }

    this.root.visible = false;
    scene.add(this.root);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible() {
    return this.root.visible;
  }

  private resetBody() {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
  }

  /** Alive, armed: walk cycle, crouch, aim pitch, and quick action overrides (reload, knife, grenade). */
  pose(dt: number, s: AvatarPose) {
    this.resetBody();
    this.rifleHands.visible = true;
    this.rifleBack.visible = false;
    const moving = s.speed > 0.4;
    this.walkPhase += dt * (moving ? 3 + s.speed * 1.1 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.7, 0.2 + s.speed * 0.08) : 0;
    const crouch = s.crouch ? 1 : 0;
    this.hips.position.y = 0.82 - crouch * 0.32 + (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.04 : 0);
    // Rigid legs: crouching swings them forward (sitting-ish) as the hips drop.
    this.legL.rotation.x = swing + crouch * 0.9;
    this.legR.rotation.x = -swing + crouch * 0.9;
    this.torso.rotation.x = -crouch * 0.35 + s.pitch * 0.3;
    this.head.rotation.x = s.pitch * 0.4;

    if (s.slide) {
      // Baseball slide: legs out in front, body leaning back, still aiming.
      this.hips.position.y = 0.32;
      this.legL.rotation.x = 1.35;
      this.legR.rotation.x = 1.1;
      this.torso.rotation.x = 0.45 + s.pitch * 0.3;
    }

    // Arms forward holding the rifle, aimed with the view pitch. (Euler XYZ: the Z swing happens in the
    // hanging frame, then X lifts the arm forward; +X = forward/up for an arm hanging along -Y.)
    const aim = 1.35 + s.pitch * 0.5 + (s.ads ? 0.1 : 0);
    this.armR.rotation.set(aim, 0, -0.12);
    this.armL.rotation.set(aim - 0.1, 0, 0.45);
    this.rifleHands.rotation.x = s.pitch * 0.5;

    if (s.reload) {
      this.armL.rotation.set(0.6, 0, 0.2);
      this.rifleHands.rotation.z = 0.5;
    } else {
      this.rifleHands.rotation.z = 0;
    }
    if (s.knife) this.armR.rotation.set(1.6, 0.5, -0.2);
    if (s.cook) this.armL.rotation.set(2.6, 0, 0.2);
  }

  /** "Dancinha da Vitória": raise the roof, spin, then disco pointing. `t` in seconds, 150 bpm. */
  dance(t: number) {
    this.resetBody();
    this.rifleHands.visible = false;
    this.rifleBack.visible = true;
    const beat = 0.4;
    const b = t / beat;
    const bounce = Math.abs(Math.sin(b * Math.PI));
    this.hips.position.y = 0.76 + bounce * 0.1;
    this.hips.rotation.z = Math.sin(b * Math.PI) * 0.14;
    this.legL.rotation.x = Math.sin(b * Math.PI) * 0.35;
    this.legR.rotation.x = -Math.sin(b * Math.PI) * 0.35;
    this.torso.rotation.z = -this.hips.rotation.z * 1.4;
    this.head.rotation.x = Math.sin(b * Math.PI * 2) * 0.15;
    this.head.rotation.z = Math.sin(b * Math.PI) * 0.2;

    if (t < 1.6) {
      // Raise the roof: both hands pumping above the head.
      const pump = Math.sin(b * Math.PI * 2) * 0.25;
      this.armL.rotation.set(0, 0, -2.7 - pump);
      this.armR.rotation.set(0, 0, 2.7 + pump);
    } else if (t < 2.4) {
      // Spin with arms out.
      const s = (t - 1.6) / 0.8;
      this.hips.rotation.y = THREE.MathUtils.smootherstep(s, 0, 1) * Math.PI * 2;
      this.armL.rotation.set(0, 0, -1.5);
      this.armR.rotation.set(0, 0, 1.5);
    } else {
      // Disco point: right arm to the sky, left to the floor, swapping every beat.
      const up = Math.floor(b) % 2 === 0;
      this.armR.rotation.set(0, 0, up ? 2.6 : 0.6);
      this.armL.rotation.set(0, 0, up ? -0.6 : -2.6);
    }
  }

  /** Stiff cartoon fall onto the back (`dir` 1) or face (-1), `t` seconds after death. */
  die(t: number, dir: 1 | -1 = 1) {
    this.resetBody();
    this.rifleHands.visible = false;
    this.rifleBack.visible = true;
    this.hips.position.y = 0.82;
    this.armL.rotation.set(0, 0, -0.5);
    this.armR.rotation.set(0, 0, 0.5);
    const k = Math.min(1, t / 0.45);
    const after = t - 0.45;
    const bounce = k < 1 ? k * k : 1 + Math.sin(after * 18) * Math.exp(-after * 7) * 0.06;
    // Fall around the feet: positive X rotation tips the top toward +Z (backward for a -Z facing body).
    this.body.rotation.x = dir * bounce * (Math.PI / 2 - 0.08);
  }
}
