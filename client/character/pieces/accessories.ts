// Body accessories (catalog "acessorio" minus the face and ears): neck pieces (chain, dog tags, scarf,
// neckerchief, tie), gloves, backpacks, bags, belts, suspenders and tattoos. Everything is skinned and built
// over the body it dresses (body.ts):
// - straps and bands follow the torso's surface (`torsoSurface`, with its build morphs) at an offset that
//   clears what is worn under them, with modeled thickness (the side toward the body is never drawn);
// - gloves are the body's own hand inflated (`buildHand`), so the fist morphs (punho_L/R) come along;
//   fingerless ones are the palm and short finger sleeves, with the skin's fingers coming out of them;
// - packs and pouches are rigid lofts of chamfered rings that ride on the back or the hips and move out
//   with the build ("gordo") as a whole;
// - tattoos are designs cut out of a fine shell just above the skin of the arms (they stay under sleeves
//   and go with a PCD limb, since they carry the limb's region).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { Generator, PieceGeometry } from '.';
import { BodyParts, buildHand, SHAPES, sideName, type BodyShape, type Side } from '../body';
import { FacetBuilder, lodSegments, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, type Paint } from '../palette';
import type { RegionName } from '../rig';
import { start } from './common';
import { BACK, deg, FRONT, lerp } from './kit';

const clamp = THREE.MathUtils.clamp;
const zero = () => new THREE.Vector3();

// --- Surface helpers ----------------------------------------------------------------------------------------

/** A point on the torso at offset `d` with skin weights, region, build deltas and the true surface normal. */
interface Spot {
  p: THREE.Vector3;
  n: THREE.Vector3;
  w: Weights;
  region: RegionName;
  gordo: THREE.Vector3;
  magro: THREE.Vector3;
}

/** `torsoSurface` with a numerical normal: it sees the slope of the shoulders (straps lie flat on them). */
function spot(p: BodyParts, y: number, a: number, d: number): Spot {
  const s = p.torsoSurface(y, a, d);
  const e = 0.004;
  const ta = p.torsoSurface(y, a + e, d).p.sub(p.torsoSurface(y, a - e, d).p);
  const ty = p.torsoSurface(y + e, a, d).p.sub(p.torsoSurface(y - e, a, d).p);
  const n = new THREE.Vector3().crossVectors(ty, ta).normalize();
  if (n.lengthSq() < 0.5 || n.dot(s.n) < 0) n.copy(s.n);
  return { ...s, n };
}

/** Torso angle of the sideways position X (+X the wearer's right) at height y and offset d, front or back. */
function angX(p: BodyParts, X: number, y: number, d: number, back = false) {
  const k = Math.asin(clamp(X / (p.torsoAt(y).w + d), -0.95, 0.95));
  return back ? BACK - k : FRONT + k;
}

/** A path on the torso: height, angle, offset over the skin. */
type Pt = readonly [y: number, a: number, d: number];

/** Unwraps the angles (no jumps of 2π between points) and adds `steps − 1` points between each pair. */
function path(ctrl: readonly Pt[], steps = 1): Pt[] {
  let prev = ctrl[0][1];
  const pts = ctrl.map(([y, a, d]): Pt => {
    prev += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
    return [y, prev, d];
  });
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      out.push([lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f), lerp(pts[i][2], pts[i + 1][2], f)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Height where a strap at offset d crosses the top of the shoulder at sideways distance X from the middle. */
function shoulderTop(p: BodyParts, X: number, d: number) {
  let y = 1.44;
  while (y < 1.468 && p.torsoAt(y).w + d > X) y += 0.002;
  return y;
}

/** Over the shoulder of side s: front at X, the top of the shoulder, back at X (going front to back). */
function overShoulder(p: BodyParts, s: Side, X: number, d: number, backX = X): Pt[] {
  const top = shoulderTop(p, X + 0.012, d);
  return [
    [1.43, angX(p, s * X, 1.43, d), d],
    [top, s > 0 ? Math.PI : 0, d],
    [1.43, angX(p, s * backX, 1.43, d, true), d],
  ];
}

/** A ring of a loft: its points, skin weights, build deltas (the whole ring moves together) and region. */
interface Ring {
  pts: THREE.Vector3[];
  w: Weights;
  g: THREE.Vector3;
  m: THREE.Vector3;
  region: RegionName;
}

/**
 * Connects rings of the same size into a faceted surface (straps, packs, pouches, knots). Faces are turned
 * outward automatically (away from the axis between the rings); `skip` leaves sides out (the face against
 * the body), caps close the ends.
 */
function loft(b: FacetBuilder, rings: readonly Ring[], paint: (j: number, k: number) => Paint, o: { closed?: boolean; skip?: (k: number) => boolean; capStart?: boolean; capEnd?: boolean } = {}) {
  const ids = rings.map((r) => r.pts.map((q) => b.vertex(q, r.w, 0, { gordo: r.g, magro: r.m })));
  const mid = rings.map((r) => r.pts.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(r.pts.length));
  const n = rings.length;
  const K = rings[0].pts.length;
  for (let j = 0; j < (o.closed ? n : n - 1); j++) {
    const j1 = (j + 1) % n;
    const inside = mid[j].clone().add(mid[j1]).multiplyScalar(0.5);
    for (let k = 0; k < K; k++) {
      if (o.skip?.(k)) continue;
      const k1 = (k + 1) % K;
      const pk = paint(j, k);
      b.triAway(ids[j][k], ids[j1][k], ids[j1][k1], inside, pk, rings[j].region);
      b.triAway(ids[j][k], ids[j1][k1], ids[j][k1], inside, pk, rings[j].region);
    }
  }
  const cap = (j: number, other: number) => {
    for (let k = 1; k < K - 1; k++) b.triAway(ids[j][0], ids[j][k], ids[j][k + 1], mid[other], paint(j, -1), rings[j].region);
  };
  if (o.capStart) cap(0, 1);
  if (o.capEnd) cap(n - 1, n - 2);
}

interface StrapOptions {
  w: number;
  /** Thickness. */
  t: number;
  paint: Paint | ((j: number) => Paint);
  closed?: boolean;
  region?: RegionName;
  /** Half width per point (tapered pieces: a tie, a neckerchief); `w` otherwise. */
  half?: (i: number) => number;
}

/** A flat band with thickness along a path on the torso (straps, belts, tails, a tie's blade). */
function strap(b: FacetBuilder, p: BodyParts, pts0: readonly Pt[], o: StrapOptions): Spot[] {
  // Far LODs: every other point of the path (the ends kept).
  const keep = pts0.map((_, i) => i).filter((i) => b.lod < 1 || pts0.length <= 4 || i % 2 === 0 || (!o.closed && i === pts0.length - 1));
  const spots = keep.map((i) => spot(p, ...pts0[i]));
  const n = spots.length;
  let prev: THREE.Vector3 | null = null;
  const rings = spots.map((s, i): Ring => {
    const i0 = o.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const i1 = o.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const tan = spots[i1].p.clone().sub(spots[i0].p).normalize();
    // Across the band: along the surface, never flipping (where the path leaves the surface, e.g. toward a
    // pack, the last good direction is kept, so the band never twists into a fin).
    let side = new THREE.Vector3().crossVectors(tan, s.n);
    if (prev && (side.length() < 0.5 || side.dot(prev) < 0)) side = side.length() < 0.5 ? prev.clone() : side.negate();
    side.normalize();
    prev = side.clone();
    side.multiplyScalar(o.half ? o.half(keep[i]) : o.w / 2);
    const out = s.n.clone().multiplyScalar(o.t);
    return { pts: [s.p.clone().sub(side), s.p.clone().add(side), s.p.clone().add(side).add(out), s.p.clone().sub(side).add(out)], w: s.w, g: s.gordo, m: s.magro, region: o.region ?? s.region };
  });
  const paint = typeof o.paint === 'function' ? o.paint : () => o.paint as Paint;
  // Side 0 is the face against the body: never seen.
  loft(b, rings, (j) => paint(keep[j]), { closed: o.closed, skip: (k) => k === 0, capStart: !o.closed, capEnd: !o.closed });
  // The callers place parts along the path by index: give them every point.
  return b.lod >= 1 ? pts0.map(([y, a, d]) => spot(p, y, a, d)) : spots;
}

/** A part lying on the torso at a spot: `geo` scaled by `size` (z along the normal), turned `roll` around it. */
function onTorso(b: FacetBuilder, s: Spot, geo: THREE.BufferGeometry, size: THREE.Vector3, paint: Paint, o: { off?: number; roll?: number; dx?: number; dy?: number; region?: RegionName } = {}) {
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.n).normalize();
  const up = new THREE.Vector3().crossVectors(s.n, x).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, s.n));
  if (o.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), o.roll));
  const c = s.p.clone().addScaledVector(x, o.dx ?? 0).addScaledVector(up, o.dy ?? 0).addScaledVector(s.n, (o.off ?? 0) + size.z / 2);
  const at = (dp: THREE.Vector3) => new THREE.Matrix4().compose(c.clone().add(dp), q, size);
  b.append(geo, at(zero()), s.w, o.region ?? s.region, paint, { morphs: { gordo: at(s.gordo), magro: at(s.magro) } });
}

