// Tactical gear (catalog "tatico"): vests and plate carriers, belts, holsters, pouches, packs, pads, the ghillie
// and the rain cape. Gear is built from a few shapes laid over the body's own surfaces (torso, legs, arms, head)
// at an offset that clears the clothes under it, so it fits every body and follows the build morphs:
// - sheets: plates, soft panels, cups and lames, with their thickness modeled all around (style guide);
// - bands: straps along a path (over a shoulder, around a leg, across the body), a 4-sided section;
// - boxes: pouches, flaps, buckles and radios stuck to the sheet they hang on;
// - tufts: the ghillie's shaggy strips (flat pyramids).
//
// Layering: vests sit outside jackets (inner face at VEST_D, 2 cm over a heavy jacket; puffers may clip).
// Things clipped to the chest (slot acessorioColete) sit on their own placard whose face is at MOUNT, the outer
// face of the plates, held by a strap around the chest: with a vest the placard sinks into it and the item lies
// on the vest; without one it reads as a small placard rig. Every vest keeps the upper chest (1.22–1.36 m,
// |X| < 0.12) free of pouches for it. Torso gear uses region 'none' (the torso is never hidden, and a jacket's
// `over` must not hide it); limb gear uses the limb's region so a PCD limb takes it away (arms: see armRegion).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { Generator, PieceGeometry } from '.';
import { BodyParts, headShape, headShell, sideName, type Side } from '../body';
import { segment, type FacetBuilder, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, type Paint } from '../palette';
import type { RegionName } from '../rig';
import { start } from './common';
import { angDist, BACK, deg, FRONT, hash, lerp } from './kit';

const V = THREE.Vector3;
type V3 = THREE.Vector3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
const spread = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));

/** Inner face of the vests over the torso (clears a heavy jacket and its details). */
const VEST_D = 0.046;
/** Plate thickness (with the carrier's cloth). */
const PLATE = 0.03;
/** Outer face of the plates: where things clipped to the chest lie. */
const MOUNT = 0.078;
/**
 * Inner face of the sashes (radio, flashlight, bandolier): on the shirt, so no air shows under them from the side;
 * padded (SASH_T thick) so their outer face still clears a jacket (m65, puffer: up to ~4 cm on the back).
 */
const SASH_D = 0.015;
const SASH_T = 0.025;
/** Belts of the waist gear: over the pants' waistband (up to 4 cm out at 0.86–1.04 m). */
const BELT_D = 0.045;
/** Strap clearance over the top of the shoulder. */
const TOP_C = 0.02;
/** Inner face of the slabs' edges (vests, plates): just over a tee. */
const SLAB = 0.016;
/** Outer face of the thin side panels under the arms (over a tee and a jacket's side, inside a hanging elbow). */
const SIDE_OUT = 0.036;
/** Straps over the shoulders and across the back (over a heavy jacket; under the plates at their ends). */
const STRAP_D = 0.032;

interface Ctx {
  b: FacetBuilder;
  p: BodyParts;
}

// --- Surfaces --------------------------------------------------------------------------------------------------

/** A point a piece is built on: position, outward normal, skin weights and build morph deltas. */
interface Spot {
  p: V3;
  n: V3;
  w: Weights;
  gordo: V3;
  magro: V3;
}
/** A surface for a sheet: (u, v) on it, `depth` 0 = its inner face, 1 = its outer face. */
type Mapper = (u: number, v: number, depth: number) => Spot;

const vert = (b: FacetBuilder, s: Spot, ao = 0) => b.vertex(s.p, s.w, ao, { gordo: s.gordo, magro: s.magro });

/** A face (3 or 4 vertices in order around it), turned to face `out`. */
function face(b: FacetBuilder, ids: readonly number[], out: V3, paint: Paint, region: RegionName, shade = 0) {
  const p0 = b.position(ids[0]);
  const p1 = b.position(ids[1]);
  const p2 = b.position(ids[2]);
  const n = ids.length > 3 ? new V().subVectors(p2, p0).cross(new V().subVectors(b.position(ids[3]), p1)) : new V().subVectors(p1, p0).cross(new V().subVectors(p2, p0));
  const list = n.dot(out) < 0 ? [...ids].reverse() : ids;
  for (let i = 1; i < list.length - 1; i++) b.tri(list[0], list[i], list[i + 1], paint, region, shade);
}

/** Torso angle at sideways position X (the wearer's right is +X) and height y, at offset d; on the back with `back`. */
function ax(p: BodyParts, X: number, y: number, d: number, back = false) {
  const k = Math.asin(THREE.MathUtils.clamp(X / (p.torsoAt(y).w + d), -0.97, 0.97));
  return back ? BACK - k : FRONT + k;
}

/** The point of the torso at sideways position X, height y and offset d. */
const at = (p: BodyParts, X: number, y: number, d: number, back = false): Spot => p.torsoSurface(y, ax(p, X, y, d, back), d);

/** Build morphs of any point near the torso (the same push the torso's own surface gets at that height). */
function torsoMorph(p: BodyParts, pt: V3, y: number) {
  const off = new V(pt.x, 0, pt.z + p.torsoAt(y).fwd);
  const k = y < 0.99 ? 0.18 : y < 1.25 ? 0.2 : 0.12;
  const gordo = off.clone().multiplyScalar(k);
  if (off.z < 0 && y > 0.99 && y < 1.25) gordo.z += 0.3 * Math.sin(((y - 0.99) / 0.26) * Math.PI) * off.z;
  return { gordo, magro: off.clone().multiplyScalar(-k * 0.45) };
}

/** Height of the top of the shoulder line at sideways distance X. */
function shoulderTop(p: BodyParts, X: number) {
  for (let y = 1.38; y < 1.47; y += 0.002) if (p.torsoAt(y).w < X) return y;
  return 1.47;
}

/** A point on a leg at height y and angle a (0 = −X, 90° = the front), `d` over the skin. */
function legSpot(p: BodyParts, side: Side, y: number, a: number, d: number): Spot {
  const j = p.j;
  const s = p.s;
  let r: number;
  let sx: number;
  let k: number;
  let w: Weights;
  if (y >= j.kneeY) {
    const t = clamp01((j.hipY + 0.03 - y) / (j.hipY + 0.03 - j.kneeY));
    r = lerp(s.thigh[0], s.thigh[1], Math.pow(t, 0.85));
    sx = 0.94;
    k = 0.2;
    w = segment(sideName('thigh', side), 'hips', sideName('shin', side), 0.14)(t);
  } else {
    const t = clamp01((j.kneeY + 0.01 - y) / (j.kneeY - j.ankleY - 0.01));
    r = p.shinRadius(t);
    sx = 0.92;
    k = 0.12;
    w = segment(sideName('shin', side), sideName('thigh', side), sideName('foot', side), 0.12)(t);
  }
  const R = r + d;
  const off = new V(-Math.cos(a) * R * sx, 0, -Math.sin(a) * R);
  const gordo = off.clone().multiplyScalar(k);
  return { p: new V(side * j.legX, y, 0).add(off), n: new V(-Math.cos(a) / sx, 0, -Math.sin(a)).normalize(), w, gordo, magro: gordo.clone().multiplyScalar(-0.45) };
}

/**
 * A point on an arm (T pose) at distance x from the middle and angle a around it (0 = the front, 90° = up, the
 * outside of a hanging arm, 180° = the back, where the elbow points), `d` over the skin.
 */
function armSpot(p: BodyParts, side: Side, x: number, a: number, d: number): Spot {
  const j = p.j;
  const s = p.s;
  const x0 = j.shoulder - 0.07;
  let c: V3;
  let r: number;
  let sy: number;
  let k: number;
  let w: Weights;
  if (x <= j.elbow) {
    const t = clamp01((x - x0) / (j.elbow - x0));
    r = lerp(s.upperArm[0], s.upperArm[1], t) * (0.72 + 0.28 * Math.min(1, t / 0.24));
    c = new V(side * x, j.armY - 0.012 * (1 - t), 0);
    sy = 0.92;
    k = 0.16;
    w = p.upperArmWeights(side, t);
  } else {
    const t = clamp01((x - (j.elbow - 0.02)) / (j.wrist + 0.032 - j.elbow));
    r = lerp(s.forearm[0], s.forearm[1], Math.pow(t, 0.8)) + 0.005 * bell(t, 0.22, 0.25);
    c = new V(side * x, j.armY, 0);
    sy = lerp(0.95, 0.72, t);
    k = 0.1;
    w = segment(sideName('forearm', side), sideName('upperArm', side), sideName('hand', side), 0.14)(t);
  }
  const R = r + d;
  const off = new V(0, Math.sin(a) * R * sy, -Math.cos(a) * R);
  const gordo = off.clone().multiplyScalar(k);
  return { p: c.add(off), n: new V(0, Math.sin(a) / sy, -Math.cos(a)).normalize(), w, gordo, magro: gordo.clone().multiplyScalar(-0.45) };
}

/**
 * Region of arm gear: the forearm (it goes away with a PCD arm; a jacket's `over` only hides the layers under
 * it, so gear worn over a jacket stays).
 */
const armRegion = (side: Side): RegionName => sideName('forearm', side);
const legRegion = (side: Side, y: number, j: BodyParts['j']): RegionName => (y >= j.kneeY ? sideName('thigh', side) : sideName('shin', side));

// --- Shapes ----------------------------------------------------------------------------------------------------

interface SheetOptions {
  us: readonly number[];
  vs: readonly number[];
  paint: Paint | ((u: number, v: number) => Paint);
  /** The thickness band around the edges (default: the paint one step darker). */
  edge?: Paint;
  region?: RegionName;
  /** No edge band on this border at this point (where the sheet meets another one). */
  open?: (border: 'u0' | 'u1' | 'v0' | 'v1', t: number) => boolean;
  /** Also the inside, in this paint (seen from both sides: capes). */
  inner?: Paint;
  shade?: (u: number, v: number) => number;
}

