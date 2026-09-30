// First-person arms + rifle built from primitives (placeholder for weapons/rifle_padrao.glb).
// Handles ADS blend, sprint pose, reload animation, bob, sway, strafe tilt and recoil kick (section 4).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, toon, toonGradient } from './materials';
import { grenadeModel } from '../weapons/grenades';

export interface ViewmodelState {
  ads: number; // 0..1
  sprint: number; // 0..1 (smoothed here)
  grounded: boolean;
  speed: number; // horizontal m/s
  strafe: number; // lateral velocity in camera space, m/s
  mouseDX: number;
  mouseDY: number;
  /** Reload progress 0..1, or null when not reloading. */
  reload: number | null;
  /** 0..1 while sliding (smoothed): the gun tilts and drops a little. */
  slide: number;
  /** Knife swing progress 0..1, or null. */
  melee: number | null;
  /** Grenade: seconds cooking in hand, and seconds since release (null when not happening). */
  grenadeCook: number | null;
  grenadeThrow: number | null;
  crouch: number;
}

const HIP = new THREE.Vector3(0.15, -0.15, -0.4);
const ADS = new THREE.Vector3(0, -0.057, -0.36);
const SPRINT = new THREE.Vector3(0.1, -0.2, -0.34);
const MUZZLE_LOCAL = new THREE.Vector3(0, 0.012, -0.47);