const unitBox = () => new THREE.BoxGeometry(1, 1, 1);

/** Gap between the back and a pack's front face: on a shirt (a jacket's back goes into the pack's face). */
const PACK_GAP = 0.02;

// --- Neck ---------------------------------------------------------------------------------------------------

/**
 * A loop around the base of the neck resting on the top of the trapezius (where the torso narrows to the neck, so
 * it hugs the collar line instead of standing out on the shoulders), dropping `drop` in front (a U on the chest),
 * `n` points from the front.
 */
function neckLoop(d: number, drop: number, n: number, top = 1.464): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => {
    const a = FRONT + (i / n) * Math.PI * 2;
    const f = Math.max(0, (Math.sin(a) - 0.68) / 0.32) ** 1.3;
    return [top - drop * f, a, d];
  });
}

/** Chain: flat diamond links along a closed loop, every other one turned a quarter around the chain. */
function chainLinks(b: FacetBuilder, p: BodyParts, loop: readonly Pt[], count: number, len: number, wid: number, paint: Paint, lift = 0) {
  const spots = loop.map(([y, a, d]) => spot(p, y, a, d));
  const n = spots.length;
  const lens = spots.map((s, i) => s.p.distanceTo(spots[(i + 1) % n].p));
  const total = lens.reduce((x, y) => x + y, 0);
  let i = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const at = (k / count) * total;
    while (acc + lens[i] < at) acc += lens[i++];
    const f = (at - acc) / lens[i];
    const s0 = spots[i];
    const s1 = spots[(i + 1) % n];
    const tan = s1.p.clone().sub(s0.p).normalize();
    const nrm = s0.n.clone().lerp(s1.n, f).normalize();
    const side = new THREE.Vector3().crossVectors(tan, nrm).normalize();
    const flat = k % 2 === 0;
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tan, flat ? side : nrm, flat ? nrm : side));
    // Links on edge are a little smaller (they read as the chain's twist, not as spikes).
    const c = s0.p.clone().lerp(s1.p, f).addScaledVector(nrm, lift + (flat ? 0.0025 : wid * 0.35));
    const size = new THREE.Vector3(len / 2, flat ? wid / 2 : wid * 0.35, 0.0035);
    const m = (dp: THREE.Vector3) => new THREE.Matrix4().compose(c.clone().add(dp), q, size);
    b.append(new THREE.OctahedronGeometry(1), m(zero()), s0.w, s0.region, paint, { morphs: { gordo: m(s0.gordo), magro: m(s0.magro) } });
  }
}

/** Neck chain: a cord on the collar line (it reads as a chain from afar), diamond links on it, a medallion. */
function corrente(b: FacetBuilder, p: BodyParts) {
  const d = 0.018;
  const drop = 0.12;
  const loop = neckLoop(d, drop, 24);
  strap(b, p, loop, { w: 0.006, t: 0.004, paint: darker(PRIMARY, 2), closed: true });
  b.detail(() => chainLinks(b, p, neckLoop(d, drop, 48), 24, 0.026, 0.01, PRIMARY, 0.002));
  const s = spot(p, 1.464 - drop - 0.022, FRONT, d);
  const disc = new THREE.CylinderGeometry(1, 1, 1, 7);
  disc.rotateX(Math.PI / 2);
  onTorso(b, s, disc, new THREE.Vector3(0.016, 0.016, 0.005), darker(PRIMARY, 1));
}