/** A sheet with thickness: the outer face as a grid, an edge band all around (the inside only on request). */
function sheet(b: FacetBuilder, map: Mapper, o: SheetOptions) {
  const region = o.region ?? 'none';
  const paintOf = typeof o.paint === 'function' ? o.paint : () => o.paint as Paint;
  const edge = o.edge ?? darker(paintOf(0.5, 0.5), 1);
  const { us, vs } = o;
  const nU = us.length - 1;
  const nV = vs.length - 1;
  const grid = vs.map((v) => us.map((u) => vert(b, map(u, v, 1))));
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < nU; i++) {
      const um = (us[i] + us[i + 1]) / 2;
      const vm = (vs[j] + vs[j + 1]) / 2;
      face(b, [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]], map(um, vm, 1).n, paintOf(um, vm), region, o.shade?.(um, vm) ?? 0);
    }
  }
  if (o.inner !== undefined) {
    const inner = vs.map((v) => us.map((u) => vert(b, map(u, v, 0))));
    for (let j = 0; j < nV; j++) {
      for (let i = 0; i < nU; i++) {
        const n = map((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2, 0).n.negate();
        face(b, [inner[j][i], inner[j][i + 1], inner[j + 1][i + 1], inner[j + 1][i]], n, o.inner, region, -0.5);
      }
    }
  }
  // Edge bands: the sheet's thickness all around, facing away from the sheet.
  const band = (name: 'u0' | 'u1' | 'v0' | 'v1', pts: [number, number][], ids: number[], cell: (k: number) => [number, number]) => {
    const inner = pts.map(([u, v]) => vert(b, map(u, v, 0)));
    for (let k = 0; k < pts.length - 1; k++) {
      const t = name[0] === 'u' ? (pts[k][1] + pts[k + 1][1]) / 2 : (pts[k][0] + pts[k + 1][0]) / 2;
      if (o.open?.(name, t)) continue;
      const [cu, cv] = cell(k);
      const out = b.position(ids[k]).add(b.position(ids[k + 1])).multiplyScalar(0.5).sub(map(cu, cv, 1).p);
      face(b, [ids[k], ids[k + 1], inner[k + 1], inner[k]], out, edge, region);
    }
  };
  const mid = (a: readonly number[], k: number) => (a[k] + a[k + 1]) / 2;
  band('v0', us.map((u) => [u, vs[0]]), grid[0], (k) => [mid(us, k), mid(vs, 0)]);
  band('v1', us.map((u) => [u, vs[nV]]), grid[nV], (k) => [mid(us, k), mid(vs, nV - 1)]);
  band('u0', vs.map((v) => [us[0], v]), grid.map((r) => r[0]), (k) => [mid(us, 0), mid(vs, k)]);
  band('u1', vs.map((v) => [us[nU], v]), grid.map((r) => r[nU]), (k) => [mid(us, nU - 1), mid(vs, k)]);
}

/** A strap along a path of spots: a 4-sided section `width` wide and `thick` thick, standing out of the path. */
function band(b: FacetBuilder, path: readonly Spot[], width: number, thick: number, paint: Paint, o: { region?: RegionName; closed?: boolean; inner?: boolean; edge?: Paint } = {}) {
  const region = o.region ?? 'none';
  const n = path.length;
  const closed = !!o.closed;
  const edge = o.edge ?? darker(paint, 1);
  const rings = path.map((s, i) => {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)].p;
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)].p;
    const t = next.clone().sub(prev).normalize();
    const nn = s.n.clone().addScaledVector(t, -s.n.dot(t)).normalize();
    const across = new V().crossVectors(t, nn).normalize();
    const pt = (x: number, y: number) => s.p.clone().addScaledVector(across, (x * width) / 2).addScaledVector(nn, y * thick);
    const ids = [pt(-1, 0), pt(1, 0), pt(1, 1), pt(-1, 1)].map((q) => b.vertex(q, s.w, 0, { gordo: s.gordo, magro: s.magro }));
    return { ids, c: s.p.clone().addScaledVector(nn, thick / 2) };
  });
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const r0 = rings[k];
    const r1 = rings[(k + 1) % n];
    const c = r0.c.clone().add(r1.c).multiplyScalar(0.5);
    for (let side = 0; side < 4; side++) {
      // The inside (toward the body) only on open straps: they leave the body over the shoulders.
      if (side === 0 && !(o.inner ?? !closed)) continue;
      const i1 = (side + 1) % 4;
      const ids = [r0.ids[side], r0.ids[i1], r1.ids[i1], r1.ids[side]];
      const out = ids.reduce((acc, id) => acc.add(b.position(id)), new V()).multiplyScalar(0.25).sub(c);
      face(b, ids, out, side === 2 ? paint : side === 0 ? darker(paint, 2) : edge, region);
    }
  }
  if (!closed && n > 1) {
    face(b, rings[0].ids, rings[0].c.clone().sub(rings[1].c), edge, region);
    face(b, rings[n - 1].ids, rings[n - 1].c.clone().sub(rings[n - 2].c), edge, region);
  }
}

/** Any geometry placed at `c` with rotation `q` and scale, riding a spot (its weights and build morphs). */
function part(b: FacetBuilder, geo: THREE.BufferGeometry, c: V3, q: THREE.Quaternion, scale: V3, s: Pick<Spot, 'w' | 'gordo' | 'magro'>, paint: Paint, region: RegionName = 'none') {
  const m = (dp: V3) => new THREE.Matrix4().compose(c.clone().add(dp), q, scale);
  b.append(geo, m(new V()), s.w, region, paint, { morphs: { gordo: m(s.gordo), magro: m(s.magro) } });
}

/** The frame of a spot: x across (sideways on the surface), y up along it, z out. */
function frame(s: Spot, up = new V(0, 1, 0)) {
  const z = s.n.clone().normalize();
  const x = new V().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new V().crossVectors(z, x).normalize();
  return { x, y, z, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) };
}

interface BoxOptions {
  /** Move along the spot's frame: across, up, out. */
  dx?: number;
  dy?: number;
  lift?: number;
  /** Turn in the surface's plane (radians) and tip forward (about x). */
  tilt?: number;
  tip?: number;
  region?: RegionName;
  up?: V3;
}

/** A box with its back on a spot (sunk 2 mm), facing out. */
function boxOn(b: FacetBuilder, s: Spot, size: V3, paint: Paint, o: BoxOptions = {}) {
  const f = frame(s, o.up);
  const q = f.q.clone();
  if (o.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V(0, 0, 1), o.tilt));
  if (o.tip) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V(1, 0, 0), o.tip));
  const c = s.p.clone().addScaledVector(f.x, o.dx ?? 0).addScaledVector(f.y, o.dy ?? 0).addScaledVector(f.z, (o.lift ?? 0) + size.z / 2 - 0.002);
  part(b, new THREE.BoxGeometry(1, 1, 1), c, q, size, s, paint, o.region);
}

/** A cylinder on a spot along `axis` (in the spot's frame: x across, y up, z out). */
function cylOn(b: FacetBuilder, s: Spot, r: number, len: number, paint: Paint, o: { axis?: V3; off?: V3; seg?: number; r1?: number; region?: RegionName } = {}) {
  const f = frame(s);
  const ax = (o.axis ?? new V(0, 1, 0)).clone();
  const dir = new V().addScaledVector(f.x, ax.x).addScaledVector(f.y, ax.y).addScaledVector(f.z, ax.z).normalize();
  const off = o.off ?? new V();
  const c = s.p.clone().addScaledVector(f.x, off.x).addScaledVector(f.y, off.y).addScaledVector(f.z, off.z);
  const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), dir);
  part(b, new THREE.CylinderGeometry(o.r1 ?? r, r, len, o.seg ?? 6), c, q, new V(1, 1, 1), s, paint, o.region);
}

/** A flat strip of a ghillie: a flat pyramid from a spot along `dir`. */
function tuft(b: FacetBuilder, s: Spot, dir: V3, len: number, width: number, paint: Paint, region: RegionName = 'none') {
  const d = dir.clone().normalize();
  let side = new V().crossVectors(d, s.n);
  if (side.lengthSq() < 1e-6) side = new V(1, 0, 0);
  side.normalize();
  const nn = new V().crossVectors(side, d).normalize();
  if (nn.dot(s.n) < 0) nn.negate();
  const m = { gordo: s.gordo, magro: s.magro };
  const base = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => b.vertex(s.p.clone().addScaledVector(side, (x * width) / 2).addScaledVector(nn, y * width * 0.35), s.w, 0.12, m));
  const tip = b.vertex(s.p.clone().addScaledVector(d, len).addScaledVector(nn, width * 0.5), s.w, 0, m);
  const c = s.p.clone().addScaledVector(d, len * 0.3).addScaledVector(nn, width * 0.15);
  for (let k = 0; k < 4; k++) {
    const ids = [base[k], base[(k + 1) % 4], tip];
    const out = ids.reduce((acc, id) => acc.add(b.position(id)), new V()).divideScalar(3).sub(c);
    face(b, ids, out, k === 0 ? darker(paint, 2) : paint, region);
  }
}

// --- Torso pieces ------------------------------------------------------------------------------------------------

/**
 * A plate or panel over the front or the back between sideways ±half(y). A slab: its edges go in to SLAB, just over
 * a tee, so it never floats off the body (a jacket worn under it goes into the slab, as if tucked under the vest).
 */
