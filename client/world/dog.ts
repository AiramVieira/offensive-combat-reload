// Amora, the black Chow Chow guarding the doghouse. Built from primitives like the characters: a very
// fluffy body, the lion-like ruff, small rounded ears, short muzzle, deep-set eyes, the breed's blue-black
// tongue and the tail curled over the back. She follows whoever comes close with her head and bites
// anyone who steps into the strip in front of her door: an instant kill (map hazard).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeColoredParts, toonGradient, type ColoredPart } from '../render/materials';
import { WORLD_GROUPS, type Physics } from './physics';
import type { SpatialSfx } from '../audio/spatial';

// Not pure black: toon shading flattens near-black into a silhouette with no shape.
const FUR = 0x35323c;
const FUR_LIGHT = 0x4a4652;
const FUR_DARK = 0x24222a;
const NOSE = 0x0b0b0e;
const TONGUE = 0x4b4a9e;
const EYE = 0x080808;
const GLINT = 0xffffff;

const BITE_TIME = 0.5;
const LUNGE = 0.55;
const LOOK_RANGE = 6;

export interface DogSfx extends SpatialSfx {
  bark(): void;
  bite(): void;
}

/** Deterministic pseudo-random numbers so the fluff looks the same every load. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const blob = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

export class ChowChow {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private tail = new THREE.Group();
  private body: THREE.Mesh;
  private biteT: number | null = null;
  private biteDir = new THREE.Vector3();
  private t = 0;
  private lookYaw = 0;
  private barkCooldown = 0;
  private readonly zoneBox: THREE.Box3;

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    /** Where she sits (on the ground in front of the door). */
    private readonly spot: THREE.Vector3,
    /** Facing direction: 0 = looking toward -Z. */
    private readonly yaw: number,
    /** Anyone whose feet enter this box gets bitten. */
    zone: THREE.Box3,
    private readonly sfx: DogSfx,
  ) {
    this.zoneBox = zone.clone();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    const rand = seeded(7);
    const mesh = (parts: ColoredPart[], parent: THREE.Object3D) => {
      const m = new THREE.Mesh(mergeColoredParts(parts), mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Body, sitting: big haunches, deep chest, stubby straight legs, round paws. Local forward is -Z.
    const bodyParts: ColoredPart[] = [
      { geo: blob(0.3, 1), color: FUR, pos: [0, 0.3, 0.16], scale: [1.15, 0.85, 1.1] },
      { geo: blob(0.27, 1), color: FUR, pos: [0, 0.47, -0.05], scale: [1, 1.2, 0.95] },
      { geo: blob(0.2, 1), color: FUR_LIGHT, pos: [0, 0.32, -0.12] },
    ];
    for (const x of [-0.1, 0.1]) {
      bodyParts.push({ geo: new THREE.CapsuleGeometry(0.065, 0.24, 3, 8), color: FUR_DARK, pos: [x, 0.19, -0.16] });
      bodyParts.push({ geo: new THREE.SphereGeometry(0.075, 8, 6), color: FUR, pos: [x, 0.04, -0.2], scale: [1, 0.55, 1.3] });
      bodyParts.push({ geo: new THREE.SphereGeometry(0.08, 8, 6), color: FUR, pos: [x * 2, 0.045, 0.02], scale: [1.1, 0.55, 1.5] });
    }
    // The ruff: a ring of big tufts framing the face, like a lion's mane.
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      bodyParts.push({ geo: blob(0.12 + (k % 3) * 0.018), color: k % 2 ? FUR : FUR_LIGHT, pos: [Math.cos(a) * 0.27, 0.73 + Math.sin(a) * 0.23, -0.1 + Math.abs(Math.sin(a)) * 0.03] });
    }
    // Shaggy coat: loose tufts over the body.
    for (let k = 0; k < 22; k++) {
      const a = rand() * Math.PI * 2;
      const y = 0.18 + rand() * 0.45;
      const r = 0.24 + rand() * 0.06;
      bodyParts.push({ geo: blob(0.06 + rand() * 0.05), color: rand() < 0.5 ? FUR : FUR_LIGHT, pos: [Math.cos(a) * r, y, 0.05 + Math.sin(a) * r * 0.9] });
    }
    this.body = mesh(bodyParts, this.root);

    // Tail curled up over the back, fluffy.
    this.tail.position.set(0, 0.5, 0.36);
    const tailParts: ColoredPart[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      tailParts.push({ geo: blob(0.12 - t * 0.05, 0), color: i % 2 ? FUR : FUR_LIGHT, pos: [0.06 * t, 0.24 * Math.sin(Math.PI * t * 0.85), -0.24 * t] });
    }
    mesh(tailParts, this.tail);
    this.root.add(this.tail);

    // Head on a neck pivot: broad skull, cheek fluff, short muzzle, deep-set eyes, small rounded ears.
    this.head.position.set(0, 0.74, -0.18);
    mesh(
      [
        { geo: blob(0.19, 1), color: FUR, pos: [0, 0.04, -0.05], scale: [1.2, 0.95, 1.05] },
        { geo: blob(0.12), color: FUR_LIGHT, pos: [-0.14, -0.01, -0.06] },
        { geo: blob(0.12), color: FUR_LIGHT, pos: [0.14, -0.01, -0.06] },
        { geo: new THREE.SphereGeometry(0.085, 12, 10), color: FUR_LIGHT, pos: [0, -0.045, -0.2], scale: [1.1, 0.72, 1.05] },
        { geo: new THREE.SphereGeometry(0.028, 8, 6), color: NOSE, pos: [0, -0.02, -0.29], scale: [1.3, 0.85, 1] },
        { geo: new THREE.SphereGeometry(0.026, 8, 6), color: EYE, pos: [-0.075, 0.05, -0.205] },
        { geo: new THREE.SphereGeometry(0.026, 8, 6), color: EYE, pos: [0.075, 0.05, -0.205] },
        { geo: new THREE.SphereGeometry(0.009, 4, 3), color: GLINT, pos: [-0.068, 0.06, -0.228] },
        { geo: new THREE.SphereGeometry(0.009, 4, 3), color: GLINT, pos: [0.082, 0.06, -0.228] },
        { geo: blob(0.075), color: FUR, pos: [-0.085, 0.1, -0.16] },
        { geo: blob(0.075), color: FUR, pos: [0.085, 0.1, -0.16] },
        { geo: new THREE.ConeGeometry(0.058, 0.1, 5), color: FUR_DARK, pos: [-0.12, 0.2, -0.03], rot: [0, 0, 0.3] },
        { geo: new THREE.ConeGeometry(0.058, 0.1, 5), color: FUR_DARK, pos: [0.12, 0.2, -0.03], rot: [0, 0, -0.3] },
      ],
      this.head,
    );
    // Lower jaw with the blue-black tongue: opens to pant and to bite.
    this.jaw.position.set(0, -0.08, -0.14);
    mesh(
      [
        { geo: new THREE.SphereGeometry(0.07, 8, 6), color: FUR_LIGHT, pos: [0, -0.012, -0.07], scale: [1, 0.5, 1.3] },
        { geo: new THREE.SphereGeometry(0.045, 8, 6), color: TONGUE, pos: [0, -0.005, -0.13], scale: [1.05, 0.35, 1.6] },
      ],
      this.jaw,
    );
    this.head.add(this.jaw);
    this.root.add(this.head);

    this.root.position.copy(spot);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(1.15);
    scene.add(this.root);

    // Solid (you can't walk through her) and shootable: she only barks about it.
    const col = physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.5, 0.36).setTranslation(spot.x, spot.y + 0.5, spot.z).setCollisionGroups(WORLD_GROUPS),
      physics.staticBody,
    );
    physics.surfaces.set(col.handle, { material: 'grass', onShot: () => this.growl() });
  }

  /** The strip in front of her door (feet position). */
  contains(feet: THREE.Vector3): boolean {
    return this.zoneBox.containsPoint(feet);
  }

  /** Box for bots to route around. */
  get zone(): THREE.Box3 {
    return this.zoneBox;
  }

  private growl() {
    if (this.barkCooldown > 0) return;
    this.barkCooldown = 1.2;
    this.sfx.at(this.spot, 'normal', (s) => s.bark());
  }

  /** Lunge at a victim standing at `at`. */
  bite(at: THREE.Vector3) {
    this.sfx.at(this.spot, 'normal', (s) => s.bite());
    this.biteT = 0;
    this.biteDir.set(at.x - this.spot.x, 0, at.z - this.spot.z);
    if (this.biteDir.lengthSq() < 1e-4) this.biteDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.biteDir.normalize();
  }

  /** Per frame: breathe and pant, wag, follow the closest character within range, animate bites. */
  update(dt: number, nearby: THREE.Vector3[]) {
    this.t += dt;
    this.barkCooldown = Math.max(0, this.barkCooldown - dt);
    // Look at the closest character in front of her.
    let target: THREE.Vector3 | null = null;
    let best = LOOK_RANGE;
    for (const p of nearby) {
      const d = Math.hypot(p.x - this.spot.x, p.z - this.spot.z);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    let wantYaw = 0;
    if (target) {
      const worldYaw = Math.atan2(-(target.x - this.spot.x), -(target.z - this.spot.z));
      wantYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(worldYaw - this.yaw), Math.cos(worldYaw - this.yaw)), -1.1, 1.1);
    }
    this.lookYaw += (wantYaw - this.lookYaw) * Math.min(1, dt * 6);
    this.head.rotation.set(0, this.lookYaw, 0);
    // Panting when someone is around, calm breathing otherwise.
    const alert = target !== null;
    const breathe = Math.sin(this.t * (alert ? 9 : 2.2));
    this.body.scale.set(1, 1 + breathe * (alert ? 0.015 : 0.01), 1);
    this.jaw.rotation.x = alert ? 0.18 + breathe * 0.08 : 0.04;
    this.tail.rotation.z = Math.sin(this.t * (alert ? 7 : 2)) * (alert ? 0.25 : 0.08);

    // Bite: lunge out and back, jaw snapping shut at the peak.
    this.root.position.copy(this.spot);
    this.root.rotation.y = this.yaw;
    if (this.biteT !== null) {
      this.biteT += dt;
      const k = this.biteT / BITE_TIME;
      if (k >= 1) this.biteT = null;
      else {
        const out = Math.sin(Math.PI * k);
        this.root.position.addScaledVector(this.biteDir, out * LUNGE);
        this.root.rotation.y = Math.atan2(-this.biteDir.x, -this.biteDir.z);
        this.head.rotation.set(-0.25 * out, 0, 0);
        this.jaw.rotation.x = k < 0.45 ? 0.7 : 0.05;
      }
    }
  }
}

/** Canvas texture with the dog's name, for the plate over the doghouse door. */
export function namePlate(name: string, width: number, height: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * height) / width);
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e8';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#7a2f1e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `400 ${Math.round(c.height * 0.72)}px "Lilita One", system-ui, sans-serif`;
  g.fillText(name, c.width / 2, c.height * 0.54);
  // Tiny paw prints at the ends.
  const dot = (x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  for (const x of [c.width * 0.09, c.width * 0.91]) {
    dot(x, c.height * 0.62, c.height * 0.1);
    for (const [dx, dy] of [[-0.12, -0.2], [0, -0.27], [0.12, -0.2]]) dot(x + dx * c.height, c.height * (0.62 + dy), c.height * 0.045);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() }));
  return m;
}