/** Dog tags: a thin ball chain and two tags with rubber silencers lying on the chest. */
function dogTag(b: FacetBuilder, p: BodyParts) {
  const d = 0.018;
  const drop = 0.16;
  strap(b, p, neckLoop(d, drop, 24), { w: 0.004, t: 0.004, paint: darker(PRIMARY, 2), closed: true });
  const s = spot(p, 1.464 - drop - 0.03, FRONT, d);
  const tags: [number, number, number, number][] = [
    // dx, dy, roll, off
    [-0.006, 0, 0.06, 0],
    [0.01, -0.012, -0.22, 0.004],
  ];
  for (const [dx, dy, roll, off] of tags) {
    onTorso(b, s, unitBox(), new THREE.Vector3(0.032, 0.054, 0.002), fixed('rubber'), { dx, dy, roll, off });
    onTorso(b, s, unitBox(), new THREE.Vector3(0.027, 0.048, 0.0025), PRIMARY, { dx, dy, roll, off: off + 0.0012 });
  }
}

/** Scarf: two thick rolls around the neck, two ends hanging on the chest with stripes and a short fringe. */
function cachecol(b: FacetBuilder, p: BodyParts) {
  p.neck(1.43, 1.515, 0.03, {
    paint: PRIMARY,
    flare: (t) => 0.006 + 0.009 * Math.abs(Math.sin(t * Math.PI * 2)),
    shade: (t) => (Math.abs(t - 0.5) < 0.15 ? -0.7 : 0.2),
    rimEnd: { h: 0.012, out: 0.004, paint: PRIMARY },
    segments: 10,
    ts: [0, 0.25, 0.5, 0.75, 1],
    region: 'none',
  });
  const W = p.torsoAt(1.4).w / 0.19;
  const tails: [number, number, number][] = [
    // X, bottom, offset
    [-0.035, 1.16, 0.036],
    [-0.085, 1.21, 0.05],
  ];
  for (const [X0, bottom, d] of tails) {
    const ys = [...[0, 0.33, 0.67, 1].map((f) => lerp(1.47, bottom + 0.06, f)), bottom + 0.04, bottom + 0.025, bottom];
    const pts = ys.map((y, i): Pt => [y, angX(p, X0 * W + i * 0.002, y, d), d]);
    // Two stripes near the end (the last segments), then the fringe.
    const n = pts.length - 1;
    const spots = strap(b, p, pts, { w: 0.07 * W, t: 0.012, paint: (j) => (j === n - 3 || j === n - 1 ? SECONDARY : PRIMARY), region: 'none' });
    b.detail(() => {
      const end = spots[spots.length - 1];
      for (let k = 0; k < 3; k++) onTorso(b, end, unitBox(), new THREE.Vector3(0.01, 0.026, 0.006), PRIMARY, { dx: (k - 1) * 0.022 * W, dy: -0.012, off: 0.003, region: 'none' });
    });
  }
}

/** Neckerchief: a band around the neck, the folded triangle in front with a trim and dots, the knot behind. */
function lencoPescoco(b: FacetBuilder, p: BodyParts) {
  p.neck(1.44, 1.488, 0.025, { paint: PRIMARY, rimEnd: { h: 0.008, out: 0.003, paint: PRIMARY }, segments: 8, ts: [0, 1] });
  const d = 0.024;
  const t = 0.006;
  const W = p.torsoAt(1.4).w / 0.19;
  const rows: [number, number][] = [
    [1.472, 0.088],
    [1.43, 0.072],
    [1.39, 0.05],
    [1.35, 0.026],
    [1.318, 0.004],
  ];
  const rings = rows.map(([y, hw]): Ring => {
    const L = spot(p, y, angX(p, -hw * W, y, d), d);
    const R = spot(p, y, angX(p, hw * W, y, d), d);
    const c = spot(p, y, FRONT, d);
    return { pts: [L.p, R.p, R.p.clone().addScaledVector(R.n, t), L.p.clone().addScaledVector(L.n, t)], w: c.w, g: c.gordo, m: c.magro, region: c.region };
  });
  // The slanted edges in the second color (a trim), the face in the first.
  loft(b, rings, (_j, k) => (k === 2 ? PRIMARY : SECONDARY), { skip: (k) => k === 0, capEnd: true });
  b.detail(() => {
    const dots: [number, number][] = [
      [0, 1.41],
      [-0.034, 1.44],
      [0.034, 1.44],
      [0, 1.36],
    ];
    for (const [X, y] of dots) onTorso(b, spot(p, y, angX(p, X * W, y, d), d), new THREE.OctahedronGeometry(1), new THREE.Vector3(0.007, 0.007, 0.002), SECONDARY, { off: t });
  });
  // The knot at the back of the neck and its two short ends.
  const k = spot(p, 1.462, BACK, 0.018);
  onTorso(b, k, new THREE.OctahedronGeometry(1), new THREE.Vector3(0.016, 0.014, 0.012), darker(PRIMARY, 1), { off: 0.002 });
  for (const s of [-1, 1]) onTorso(b, k, unitBox(), new THREE.Vector3(0.018, 0.045, 0.005), PRIMARY, { dx: s * 0.012, dy: -0.026, roll: s * 0.3, off: 0.002 });
}

/** Tie: a knot at the collar and a blade down the front that widens to a point. */
function gravata(b: FacetBuilder, p: BodyParts) {
  const W = p.torsoAt(1.4).w / 0.19;
  // Knot: a wedge, thicker at the top.
  const knot = [
    [1.468, 0.022, 0.02, 0.016],
    [1.448, 0.02, 0.02, 0.018],
    [1.426, 0.016, 0.021, 0.013],
  ].map(([y, hw, d, t]): Ring => {
    const c = spot(p, y, FRONT, d);
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), c.n).normalize().multiplyScalar(hw * W);
    return { pts: [c.p.clone().sub(x), c.p.clone().add(x), c.p.clone().add(x).addScaledVector(c.n, t), c.p.clone().sub(x).addScaledVector(c.n, t)], w: c.w, g: c.gordo, m: c.magro, region: c.region };
  });
  loft(b, knot, () => darker(PRIMARY, 1), { skip: (k) => k === 0, capStart: true, capEnd: true });
  const ys = [1.432, 1.37, 1.28, 1.19, 1.11, 1.085];
  const half = [0.012, 0.021, 0.029, 0.035, 0.039, 0.003];
  strap(b, p, ys.map((y): Pt => [y, FRONT, 0.022]), { w: 0, t: 0.005, half: (i) => half[i] * W, paint: PRIMARY });
}

// --- Gloves -------------------------------------------------------------------------------------------------