function plate(c: Ctx, o: { back?: boolean; vs: readonly number[]; half: (y: number) => number; d?: number; th?: number; paint?: Paint; edge?: Paint; cols?: number }) {
  const d = o.d ?? VEST_D;
  const th = o.th ?? PLATE;
  const cols = o.cols ?? 4;
  sheet(c.b, (u, y, k) => c.p.torsoSurface(y, ax(c.p, lerp(-o.half(y), o.half(y), u), y, d, o.back), lerp(SLAB, d + th, k)), {
    us: spread(0, 1, cols),
    vs: o.vs,
    paint: o.paint ?? PRIMARY,
    edge: o.edge,
  });
}

/**
 * Side panels (cummerbund) from the front plate's edge to the back plate's, tucked under both: low and thin, so
 * the elbows of hanging arms pass outside them.
 */
function cummerbund(c: Ctx, front: (y: number) => number, back: (y: number) => number, vs: readonly number[], paint: Paint) {
  for (const s of [-1, 1] as Side[]) {
    sheet(
      c.b,
      (u, y, k) => {
        const af = ax(c.p, s * (front(y) - 0.03), y, VEST_D);
        let ab = ax(c.p, s * (back(y) - 0.03), y, VEST_D, true);
        if (s < 0) ab -= 2 * Math.PI;
        return c.p.torsoSurface(y, lerp(af, ab, u), lerp(SLAB, SIDE_OUT, k));
      },
      { us: [0, 1 / 3, 2 / 3, 1], vs, paint },
    );
  }
}

/**
 * A soft vest: a front and a back panel wrapping the torso from y0 to the shoulders, a scooped neck in front. They
 * meet at the sides low on the ribs (no edge there), thin under the arms; deep armholes above, so hanging and
 * swinging arms pass outside them. Slabs like the plates (edges in to SLAB).
 */
function softVest(c: Ctx, o: { y0: number; d: number; th: number; paint: Paint | ((u: number, y: number, back: boolean) => Paint); edge?: Paint; scoop?: number }) {
  const smooth = THREE.MathUtils.smoothstep;
  const yMeet = 1.1;
  // Half span of a panel around the front (or the back) at height y.
  const k = (y: number) => Math.PI / 2 - deg(30) * smooth(y, yMeet - 0.02, 1.2) - deg(29) * smooth(y, 1.2, 1.42);
  const ys = [o.y0, (o.y0 + yMeet) / 2, yMeet, 1.17, 1.25, 1.33, 1.38, 1.42];
  for (const back of [false, true]) {
    const top = (u: number) => 1.42 - (back ? 0.015 : (o.scoop ?? 0.065)) * bell(u, 0.5, 0.25);
    const yOf = (u: number, v: number) => lerp(o.y0, top(u), v);
    const paint = o.paint;
    sheet(
      c.b,
      (u, v, depth) => {
        const y = yOf(u, v);
        const off = (u * 2 - 1) * k(y);
        // Outer face: full thickness in the middle, thin at the sides (under the arms) and on the upper chest and
        // the slope of the shoulders (the support arm lies across it when aiming; no step seen from the side).
        const thin = smooth(Math.abs(off), deg(55), deg(86));
        const out = lerp(lerp(o.d + o.th, Math.min(o.d, 0.03) + o.th, smooth(y, 1.22, 1.38)), SIDE_OUT, thin);
        return c.p.torsoSurface(y, (back ? BACK : FRONT) + (back ? -1 : 1) * off, lerp(SLAB, out, depth));
      },
      {
        us: [0, 0.12, 0.28, 0.5, 0.72, 0.88, 1],
        vs: ys.map((y) => (y - o.y0) / (1.42 - o.y0)),
        paint: typeof paint === 'function' ? (u, v) => paint(u, yOf(u, v), back) : paint,
        edge: o.edge,
        open: (border, t) => (border === 'u0' || border === 'u1') && lerp(o.y0, 1.42, t) < yMeet,
      },
    );
  }
}

/** Sideways position of a shoulder strap `width` wide: clear of a collar at the neck, inside the arm's root. */
const strapX = (p: BodyParts, width: number) => p.s.neck + 0.022 + width / 2;

/** Height where the torso's skin crosses sideways distance X (bisection on the table, 1.40–1.47 m). */
function skinTopAt(p: BodyParts, X: number, depth: number) {
  // Half depth of the (superellipse) section at height y, in the plane x = X.
  const half = (y: number) => {
    const t = p.torsoAt(y);
    return t.d * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, X / t.w), 2.4)), 1 / 2.4);
  };
  let lo = 1.4;
  let hi = shoulderTop(p, X);
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (half(m) > depth) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * A strap's path over the shoulder at sideways X: up the front from yF, over the top, down the back to yB. Below
 * 1.43 m it lies on the torso's surface at offset d; over the top it follows the trapezius' own curve (the
 * torso's section in the plane x = X), `d` out where the surface is upright and `top` out where it is flat, so it
 * hugs the shoulder instead of bridging it. Weights by height like the body under it (the neck's share near the
 * top: the body there turns with the head).
 */
function overShoulder(p: BodyParts, X: number, d: number, yF: number, yB: number, top = TOP_C): Spot[] {
  const ys = (y0: number) => (y0 < 1.32 ? [y0, (y0 + 1.4) / 2, 1.4] : y0 < 1.41 ? [y0] : []);
  const front = ys(yF).map((y) => at(p, X, y, d));
  const back = ys(yB).map((y) => at(p, X, y, d, true)).reverse();
  const aX = Math.abs(X);
  // The dome: the skin's section at x = X sampled by depth, from the front (1.43 m) over the top to the back.
  const y0 = 1.425;
  const t0 = p.torsoAt(y0);
  const h0 = t0.d * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, aX / t0.w), 2.4)), 1 / 2.4);
  const ks = [1, 0.82, 0.6, 0.3, 0, -0.3, -0.6, -0.82, -1];
  const prof = ks.map((k) => {
    const y = Math.abs(k) >= 1 ? y0 : skinTopAt(p, aX, Math.abs(k) * h0);
    return { y, z: -p.torsoAt(y).fwd - k * h0 };
  });
  const dome = prof.map((q, i): Spot => {
    const a = prof[Math.max(0, i - 1)];
    const b = prof[Math.min(prof.length - 1, i + 1)];
    // Normal of the profile: the tangent (z, y) turned outward (front: −z, top: +y, back: +z).
    let n = new V(0, -(b.z - a.z), b.y - a.y);
    if (i === 0) n = new V(0, 0, -1);
    else if (i === prof.length - 1) n = new V(0, 0, 1);
    n.normalize();
    if (n.y < 0) n.negate();
    const off = d * Math.abs(n.z) + top * Math.abs(n.y);
    const pt = new V(X, q.y, q.z).addScaledVector(n, off);
    const sk = p.torsoSurface(Math.min(q.y, 1.47), q.z < 0 ? FRONT : BACK, 0);
    return { p: pt, n: new V(Math.sign(X) * 0.25, n.y, n.z).normalize(), w: sk.w, ...torsoMorph(p, pt, Math.min(q.y, 1.44)) };
  });
  return [...front, ...dome, ...back];
}

/**
 * A sash: over the shoulder on side `s` (−1 the left) and across the body to the opposite hip, front and back,
 * closed (bandolier, radio and flashlight harnesses). Returns the path and the front part's spots.
 */
function sash(p: BodyParts, s: Side, d: number, top = 0.012) {
  const X = s * 0.1;
  // Out over the pants' waistband near the hip.
  const dd = (y: number) => lerp(d, BELT_D + 0.002, clamp01((1.09 - y) / 0.1));
  const yLow = 0.99;
  const arc = overShoulder(p, X, d, 1.4, 1.4, top);
  const aF = ax(p, X, 1.4, d);
  const aB = ax(p, X, 1.4, d, true);
  // Opposite side: the right (a = 180°) for a left sash, the left (0 = 360°) for a right one.
  const opp = s < 0 ? Math.PI : 2 * Math.PI;
  const backPart = [0.2, 0.4, 0.6, 0.8, 1].map((u) => p.torsoSurface(lerp(1.4, yLow, u), lerp(aB, opp + (s < 0 ? 0.25 : -0.25), u), dd(lerp(1.4, yLow, u))));
  const side = p.torsoSurface(yLow - 0.01, opp, dd(yLow - 0.01));
  const oppF = s < 0 ? Math.PI - 0.25 : 0.25;
  const frontPart = [1, 0.8, 0.6, 0.4, 0.2].map((u) => p.torsoSurface(lerp(1.4, yLow, u), lerp(aF, oppF, u), dd(lerp(1.4, yLow, u))));
  return { path: [...arc, ...backPart, side, ...frontPart], front: (u: number) => p.torsoSurface(lerp(1.4, yLow, u), lerp(aF, oppF, u), dd(lerp(1.4, yLow, u))) };
}

/** A strap around the torso at height y. */
function torsoRing(c: Ctx, y: number, d: number, width: number, thick: number, paint: Paint, n = 12) {
  band(c.b, Array.from({ length: n }, (_, i) => c.p.torsoSurface(y, FRONT + (i / n) * Math.PI * 2, d)), width, thick, paint, { closed: true });
}

/** A flat patch (no thickness: prints, MOLLE webbing, velcro) on the torso between X0..X1, y0..y1 at offset d. */
function flatPatch(c: Ctx, X0: number, X1: number, y0: number, y1: number, d: number, paint: Paint, back = false, cols = 1) {
  const { b, p } = c;
  for (let i = 0; i < cols; i++) {
    const xa = lerp(X0, X1, i / cols);
    const xb = lerp(X0, X1, (i + 1) / cols);
    const ids = [
      [xa, y0],
      [xb, y0],
      [xb, y1],
      [xa, y1],
    ].map(([X, y]) => vert(b, at(p, X, y, d, back)));
    face(b, ids, at(p, (xa + xb) / 2, (y0 + y1) / 2, d, back).n, paint, 'none');
  }
}

