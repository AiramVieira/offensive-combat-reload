// First-person models for every weapon level (primitives, like the rest of the placeholder art): the rifle
// with its sight and paint job per level, the seven "knives", and the land mine.
import * as THREE from 'three';
import type { KnifeModel, RifleLevel, RifleLook } from '@shared/progression';
import { PALETTE, toon } from './materials';

export interface RifleParts {
  /** Rigid parts, baked into one mesh by the viewmodel. */
  meshes: THREE.Mesh[];
  /** Unlit parts (red dot, reticle, Christmas lights): kept as separate meshes so they stay bright. */
  glow: THREE.Object3D[];
  /** The magazine (animated on reloads). */
  mag: THREE.Mesh;
  /** Height of the sight line above the gun origin: the ADS pose puts it at eye level. */
  sightY: number;
  /** Magnified optic: the game shows a scope overlay when fully aimed. */
  scoped: boolean;
}

interface Palette {
  metal: number;
  dark: number;
  furniture: number;
  stripe: number;
  optic: number;
}

const LOOKS: Record<RifleLook, Palette> = {
  padrao: { metal: 0x3a3f47, dark: 0x24272c, furniture: 0x6b5a45, stripe: PALETTE.teamA, optic: 0x2a2d33 },
  fita: { metal: 0x3a3f47, dark: 0x24272c, furniture: 0x5d5347, stripe: PALETTE.teamA, optic: 0x2a2d33 },
  tia: { metal: 0xe9e4ee, dark: 0x6b4a6e, furniture: 0xff8fc8, stripe: 0x7fe0c8, optic: 0x8a5a8e },
  natal: { metal: 0x3a3f47, dark: 0x24272c, furniture: 0xc0392b, stripe: 0x2e8b57, optic: 0x2a2d33 },
  chamas: { metal: 0x1f1f23, dark: 0x141417, furniture: 0x2b2b30, stripe: 0xff6a1a, optic: 0x1a1a1e },
  vovo: { metal: 0x2d3440, dark: 0x1e232b, furniture: 0x8a4f25, stripe: 0xc8a24a, optic: 0xc8a24a },
  ouro: { metal: 0xf2c230, dark: 0xb8860b, furniture: 0xd9a520, stripe: 0xfff1a8, optic: 0xe0b020 },
};

const glowMat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending });

export function rifleParts(level: RifleLevel): RifleParts {
  const c = LOOKS[level.visual];
  const meshes: THREE.Mesh[] = [];
  const glow: THREE.Object3D[] = [];
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    meshes.push(m);
    return m;
  };
  const lit = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    glow.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  add(box(0.05, 0.07, 0.32), c.metal, 0, 0, 0); // receiver
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.3, 8).rotateX(Math.PI / 2), c.dark, 0, 0.012, -0.31); // barrel
  add(box(0.056, 0.06, 0.2), c.furniture, 0, -0.004, -0.22); // handguard
  add(box(0.045, 0.075, 0.2), c.furniture, 0, -0.012, 0.25); // stock
  add(box(0.03, 0.085, 0.042), c.furniture, 0, -0.068, 0.085, 0.35); // pistol grip
  add(box(0.052, 0.008, 0.07), c.stripe, 0, 0.039, -0.1); // stripe
  const mag = new THREE.Mesh(box(0.034, 0.13, 0.06), toon(c.dark));
  mag.position.set(0, -0.09, -0.045);
  mag.rotation.x = 0.18;

  let sightY = 0.057;
  const sight = level.mira;
  if (sight === 'ferro') {
    add(box(0.006, 0.016, 0.01), c.dark, -0.014, 0.047, 0.1);
    add(box(0.006, 0.016, 0.01), c.dark, 0.014, 0.047, 0.1);
    add(box(0.034, 0.006, 0.01), c.dark, 0, 0.041, 0.1);
    add(box(0.006, 0.03, 0.006), c.dark, 0, 0.042, -0.36); // front post, tip at y≈0.057
    add(box(0.022, 0.012, 0.012), c.dark, 0, 0.03, -0.36);
  } else if (sight === 'pontoVermelho') {
    sightY = 0.07;
    // Small tube sight: a ring you look through (front and back rims) with a glowing dot in the middle.
    add(box(0.03, 0.014, 0.05), c.dark, 0, 0.042, 0.02);
    add(box(0.012, 0.012, 0.04), c.dark, 0, 0.052, 0.02);
    for (const z of [-0.005, 0.045]) add(new THREE.TorusGeometry(0.021, 0.0035, 8, 24), c.optic, 0, sightY, z);
    for (const x of [-0.021, 0.021]) add(box(0.004, 0.012, 0.05), c.optic, x, sightY, 0.02);
    lit(new THREE.CircleGeometry(0.02, 20).rotateY(Math.PI), glowMat(0xff6060, 0.12), 0, sightY, -0.004);
    lit(new THREE.SphereGeometry(0.0038, 10, 8), glowMat(0xff1a1a), 0, sightY, -0.003);
  } else if (sight === 'holo' || sight === 'holoLupa') {
    sightY = 0.076;
    // Open window frame with a smiley reticle floating in it.
    add(box(0.05, 0.012, 0.06), c.dark, 0, 0.041, 0.02);
    for (const x of [-0.027, 0.027]) add(box(0.006, 0.05, 0.05), c.optic, x, 0.07, 0.02);
    add(box(0.06, 0.006, 0.05), c.optic, 0, 0.097, 0.02);
    const reticle = glowMat(0xffd23f);
    const face = new THREE.Group();
    face.position.set(0, sightY, 0.0);
    face.add(new THREE.Mesh(new THREE.TorusGeometry(0.0065, 0.0007, 6, 24), reticle));
    for (const x of [-0.0024, 0.0024]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0008, 6, 4), reticle);
      eye.position.set(x, 0.0018, 0);
      face.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.0032, 0.0006, 6, 16, Math.PI), reticle);
    smile.rotation.z = Math.PI;
    smile.position.y = -0.0005;
    face.add(smile);
    glow.push(face);
    if (sight === 'holoLupa') {
      // Flip magnifier behind the holo: a short tube the eye looks through.
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 16, 1, true).rotateX(Math.PI / 2), c.optic, 0, sightY, 0.11);
      add(box(0.012, 0.03, 0.02), c.dark, 0, 0.05, 0.11);
    }
  } else {
    // Scopes: longer and bigger with the magnification. Aiming shows the scope overlay instead.
    sightY = 0.085;
    const power = sight === 'luneta2x' ? 1 : sight === 'luneta3x' ? 1.2 : 1.35;
    const len = 0.16 * power;
    add(new THREE.CylinderGeometry(0.016, 0.016, len, 16).rotateX(Math.PI / 2), c.optic, 0, sightY, 0.0);
    add(new THREE.CylinderGeometry(0.024 * power, 0.016, 0.05, 16).rotateX(Math.PI / 2), c.optic, 0, sightY, -len / 2 - 0.02);
    add(new THREE.CylinderGeometry(0.019, 0.019, 0.04, 16).rotateX(Math.PI / 2), c.optic, 0, sightY, len / 2 + 0.01);
    for (const z of [-0.045, 0.045]) add(box(0.02, 0.05, 0.016), c.dark, 0, 0.056, z);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10), c.dark, 0.022, sightY, 0); // turret
    lit(new THREE.CircleGeometry(0.023 * power, 16).rotateY(Math.PI), glowMat(0x7fb8ff, 0.35), 0, sightY, -len / 2 - 0.046);
  }

  // Paint jobs.
  if (level.visual === 'fita') {
    for (const [z, rz] of [[-0.17, 0.12], [-0.27, -0.08]] as const) add(box(0.064, 0.068, 0.022), 0xc9c9c9, 0, -0.004, z, 0, rz);
    add(box(0.053, 0.083, 0.03), 0xc9c9c9, 0, -0.012, 0.23, 0, 0.1);
  } else if (level.visual === 'tia') {
    // Flower sticker on the stock.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      add(new THREE.SphereGeometry(0.009, 8, 6), 0xffffff, 0.024, -0.01 + Math.sin(a) * 0.012, 0.25 + Math.cos(a) * 0.012);
    }
    add(new THREE.SphereGeometry(0.008, 8, 6), 0xffd23f, 0.026, -0.01, 0.25);
  } else if (level.visual === 'natal') {
    // Blinking-looking string of lights along the handguard and barrel.
    const colors = [0xff3b3b, 0x3bff6a, 0xffe14d, 0x4fa3ff];
    for (let k = 0; k < 9; k++) {
      const z = -0.12 - k * 0.035;
      const x = (k % 2 ? 1 : -1) * 0.022;
      const y = k < 5 ? 0.03 : 0.024;
      add(box(0.004, 0.004, 0.036), 0x1a3a1a, x * 0.5, y + 0.002, z + 0.017);
      lit(new THREE.SphereGeometry(0.0065, 8, 6), glowMat(colors[k % colors.length]), x, y, z);
    }
  } else if (level.visual === 'chamas') {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const flame = new THREE.ConeGeometry(0.012, 0.05 - k * 0.008, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(0.3, 1, 1);
        add(flame, k === 1 ? 0xffd23f : 0xff6a1a, side * 0.027, -0.012 + k * 0.012, 0.02 + k * 0.03, 0, 0);
      }
    }
  } else if (level.visual === 'ouro') {
    for (const side of [-1, 1]) add(new THREE.OctahedronGeometry(0.009), 0xff2a4a, side * 0.027, 0.005, 0.05);
  }
  return { meshes, glow, mag, sightY, scoped: sight.startsWith('luneta') };
}