export class Viewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  private mag: THREE.Mesh;
  private knife = new THREE.Group();
  private grenadeArm = new THREE.Group();
  private grenadeInHand: THREE.Object3D;
  private flashGroup = new THREE.Group();
  private flashT = 0;
  private sprintT = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private sway = new THREE.Vector2();
  private kickBack = 0;
  private kickRot = 0;
  private tilt = 0;
  private landDip = 0;
  private tmp = new THREE.Vector3();

  constructor(vmScene: THREE.Scene) {
    const metal = toon(0x3a3f47);
    const dark = toon(0x24272c);
    const furniture = toon(0x6b5a45);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.gun.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    add(box(0.05, 0.07, 0.32), metal, 0, 0, 0); // receiver
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.3, 8).rotateX(Math.PI / 2), dark, 0, 0.012, -0.31); // barrel
    add(box(0.056, 0.06, 0.2), furniture, 0, -0.004, -0.22); // handguard
    add(box(0.045, 0.075, 0.2), furniture, 0, -0.012, 0.25); // stock
    add(box(0.03, 0.085, 0.042), furniture, 0, -0.068, 0.085, 0.35); // pistol grip
    this.mag = add(box(0.034, 0.13, 0.06), dark, 0, -0.09, -0.045, 0.18);
    add(box(0.006, 0.016, 0.01), dark, -0.014, 0.047, 0.1); // rear sight (two ears framing the post)
    add(box(0.006, 0.016, 0.01), dark, 0.014, 0.047, 0.1);
    add(box(0.034, 0.006, 0.01), dark, 0, 0.041, 0.1);
    add(box(0.006, 0.03, 0.006), dark, 0, 0.042, -0.36); // front post, tip at y≈0.057
    add(box(0.022, 0.012, 0.012), dark, 0, 0.03, -0.36);
    add(box(0.052, 0.008, 0.07), toon(PALETTE.teamA), 0, 0.039, -0.1); // team-colored stripe

    // Arms: sleeve + hand boxes stretched between two points.
    const skin = toon(PALETTE.skin);
    const sleeve = toon(PALETTE.sleeve);
    const band = toon(PALETTE.teamA);
    const limb = (from: THREE.Vector3, to: THREE.Vector3, thick: number, mat: THREE.Material) => {
      const len = from.distanceTo(to);
      const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.lookAt(to);
      this.gun.add(m);
      return m;
    };
    // Right hand on the grip, left hand under the handguard.
    limb(new THREE.Vector3(0.012, -0.06, 0.1), new THREE.Vector3(0.012, -0.075, 0.05), 0.05, skin);
    limb(new THREE.Vector3(0.02, -0.08, 0.12), new THREE.Vector3(0.09, -0.2, 0.34), 0.07, sleeve);
    limb(new THREE.Vector3(0.05, -0.13, 0.21), new THREE.Vector3(0.062, -0.15, 0.245), 0.074, band);
    limb(new THREE.Vector3(-0.005, -0.04, -0.24), new THREE.Vector3(-0.01, -0.055, -0.18), 0.052, skin);
    limb(new THREE.Vector3(-0.02, -0.06, -0.2), new THREE.Vector3(-0.17, -0.24, 0.1), 0.07, sleeve);
    limb(new THREE.Vector3(-0.1, -0.15, -0.05), new THREE.Vector3(-0.115, -0.17, -0.02), 0.074, band);

    // Muzzle flash: two crossed additive quads.
    const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const quad = new THREE.PlaneGeometry(0.16, 0.16);
    const a = new THREE.Mesh(quad, flashMat);
    const b = new THREE.Mesh(quad, flashMat);
    b.rotation.y = Math.PI / 2;
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), flashMat);
    this.flashGroup.add(a, b, c);
    this.flashGroup.position.copy(MUZZLE_LOCAL);
    this.flashGroup.visible = false;
    this.gun.add(this.flashGroup);

    // Knife + right hand, shown only during a melee swing.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.2), toon(0xd8dde3));
    blade.position.z = -0.14;
    const edge = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4).rotateX(-Math.PI / 2), toon(0xd8dde3));
    edge.position.z = -0.27;
    edge.scale.set(0.4, 1, 1);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.015), toon(0x24272c));
    guard.position.z = -0.035;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.032, 0.1), toon(0x3b2a1e));
    handle.position.z = 0.02;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), skin);
    fist.position.z = 0.02;
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), sleeve);
    forearm.position.set(0.02, -0.02, 0.2);
    this.knife.add(blade, edge, guard, handle, fist, forearm);
    this.knife.visible = false;

    // Left arm holding a grenade, shown while cooking/throwing.
    this.grenadeInHand = grenadeModel();
    this.grenadeInHand.position.set(0, 0.03, -0.02);
    this.grenadeInHand.scale.setScalar(0.7);
    const gHand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.08), skin);
    gHand.position.set(0, -0.03, 0.01);
    const gSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.32), sleeve);
    gSleeve.position.set(-0.02, -0.06, 0.2);
    gSleeve.rotation.x = 0.35;
    this.grenadeArm.add(this.grenadeInHand, gHand, gSleeve);
    this.grenadeArm.visible = false;

    bakeStaticParts(this.gun, [this.mag, this.flashGroup]);
    this.root.add(this.gun, this.knife, this.grenadeArm);
    vmScene.add(this.root);
  }

  kick() {
    this.kickBack = Math.min(this.kickBack + 0.028, 0.07);
    this.kickRot = Math.min(this.kickRot + 0.045, 0.14);
  }

  flash() {
    this.flashT = 0.045;
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flashGroup.scale.set(s, s, s * 1.4);
  }

  landed(strength: number) {
    this.landDip = Math.min(0.06, 0.015 + strength * 0.008);
  }

  // Keyframes: wind up to the right, stab forward-left at the impact moment (~30%), then retract.
  private static readonly KNIFE_KEYS: [t: number, pos: [number, number, number], rot: [number, number, number]][] = [
    [0, [0.32, -0.34, -0.2], [0.6, 0.5, -0.9]],
    [0.12, [0.26, -0.12, -0.26], [0.25, 0.55, -1.2]],
    [0.3, [-0.02, -0.08, -0.52], [-0.05, -0.25, 0.35]],
    [0.55, [-0.06, -0.12, -0.46], [-0.1, -0.35, 0.5]],
    [1, [0.3, -0.4, -0.2], [0.5, 0.2, -0.3]],
  ];

  private poseKnife(p: number) {
    const keys = Viewmodel.KNIFE_KEYS;
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const [t0, p0, r0] = keys[i];
    const [t1, p1, r1] = keys[i + 1];
    const f = THREE.MathUtils.smoothstep(p, t0, t1);
    this.knife.position.set(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f);
    this.knife.rotation.set(r0[0] + (r1[0] - r0[0]) * f, r0[1] + (r1[1] - r0[1]) * f, r0[2] + (r1[2] - r0[2]) * f);
  }

  /** Muzzle position in main-camera space, for tracers and the muzzle light. */
  muzzleCameraSpace(out: THREE.Vector3): THREE.Vector3 {
    this.gun.updateWorldMatrix(true, false);
    return out.copy(MUZZLE_LOCAL).applyMatrix4(this.gun.matrixWorld);
  }

  update(dt: number, s: ViewmodelState) {
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    this.sprintT += ((s.sprint > 0.5 ? 1 : 0) - this.sprintT) * k(10);

    // Base pose: hip -> ADS -> sprint.
    const pos = this.tmp.copy(HIP).lerp(ADS, s.ads).lerp(SPRINT, this.sprintT);
    let rx = this.sprintT * -0.35;
    let ry = this.sprintT * 0.75;
    let rz = this.sprintT * 0.25;

    // Walk bob, reduced while aiming.
    const moving = s.grounded && s.speed > 0.5;
    this.bobAmp += ((moving ? Math.min(1.4, s.speed / 5.5) : 0) - this.bobAmp) * k(8);
    this.bobPhase += dt * (4 + s.speed * 1.35);
    const bobScale = this.bobAmp * (1 - s.ads * 0.85) * (1 + this.sprintT * 0.8);
    pos.x += Math.sin(this.bobPhase) * 0.011 * bobScale;
    pos.y += -Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobScale;
    rz += Math.sin(this.bobPhase) * 0.02 * bobScale;

    // Sway lags behind mouse movement; strafe tilt.
    const swayScale = 1 - s.ads * 0.8;
    this.sway.x += (THREE.MathUtils.clamp(-s.mouseDX * 0.0009, -0.05, 0.05) - this.sway.x) * k(10);
    this.sway.y += (THREE.MathUtils.clamp(s.mouseDY * 0.0009, -0.05, 0.05) - this.sway.y) * k(10);
    pos.x += this.sway.x * 0.5 * swayScale;
    pos.y += this.sway.y * 0.5 * swayScale;
    ry += this.sway.x * 1.5 * swayScale;
    rx += this.sway.y * 1.5 * swayScale;
    this.tilt += (-s.strafe * 0.012 * (1 - s.ads * 0.7) - this.tilt) * k(8);
    rz += this.tilt;

    // Reload: tilt the gun, drop the mag out of frame and bring it back.
    if (s.reload !== null) {
      const r = s.reload;
      const tiltIn = THREE.MathUtils.smoothstep(r, 0, 0.15) * (1 - THREE.MathUtils.smoothstep(r, 0.85, 1));
      rx += tiltIn * 0.35;
      rz += tiltIn * 0.55;
      pos.y -= tiltIn * 0.03;
      const out = THREE.MathUtils.smoothstep(r, 0.12, 0.3) * (1 - THREE.MathUtils.smoothstep(r, 0.45, 0.62));
      this.mag.position.y = -0.09 - out * 0.35;
    } else {
      this.mag.position.y = -0.09;
    }

    // Slide: gun rolls inward and sits a bit lower, still aimable.
    rz += s.slide * 0.22 * (1 - s.ads * 0.7);
    pos.y -= s.slide * 0.02 * (1 - s.ads);
    pos.x -= s.slide * 0.02 * (1 - s.ads);

    // Recoil kick and landing dip (critically damped decay).
    this.kickBack *= Math.exp(-16 * dt);
    this.kickRot *= Math.exp(-14 * dt);
    this.landDip *= Math.exp(-9 * dt);
    pos.z += this.kickBack * (1 - s.ads * 0.4);
    rx += this.kickRot * (1 - s.ads * 0.6);
    pos.y -= this.landDip + s.crouch * 0.01;

    // Knife swing: the rifle ducks out of the way while the knife stabs across the screen.
    if (s.melee !== null) {
      const p = s.melee;
      const duck = Math.sin(Math.min(1, p * 1.25) * Math.PI);
      pos.y -= duck * 0.16;
      pos.x += duck * 0.06;
      rx -= duck * 0.6;
      rz -= duck * 0.4;
      this.poseKnife(p);
    }
    this.knife.visible = s.melee !== null;

    // Grenade: the rifle ducks while the left hand holds the grenade up, then a quick overhand throw.
    const cooking = s.grenadeCook !== null;
    const throwing = s.grenadeThrow !== null && s.grenadeThrow < 0.4;
    if (cooking || throwing) {
      const inT = cooking ? Math.min(1, s.grenadeCook! / 0.15) : 1;
      const outT = throwing ? THREE.MathUtils.smoothstep(s.grenadeThrow!, 0.15, 0.4) : 0;
      const duck = inT * (1 - outT);
      pos.y -= duck * 0.15;
      pos.x += duck * 0.05;
      rx -= duck * 0.55;
      const arm = this.grenadeArm;
      if (cooking) {
        // Raised and slightly trembling: it's live.
        const tremble = Math.sin(s.grenadeCook! * 60) * 0.002 * Math.min(1, s.grenadeCook!);
        arm.position.set(-0.16 + tremble, -0.4 + inT * 0.22, -0.5);
        arm.rotation.set(0.25, 0.2, 0.15);
        this.grenadeInHand.visible = true;
      } else {
        const k = Math.min(1, s.grenadeThrow! / 0.12);
        arm.position.set(-0.16 + k * 0.06, -0.18 + k * 0.06 - outT * 0.3, -0.5 - k * 0.25);
        arm.rotation.set(0.25 - k * 0.9, 0.2, 0.15);
        this.grenadeInHand.visible = s.grenadeThrow! < 0.05; // released
      }
      arm.visible = true;
    } else {
      this.grenadeArm.visible = false;
    }

    this.gun.position.copy(pos);
    this.gun.rotation.set(rx, ry, rz);

    this.flashT -= dt;
    this.flashGroup.visible = this.flashT > 0;
  }
}

/**
 * Merges every rigid child mesh of `group` (except `keep`) into one vertex-colored mesh: the rifle and arms
 * are ~18 boxes that never move relative to each other, so they cost one draw call instead of eighteen.
 */
function bakeStaticParts(group: THREE.Group, keep: THREE.Object3D[]) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || keep.includes(child)) continue;
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    g.deleteAttribute('uv');
    const c = ((mesh.material as THREE.MeshToonMaterial).color ?? new THREE.Color(1, 1, 1)).clone();
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
    group.remove(child);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (merged) group.add(new THREE.Mesh(merged, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() })));
}

function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.3, 'rgba(255,210,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.beginPath();
  const spikes = 7;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 30 : 11;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