/** Gloves that cover the fingers: they hide the hands; fingerless ones leave the fingers' skin. */
export const FULL_GLOVES = new Set(['luvasTaticas', 'luvasTrabalho']);

/** The body's fingers (body.ts FINGERS): where they sit across the knuckles, length, relaxed curl, spread. */
const FINGERS = [
  { across: -0.75, len: 0.92, curl: deg(46), spread: deg(-4) },
  { across: -0.25, len: 1.0, curl: deg(58), spread: deg(0) },
  { across: 0.25, len: 0.94, curl: deg(70), spread: deg(3) },
  { across: 0.75, len: 0.76, curl: deg(82), spread: deg(7) },
];

/**
 * Fingerless glove of one hand: the body's palm rings inflated by `g` (closed just past the knuckles) and
 * short sleeves on the first segment of each finger and the thumb, with a cut edge (an end ring with
 * thickness). The sleeves follow the fist morph like the fingers under them.
 */
function fingerless(b: FacetBuilder, s: BodyShape, side: Side, wrist: THREE.Vector3, paint: Paint) {
  const h = s.hand;
  const g = 0.003;
  const hand = sideName('hand', side);
  const fore = sideName('forearm', side);
  const morph = sideName('punho', side);
  const toWorld = (v: THREE.Vector3) => new THREE.Vector3(wrist.x + side * v.x, wrist.y + v.y, wrist.z + v.z);
  const W = (x: number): Weights => (x < 0.02 ? [[hand, 0.7], [fore, 0.3]] : [[hand, 1]]);
  const vert = (relaxed: THREE.Vector3, fist: THREE.Vector3) => {
    const p = toWorld(relaxed);
    return b.vertex(p, W(relaxed.x), 0, { [morph]: toWorld(fist).sub(p), gordo: zero(), magro: zero() });
  };
  const quad = (a: number, bb: number, c: number, d: number, inside: THREE.Vector3, p: Paint) => {
    b.triAway(a, bb, c, inside, p, hand);
    b.triAway(a, c, d, inside, p, hand);
  };

  // Palm.
  const ring = (x: number, w: number, t: number, arch: number) => [
    new THREE.Vector3(x, t * 0.5, -w * 0.5),
    new THREE.Vector3(x, t * 0.5 + arch, 0),
    new THREE.Vector3(x, t * 0.5, w * 0.5),
    new THREE.Vector3(x, -t * 0.5, w * 0.46),
    new THREE.Vector3(x, -t * 0.62, 0),
    new THREE.Vector3(x, -t * 0.5, -w * 0.46),
  ];
  const pw = h.palmW + 2 * g;
  const pt = h.palmT + 2 * g;
  const rings = [ring(-0.012, pw * 0.74, pt * 1.05, 0.004), ring(h.palmLen * 0.55, pw * 0.96, pt, 0.006), ring(h.palmLen + g, pw, pt * 0.82, 0.004)].map((r) => r.map((v) => vert(v, v)));
  const center = toWorld(new THREE.Vector3(h.palmLen * 0.5, 0, 0));
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) quad(rings[r][i], rings[r][(i + 1) % 6], rings[r + 1][(i + 1) % 6], rings[r + 1][i], center, paint);
  const k = rings[2];
  for (const [a, bb, c] of [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 5],
    [3, 4, 5],
  ]) b.triAway(k[a], k[bb], k[c], center, paint, hand);

  // A sleeve along the first segment of a finger: square rings (base and end) a little bigger than the
  // finger, and the cut edge back down to the finger.
  const sleeve = (frames: (fold: number) => THREE.Matrix4, len: number, sq: (m: THREE.Matrix4, k: number, grow: number) => THREE.Vector3[], k0: number, k1: number) => {
    const r0 = frames(0);
    const f0 = frames(1);
    const end = (m: THREE.Matrix4) => m.clone().multiply(new THREE.Matrix4().makeTranslation(len, 0, 0));
    const base = sq(r0, k0, g).map((v, i) => vert(v, sq(f0, k0, g)[i]));
    const outer = sq(end(r0), k1, g).map((v, i) => vert(v, sq(end(f0), k1, g)[i]));
    const inner = sq(end(r0), k1, 0.0006).map((v, i) => vert(v, sq(end(f0), k1, 0.0006)[i]));
    const mid = toWorld(new THREE.Vector3(len / 2, 0, 0).applyMatrix4(r0));
    for (let i = 0; i < 4; i++) {
      const i1 = (i + 1) % 4;
      quad(base[i], outer[i], outer[i1], base[i1], mid, paint);
      quad(outer[i], inner[i], inner[i1], outer[i1], mid, darker(paint, 2));
    }
  };
  const fw = h.fingerW;
  for (const f of FINGERS) {
    const baseZ = f.across * h.palmW * 0.42;
    const len = h.finger * f.len;
    const frames = (fold: number) => {
      const curl = fold ? deg(95) : f.curl;
      return new THREE.Matrix4().compose(new THREE.Vector3(h.palmLen - 0.004, 0.001, baseZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -f.spread, -curl * 0.5)), new THREE.Vector3(1, 1, 1));
    };
    const sq = (m: THREE.Matrix4, k: number, grow: number) =>
      [
        new THREE.Vector3(0, fw * 0.5 * k + 0.002 + grow, -fw * 0.5 * k - grow),
        new THREE.Vector3(0, fw * 0.5 * k + 0.002 + grow, fw * 0.5 * k + grow),
        new THREE.Vector3(0, -fw * 0.45 * k - grow, fw * 0.5 * k + grow),
        new THREE.Vector3(0, -fw * 0.45 * k - grow, -fw * 0.5 * k - grow),
      ].map((v) => v.applyMatrix4(m));
    const stub = len * 0.34;
    sleeve(frames, stub, sq, 1, lerp(1, 0.92, stub / (len * 0.55)));
  }
  // Thumb (body.ts thumb frames).
  const thumb = (fold: number) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(h.palmLen * 0.28, -h.palmT * 0.18, -h.palmW * 0.42),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(-35) - fold * 0.3, deg(26) - fold * 0.5, deg(-28) - fold * 0.6, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
  const tw = fw * 1.18;
  const tsq = (m: THREE.Matrix4, k: number, grow: number) =>
    [
      new THREE.Vector3(0, tw * 0.5 * k + grow, -tw * 0.5 * k - grow),
      new THREE.Vector3(0, tw * 0.5 * k + grow, tw * 0.5 * k + grow),
      new THREE.Vector3(0, -tw * 0.5 * k - grow, tw * 0.5 * k + grow),
      new THREE.Vector3(0, -tw * 0.5 * k - grow, -tw * 0.5 * k - grow),
    ].map((v) => v.applyMatrix4(m));
  sleeve(thumb, h.finger * 0.46 * 0.55, tsq, 1.35, lerp(1.35, 1, 0.55));
}