/** The held "blade" for each knife level, pointing down -Z from the fist at the origin. */
export function knifeModel(model: KnifeModel): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const along = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  if (model === 'faca') {
    add(new THREE.BoxGeometry(0.012, 0.035, 0.2), toon(0xd8dde3), 0, 0, -0.14);
    add(new THREE.ConeGeometry(0.018, 0.06, 4).rotateX(-Math.PI / 2).scale(0.4, 1, 1), toon(0xd8dde3), 0, 0, -0.27);
    add(new THREE.BoxGeometry(0.02, 0.06, 0.015), toon(0x24272c), 0, 0, -0.035);
    add(new THREE.BoxGeometry(0.026, 0.032, 0.1), toon(0x3b2a1e), 0, 0, 0.02);
  } else if (model === 'colher') {
    const wood = toon(0xc69c6d);
    add(new THREE.BoxGeometry(0.018, 0.012, 0.3), wood, 0, 0, -0.1);
    add(new THREE.SphereGeometry(0.036, 12, 8).scale(1, 0.35, 1.45), wood, 0, 0.004, -0.29);
  } else if (model === 'frango') {
    // Yellow rubber chicken held by the feet: long floppy body, skinny neck, red comb, open beak.
    const yellow = toon(0xffd83a);
    const orange = toon(0xff8a1f);
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.05).rotateX(Math.PI / 2), orange, -0.008, 0, -0.02);
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.05).rotateX(Math.PI / 2), orange, 0.008, 0, -0.02);
    add(new THREE.SphereGeometry(0.042, 12, 10).scale(1, 0.9, 1.8), yellow, 0, 0, -0.12);
    for (const x of [-0.04, 0.04]) add(new THREE.SphereGeometry(0.022, 8, 6).scale(0.4, 0.8, 1.4), yellow, x, 0.005, -0.12);
    add(along(new THREE.CapsuleGeometry(0.014, 0.1, 4, 8)), yellow, 0, 0.005, -0.25);
    add(new THREE.SphereGeometry(0.026, 10, 8), yellow, 0, 0.012, -0.32);
    for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.009, 6, 4), toon(0xe0263b), 0, 0.036 + (k === 1 ? 0.006 : 0), -0.31 - k * 0.012);
    add(new THREE.ConeGeometry(0.012, 0.03, 6).rotateX(-Math.PI / 2), orange, 0, 0.008, -0.35);
    for (const x of [-0.012, 0.012]) add(new THREE.SphereGeometry(0.004, 6, 4), toon(0x111111), x, 0.02, -0.335);
  } else if (model === 'baguete') {
    const crust = toon(0xd9a04e);
    add(along(new THREE.CapsuleGeometry(0.028, 0.4, 6, 12)), crust, 0, 0, -0.2);
    for (let k = 0; k < 5; k++) {
      const cut = add(new THREE.BoxGeometry(0.03, 0.006, 0.012), toon(0xf3d7a0), 0, 0.026, -0.06 - k * 0.075);
      cut.rotation.y = 0.6;
    }
  } else if (model === 'peixe') {
    // Frozen fish held by the tail.
    const fish = toon(0x8fb3c9);
    add(new THREE.ConeGeometry(0.035, 0.05, 4).rotateX(Math.PI / 2).scale(0.25, 1.2, 1), fish, 0, 0, -0.01);
    add(new THREE.SphereGeometry(0.045, 12, 10).scale(0.45, 1, 2.8), fish, 0, 0, -0.17);
    add(new THREE.SphereGeometry(0.006, 6, 4), toon(0x111111), 0.018, 0.012, -0.28);
    add(new THREE.ConeGeometry(0.01, 0.03, 4), toon(0x6f93a9), 0, 0.045, -0.15);
    for (let k = 0; k < 7; k++) add(new THREE.SphereGeometry(0.006, 5, 4), toon(0xffffff), (k % 2 ? 1 : -1) * 0.02, -0.02 + (k % 3) * 0.02, -0.07 - k * 0.028);
  } else if (model === 'macarrao') {
    add(along(new THREE.CylinderGeometry(0.036, 0.036, 0.6, 14)), toon(0x39d353), 0, 0, -0.29);
    add(new THREE.CircleGeometry(0.014, 12).rotateY(Math.PI), toon(0x1c7a2a), 0, 0, -0.591);
  } else {
    // Knock-off lightsaber: silver hilt, hot pink blade with a soft glow.
    add(along(new THREE.CylinderGeometry(0.015, 0.015, 0.13, 12)), toon(0xc9ccd1), 0, 0, 0.0);
    for (const z of [0.02, -0.01, -0.04]) add(along(new THREE.CylinderGeometry(0.0165, 0.0165, 0.012, 12)), toon(0x1c1c20), 0, 0, z);
    add(along(new THREE.CylinderGeometry(0.011, 0.009, 0.55, 12)), glowMat(0xffe6fb), 0, 0, -0.34);
    add(along(new THREE.CylinderGeometry(0.024, 0.02, 0.57, 12)), glowMat(0xff3df0, 0.35), 0, 0, -0.34);
  }
  return g;
}

/** Land mine: olive disc with a pressure plate and a red LED (returned so it can blink). */
export function mineModel(): { group: THREE.Group; led: THREE.Mesh } {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), toon(0x4a5a32));
  body.position.y = 0.03;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16), toon(0x6f7d52));
  plate.position.y = 0.07;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  led.position.set(0.11, 0.065, 0);
  g.add(body, plate, led);
  g.traverse((o) => (o.castShadow = true));
  return { group: g, led };
}

