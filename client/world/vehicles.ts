// Street vehicles built from shaped pieces instead of plain boxes: an extruded side silhouette with wheel
// arches, cabin with pillars and glass, wheels with alloy rims, bumpers, grille, lights, Mercosul plates,
// mirrors and door seams. Everything goes into the static batches (a car is a handful of pieces per
// surface, so draw calls don't grow). Collision stays a few cuboids per vehicle, so bullets, movement and
// the navmesh behave exactly like the old blockout.
//
// Vehicle space: +X is the front, +Y up, Z across (the vehicle is symmetric in Z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { worldUVs, type MapBuilder } from './mapBuilder';
import type { SurfaceInfo } from './physics';
import { surfaceMaterial, type SurfaceKey } from './surfaces';

type Mat = SurfaceKey | 'luz';

const TIRE = 0x2b2b30;
const SIDEWALL = 0x3c3e44;
const RIM = 0xc7cbd1;
const SPOKE = 0x9aa0a8;
const HUB = 0x6d737b;
const PLASTIC = 0x33363b;
const GRILLE = 0x1c1e22;
const CHROME = 0xd9dde2;
const PLATE = 0xf4f4f4;
const PLATE_BAND = 0x1f4fb5;
const HEADLIGHT = 0xfff4c8;
const TAILLIGHT = 0xff2a2a;
const SIGNAL = 0xffa630;
const CAR_GLASS = 0x55789a;

/** Unlit material for lamps: they read as "on" in shade too. */
let lampMaterial: THREE.MeshBasicMaterial | null = null;
const lamps = () => (lampMaterial ??= Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { name: 'MAT_farol' }));

/**
 * Car-paint UVs in vehicle meters: sides read u = length, v = height (the paint texture puts the horizon
 * reflection just under the beltline); upward faces all sample the glossy top band. Tall vehicles clamp v
 * so the roof never wraps into the dark rocker band.
 */