/**
 * Gloves of one hand in the body's T-pose (shared with the first-person arms, which bake the fist): full
 * gloves are the body's hand inflated (the same fingers and fist morph); fingerless ones leave the fingers.
 * `c.p`/`c.s` are the paints of the item's first and second colors. Every face is in the hand's region (a
 * PCD hand takes the glove with it).
 */
export function buildGlove(b: FacetBuilder, s: BodyShape, side: Side, id: string, c: { p: Paint; s: Paint }) {
  const parts = new BodyParts(b, s);
  const hand = sideName('hand', side);
  const wrist = new THREE.Vector3(side * parts.j.wrist, parts.j.armY, 0);
  const h = s.hand;
  const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(wrist.x + side * x, wrist.y + y, wrist.z + z);
  const handW: Weights = [[hand, 1]];
  if (FULL_GLOVES.has(id)) {
    const g = id === 'luvasTrabalho' ? 0.0045 : 0.0035;
    buildHand(b, { ...s, hand: { palmLen: h.palmLen + g * 0.5, palmW: h.palmW + 2 * g, palmT: h.palmT + 2 * g, finger: h.finger + g, fingerW: h.fingerW + 2 * g } }, side, wrist, c.p);
  } else fingerless(b, s, side, wrist, c.p);

  if (id === 'luvasTrabalho') {
    // Work gloves: a wide gauntlet cuff in the second color (over a sleeve's cuff), narrowing to the wrist.
    parts.forearm(side, 0.66, 1, 0.006, {
      paint: c.s,
      flare: (t) => (t < 0.92 ? 0.02 + 0.008 * ((0.92 - t) / 0.26) : lerp(0.02, 0.002, (t - 0.92) / 0.08)),
      rimStart: { h: 0.012, out: 0.004, paint: darker(c.s, 1) },
      // A flat ring closes the wide opening down to the arm (the arm goes through it), so it never looks hollow.
      capStart: 0.02,
      rings: [0.66, 0.92, 1],
      region: hand,
    });
  } else {
    // A short cuff over the wrist with a band at its edge (under a long sleeve's cuff).
    const fingerlessCuff = id === 'luvasSemDedos';
    parts.forearm(side, fingerlessCuff ? 0.88 : 0.84, 1, 0.005, { paint: c.p, rimStart: { h: fingerlessCuff ? 0.012 : 0.01, out: 0.004, paint: c.s }, rings: [], region: hand });
    if (!fingerlessCuff) {
      // Tactical: a velcro tab on the back of the wrist and a hard shell over the knuckles.
      b.append(unitBox(), new THREE.Matrix4().compose(toWorld(-0.006, (s.forearm[1] + 0.005) * 0.72 + 0.0025, 0), new THREE.Quaternion(), new THREE.Vector3(0.026, 0.005, h.palmW * 0.5)), handW, hand, c.s);
      b.append(unitBox(), new THREE.Matrix4().compose(toWorld(h.palmLen * 0.86, h.palmT / 2 + 0.0062, 0), new THREE.Quaternion(), new THREE.Vector3(0.024, 0.008, h.palmW * 0.86)), handW, hand, c.s);
    }
  }
}

function gloves(id: string, sex: Sex): PieceGeometry {
  const { b } = start(sex, id.length * 7 + 1);
  for (const side of [-1, 1] as Side[]) buildGlove(b, SHAPES[sex], side, id, { p: PRIMARY, s: SECONDARY });
  return { skinned: b.build() };
}

// --- Packs and bags -----------------------------------------------------------------------------------------

/**
 * Where a pack leans on the back at each height: the back's farthest point around that height (±8 cm, across
 * the pack's width) plus `gap`, so the pack follows the spine's curve without touching the shoulder blades;
 * above the shoulders it stays where the shoulders are (clear of the head). With how it moves with the build.
 */
function backProfile(p: BodyParts, gap: number) {
  return (y: number) => {
    const yc = Math.min(y, 1.4);
    let z = -Infinity;
    let zg = -Infinity;
    let zm = -Infinity;
    for (let yy = yc - 0.08; yy <= yc + 0.08 + 1e-6; yy += 0.02) {
      for (const X of [-0.12, -0.06, 0, 0.06, 0.12]) {
        const s = p.torsoSurface(yy, angX(p, X, yy, 0, true), 0);
        z = Math.max(z, s.p.z);
        zg = Math.max(zg, s.p.z + s.gordo.z);
        zm = Math.max(zm, s.p.z + s.magro.z);
      }
    }
    return { z: z + gap, g: new THREE.Vector3(0, 0, zg - z), m: new THREE.Vector3(0, 0, zm - z) };
  };
}
type Back = ReturnType<typeof backProfile>;

/**
 * Rings of a box with chamfered vertical edges, stacked by height: [y, half width, half depth, chamfer], the
 * face toward the body on the back profile (plus `out`).
 */
function boxRings(p: BodyParts, rows: readonly (readonly number[])[], back: Back, out = 0, scaleX = 1): Ring[] {
  return rows.map(([y, hw0, hd, ch]) => {
    const hw = hw0 * scaleX;
    const at = back(y);
    const cz = at.z + out + hd;
    const pts = [
      [-hw + ch, -hd],
      [hw - ch, -hd],
      [hw, -hd + ch],
      [hw, hd - ch],
      [hw - ch, hd],
      [-hw + ch, hd],
      [-hw, hd - ch],
      [-hw, -hd + ch],
    ].map(([x, z]) => new THREE.Vector3(x, y, cz + z));
    return { pts, w: p.torsoSurface(y, BACK, 0).w, g: at.g, m: at.m, region: 'none' };
  });
}

/** A rigid part of a pack at (x, y, `out` behind the back profile), moving with it. */
function packPart(b: FacetBuilder, p: BodyParts, back: Back, geo: THREE.BufferGeometry, x: number, y: number, out: number, size: THREE.Vector3, paint: Paint, rot = new THREE.Euler()) {
  const at = back(y);
  const m = (dz: THREE.Vector3) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, at.z + out).add(dz), new THREE.Quaternion().setFromEuler(rot), size);
  b.append(geo, m(zero()), p.torsoSurface(y, BACK, 0).w, 'none', paint, { morphs: { gordo: m(at.g), magro: m(at.m) } });
}

