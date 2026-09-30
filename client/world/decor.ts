// Decorative props with recognisable silhouettes: the giant ice cream on the truck's roof and the lawn
// flamingos. Visual only; the map code gives them simple colliders.
import * as THREE from 'three';
import { mergeColoredParts, toonGradient, type ColoredPart } from '../render/materials';

/** Waffle pattern for the cone: diagonal grid of grooves on golden batter. */
function waffleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e2a857';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#a8692c';
  g.lineWidth = 7;
  for (let i = -128; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 128, 0);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,230,170,0.5)';
  g.lineWidth = 2;
  for (let i = -128; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i + 5, 0);
    g.lineTo(i + 133, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 2.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Giant ice cream cone for the truck's roof: waffle cone on a small mount, a strawberry scoop with the
 * scooped lip and drips over the rim, a vanilla scoop with sprinkles, and a cherry. `base` is the roof point
 * it stands on.
 */
export function iceCreamTopper(base: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(base);
  const toonMat = (opts: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });

  // Mount, then the cone standing on its tip.
  const CONE_H = 1.5;
  const CONE_R = 0.56;
  const TIP = 0.16;
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, TIP, 16), toonMat({ color: 0xff4f9a }));
  mount.position.y = TIP / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(CONE_R, CONE_H, 28, 1, true).rotateX(Math.PI), toonMat({ map: waffleTexture(), side: THREE.DoubleSide }));
  cone.position.y = TIP + CONE_H / 2;
  const rimY = TIP + CONE_H;

  const parts: ColoredPart[] = [
    // Cone rim.
    { geo: new THREE.TorusGeometry(CONE_R, 0.05, 8, 28), color: 0xc98a3f, pos: [0, rimY, 0], rot: [Math.PI / 2, 0, 0] },
  ];
  const scoop = (y: number, r: number, color: number, lipColor: number, drips: number) => {
    parts.push({ geo: new THREE.SphereGeometry(r, 20, 14), color, pos: [0, y, 0], scale: [1, 0.88, 1] });
    // The ridge a scoop leaves around its bottom edge.
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      parts.push({ geo: new THREE.SphereGeometry(r * (0.2 + (k % 3) * 0.03), 8, 6), color: lipColor, pos: [Math.cos(a) * r * 0.9, y - r * 0.5, Math.sin(a) * r * 0.9] });
    }
    // Drips running down.
    for (let k = 0; k < drips; k++) {
      const a = (k / drips) * Math.PI * 2 + 0.4;
      const len = 0.1 + ((k * 7) % 5) * 0.05;
      parts.push({ geo: new THREE.CapsuleGeometry(0.055, len, 3, 8), color: lipColor, pos: [Math.cos(a) * r * 0.93, y - r * 0.62 - len / 2, Math.sin(a) * r * 0.93] });
    }
  };
  const s1 = rimY + 0.36;
  scoop(s1, 0.64, 0xff8fbd, 0xff7cb0, 5);
  const s2 = s1 + 0.66;
  scoop(s2, 0.5, 0xfff1cf, 0xf7e2b0, 3);
  // Sprinkles on the top scoop.
  const colors = [0xff4f6d, 0x4fc3ff, 0xffe14d, 0x7bdc5a, 0xffffff, 0xb07bff];
  for (let k = 0; k < 26; k++) {
    const a = k * 2.399; // golden angle: evenly spread
    const el = 0.35 + ((k * 37) % 50) / 100; // latitude on the upper half
    const x = Math.cos(a) * Math.cos(el) * 0.5;
    const z = Math.sin(a) * Math.cos(el) * 0.5;
    const y = s2 + Math.sin(el) * 0.5 * 0.88;
    parts.push({ geo: new THREE.CapsuleGeometry(0.018, 0.06, 2, 4), color: colors[k % colors.length], pos: [x * 1.01, y, z * 1.01], rot: [a, k, el] });
  }
  // Cherry with its stem.
  const top = s2 + 0.5 * 0.88;
  parts.push({ geo: new THREE.SphereGeometry(0.14, 14, 10), color: 0xd81b3a, pos: [0, top + 0.1, 0] });
  parts.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), color: 0x4a7a2a, pos: [0.04, top + 0.3, 0], rot: [0, 0, -0.35] });

  const scoops = new THREE.Mesh(mergeColoredParts(parts), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));
  for (const m of [mount, cone, scoops]) {
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

/** Line segment as a thin cylinder (legs, stems). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, dir.length(), 6);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

/**
 * A flamingo standing on one leg (the other folded up), facing +X: plump body, folded wings with the black
 * flight feathers peeking out, S-shaped neck, and the bent pale beak with its black tip.
 */
export function flamingoGeometry(): THREE.BufferGeometry {
  const PINK = 0xff8fb8;
  const DEEP = 0xff6fa3;
  const NECK = 0xff9cc2;
  const LEG = 0xf0849e;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const neckCurve = new THREE.CatmullRomCurve3([V(0.3, 1.1, 0), V(0.42, 1.32, 0), V(0.36, 1.52, 0), V(0.27, 1.66, 0), V(0.32, 1.84, 0), V(0.44, 1.92, 0)]);
  // Beak: pale base bending down, black tip.
  const beakDir = new THREE.Euler(0, 0, -(Math.PI / 2 + 0.65));
  const parts: ColoredPart[] = [
    { geo: new THREE.SphereGeometry(0.3, 16, 12), color: PINK, pos: [0, 1.0, 0], scale: [1.35, 0.8, 0.75] },
    { geo: new THREE.ConeGeometry(0.13, 0.32, 8), color: DEEP, pos: [-0.44, 1.07, 0], rot: [0, 0, Math.PI / 2 - 0.3] },
    { geo: new THREE.TubeGeometry(neckCurve, 28, 0.045, 8), color: NECK, pos: [0, 0, 0] },
    { geo: new THREE.SphereGeometry(0.075, 12, 10), color: NECK, pos: [0.47, 1.92, 0], scale: [1.2, 0.95, 0.9] },
    { geo: new THREE.ConeGeometry(0.036, 0.13, 8), color: 0xf2e6d0, pos: [0.57, 1.88, 0], rot: [beakDir.x, beakDir.y, beakDir.z] },
    { geo: new THREE.ConeGeometry(0.022, 0.07, 8), color: 0x1b1b1b, pos: [0.64, 1.83, 0], rot: [beakDir.x, beakDir.y, beakDir.z] },
  ];
  for (const side of [-1, 1]) {
    parts.push({ geo: new THREE.SphereGeometry(0.25, 12, 8), color: DEEP, pos: [-0.05, 1.05, side * 0.16], scale: [1.25, 0.55, 0.3], rot: [0, 0, 0.12] });
    parts.push({ geo: new THREE.SphereGeometry(0.12, 8, 6), color: 0x222226, pos: [-0.33, 1.04, side * 0.15], scale: [1.3, 0.35, 0.35], rot: [0, 0, 0.2] });
    parts.push({ geo: new THREE.SphereGeometry(0.013, 6, 4), color: 0x111111, pos: [0.5, 1.94, side * 0.058] });
  }
  // Standing leg: backward-bending "knee" (the ankle), webbed foot. Folded leg tucked up under the body.
  const hip = V(0.02, 0.8, 0.03);
  const ankle = V(0.0, 0.42, 0.03);
  const foot = V(0.03, 0.03, 0.03);
  parts.push({ geo: limb(hip, ankle, 0.02), color: LEG, pos: [0, 0, 0] });
  parts.push({ geo: limb(ankle, foot, 0.018), color: LEG, pos: [0, 0, 0] });
  parts.push({ geo: new THREE.SphereGeometry(0.03, 8, 6), color: LEG, pos: [ankle.x, ankle.y, ankle.z] });
  parts.push({ geo: new THREE.BoxGeometry(0.14, 0.015, 0.09), color: LEG, pos: [0.06, 0.01, 0.03] });
  const hip2 = V(0.0, 0.8, -0.05);
  const ankle2 = V(0.08, 0.56, -0.05);
  const foot2 = V(-0.15, 0.66, -0.05);
  parts.push({ geo: limb(hip2, ankle2, 0.02), color: LEG, pos: [0, 0, 0] });
  parts.push({ geo: limb(ankle2, foot2, 0.018), color: LEG, pos: [0, 0, 0] });
  parts.push({ geo: new THREE.SphereGeometry(0.03, 8, 6), color: LEG, pos: [ankle2.x, ankle2.y, ankle2.z] });
  return mergeColoredParts(parts);
}