function paintUVs(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const frontal = Math.abs(nor.getX(i)) > Math.abs(nor.getZ(i));
    uv[i * 2] = frontal ? z : x;
    uv[i * 2 + 1] = nor.getY(i) > 0.75 ? 1.6 + x * 0.02 : Math.min(y, 1.95);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Places parts given in vehicle space into the map. */
class Kit {
  private m: THREE.Matrix4;
  private q: THREE.Quaternion;

  constructor(
    private b: MapBuilder,
    x: number,
    z: number,
    rotY: number,
  ) {
    this.m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
    this.q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  }

  add(geo: THREE.BufferGeometry, mat: Mat, tint: THREE.ColorRepresentation, shadow = false) {
    if (mat === 'lataria') paintUVs(geo);
    geo.applyMatrix4(this.m);
    if (mat !== 'lataria') worldUVs(geo);
    this.b.addGeometry(geo, mat === 'luz' ? lamps() : surfaceMaterial(mat), tint, shadow);
    geo.dispose();
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: Mat, tint: THREE.ColorRepresentation, radius = 0, shadow = false) {
    const geo = radius > 0 ? new RoundedBoxGeometry(sx, sy, sz, 2, radius) : new THREE.BoxGeometry(sx, sy, sz);
    geo.translate(cx, cy, cz);
    this.add(geo, mat, tint, shadow);
  }

  /** The same box on both sides (z and -z). */
  pair(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: Mat, tint: THREE.ColorRepresentation, radius = 0, shadow = false) {
    this.box(cx, cy, cz, sx, sy, sz, mat, tint, radius, shadow);
    this.box(cx, cy, -cz, sx, sy, sz, mat, tint, radius, shadow);
  }

  /** Extruded side silhouette, centered in Z, `width` wide including the rounded bevel. */
  extrude(shape: THREE.Shape, width: number, bevel: number, mat: Mat, tint: THREE.ColorRepresentation) {
    const t = bevel * 1.3;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * t, bevelEnabled: true, bevelThickness: t, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
    geo.translate(0, 0, -(width - 2 * t) / 2);
    this.add(geo, mat, tint, true);
  }

  /** Flat panel on the side faces (windows, decals), drawn on both sides or only on `sides`. */
  pane(shape: (mirror: 1 | -1) => THREE.Shape, zAbs: number, mat: Mat, tint: THREE.ColorRepresentation, sides: (1 | -1)[] = [1, -1]) {
    for (const side of sides) {
      const geo = new THREE.ShapeGeometry(shape(side), 6);
      // ShapeGeometry faces +Z; the -Z copy is drawn mirrored in X and turned around.
      if (side < 0) geo.rotateY(Math.PI);
      geo.translate(0, 0, side * zAbs);
      this.add(geo, mat, tint);
    }
  }

  /** Flat quad facing `out` (windshields, rear windows). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3, mat: Mat, tint: THREE.ColorRepresentation) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const geo = new THREE.BufferGeometry().setFromPoints(n.dot(out) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]);
    geo.computeVertexNormals();
    this.add(geo, mat, tint);
  }

  /** Tire with sidewall ring, alloy rim with spokes and hub; `side` is where the outer face points. */
  wheel(x: number, z: number, r: number, w: number, side: 1 | -1) {
    const axis = (geo: THREE.BufferGeometry, zc: number) => geo.rotateX(Math.PI / 2).translate(x, r, zc);
    const outer = z + (side * w) / 2;
    this.add(axis(new THREE.CylinderGeometry(r, r, w, 20), z), 'pintura', TIRE, true);
    this.add(axis(new THREE.CylinderGeometry(r * 0.74, r * 0.74, 0.02, 18), outer), 'pintura', SIDEWALL);
    this.add(axis(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.02, 18), outer + side * 0.012), 'pintura', RIM);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.BoxGeometry(0.045, r * 1.1, 0.012).rotateZ((k * Math.PI) / 5);
      this.add(spoke.translate(x, r, outer + side * 0.026), 'pintura', SPOKE);
    }
    this.add(axis(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.03, 12), outer + side * 0.03), 'pintura', HUB);
  }

  /** Mercosul plate: white with the blue band on top; `face` = x of the surface, `dir` = which way it faces. */
  plate(face: number, y: number, dir: 1 | -1) {
    this.box(face + dir * 0.012, y, 0, 0.02, 0.13, 0.4, 'pintura', PLATE);
    this.box(face + dir * 0.014, y + 0.05, 0, 0.02, 0.03, 0.4, 'pintura', PLATE_BAND);
  }

  collider(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, onShot?: SurfaceInfo['onShot']) {
    const c = new THREE.Vector3(cx, cy, cz).applyMatrix4(this.m);
    this.b.cuboidCollider(c, new THREE.Vector3(hx, hy, hz), this.q, 'metal', onShot);
  }
}

/** Wheel-arch notch along the bottom edge of a silhouette being drawn toward +X. */
function arch(s: THREE.Shape, cx: number, axleY: number, r: number, bottom: number) {
  const a0 = Math.asin((bottom - axleY) / r);
  s.lineTo(cx - r * Math.cos(a0), bottom);
  s.absarc(cx, axleY, r, Math.PI - a0, a0, true);
}

const darker = (c: THREE.ColorRepresentation, k: number) => new THREE.Color(c).multiplyScalar(k);