/** Offset that puts a point of the back (at X, y) on the pack's front face. */
function toPlane(p: BodyParts, X: number, y: number, back: Back): Pt {
  const a = angX(p, X, y, 0, true);
  return [y, a, back(y).z + 0.006 - p.torsoSurface(y, a, 0).p.z];
}

/**
 * Backpack straps of side s: a padded strap from the top of the pack over the shoulder and down the chest (many
 * points, so it lies on the trapezius and the chest instead of bridging them), a buckle, and the webbing's loose
 * end hanging below it (`tail`: not on a pack with a hip belt). `d` puts it just over a shirt; its thickness
 * clears most of a jacket.
 */
function packStrap(b: FacetBuilder, p: BodyParts, s: Side, back: Back, top: number, paint: Paint, w = 0.055, tail = true) {
  const W = p.torsoAt(1.4).w;
  const d = 0.02;
  const [front, apex, behind] = overShoulder(p, s, 0.6 * W, d, 0.56 * W);
  const end: Pt = [1.22, angX(p, s * 0.7 * W, 1.22, d), d];
  const padded: Pt[] = [toPlane(p, s * 0.42 * W, top, back), [1.36, angX(p, s * 0.5 * W, 1.36, d, true), d], behind, apex, front, [1.36, angX(p, s * 0.6 * W, 1.36, d), d], [1.29, angX(p, s * 0.64 * W, 1.29, d), d], end];
  strap(b, p, [...path(padded.slice(0, 2)), ...path(padded.slice(1, 4), 2).slice(1), ...path(padded.slice(3)).slice(1)], { w: w * (W / 0.19), t: 0.016, paint, region: 'none' });
  // Buckle and the webbing's end below it.
  onTorso(b, spot(p, end[0], end[1], d), unitBox(), new THREE.Vector3(0.034, 0.026, 0.008), darker(paint, 5), { off: 0.014, region: 'none' });
  if (!tail) return;
  const loose: Pt[] = [end, [1.16, angX(p, s * 0.71 * W, 1.16, d), d], [1.11, angX(p, s * 0.71 * W, 1.11, d), d]];
  strap(b, p, path(loose), { w: 0.022, t: 0.005, paint: darker(paint, 3), region: 'none' });
}

/** School backpack: a rounded pack with a front pocket, zipper pulls, a handle and padded straps. */
function mochilaEscolar(b: FacetBuilder, p: BodyParts) {
  const k = p.torsoAt(1.4).w / 0.19;
  const back = backProfile(p, PACK_GAP);
  const main = [
    [1.0, 0.13, 0.05, 0.03],
    [1.025, 0.145, 0.065, 0.035],
    [1.33, 0.145, 0.065, 0.035],
    [1.395, 0.125, 0.058, 0.04],
    [1.425, 0.085, 0.04, 0.03],
  ];
  loft(b, boxRings(p, main, back, 0, k), () => PRIMARY, { capStart: true, capEnd: true });
  // Front pocket on the outside face.
  const pocket = [
    [1.05, 0.095, 0.014, 0.012],
    [1.07, 0.11, 0.026, 0.02],
    [1.2, 0.11, 0.026, 0.02],
    [1.22, 0.095, 0.014, 0.012],
  ];
  loft(b, boxRings(p, pocket, back, 0.124, k), () => SECONDARY, { capStart: true, capEnd: true });
  // Zipper pulls (main and pocket) and the handle on top.
  const pull = new THREE.Vector3(0.009, 0.024, 0.004);
  for (const x of [-0.06, 0.06]) packPart(b, p, back, unitBox(), x * k, 1.37, 0.122, pull, DETAIL);
  packPart(b, p, back, unitBox(), 0.05 * k, 1.205, 0.178, pull, DETAIL);
  packPart(b, p, back, unitBox(), 0, 1.435, 0.04, new THREE.Vector3(0.07, 0.014, 0.02), SECONDARY);
  for (const s of [-1, 1] as Side[]) packStrap(b, p, s, back, 1.39, SECONDARY);
}

/** Hiking backpack: tall pack with a lid, compression straps, a sleeping roll, sternum strap and hip belt. */
function mochilaTrilha(b: FacetBuilder, p: BodyParts) {
  const k = p.torsoAt(1.4).w / 0.19;
  const W = p.torsoAt(1.4).w;
  const back = backProfile(p, PACK_GAP);
  const main = [
    [0.97, 0.13, 0.07, 0.04],
    [1.0, 0.15, 0.085, 0.045],
    [1.45, 0.145, 0.085, 0.045],
    [1.53, 0.135, 0.08, 0.045],
    [1.585, 0.105, 0.062, 0.04],
  ];
  loft(b, boxRings(p, main, back, 0, k), () => PRIMARY, { capStart: true, capEnd: true });
  // Lid over the top.
  const lid = [
    [1.525, 0.152, 0.092, 0.045],
    [1.6, 0.147, 0.088, 0.045],
    [1.635, 0.115, 0.066, 0.04],
  ];
  loft(b, boxRings(p, lid, back, -0.004, k), () => SECONDARY, { capEnd: true });
  // Compression straps across the outside, a sleeping roll under the pack.
  for (const y of [1.27]) packPart(b, p, back, unitBox(), 0, y, 0.172, new THREE.Vector3(0.292 * k, 0.02, 0.006), DETAIL);
  packPart(b, p, back, new THREE.CylinderGeometry(1, 1, 1, 6), 0, 0.928, 0.075, new THREE.Vector3(0.045, 0.34 * k, 0.045), DETAIL, new THREE.Euler(0, 0, Math.PI / 2));
  for (const s of [-1, 1] as Side[]) packStrap(b, p, s, back, 1.45, SECONDARY, 0.058, false);
  // Sternum strap and buckle.
  const ys = 1.3;
  const dS = 0.036;
  strap(b, p, path([-0.55, 0, 0.55].map((x): Pt => [ys, angX(p, x * W, ys, dS), dS])), { w: 0.016, t: 0.005, paint: DETAIL, region: 'none' });
  onTorso(b, spot(p, ys, FRONT, dS), unitBox(), new THREE.Vector3(0.03, 0.024, 0.008), darker(DETAIL, 2), { off: 0.004, region: 'none' });
  // Hip belt: padded wings from the pack around the hips to a buckle in front.
  const dH = 0.034;
  for (const s of [-1, 1] as Side[]) {
    const side = s > 0 ? Math.PI : 0;
    const ctrl: Pt[] = [toPlane(p, s * 0.7 * W, 0.985, back), [0.98, side + s * 0.35, dH], [0.972, side - s * 0.15, dH], [0.966, angX(p, s * 0.35 * W, 0.966, dH), dH], [0.965, angX(p, s * 0.02, 0.965, dH), dH]];
    strap(b, p, path(ctrl), { w: 0.05, t: 0.012, paint: SECONDARY, region: 'none' });
  }
  onTorso(b, spot(p, 0.965, FRONT, dH), unitBox(), new THREE.Vector3(0.05, 0.036, 0.008), DETAIL, { off: 0.011, region: 'none' });
}