/** MOLLE webbing: rows of strips across a panel. */
function molle(c: Ctx, X: number, ys: readonly number[], d: number, paint: Paint, back = false) {
  c.b.detail(() => {
    for (const y of ys) flatPatch(c, -X, X, y, y + 0.022, d + 0.002, paint, back, X > 0.08 ? 2 : 1);
  });
}

/** Block letters (3×5 cells, rows from the top). */
const FONT: Record<string, readonly string[]> = {
  P: ['111', '101', '111', '100', '100'],
  R: ['110', '101', '110', '101', '101'],
  E: ['111', '100', '110', '100', '111'],
  S: ['111', '100', '111', '001', '111'],
  O: ['111', '101', '101', '101', '111'],
  L: ['100', '100', '100', '100', '111'],
  I: ['111', '010', '010', '010', '111'],
  C: ['111', '100', '100', '100', '111'],
  A: ['010', '101', '111', '101', '101'],
};

/** The rectangles of a letter: runs of cells per row, merged down when the next row repeats them. */
function letterRects(ch: string): [number, number, number, number][] {
  const rows = FONT[ch] ?? [];
  const out: [number, number, number, number][] = [];
  const runsOf = (row: string) => {
    const runs: [number, number][] = [];
    for (let i = 0; i < row.length; i++) if (row[i] === '1' && (i === 0 || row[i - 1] !== '1')) runs.push([i, i + (row.slice(i).match(/^1+/)?.[0].length ?? 1)]);
    return runs;
  };
  const open: { c0: number; c1: number; r0: number; r1: number }[] = [];
  rows.forEach((row, r) => {
    const runs = runsOf(row);
    for (const [c0, c1] of runs) {
      const prev = open.find((o) => o.c0 === c0 && o.c1 === c1 && o.r1 === r);
      if (prev) prev.r1 = r + 1;
      else open.push({ c0, c1, r0: r, r1: r + 1 });
    }
  });
  for (const o of open) out.push([o.c0, o.c1, o.r0, o.r1]);
  return out;
}

/** Text in block letters centered at height cy, `h` tall, read from the front or the back, at offset d. */
function text(c: Ctx, str: string, cy: number, h: number, back: boolean, d: number, paint: Paint) {
  const px = h / 5;
  const total = str.length * 3 * px + (str.length - 1) * px;
  // The viewer's right is −X in front of the wearer and +X behind.
  const X = (vx: number) => (back ? vx : -vx);
  [...str].forEach((ch, i) => {
    const x0 = -total / 2 + i * 4 * px;
    for (const [c0, c1, r0, r1] of letterRects(ch)) {
      const xa = X(x0 + c0 * px);
      const xb = X(x0 + c1 * px);
      flatPatch(c, Math.min(xa, xb), Math.max(xa, xb), cy + h / 2 - r1 * px, cy + h / 2 - r0 * px, d, paint, back);
    }
  });
}

/** A magazine pouch on a spot: the pouch and its flap (or open, with the magazine's top showing). */
function magPouch(c: Ctx, s: Spot, w: number, h: number, depth: number, paint: Paint, flap: Paint | null) {
  boxOn(c.b, s, new V(w, h, depth), paint);
  if (flap !== null) boxOn(c.b, s, new V(w + 0.006, 0.028, depth + 0.006), flap, { dy: h / 2 - 0.012 });
  else boxOn(c.b, s, new V(w * 0.62, 0.035, depth * 0.55), fixed('gunmetal'), { dy: h / 2 + 0.01, lift: depth * 0.2 });
}

/** The two shoulder straps of a vest. */
function vestStraps(c: Ctx, d: number, yF: number, yB: number, paint: Paint, width = 0.05, thick = 0.014) {
  const X = strapX(c.p, width);
  for (const s of [-1, 1] as Side[]) band(c.b, overShoulder(c.p, s * X, d, yF, yB), width, thick, paint);
}

// --- Builders -------------------------------------------------------------------------------------------------------

/** Plate carrier front and back halves (shooter's cut at the top of the front). */
const pcFront = (y: number) => (y < 1.27 ? 0.125 : lerp(0.125, 0.098, (y - 1.27) / 0.11));
const pcBack = (y: number) => (y < 1.3 ? 0.13 : lerp(0.13, 0.1, (y - 1.3) / 0.1));