/** Compact hatchback/sedan, 4.2 m long, 1.8 m wide: body is waist-high cover, the cabin blocks a crouch. */
export function buildCar(b: MapBuilder, x: number, z: number, color: THREE.ColorRepresentation, rotY = 0) {
  const k = new Kit(b, x, z, rotY);
  const WB = 1.3; // half wheelbase
  const R = 0.34; // wheel radius
  const BOT = 0.3;
  const HW = 0.9; // half width of the body side
  const trim = darker(color, 0.72);

  // Body: rounded nose and tail, a hood rising toward the windshield, arches over the wheels.
  const body = new THREE.Shape();
  body.moveTo(2.04, BOT);
  body.lineTo(2.04, 0.7);
  body.quadraticCurveTo(2.04, 0.86, 1.86, 0.88);
  body.lineTo(0.8, 0.98);
  body.lineTo(-1.3, 0.98);
  body.lineTo(-1.86, 0.96);
  body.quadraticCurveTo(-2.04, 0.95, -2.04, 0.76);
  body.lineTo(-2.04, BOT);
  arch(body, -WB, R, 0.46, BOT);
  arch(body, WB, R, 0.46, BOT);
  body.lineTo(2.04, BOT);
  k.extrude(body, HW * 2, 0.06, 'lataria', color);

  // Cabin (greenhouse): raked windshield, short rear window, rounded roof.
  const cabin = new THREE.Shape();
  cabin.moveTo(0.85, 0.9);
  cabin.lineTo(0.02, 1.44);
  cabin.quadraticCurveTo(-0.08, 1.5, -0.2, 1.5);
  cabin.lineTo(-0.85, 1.5);
  cabin.quadraticCurveTo(-0.97, 1.5, -1.05, 1.44);
  cabin.lineTo(-1.45, 0.9);
  cabin.lineTo(0.85, 0.9);
  k.extrude(cabin, 1.54, 0.04, 'lataria', color);
  const CABIN_SIDE = 0.77 + 0.004;

  // Side windows split by the B-pillar; windshield and rear window sit just off the rounded glass faces.
  const poly = (pts: [number, number][]) => (m: 1 | -1) => new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(m * px, py)));
  k.pane(poly([[0.468, 1.09], [-0.039, 1.42], [-0.25, 1.42], [-0.25, 1.09]]), CABIN_SIDE, 'vidro', CAR_GLASS);
  k.pane(poly([[-0.35, 1.09], [-0.35, 1.42], [-0.975, 1.42], [-1.219, 1.09]]), CABIN_SIDE, 'vidro', CAR_GLASS);
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  const ws = V(0.545, 0.838, 0).multiplyScalar(0.045);
  k.quad(V(0.589 + ws.x, 1.07 + ws.y, -0.66), V(0.589 + ws.x, 1.07 + ws.y, 0.66), V(0.051 + ws.x, 1.42 + ws.y, 0.66), V(0.051 + ws.x, 1.42 + ws.y, -0.66), V(1, 1, 0), 'vidro', CAR_GLASS);
  const rw = V(-0.804, 0.595, 0).multiplyScalar(0.045);
  k.quad(V(-1.324 + rw.x, 1.07 + rw.y, -0.64), V(-1.324 + rw.x, 1.07 + rw.y, 0.64), V(-1.065 + rw.x, 1.42 + rw.y, 0.64), V(-1.065 + rw.x, 1.42 + rw.y, -0.64), V(-1, 1, 0), 'vidro', CAR_GLASS);

  // Dark underbody between the wheels, then the wheels.
  k.box(0, 0.23, 0, 3.7, 0.18, 1.56, 'pintura', GRILLE);
  for (const wx of [-WB, WB]) for (const side of [1, -1] as const) k.wheel(wx, side * 0.76, R, 0.24, side);

  // Bumpers, grille, lamps and plates.
  k.box(2.1, 0.38, 0, 0.22, 0.26, 1.84, 'pintura', PLASTIC, 0.06, true);
  k.box(-2.1, 0.38, 0, 0.22, 0.26, 1.84, 'pintura', PLASTIC, 0.06, true);
  k.box(2.095, 0.6, 0, 0.05, 0.14, 0.7, 'pintura', GRILLE, 0.02);
  k.box(2.118, 0.6, 0, 0.02, 0.022, 0.72, 'pintura', CHROME);
  k.pair(2.085, 0.66, 0.6, 0.06, 0.12, 0.32, 'luz', HEADLIGHT, 0.025);
  k.pair(2.09, 0.55, 0.7, 0.05, 0.05, 0.12, 'luz', SIGNAL);
  k.pair(-2.085, 0.66, 0.6, 0.06, 0.14, 0.34, 'luz', TAILLIGHT, 0.025);
  k.pair(-2.116, 0.64, 0.5, 0.02, 0.05, 0.08, 'luz', 0xf0f0f0);
  k.plate(2.21, 0.39, 1);
  k.plate(-2.21, 0.39, -1);

  // Side details: character line under the beltline, door seams, handles, sill, mirrors.
  const S = HW + 0.003;
  k.pair(0, 0.865, S, 3.9, 0.02, 0.006, 'pintura', trim);
  k.pair(0.72, 0.65, S, 0.012, 0.62, 0.006, 'pintura', trim);
  k.pair(-0.3, 0.64, S, 0.012, 0.64, 0.006, 'pintura', trim);
  k.pair(-1.0, 0.835, S, 0.012, 0.25, 0.006, 'pintura', trim);
  k.pair(0.35, 0.8, S + 0.004, 0.14, 0.03, 0.012, 'pintura', PLASTIC);
  k.pair(-0.6, 0.8, S + 0.004, 0.14, 0.03, 0.012, 'pintura', PLASTIC);
  k.pair(0, 0.34, S, 1.6, 0.08, 0.006, 'pintura', PLASTIC);
  k.pair(0.5, 1.07, 0.86, 0.05, 0.03, 0.14, 'pintura', PLASTIC);
  k.pair(0.5, 1.12, 0.96, 0.1, 0.1, 0.14, 'lataria', color, 0.03);

  // Collision: waist-high body (with the bumpers) and the cabin.
  k.collider(0, 0.62, 0, 2.2, 0.44, HW);
  k.collider(-0.3, 1.27, 0, 0.95, 0.24, 0.76);
}