/** Crossbody bag: a strap from the left shoulder across the chest and back to a flap bag at the right hip. */
function bolsaTransversal(b: FacetBuilder, p: BodyParts) {
  const W = p.torsoAt(1.4).w;
  // On the shirt (no air under it from the side); thick enough to clear most of a jacket.
  const d = 0.018;
  const front: [number, number][] = [
    [1.36, -0.5],
    [1.26, -0.25],
    [1.16, 0.05],
    [1.07, 0.35],
    [1.0, 0.62],
  ];
  const [frontTop, apex, backTop] = overShoulder(p, -1, 0.6 * W, d);
  const ctrl: Pt[] = [
    apex,
    frontTop,
    ...front.map(([y, x]): Pt => [y, angX(p, x * W, y, d), d]),
    [0.975, Math.PI, d],
    ...[...front].reverse().map(([y, x]): Pt => [y, angX(p, x * W, y, d, true), d]),
    backTop,
  ];
  strap(b, p, path(ctrl, 2), { w: 0.034, t: 0.012, paint: SECONDARY, closed: true, region: 'none' });
  // The bag on the right hip, a flap over its top and a clasp.
  const s = spot(p, 0.92, Math.PI - 0.55, 0.03);
  onTorso(b, s, unitBox(), new THREE.Vector3(0.2, 0.15, 0.055), PRIMARY, { region: 'none' });
  onTorso(b, s, unitBox(), new THREE.Vector3(0.206, 0.095, 0.01), SECONDARY, { dy: 0.032, off: 0.052, region: 'none' });
  onTorso(b, s, unitBox(), new THREE.Vector3(0.022, 0.018, 0.006), fixed('steel'), { dy: -0.012, off: 0.06, region: 'none' });
  // Rings where the strap meets the bag.
  for (const dx of [-0.09, 0.09]) onTorso(b, s, unitBox(), new THREE.Vector3(0.012, 0.016, 0.03), fixed('steel'), { dx, dy: 0.08, off: 0.012, region: 'none' });
}

/** Fanny pack: a thin strap around the waist and a curved pouch in front with its zipper. */
function pochete(b: FacetBuilder, p: BodyParts) {
  // The strap over the pants' waistband (up to 4 cm out), the pouch on the belly above the thighs (they come up
  // to it when crouching).
  const d = 0.044;
  p.torso(0.978, 1.0, d, { paint: SECONDARY, segments: 10, ts: [0, 1], rimEnd: { h: 0.004, out: 0.003, paint: SECONDARY }, region: 'none' });
  // Pouch: D-shaped sections from one end to the other, following the belly's curve.
  const yc = 0.99;
  const hh = 0.045;
  const dd = 0.055;
  const xs: [number, number][] = [
    [-0.12, 0.55],
    [-0.1, 0.92],
    [0, 1],
    [0.1, 0.92],
    [0.12, 0.55],
  ];
  const sec: [number, number][] = [
    [0, hh],
    [0.6 * dd, hh],
    [dd, 0.3 * hh],
    [dd, -0.4 * hh],
    [0.6 * dd, -hh],
    [0, -hh],
  ];
  const rings = xs.map(([X, k]): Ring => {
    const s = spot(p, yc, angX(p, X, yc, d + 0.004), d + 0.004);
    const up = new THREE.Vector3(0, 1, 0);
    return { pts: sec.map(([out, v]) => s.p.clone().addScaledVector(up, v * k).addScaledVector(s.n, out * k)), w: s.w, g: s.gordo, m: s.magro, region: 'none' };
  });
  // The zipper along the top front (face 1) in the second color.
  loft(b, rings, (_j, k) => (k === 1 ? SECONDARY : PRIMARY), { capStart: true, capEnd: true, skip: (k) => k === 5 });
  const z = spot(p, yc + hh * 0.75, angX(p, 0.07, yc, d), d + 0.004);
  onTorso(b, z, unitBox(), new THREE.Vector3(0.01, 0.022, 0.004), SECONDARY, { off: dd * 0.85, region: 'none' });
  // Side buckle on the strap.
  onTorso(b, spot(p, 0.989, Math.PI - 0.25, d), unitBox(), new THREE.Vector3(0.034, 0.03, 0.01), darker(SECONDARY, 2), { region: 'none' });
}

// --- Waist and chest ----------------------------------------------------------------------------------------

/** Belt over the pants' waistband: a band with thick edges, a buckle frame showing the belt, the prong and the tip. */
function cinto(b: FacetBuilder, p: BodyParts) {
  const d = 0.026;
  p.torso(0.952, 0.99, d, { paint: PRIMARY, segments: 10, ts: [0, 1], rimStart: { h: 0.004, out: 0.0015, paint: darker(PRIMARY, 1) }, rimEnd: { h: 0.004, out: 0.0015, paint: darker(PRIMARY, 1) } });
  const s = spot(p, 0.971, FRONT, d);
  onTorso(b, s, unitBox(), new THREE.Vector3(0.05, 0.046, 0.006), DETAIL, { off: 0.001 });
  onTorso(b, s, unitBox(), new THREE.Vector3(0.032, 0.028, 0.004), darker(PRIMARY, 2), { off: 0.0045 });
  onTorso(b, s, unitBox(), new THREE.Vector3(0.004, 0.03, 0.003), DETAIL, { dx: 0.002, off: 0.007 });
  // The tip of the belt after the buckle (toward the wearer's left).
  const tip = spot(p, 0.971, angX(p, -0.055, 0.971, d), d);
  onTorso(b, tip, unitBox(), new THREE.Vector3(0.05, 0.034, 0.005), PRIMARY, { off: 0.0015 });
}