const BUILDERS: Record<string, (c: Ctx) => void> = {
  coletePlacas: (c) => {
    const d = VEST_D;
    plate(c, { vs: [1.0, 1.1, 1.19, 1.27, 1.33, 1.38], half: pcFront, edge: darker(PRIMARY, 2) });
    plate(c, { back: true, vs: [1.0, 1.1, 1.2, 1.3, 1.4], half: pcBack, edge: darker(PRIMARY, 2) });
    cummerbund(c, pcFront, pcBack, [1.0, 1.05, 1.1], SECONDARY);
    vestStraps(c, STRAP_D, 1.35, 1.36, PRIMARY, 0.046, 0.014);
    // Three magazine pouches low on the front; the upper chest is left flat (velcro) for chest accessories.
    for (const X of [-0.076, 0, 0.076]) magPouch(c, at(c.p, X, 1.1, d + PLATE), 0.066, 0.12, 0.036, PRIMARY, darker(PRIMARY, 1));
    c.b.detail(() => flatPatch(c, -0.085, 0.085, 1.235, 1.33, d + PLATE + 0.001, darker(PRIMARY, 1), false, 2));
    molle(c, 0.11, [1.1, 1.17, 1.24], d + PLATE, darker(PRIMARY, 1), true);
    c.b.detail(() => {
      for (const s of [-1, 1] as Side[]) for (const y of [1.018, 1.062]) flatPatch(c, s * 0.15, s * 0.19, y, y + 0.02, SIDE_OUT + 0.001, darker(SECONDARY, 1));
    });
    // Drag handle at the top of the back.
    boxOn(c.b, at(c.p, 0, 1.365, d + PLATE, true), new V(0.08, 0.022, 0.018), SECONDARY);
  },

  portaCarregadores: (c) => {
    const d = VEST_D - 0.002;
    softVest(c, { y0: 0.98, d, th: 0.016, paint: PRIMARY, edge: SECONDARY });
    vestStraps(c, STRAP_D, 1.38, 1.39, PRIMARY, 0.05, 0.012);
    c.b.detail(() => flatPatch(c, -0.007, 0.007, 0.985, 1.35, d + 0.017, SECONDARY), 1);
    // Four double magazine pouches across the belly, a pistol magazine pair each side above.
    for (const X of [-0.135, -0.05, 0.05, 0.135]) magPouch(c, at(c.p, X, 1.075, d + 0.016), 0.07, 0.13, 0.04, PRIMARY, darker(PRIMARY, 1));
    for (const s of [-1, 1]) magPouch(c, at(c.p, s * 0.165, 1.2, d + 0.016), 0.05, 0.085, 0.03, PRIMARY, darker(PRIMARY, 1));
    molle(c, 0.13, [1.05, 1.12, 1.19, 1.26], d + 0.016, darker(PRIMARY, 1), true);
  },

  assaltoPesado: (c) => {
    const d = VEST_D + 0.002;
    const th = 0.032;
    softVest(c, { y0: 0.96, d, th, paint: PRIMARY, edge: darker(PRIMARY, 2), scoop: 0.05 });
    vestStraps(c, STRAP_D, 1.38, 1.39, PRIMARY, 0.06, 0.016);
    // High collar around the neck, open at the throat.
    c.p.neck(1.425, 1.525, 0.034, { paint: PRIMARY, region: 'none', rimEnd: { h: 0.016, out: 0.006, paint: SECONDARY }, flare: (t) => 0.012 * t, segments: 10, ts: [0, 1], gap: deg(70) });
    // Shoulder armor: a plate over each deltoid.
    for (const s of [-1, 1] as Side[]) {
      const x0 = c.p.j.shoulder - 0.06;
      sheet(c.b, (u, v, k) => armSpot(c.p, s, lerp(x0, x0 + 0.13, v), lerp(deg(15), deg(165), u), 0.04 + 0.012 * bell(v, 0.4, 0.8) + k * 0.018), {
        us: [0, 0.25, 0.5, 0.75, 1],
        vs: [0, 0.5, 1],
        paint: PRIMARY,
        edge: darker(PRIMARY, 2),
        inner: darker(PRIMARY, 3),
      });
    }
    // Groin flap hanging from the front.
    sheet(
      c.b,
      (u, y, k) => {
        const yy = Math.max(y, 0.93);
        const s = c.p.torsoSurface(yy, ax(c.p, lerp(-0.085, 0.085, u), yy, d), d + k * 0.024);
        if (y < 0.93) {
          s.p.y -= 0.93 - y;
          s.w = [['hips', 0.8], [u < 0.5 ? 'thigh_L' : 'thigh_R', 0.2]];
        }
        return s;
      },
      { us: [0, 0.5, 1], vs: [0.79, 0.86, 0.93, 0.97], paint: SECONDARY },
    );
    // Pouches: three magazines, two grenades on the sides, MOLLE all over the back.
    for (const X of [-0.078, 0, 0.078]) magPouch(c, at(c.p, X, 1.06, d + th), 0.068, 0.12, 0.04, PRIMARY, darker(PRIMARY, 1));
    for (const s of [-1, 1]) magPouch(c, at(c.p, s * 0.168, 1.12, d + th), 0.055, 0.085, 0.045, PRIMARY, darker(PRIMARY, 1));
    molle(c, 0.12, [1.04, 1.11, 1.18, 1.25, 1.32], d + th, darker(PRIMARY, 1), true);
  },

  chestRig: (c) => {
    const { b, p } = c;
    const d = VEST_D - 0.004;
    const th = 0.018;
    // The chest panel: low on the chest, magazines at the bottom, a zipped admin flap above.
    plate(c, { vs: [1.05, 1.13, 1.22, 1.3], half: (y) => 0.15 - (y - 1.05) * 0.12, d, th, cols: 4, edge: darker(PRIMARY, 2) });
    for (const X of [-0.105, -0.035, 0.035, 0.105]) magPouch(c, at(p, X, 1.1, d + th), 0.064, 0.1, 0.038, PRIMARY, null);
    b.detail(() => flatPatch(c, -0.11, 0.11, 1.255, 1.262, d + th + 0.001, SECONDARY, false, 2));
    // Harness: up over the shoulders, crossing in an X on the back, into a waist strap around the back.
    for (const s of [-1, 1] as Side[]) {
      const path = overShoulder(p, s * strapX(p, 0.04), STRAP_D, 1.28, 1.36, TOP_C);
      for (const [X, y] of [
        [s * 0.0, 1.27],
        [-s * 0.08, 1.19],
        [-s * 0.14, 1.13],
      ] as const)
        path.push(at(p, X, y, STRAP_D + (s > 0 ? 0.003 : 0), true));
      band(b, path, 0.04, 0.008, SECONDARY);
    }
    const aL = ax(p, -0.13, 1.1, d);
    const aR = ax(p, 0.13, 1.1, d) - 2 * Math.PI;
    band(b, spread(0, 1, 9).map((u) => p.torsoSurface(1.1, lerp(aL, aR, u), STRAP_D)), 0.035, 0.008, SECONDARY);
    for (const s of [-1, 1]) boxOn(b, at(p, s * 0.158, 1.1, d + 0.004), new V(0.03, 0.04, 0.012), fixed('rubber'));
  },

  coleteImprensa: (c) => {
    const d = VEST_D - 0.002;
    const th = 0.018;
    softVest(c, { y0: 0.98, d, th, paint: PRIMARY, edge: darker(PRIMARY, 2) });
    vestStraps(c, STRAP_D, 1.38, 1.39, PRIMARY, 0.05, 0.012);
    c.b.detail(() => {
      text(c, 'PRESS', 1.235, 0.075, true, d + th + 0.002, DETAIL);
      text(c, 'PRESS', 1.1, 0.045, false, d + th + 0.002, DETAIL);
    }, 1);
  },

  coletePolicia: (c) => {
    const d = VEST_D - 0.002;
    const th = 0.02;
    // Side panels in the secondary color.
    softVest(c, { y0: 0.97, d, th, paint: (u, y) => (Math.abs(u - 0.5) > 0.38 && y < 1.27 ? SECONDARY : PRIMARY), edge: SECONDARY });
    vestStraps(c, STRAP_D, 1.38, 1.39, SECONDARY, 0.05, 0.012);
    c.b.detail(() => {
      text(c, 'POLICIA', 1.24, 0.062, true, d + th + 0.002, DETAIL);
      text(c, 'POLICIA', 1.085, 0.04, false, d + th + 0.002, DETAIL);
    }, 1);
    // Badge on the left chest, radio pouch on the right.
    const badge = at(c.p, -0.148, 1.29, d + th);
    boxOn(c.b, badge, new V(0.04, 0.046, 0.006), DETAIL, { lift: 0.002 });
    boxOn(c.b, badge, new V(0.028, 0.012, 0.006), darker(DETAIL, 3), { lift: 0.005, dy: 0.008 });
    magPouch(c, at(c.p, 0.155, 1.24, d + th), 0.05, 0.1, 0.03, SECONDARY, darker(SECONDARY, 1));
  },

  // --- Waist ---

  cinturao: (c) => {
    const { b, p } = c;
    const d = BELT_D;
    p.torso(0.915, 0.995, d, { paint: PRIMARY, region: 'none', segments: 12, rimStart: { h: 0.01, out: 0.003, paint: SECONDARY }, rimEnd: { h: 0.01, out: 0.003, paint: SECONDARY }, ts: [0.955] });
    const on = (a: number, y = 0.955) => p.torsoSurface(y, a, d + 0.003);
    // Buckle, two magazine pouches on the left front, a utility pouch on the right, a dump pouch at the back.
    boxOn(b, on(FRONT), new V(0.062, 0.05, 0.014), fixed('gunmetal'));
    boxOn(b, on(FRONT), new V(0.03, 0.02, 0.006), fixed('steel'), { lift: 0.012 });
    for (const a of [FRONT - deg(36), FRONT - deg(56)]) magPouch(c, on(a, 0.94), 0.05, 0.1, 0.034, PRIMARY, darker(PRIMARY, 1));
    magPouch(c, on(FRONT + deg(64), 0.945), 0.085, 0.09, 0.045, PRIMARY, darker(PRIMARY, 1));
    boxOn(b, on(BACK + deg(28), 0.93), new V(0.12, 0.11, 0.05), darker(PRIMARY, 1));
  },

  primeirosSocorros: (c) => {
    const { b, p } = c;
    torsoRing(c, 0.95, BELT_D, 0.035, 0.007, darker(PRIMARY, 1));
    const s = p.torsoSurface(0.93, FRONT - deg(58), BELT_D + 0.007);
    boxOn(b, s, new V(0.11, 0.1, 0.05), PRIMARY);
    boxOn(b, s, new V(0.116, 0.03, 0.056), darker(PRIMARY, 1), { dy: 0.04 });
    // A cross in the detail color, and the pull tab.
    boxOn(b, s, new V(0.044, 0.014, 0.004), DETAIL, { lift: 0.049, dy: -0.008 });
    boxOn(b, s, new V(0.014, 0.044, 0.004), DETAIL, { lift: 0.049, dy: -0.008 });
    boxOn(b, s, new V(0.02, 0.022, 0.008), DETAIL, { dy: -0.06, lift: 0.02 });
  },

  protetorVirilha: (c) => {
    const { b, p } = c;
    const d = BELT_D;
    torsoRing(c, 0.95, d, 0.04, 0.008, SECONDARY);
    // The flap hangs straight down from the belt: two lames (hips, a little of the thighs at the bottom).
    for (const [y0, y1, dd] of [
      [0.84, 0.95, 0.008],
      [0.77, 0.86, 0.0],
    ] as const) {
      sheet(
        b,
        (u, y, k) => {
          const yy = Math.max(y, 0.93);
          const s = p.torsoSurface(yy, ax(p, lerp(-0.09, 0.09, u) * (y < 0.86 ? 0.85 : 1), yy, d), d + dd + k * 0.02);
          if (y < 0.93) {
            s.p.y -= 0.93 - y;
            s.p.z -= (0.93 - y) * 0.15;
            // Lower down it follows the thighs (both, blended across), so it lies on the lap when crouching instead
            // of the thighs coming up through it.
            const f = clamp01((0.93 - y) / 0.16) * 0.55;
            s.w = [['hips', 1 - f], ['thigh_L', f * (1 - u) + 1e-4], ['thigh_R', f * u + 1e-4]];
          }
          return s;
        },
        { us: [0, 0.5, 1], vs: spread(y0, y1, 2), paint: dd ? PRIMARY : darker(PRIMARY, 1), edge: darker(PRIMARY, 2) },
      );
    }
    for (const s of [-1, 1]) boxOn(b, at(p, s * 0.06, 0.95, d + 0.008), new V(0.022, 0.03, 0.012), fixed('gunmetal'));
  },

  rapel: (c) => {
    const { b, p } = c;
    const d = BELT_D;
    torsoRing(c, 0.95, d, 0.04, 0.008, SECONDARY);
    // Leg loops of the harness, joined to the belt at the front.
    for (const s of [-1, 1] as Side[]) {
      const y = 0.86;
      band(b, Array.from({ length: 8 }, (_, i) => legSpot(p, s, y, (i / 8) * Math.PI * 2, 0.034)), 0.03, 0.007, SECONDARY, { closed: true, region: sideName('thigh', s) });
      band(b, [at(p, s * 0.035, 0.935, d), legSpot(p, s, 0.88, FRONT + s * deg(25), 0.03)], 0.025, 0.007, SECONDARY);
    }
    // Carabiner at the front, the rope coiled at the left hip with its tail hanging.
    const front = at(p, 0, 0.925, d + 0.008);
    part(b, new THREE.TorusGeometry(0.022, 0.0045, 4, 8), front.p.clone().add(new V(0, -0.012, -0.006)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3)), new V(1, 1.5, 1), front, fixed('steel'));
    const hip = p.torsoSurface(0.9, deg(14), d + 0.03);
    const hw: Weights = [['hips', 0.7], ['thigh_L', 0.3]];
    const coil = { w: hw, gordo: hip.gordo, magro: hip.magro };
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V(0, 0, 1), new V(0, 1, 0), new V(-1, 0, 0)));
    for (const [r, k] of [
      [0.075, 0],
      [0.068, 1],
    ] as const)
      part(b, new THREE.TorusGeometry(r, 0.014, 4, 9), hip.p.clone().add(new V(-0.01 * k, -0.02 - k * 0.006, 0)), q, new V(1, 1.15, 1), coil, k ? darker(PRIMARY, 1) : PRIMARY);
    // Tie around the coil, and the tail.
    part(b, new THREE.BoxGeometry(1, 1, 1), hip.p.clone().add(new V(-0.006, 0.05, 0)), new THREE.Quaternion(), new V(0.042, 0.03, 0.04), coil, SECONDARY);
    part(b, new THREE.CylinderGeometry(0.009, 0.009, 0.16, 4), hip.p.clone().add(new V(-0.02, -0.12, 0.02)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0.1)), new V(1, 1, 1), coil, PRIMARY);
  },

  // --- Thighs ---

  coldre: (c) => thighRig(c, 1, 'holster'),
  bolsaPerna: (c) => thighRig(c, -1, 'pouch'),

  // --- Chest accessories (on their own placard: see the header) ---

  portaGranadas: (c) => {
    const { b, p } = c;
    placard(c, -0.105, 0.105, 1.225, 1.315);
    for (const X of [-0.048, 0.048]) {
      const s = at(p, X, 1.262, MOUNT + 0.004);
      boxOn(b, s, new V(0.066, 0.075, 0.056), PRIMARY);
      // The grenade's top, its fuse and spoon, and the retention strap across.
      const top = s.p.clone().addScaledVector(s.n, 0.03).add(new V(0, 0.046, 0));
      part(b, new THREE.SphereGeometry(1, 6, 3), top, new THREE.Quaternion(), new V(0.027, 0.02, 0.027), s, fixed('paintedMetal'));
      part(b, new THREE.CylinderGeometry(0.008, 0.009, 0.022, 5), top.clone().add(new V(0, 0.022, 0)), new THREE.Quaternion(), new V(1, 1, 1), s, fixed('steel'));
      boxOn(b, s, new V(0.008, 0.05, 0.006), fixed('steel'), { dy: 0.045, lift: 0.05, tip: -0.3 });
      boxOn(b, s, new V(0.07, 0.014, 0.062), SECONDARY, { dy: 0.024 });
    }
  },

  canivete: (c) => {
    const { b, p } = c;
    placard(c, -0.13, 0.13, 1.24, 1.3);
    // Horizontal sheath across the upper chest, the handle to the wearer's right (cross draw).
    const s = at(p, 0, 1.27, MOUNT + 0.004);
    boxOn(b, s, new V(0.17, 0.042, 0.018), PRIMARY, { dx: 0.035 });
    boxOn(b, s, new V(0.03, 0.05, 0.022), darker(PRIMARY, 1), { dx: -0.03 });
    boxOn(b, s, new V(0.011, 0.04, 0.026), fixed('steel'), { dx: -0.058, lift: 0.002 });
    boxOn(b, s, new V(0.085, 0.028, 0.024), SECONDARY, { dx: -0.105, lift: 0.002 });
    boxOn(b, s, new V(0.014, 0.03, 0.026), fixed('steel'), { dx: -0.152, lift: 0.002 });
  },

  patches: (c) => {
    const { b, p } = c;
    placard(c, -0.115, 0.115, 1.225, 1.335);
    const s = (X: number, y: number) => at(p, X, y, MOUNT + 0.004);
    // Flag (three bands), name tape, and a round unit patch, in the detail color and its shades.
    const flag = s(0.055, 1.3);
    boxOn(b, flag, new V(0.085, 0.052, 0.004), DETAIL);
    b.detail(() => {
      boxOn(b, flag, new V(0.085, 0.017, 0.004), darker(DETAIL, 4), { lift: 0.0015 });
      boxOn(b, flag, new V(0.028, 0.052, 0.004), PRIMARY, { lift: 0.0015, dx: 0.029 });
    });
    boxOn(b, s(0, 1.245), new V(0.17, 0.026, 0.004), DETAIL);
    b.detail(() => {
      for (let i = 0; i < 6; i++) boxOn(b, s(-0.055 + i * 0.022, 1.245), new V(0.014, 0.012, 0.004), darker(DETAIL, 6), { lift: 0.0015 });
    });
    const unit = s(-0.06, 1.3);
    part(b, new THREE.CylinderGeometry(0.028, 0.028, 0.004, 8), unit.p.clone().addScaledVector(unit.n, 0.002), new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), unit.n), new V(1, 1, 1), unit, darker(DETAIL, 2));
    part(b, new THREE.CylinderGeometry(0.016, 0.016, 0.004, 6), unit.p.clone().addScaledVector(unit.n, 0.0035), new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), unit.n), new V(1, 1, 1), unit, DETAIL);
  },

  // --- Shoulder ---

  radioOmbro: (c) => {
    const { b, p } = c;
    const { path, front } = sash(p, -1, SASH_D);
    band(b, path, 0.04, SASH_T, PRIMARY);
    // Radio in its pouch high on the left chest, antenna up, a speaker mic at the shoulder.
    const s = front(0.12);
    s.p.addScaledVector(s.n, SASH_T);
    boxOn(b, s, new V(0.062, 0.1, 0.04), PRIMARY);
    boxOn(b, s, new V(0.054, 0.05, 0.034), SECONDARY, { dy: 0.07, lift: 0.002 });
    boxOn(b, s, new V(0.014, 0.012, 0.014), fixed('rubber'), { dy: 0.1, dx: 0.014, lift: 0.01 });
    cylOn(b, s, 0.006, 0.13, fixed('rubber'), { off: new V(-0.016, 0.16, 0.02), seg: 5, r1: 0.004 });
    const top = path[2];
    boxOn(b, top, new V(0.045, 0.055, 0.02), SECONDARY, { lift: SASH_T });
    boxOn(b, top, new V(0.032, 0.012, 0.004), fixed('rubber'), { lift: SASH_T + 0.019, dy: 0.012 });
  },

  lanternaOmbro: (c) => {
    const { b, p } = c;
    const { path, front } = sash(p, 1, SASH_D);
    band(b, path, 0.04, SASH_T, PRIMARY);
    // Clip on the strap, the light pointing forward.
    const s = front(0.08);
    s.p.addScaledVector(s.n, SASH_T);
    boxOn(b, s, new V(0.04, 0.05, 0.016), PRIMARY);
    cylOn(b, s, 0.016, 0.1, SECONDARY, { axis: new V(0, 0, 1), off: new V(0, 0.01, 0.04), seg: 7 });
    cylOn(b, s, 0.022, 0.035, SECONDARY, { axis: new V(0, 0, 1), off: new V(0, 0.01, 0.1), seg: 7, r1: 0.017 });
    cylOn(b, s, 0.019, 0.006, fixed('lensLight'), { axis: new V(0, 0, 1), off: new V(0, 0.01, 0.12), seg: 7 });
    boxOn(b, s, new V(0.012, 0.01, 0.012), fixed('rubber'), { dy: 0.032, lift: 0.04 });
  },

  bandoleira: (c) => {
    const { b, p } = c;
    const { path, front } = sash(p, -1, SASH_D);
    band(b, path, 0.055, SASH_T, PRIMARY);
    // Shells in loops down the front.
    for (let i = 0; i < 9; i++) {
      const s = front(0.12 + i * 0.075);
      s.p.addScaledVector(s.n, SASH_T);
      const next = front(0.12 + i * 0.075 + 0.02);
      const dir = next.p.clone().sub(s.p);
      // Turned across the strap: its direction in the spot's frame.
      const f = frame(s);
      const tilt = Math.atan2(dir.dot(f.y), dir.dot(f.x));
      boxOn(b, s, new V(0.018, 0.05, 0.016), DETAIL, { tilt, lift: 0.004 });
      boxOn(b, s, new V(0.026, 0.02, 0.012), SECONDARY, { tilt, lift: 0.002 });
    }
    // Buckle at the hip.
    boxOn(b, front(0.95), new V(0.04, 0.05, 0.012), fixed('brass'), { lift: SASH_T });
  },

  // --- Back ---

  mochilaAssalto: (c) => {
    const { b, p } = c;
    packStraps(c);
    const s = backSpot(p, 1.18);
    boxOn(b, s, new V(0.27, 0.36, 0.13), PRIMARY);
    boxOn(b, s, new V(0.28, 0.06, 0.14), darker(PRIMARY, 1), { dy: 0.17 });
    boxOn(b, s, new V(0.22, 0.17, 0.05), PRIMARY, { dy: -0.07, lift: 0.128 });
    b.detail(() => {
      for (const y of [-0.03, -0.075, -0.12]) boxOn(b, s, new V(0.2, 0.012, 0.004), darker(PRIMARY, 1), { dy: y, lift: 0.177 });
      for (const sd of [-1, 1]) boxOn(b, s, new V(0.006, 0.02, 0.1), SECONDARY, { dx: sd * 0.137, dy: 0.04, lift: 0.015 });
    });
    boxOn(b, s, new V(0.07, 0.016, 0.022), SECONDARY, { dy: 0.205, lift: 0.04 });
  },

  mochilaRadio: (c) => {
    const { b, p } = c;
    packStraps(c);
    const s = backSpot(p, 1.17);
    boxOn(b, s, new V(0.25, 0.34, 0.1), PRIMARY);
    // The radio in the pack's open top: knobs, and a long whip antenna.
    boxOn(b, s, new V(0.21, 0.09, 0.08), SECONDARY, { dy: 0.2, lift: 0.006 });
    for (const x of [-0.06, 0, 0.05]) cylOn(b, s, 0.011, 0.02, fixed('rubber'), { off: new V(x, 0.255, 0.05), seg: 5 });
    cylOn(b, s, 0.006, 0.5, fixed('rubber'), { off: new V(0.085, 0.49, 0.05), seg: 4, r1: 0.003 });
    boxOn(b, s, new V(0.022, 0.18, 0.006), SECONDARY, { dx: 0.0, dy: -0.04, lift: 0.098 });
    // Handset on the left strap.
    const h = at(p, -0.1, 1.27, 0.05);
    boxOn(b, h, new V(0.035, 0.09, 0.03), SECONDARY);
    boxOn(b, h, new V(0.03, 0.02, 0.012), fixed('rubber'), { dy: 0.035, lift: 0.028 });
  },

  hidratacao: (c) => {
    const { b, p } = c;
    packStraps(c, 0.04);
    const s = backSpot(p, 1.2);
    boxOn(b, s, new V(0.2, 0.4, 0.05), PRIMARY);
    boxOn(b, s, new V(0.16, 0.3, 0.012), darker(PRIMARY, 1), { lift: 0.046, dy: -0.02 });
    boxOn(b, s, new V(0.05, 0.03, 0.04), SECONDARY, { dy: 0.205 });
    // The drinking tube over the right shoulder, down to a bite valve on the chest.
    band(b, overShoulder(p, 0.12, 0.05, 1.26, 1.37, 0.06), 0.012, 0.012, SECONDARY);
    boxOn(b, at(p, 0.12, 1.25, 0.06), new V(0.016, 0.03, 0.016), fixed('rubber'));
  },

  ghillie: (c) => ghillie(c),
  capaTatica: (c) => cape(c),

  // --- Limbs ---

  joelheiras: (c) => {
    const { b, p } = c;
    const ky = p.j.kneeY;
    for (const s of [-1, 1] as Side[]) {
      // A hard cup over the kneecap (pants are up to ~3 cm out), the knee bump in the middle.
      sheet(b, (u, y, k) => legSpot(p, s, y, lerp(FRONT - deg(62), FRONT + deg(62), u), 0.016 + k * (0.034 + 0.014 * bell(u, 0.5, 0.6) * bell(y, ky - 0.005, 0.09))), {
        us: [0, 0.25, 0.5, 0.75, 1],
        vs: [ky - 0.075, ky - 0.035, ky, ky + 0.035, ky + 0.065],
        paint: PRIMARY,
        edge: darker(PRIMARY, 2),
        region: legRegion(s, ky - 0.01, p.j),
      });
      for (const y of [ky - 0.062, ky + 0.056]) legStrap(c, s, y, 0.028, 0.026, SECONDARY);
    }
  },

  cotoveleiras: (c) => {
    const { b, p } = c;
    const ex = p.j.elbow;
    for (const s of [-1, 1] as Side[]) {
      // A cup over the point of the elbow (the back, T pose) and a strap each side; the cup's outer face clears a
      // jacket's sleeve (its edges go down to the skin: a thick pad, never floating).
      sheet(b, (u, x, k) => armSpot(p, s, x, lerp(deg(112), deg(248), u), 0.012 + k * (0.036 + 0.01 * bell(u, 0.5, 0.6) * bell(x, ex, 0.07))), {
        us: [0, 0.25, 0.5, 0.75, 1],
        vs: [ex - 0.05, ex - 0.015, ex + 0.02, ex + 0.055],
        paint: PRIMARY,
        edge: darker(PRIMARY, 2),
        region: armRegion(s),
      });
      for (const x of [ex - 0.065, ex + 0.07]) armStrap(c, s, x, 0.026, 0.02, SECONDARY);
    }
  },

  ombreiras: (c) => {
    const { b, p } = c;
    // Starting past the shoulder joint: what is inside it stays with the torso and would stick up.
    const x0 = p.j.shoulder - 0.025;
    for (const s of [-1, 1] as Side[]) {
      // Three overlapping lames down the deltoid; the top one outermost.
      for (let i = 2; i >= 0; i--) {
        const xa = x0 + i * 0.048;
        sheet(b, (u, x, k) => armSpot(p, s, x, lerp(deg(14), deg(166), u), 0.028 + 0.008 * (2 - i) + 0.012 * bell(x, p.j.shoulder + 0.01, 0.09) + k * 0.012), {
          us: [0, 1 / 3, 2 / 3, 1],
          vs: [xa, xa + 0.035, xa + 0.07],
          paint: i === 1 ? darker(PRIMARY, 1) : PRIMARY,
          edge: darker(PRIMARY, 2),
          region: 'none',
          inner: darker(PRIMARY, 3),
        });
      }
      armStrap(c, s, x0 + 0.16, 0.034, 0.02, SECONDARY, 'none');
    }
  },

  protetorPescoco: (c) => {
    const { b, p } = c;
    // Padded collar around the neck (a dark lining inside it, so the gap at its top never reads as empty when
    // the head turns) and a throat flap over the top of the chest, a slab down to the shirt.
    p.neck(1.43, 1.505, 0.024, { paint: PRIMARY, region: 'none', rimStart: { h: 0.014, out: 0.006, paint: SECONDARY }, rimEnd: { h: 0.012, out: 0.005, paint: SECONDARY }, flare: (t) => 0.004 + 0.004 * t, segments: 10, ts: [0, 0.5, 1] });
    p.neck(1.46, 1.51, 0.006, { paint: darker(PRIMARY, 3), region: 'none', segments: 10, ts: [0, 1] });
    sheet(b, (u, y, k) => p.torsoSurface(y, ax(p, lerp(-0.06, 0.06, u) * (1.1 - (1.445 - y) * 2), y, 0.035), lerp(0.014, 0.035 + 0.01 * (y - 1.33) * 10 + 0.016, k)), {
      us: [0, 0.5, 1],
      vs: [1.33, 1.39, 1.445],
      paint: PRIMARY,
      edge: SECONDARY,
    });
  },

  facaBota: (c) => {
    const { b, p } = c;
    // On the outside of the right shin, over a boot's shaft (or the pants), the handle up.
    const out = Math.PI;
    const s = legSpot(p, 1, 0.235, out - deg(10), 0.04);
    const region = sideName('shin', 1);
    boxOn(b, s, new V(0.036, 0.13, 0.014), PRIMARY, { region });
    boxOn(b, s, new V(0.044, 0.01, 0.018), fixed('steel'), { dy: 0.07, region });
    boxOn(b, s, new V(0.028, 0.075, 0.02), SECONDARY, { dy: 0.11, region });
    boxOn(b, s, new V(0.032, 0.012, 0.022), fixed('steel'), { dy: 0.152, region });
    for (const y of [0.262, 0.19]) legStrap(c, 1, y, 0.03, 0.02, darker(PRIMARY, 1), 'shin_R');
  },

  mapaBussola: (c) => {
    const { b, p } = c;
    const s: Side = -1;
    const ex = p.j.elbow;
    const xw = p.j.wrist;
    const region = armRegion(s);
    // A map case on top of the left forearm (T pose: up, the back of the arm), a compass at its elbow end.
    sheet(b, (u, x, k) => armSpot(p, s, x, lerp(deg(38), deg(142), u), 0.012 + k * 0.024), { us: [0, 0.33, 0.67, 1], vs: [ex + 0.05, lerp(ex + 0.05, xw - 0.035, 0.5), xw - 0.035], paint: PRIMARY, edge: darker(PRIMARY, 2), region });
    b.detail(() =>
      sheet(b, (u, x, k) => armSpot(p, s, x, lerp(deg(55), deg(125), u), 0.037 + k * 0.002), {
        us: [0, 0.5, 1],
        vs: [ex + 0.075, xw - 0.06],
        paint: (u, x) => (Math.floor(u * 2 + (x - ex) * 25) % 2 ? SECONDARY : darker(SECONDARY, 2)),
        region,
      }),
    );
    for (const x of [ex + 0.065, xw - 0.05]) armStrap(c, s, x, 0.016, 0.018, darker(PRIMARY, 1));
    const top = armSpot(p, s, ex + 0.03, deg(90), 0.034);
    cylOn(b, top, 0.02, 0.014, fixed('darkSteel'), { seg: 8, off: new V(0, 0, 0.006), axis: new V(0, 0, 1), region });
    cylOn(b, top, 0.016, 0.004, fixed('offWhite'), { seg: 8, off: new V(0, 0, 0.014), axis: new V(0, 0, 1), region });
    boxOn(b, top, new V(0.004, 0.022, 0.003), fixed('red'), { lift: 0.014, tilt: 0.5, region });
  },
};