/** Moving van next to the orange spawn: same footprint as the old box (4.5 x 2.2 x 2.6 m), front at +X. */
export function buildVan(b: MapBuilder, x: number, z: number, color: THREE.ColorRepresentation, stripe: THREE.ColorRepresentation) {
  const k = new Kit(b, x, z, 0);
  const WB = 1.45;
  const R = 0.38;
  const BOT = 0.35;
  const HW = 1.1;
  const trim = darker(color, 0.75);

  const s = new THREE.Shape();
  s.moveTo(2.2, BOT);
  s.lineTo(2.2, 1.2);
  s.quadraticCurveTo(2.2, 1.35, 2.05, 1.42);
  s.lineTo(1.95, 1.5);
  s.lineTo(1.5, 2.4);
  s.quadraticCurveTo(1.42, 2.55, 1.2, 2.55);
  s.lineTo(-2.05, 2.55);
  s.quadraticCurveTo(-2.2, 2.55, -2.2, 2.4);
  s.lineTo(-2.2, BOT);
  arch(s, -WB, R, 0.5, BOT);
  arch(s, WB, R, 0.5, BOT);
  s.lineTo(2.2, BOT);
  k.extrude(s, HW * 2, 0.05, 'lataria', color);

  // Glass: raked windshield, cab door windows, two small rear-door windows.
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  const off = V(0.894, 0.447, 0).multiplyScalar(0.055);
  k.quad(V(1.9 + off.x, 1.6 + off.y, -0.95), V(1.9 + off.x, 1.6 + off.y, 0.95), V(1.55 + off.x, 2.3 + off.y, 0.95), V(1.55 + off.x, 2.3 + off.y, -0.95), V(1, 0.5, 0), 'vidro', CAR_GLASS);
  const poly = (pts: [number, number][]) => (m: 1 | -1) => new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(m * px, py)));
  k.pane(poly([[1.8, 1.6], [1.45, 2.3], [0.8, 2.3], [0.8, 1.6]]), HW + 0.004, 'vidro', CAR_GLASS);
  for (const wz of [0.5, -0.5]) k.quad(V(-2.255, 1.75, wz - 0.32), V(-2.255, 1.75, wz + 0.32), V(-2.255, 2.25, wz + 0.32), V(-2.255, 2.25, wz - 0.32), V(-1, 0, 0), 'vidro', CAR_GLASS);

  k.box(0, 0.26, 0, 3.9, 0.2, 1.9, 'pintura', GRILLE);
  for (const wx of [-WB, WB]) for (const side of [1, -1] as const) k.wheel(wx, side * 0.96, R, 0.28, side);

  // Front: bumper, grille, headlights, plate, big mirrors. Rear: bumper, tall lamps, door seam, plate.
  k.box(2.25, 0.47, 0, 0.24, 0.3, 2.24, 'pintura', PLASTIC, 0.06, true);
  k.box(-2.25, 0.47, 0, 0.24, 0.3, 2.24, 'pintura', PLASTIC, 0.06, true);
  k.box(2.24, 0.95, 0, 0.05, 0.24, 0.9, 'pintura', GRILLE, 0.02);
  k.box(2.262, 0.95, 0, 0.02, 0.03, 0.92, 'pintura', CHROME);
  k.pair(2.235, 1.0, 0.76, 0.05, 0.16, 0.34, 'luz', HEADLIGHT, 0.02);
  k.pair(2.24, 0.82, 0.9, 0.04, 0.06, 0.14, 'luz', SIGNAL);
  k.pair(-2.232, 1.05, 0.96, 0.05, 0.5, 0.12, 'luz', TAILLIGHT, 0.02);
  k.box(-2.253, 1.45, 0, 0.012, 2.0, 0.012, 'pintura', trim);
  k.plate(2.37, 0.47, 1);
  k.plate(-2.37, 0.47, -1);
  k.pair(1.45, 1.75, 1.18, 0.06, 0.04, 0.16, 'pintura', PLASTIC);
  k.pair(1.45, 1.8, 1.3, 0.1, 0.26, 0.1, 'pintura', PLASTIC, 0.03);

  // Sides: moving-company stripes, cab door and sliding door seams, handles.
  const S = HW + 0.003;
  k.pair(-0.2, 1.12, S, 4.0, 0.22, 0.006, 'pintura', stripe);
  k.pair(-0.2, 1.3, S, 4.0, 0.05, 0.006, 'pintura', stripe);
  k.pair(0.72, 1.45, S, 0.014, 2.0, 0.006, 'pintura', trim);
  k.pair(-0.9, 1.45, S, 0.014, 2.0, 0.006, 'pintura', trim);
  k.pair(0.9, 1.5, S + 0.004, 0.16, 0.035, 0.012, 'pintura', PLASTIC);
  k.pair(-0.75, 1.5, S + 0.004, 0.035, 0.18, 0.012, 'pintura', PLASTIC);

  k.collider(0, 1.3, 0, 2.25, 1.3, HW);
}