/** Suspenders: straps from the front waistband over the shoulders, crossing in an X on the back, with clips. */
function suspensorios(b: FacetBuilder, p: BodyParts) {
  const W = p.torsoAt(1.4).w;
  const d = 0.02;
  const w = 0.03 * (W / 0.19);
  for (const s of [-1, 1] as Side[]) {
    // One strap rides 4 mm over the other where they cross.
    const db = d + (s > 0 ? 0.0045 : 0);
    const [frontTop, apex, backTop] = overShoulder(p, s, 0.55 * W, d, 0.5 * W);
    const ctrl: Pt[] = [
      [1.0, angX(p, s * 0.45 * W, 1.0, d), d],
      [1.1, angX(p, s * 0.46 * W, 1.1, d), d],
      [1.2, angX(p, s * 0.48 * W, 1.2, d), d],
      [1.3, angX(p, s * 0.52 * W, 1.3, d), d],
      frontTop,
      apex,
      backTop,
      [1.36, angX(p, s * 0.32 * W, 1.36, db, true), db],
      [1.24, angX(p, 0, 1.24, db, true), db],
      [1.12, angX(p, -s * 0.3 * W, 1.12, db, true), db],
      [1.0, angX(p, -s * 0.42 * W, 1.0, db, true), db],
    ];
    const spots = strap(b, p, path(ctrl), { w, t: 0.004, paint: PRIMARY });
    // Clips at both ends.
    for (const e of [spots[0], spots[spots.length - 1]]) onTorso(b, e, unitBox(), new THREE.Vector3(w + 0.006, 0.03, 0.006), DETAIL, { dy: 0.004, off: 0.004 });
  }
  // Leather patch where they cross.
  onTorso(b, spot(p, 1.24, BACK, d + 0.0045), unitBox(), new THREE.Vector3(0.04, 0.04, 0.004), darker(PRIMARY, 2), { roll: Math.PI / 4, off: 0.004 });
}

// --- Tattoos ------------------------------------------------------------------------------------------------

/** Keeps the triangles of a built geometry whose centroid passes `keep` (a design cut out of a fine shell). */
function keepTriangles(g: THREE.BufferGeometry, keep: (c: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const kept: number[] = [];
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, t * 3 + k));
    if (keep(c.divideScalar(3))) kept.push(t);
  }
  const copy = (a: THREE.BufferAttribute) => {
    const n = a.itemSize * 3;
    const src = a.array as Float32Array | Uint16Array;
    const out = new (src.constructor as Float32ArrayConstructor | Uint16ArrayConstructor)(kept.length * n);
    kept.forEach((t, j) => out.set(src.subarray(t * n, t * n + n), j * n));
    const r = new THREE.BufferAttribute(out, a.itemSize, a.normalized);
    r.name = a.name;
    return r;
  };
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, copy(a as THREE.BufferAttribute));
  if (g.morphAttributes.position) out.morphAttributes.position = g.morphAttributes.position.map((a) => copy(a as THREE.BufferAttribute));
  out.morphTargetsRelative = g.morphTargetsRelative;
  out.computeBoundingSphere();
  g.dispose();
  return out;
}

/**
 * Tattoos (primary color): a tribal band of teeth around the right arm below a tee's sleeve, a dagger on
 * the back of the left forearm. Each is a fine shell over that part of the arm, 2 mm above the skin, cut
 * down to the design's triangles.
 */
function tatuagens(id: string, sex: Sex): PieceGeometry {
  const { b, p } = start(sex, id.length * 3 + 9);
  const j = p.j;
  const d = 0.0018;
  const bandSegs = 12;
  const band: [number, number, number, number] = [0.56, 0.585, 0.665, 0.69];
  p.upperArm(1, band[0], band[3], d, { paint: PRIMARY, rings: band, segments: bandSegs });
  const fore = [0.12, 0.8];
  p.forearm(-1, fore[0], fore[1], d, { paint: PRIMARY, rings: Array.from({ length: 23 }, (_, i) => lerp(fore[0], fore[1], i / 22)), segments: 20 });
  const cols = lodSegments(bandSegs, b.lod);
  const step = (Math.PI * 2) / cols;
  const g = keepTriangles(b.build(), (c) => {
    if (c.x > 0) {
      // Upper arm (right): t along the arm, phi around it (atan2 of up and back).
      const t = (c.x - (j.shoulder - 0.07)) / (j.elbow - j.shoulder + 0.07);
      if (t < band[1] || t > band[2]) return true;
      const phi = (Math.atan2(c.y - (j.armY - 0.012 * (1 - t)), c.z) + Math.PI * 2) % (Math.PI * 2);
      const i = Math.floor(phi / step + 1e-6);
      const af = phi / step - i;
      const tf = (t - band[1]) / (band[2] - band[1]);
      // Teeth: one triangle of each quad, alternating up and down.
      return i % 2 === 0 ? tf > af : tf < af;
    }
    // Forearm (left): a dagger on the back of the forearm (up in T-pose), pointing at the wrist.
    const t = (-c.x - (j.elbow - 0.02)) / (j.wrist + 0.012 - j.elbow + 0.02);
    const off = Math.abs(Math.atan2(c.z, c.y - j.armY)) * (180 / Math.PI);
    if (t < 0.16) return false;
    if (t < 0.21) return off < 16;
    if (t < 0.3) return off < 7;
    if (t < 0.34) return off < 40;
    if (t < 0.76) return off < 22 * (1 - (t - 0.34) / 0.44) + 3;
    return false;
  });
  return { skinned: g };
}

// --- Generators ---------------------------------------------------------------------------------------------

const TORSO_PIECES: Record<string, (b: FacetBuilder, p: BodyParts) => void> = {
  corrente,
  dogTag,
  cachecol,
  lencoPescoco,
  gravata,
  mochilaEscolar,
  mochilaTrilha,
  bolsaTransversal,
  pochete,
  cinto,
  suspensorios,
};

function accessory(id: string, sex: Sex): PieceGeometry {
  if (id.startsWith('luvas')) return gloves(id, sex);
  if (id === 'tatuagens') return tatuagens(id, sex);
  const { b, p } = start(sex, id.length * 11 + 7);
  (TORSO_PIECES[id] ?? corrente)(b, p);
  return { skinned: b.build() };
}

export const ACCESSORY_GENERATORS: Record<string, Generator> = {
  accessory: (id, sex) => accessory(id, sex),
};