// --- Shared rigs ------------------------------------------------------------------------------------------------------

/** A strap around a leg at height y. */
function legStrap(c: Ctx, side: Side, y: number, d: number, width: number, paint: Paint, region?: RegionName, n = 7) {
  band(c.b, Array.from({ length: n }, (_, i) => legSpot(c.p, side, y, (i / n) * Math.PI * 2, d)), width, 0.006, paint, { closed: true, region: region ?? legRegion(side, y, c.p.j) });
}

/** A strap around an arm at distance x. */
function armStrap(c: Ctx, side: Side, x: number, d: number, width: number, paint: Paint, region?: RegionName, n = 6) {
  band(c.b, Array.from({ length: n }, (_, i) => armSpot(c.p, side, x, (i / n) * Math.PI * 2, d)), width, 0.005, paint, { closed: true, region: region ?? armRegion(side) });
}

/** The placard of a chest accessory: a padded panel from 3 cm out to MOUNT and a strap around the chest. */
function placard(c: Ctx, X0: number, X1: number, y0: number, y1: number) {
  const d = 0.03;
  sheet(c.b, (u, y, k) => c.p.torsoSurface(y, ax(c.p, lerp(X0, X1, u), y, d), d + k * (MOUNT + 0.004 - d)), { us: [0, 0.5, 1], vs: [y0, y1], paint: darker(SECONDARY, 1), edge: darker(SECONDARY, 2) });
  torsoRing(c, (y0 + y1) / 2, d - 0.002, 0.025, 0.006, darker(SECONDARY, 2), 10);
}