/** Ice cream truck in the middle of the street (front at -X), same colliders as the old two boxes. */
export function buildIceCreamTruck(b: MapBuilder, color: THREE.ColorRepresentation, trimColor: THREE.ColorRepresentation, onShot: SurfaceInfo['onShot']) {
  const k = new Kit(b, 0, 0, 0);
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);

  // Box body and cab.
  k.box(1, 1.525, 0, 7, 2.45, 2.6, 'lataria', color, 0.12, true);
  k.box(-3.4, 1.075, 0, 1.8, 1.55, 2.5, 'lataria', trimColor, 0.1, true);
  k.box(0.1, 0.24, 0, 8.4, 0.18, 2.2, 'pintura', GRILLE);

  // Cab glass and door seam.
  k.quad(V(-4.306, 1.2, -1.0), V(-4.306, 1.2, 1.0), V(-4.306, 1.72, 1.0), V(-4.306, 1.72, -1.0), V(-1, 0, 0), 'vidro', CAR_GLASS);
  const rect = (x0: number, y0: number, x1: number, y1: number) => (m: 1 | -1) => new THREE.Shape([new THREE.Vector2(m * x0, y0), new THREE.Vector2(m * x1, y0), new THREE.Vector2(m * x1, y1), new THREE.Vector2(m * x0, y1)]);
  k.pane(rect(-4.12, 1.2, -3.12, 1.72), 1.254, 'vidro', CAR_GLASS);
  k.pair(-3.0, 1.05, 1.253, 0.014, 1.4, 0.006, 'pintura', darker(trimColor, 0.7));

  // Wheels under fender flares.
  for (const wx of [-3.4, 3.2]) {
    for (const side of [1, -1] as const) {
      k.wheel(wx, side * 1.18, 0.42, 0.3, side);
      const fender = new THREE.CylinderGeometry(0.54, 0.54, 0.36, 14, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(wx, 0.42, side * 1.18);
      k.add(fender, 'pintura', PLASTIC);
    }
  }

  // Serving hatch with a counter and a pink awning (south side), cone decals on both sides.
  const S = 1.3 + 0.005;
  k.pane(rect(-0.2, 1.35, 2.6, 2.3), S, 'pintura', 0x3a2f3f, [1]);
  for (const [cx, cy, sx, sy] of [[1.2, 2.33, 2.9, 0.06], [1.2, 1.32, 2.9, 0.06], [-0.23, 1.825, 0.06, 1.0], [2.63, 1.825, 0.06, 1.0]]) k.box(cx, cy, S, sx, sy, 0.02, 'pintura', 0xffffff);
  k.box(1.2, 1.3, 1.46, 3.0, 0.06, 0.32, 'pintura', 0xffffff);
  const awning = new THREE.BoxGeometry(3.2, 0.05, 0.8).rotateX(0.4).translate(1.2, 2.52, 1.64);
  k.add(awning, 'pintura', trimColor, true);
  const cone = (cx: number, cy: number, size: number) => {
    const scoop = (m: 1 | -1) => new THREE.Shape().absarc(m * cx, cy + size * 0.35, size * 0.42, 0, Math.PI * 2, false);
    const wafer = (m: 1 | -1) => new THREE.Shape([new THREE.Vector2(m * (cx - size * 0.4), cy + size * 0.3), new THREE.Vector2(m * cx, cy - size * 0.75), new THREE.Vector2(m * (cx + size * 0.4), cy + size * 0.3)]);
    return { scoop, wafer };
  };
  const big = cone(1.0, 1.6, 1.0);
  k.pane(big.wafer, S, 'pintura', 0xe2b36a, [-1]);
  k.pane(big.scoop, S + 0.002, 'pintura', 0xff9ec9, [-1]);
  const small = cone(3.6, 1.8, 0.6);
  k.pane(small.wafer, S, 'pintura', 0xe2b36a, [1]);
  k.pane(small.scoop, S + 0.002, 'pintura', 0x9ee6ff, [1]);
  k.pair(1, 0.68, S - 0.002, 7.0, 0.25, 0.006, 'pintura', trimColor);

  // Front and back: bumpers, grille, lamps, plates, rear door seam.
  k.box(-4.35, 0.42, 0, 0.26, 0.3, 2.56, 'pintura', PLASTIC, 0.06, true);
  k.box(4.55, 0.42, 0, 0.26, 0.3, 2.6, 'pintura', PLASTIC, 0.06, true);
  k.box(-4.315, 0.72, 0, 0.04, 0.24, 0.9, 'pintura', GRILLE);
  k.box(-4.33, 0.72, 0, 0.02, 0.03, 0.92, 'pintura', CHROME);
  k.pair(-4.312, 0.72, 0.85, 0.04, 0.16, 0.36, 'luz', HEADLIGHT, 0.015);
  k.pair(4.512, 0.8, 1.0, 0.04, 0.24, 0.3, 'luz', TAILLIGHT, 0.015);
  k.box(4.507, 1.55, 0, 0.012, 2.3, 0.014, 'pintura', darker(color, 0.7));
  k.plate(-4.48, 0.42, -1);
  k.plate(4.68, 0.42, 1);

  k.collider(1, 1.45, 0, 3.5, 1.3, 1.3, onShot);
  k.collider(-3.4, 1.0, 0, 0.9, 0.85, 1.25, onShot);
}