/**
 * A thigh rig: a platform on the outer thigh with two straps, hung from the belt; a holster or a pouch on it. Set a
 * little behind the side, so the hand of a hanging arm passes in front of it; the straps stand off the inner thigh
 * (the crotch of the pants bulges there when the leg bends).
 */
function thighRig(c: Ctx, s: Side, kind: 'holster' | 'pouch') {
  const { b, p } = c;
  const out = (s < 0 ? 0 : Math.PI) + s * deg(32);
  const region = sideName('thigh', s);
  const d = 0.03;
  const yT = 0.86;
  const yB = 0.73;
  sheet(b, (u, y, k) => legSpot(p, s, y, out + lerp(-deg(34), deg(34), u), d + k * 0.008), { us: [0, 0.5, 1], vs: [yB, (yB + yT) / 2, yT], paint: PRIMARY, edge: darker(PRIMARY, 2), region });
  for (const y of [0.835, 0.76]) {
    const n = 8;
    const ring = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return legSpot(p, s, y, a, d + 0.004 + 0.014 * Math.max(0, s * Math.cos(a)) ** 2);
    });
    band(b, ring, 0.024, 0.006, SECONDARY, { closed: true, region });
  }
  // Drop strap up to the belt line.
  band(b, [legSpot(p, s, yT - 0.01, out, d + 0.006), legSpot(p, s, 0.93, out, d + 0.006), p.torsoSurface(0.985, out, BELT_D)], 0.03, 0.006, SECONDARY, { region });
  const m = legSpot(p, s, 0.79, out, d + 0.008);
  if (kind === 'holster') {
    // Holster body tilted forward a little, the pistol's grip out of the top, the retention strap over it.
    const tilt = -s * 0.12;
    boxOn(b, m, new V(0.06, 0.16, 0.045), darker(PRIMARY, 1), { tilt, region });
    boxOn(b, m, new V(0.036, 0.075, 0.028), fixed('gunmetal'), { tilt: tilt + s * 0.35, dy: 0.1, dx: s * 0.012, lift: 0.008, region });
    boxOn(b, m, new V(0.066, 0.018, 0.05), SECONDARY, { tilt, dy: 0.06, region });
  } else {
    boxOn(b, m, new V(0.085, 0.11, 0.05), PRIMARY, { region });
    boxOn(b, m, new V(0.09, 0.03, 0.056), darker(PRIMARY, 1), { dy: 0.045, region });
    boxOn(b, m, new V(0.018, 0.022, 0.008), fixed('rubber'), { dy: 0.03, lift: 0.052, region });
  }
}

/** The middle of the back where a pack lies (its front at 3 cm, sinking into a vest), on the chest and spine. */
function backSpot(p: BodyParts, y: number): Spot {
  const s = p.torsoSurface(y, BACK, 0.03);
  s.w = [['chest', 0.6], ['spine', 0.4]];
  return s;
}

/** Shoulder straps of a pack: over the shoulders down to the chest, a sternum strap between them. */
function packStraps(c: Ctx, width = 0.055) {
  const d = 0.036;
  const X = strapX(c.p, width) + 0.008;
  for (const s of [-1, 1] as Side[]) {
    const path = overShoulder(c.p, s * X, d, 1.17, 1.34, 0.045);
    band(c.b, path, width, 0.012, darker(PRIMARY, 1));
    boxOn(c.b, path[0], new V(0.04, 0.03, 0.01), fixed('rubber'), { lift: 0.01 });
  }
  band(c.b, [-1, 0, 1].map((k) => at(c.p, k * X, 1.3, d + 0.012)), 0.02, 0.006, SECONDARY);
}

/** Ghillie poncho: a shaggy hood over the head and a mantle over the back and shoulders, covered in strips. */
function ghillie(c: Ctx) {
  const { b, p } = c;
  const h = headShape(p.s.sex);
  const mix = (n: number) => [PRIMARY, darker(PRIMARY, 2), SECONDARY, darker(SECONDARY, 1)][Math.floor(hash(n) * 4)];
  // Hood: open on the face, down to the nape at the back; a jagged lower edge.
  headShell(b, h, {
    y0: 1.53,
    y1: 1.8,
    rows: 3,
    cols: 12,
    d: (y, a) => 0.026 + 0.01 * hash(Math.round(a * 4) + Math.round(y * 60)),
    edge: (a) => 1.53 + 0.19 * bell(angDist(a, FRONT), 0, deg(82)),
    tips: (a) => -0.025 * hash(a * 17),
    paint: (y, a) => mix(Math.round(a * 3) * 7 + Math.round(y * 40)),
    region: 'none',
    closeTop: true,
    rim: 0.008,
  });
  // Cowl around the neck joining the hood to the mantle.
  p.neck(1.43, 1.56, 0.034, { paint: (t, a) => mix(Math.round(a * 4) + Math.round(t * 3) * 11), region: 'none', segments: 8, ts: [0, 0.5, 1], flare: (t) => 0.01 * (1 - t) });
  // Mantle: the back and the back of the shoulders, down to the back of the ribs on each side (not around the
  // sides, where hanging arms would go through it), sides lower, a jagged hem.
  const d = 0.072;
  const top = (u: number) => lerp(1.47, 1.3, clamp01((Math.abs(u - 0.5) * 2 - 0.55) / 0.45));
  const hem = (u: number) => 1.0 + 0.06 * hash(Math.round(u * 8) * 3 + 1);
  const map: Mapper = (u, v, k) => {
    const y = lerp(hem(u), top(u), v);
    return p.torsoSurface(y, BACK + (u * 2 - 1) * deg(70), d + 0.012 * Math.sin(u * 23) * (1 - v) + k * 0.014);
  };
  sheet(b, map, { us: spread(0, 1, 8), vs: [0, 0.35, 0.7, 1], paint: (u, v) => mix(Math.round(u * 8) * 5 + Math.round(v * 3)), edge: darker(PRIMARY, 2), inner: darker(SECONDARY, 2) });
  // Strips: on the hood hanging down and back, on the mantle hanging down.
  for (let i = 0; i < 12; i++) {
    const a = FRONT + deg(70) + (i / 12) * deg(220) + hash(i) * 0.2;
    const y = 1.6 + hash(i + 3) * 0.12;
    const pt = h.point(y, a, 0.032);
    const n = h.normal(y, a);
    const spot: Spot = { p: pt, n, w: [['head', 1]], gordo: new V(), magro: new V() };
    tuft(b, spot, new V(0, -1, 0).addScaledVector(n, 0.45), 0.07 + hash(i + 9) * 0.05, 0.035, mix(i * 13));
  }
  // Over the deltoids, along the arm (down when it hangs).
  for (const s of [-1, 1] as Side[]) {
    for (let i = 0; i < 3; i++) {
      const spot = armSpot(p, s, p.j.shoulder - 0.01 + i * 0.035, deg(60 + i * 30), 0.03);
      tuft(b, spot, new V(s, 0.25, 0), 0.11 + 0.02 * i, 0.04, mix(i * 7 + s * 3 + 40));
    }
  }
  for (let i = 0; i < 22; i++) {
    const u = (i + 0.5) / 22;
    const v = 0.15 + hash(i + 21) * 0.8;
    const spot = map(u, v, 1);
    tuft(b, spot, new V(Math.sin(i * 2.1) * 0.25, -1, 0).addScaledVector(spot.n, 0.35), 0.09 + hash(i + 5) * 0.07, 0.04, mix(i * 17 + 3));
  }
}

/** Tactical rain cape: hangs from the shoulders down the back, flaring out, a rolled hood at the collar. */
function cape(c: Ctx) {
  const { b, p } = c;
  const width = (v: number) => lerp(deg(52), deg(100), THREE.MathUtils.smoothstep(v, 0, 0.45));
  const yOf = (v: number) => lerp(1.455, 0.7, v);
  const map: Mapper = (u, v, k) => {
    const y = yOf(v);
    const yy = Math.max(y, 0.95);
    const a = BACK + (u * 2 - 1) * width(v);
    const fold = 0.012 * Math.sin(u * Math.PI * 7) * v;
    const s = p.torsoSurface(yy, a, 0.05 + 0.09 * Math.pow(v, 1.3) + fold + k * 0.008);
    if (y < yy) {
      s.p.y = y;
      const f = clamp01((0.95 - y) / 0.25) * 0.3;
      const cos = Math.cos(a);
      s.w = [['hips', 1 - f], [cos > 0 ? 'thigh_L' : 'thigh_R', f * Math.abs(cos) + 0.0001], ['spine', 0.0001]];
    }
    return s;
  };
  sheet(b, map, { us: spread(0, 1, 8), vs: [0, 0.12, 0.3, 0.52, 0.76, 1], paint: PRIMARY, inner: darker(PRIMARY, 3), edge: darker(PRIMARY, 2), shade: (u) => 0.5 * Math.sin(u * Math.PI * 7) });
  // Rolled hood at the collar.
  sheet(b, (u, y, k) => p.torsoSurface(y, BACK + (u * 2 - 1) * deg(48), 0.045 + k * 0.03), { us: spread(0, 1, 4), vs: [1.42, 1.455, 1.485], paint: darker(PRIMARY, 1) });
  // Straps from the cape's corners over the shoulders to a clasp on the chest.
  for (const s of [-1, 1] as Side[]) band(b, overShoulder(p, s * 0.09, STRAP_D, 1.37, 1.43, 0.035), 0.025, 0.006, darker(PRIMARY, 2));
  boxOn(b, at(p, 0, 1.37, STRAP_D), new V(0.2, 0.02, 0.008), darker(PRIMARY, 2));
  boxOn(b, at(p, 0, 1.37, STRAP_D + 0.008), new V(0.03, 0.03, 0.01), fixed('gunmetal'));
}

export function tactical(id: string, sex: Sex): PieceGeometry {
  const { b, p } = start(sex, id.length * 29 + 11);
  (BUILDERS[id] ?? BUILDERS.coletePlacas)({ b, p });
  return { skinned: b.build() };
}

export const TACTICAL_GENERATORS: Record<string, Generator> = { tactical: (id, sex) => tactical(id, sex) };
