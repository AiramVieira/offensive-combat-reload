// Helpers shared by the procedural pieces: fabric offsets, folds, hair locks, small boxes stuck to the body.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import { BodyParts, SHAPES } from '../body';
import { FacetBuilder, type Weights } from '../builder';
import type { Paint } from '../palette';
import type { RegionName } from '../rig';

/** Offsets over the skin by fabric (m): a garment never touches the body, so it never pokes through. */
export const FIT = { skin: 0.004, tight: 0.007, regular: 0.011, loose: 0.018, heavy: 0.026 } as const;

/** A builder and the body parts of a sex, ready for a piece. */
export function start(sex: Sex, seed: number) {
  const b = new FacetBuilder(seed);
  return { b, p: new BodyParts(b, SHAPES[sex]) };
}

const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);

/**
 * Folds around a joint (style guide: 2 to 3 diagonal cuts, never parallel and equal): rings near `c`
 * zigzag in and out along a diagonal, stronger on heavy fabric.
 */
export function folds(c: number, width: number, amp: number, count = 3, phase = 0): (t: number, a: number) => number {
  return (t, a) => amp * bell(t, c, width) * Math.sin(a * count + (t - c) * 40 + phase);
}

/** Shade offsets for the same folds: the inside of a fold darker, the outside lighter. */
export function foldShade(c: number, width: number, count = 3, phase = 0): (t: number, a: number) => number {
  return (t, a) => 0.9 * bell(t, c, width) * Math.sin(a * count + (t - c) * 40 + phase);
}

/**
 * An angular lock of hair: a 4-sided prism from `root` along `dir`, tapering to 1 vertex (style guide:
 * thick blocks that end in 1 or 2 vertices), bent by `curve` (added to the direction along the way).
 */
export function lock(
  b: FacetBuilder,
  root: THREE.Vector3,
  dir: THREE.Vector3,
  len: number,
  width: number,
  thick: number,
  paint: Paint,
  region: RegionName,
  o: { curve?: THREE.Vector3; up?: THREE.Vector3; segments?: number; w?: Weights; twist?: number } = {},
) {
  const w = o.w ?? [['head', 1]];
  // Far LODs: one segment.
  const segs = b.lod >= 1 ? 1 : (o.segments ?? 2);
  const d = dir.clone().normalize();
  const up = (o.up ?? new THREE.Vector3(0, 1, 0)).clone();
  let side = new THREE.Vector3().crossVectors(d, up);
  if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
  side.normalize();
  const norm = new THREE.Vector3().crossVectors(side, d).normalize();
  const rings: number[][] = [];
  const zero = new THREE.Vector3();
  let center = root.clone();
  let dirNow = d.clone();
  for (let s = 0; s <= segs; s++) {
    const k = 1 - (s / (segs + 1)) * 0.85;
    const tw = (o.twist ?? 0) * (s / segs);
    const sd = side.clone().applyAxisAngle(dirNow, tw);
    const nd = norm.clone().applyAxisAngle(dirNow, tw);
    const ring = [
      center.clone().addScaledVector(sd, -width * 0.5 * k).addScaledVector(nd, thick * 0.5 * k),
      center.clone().addScaledVector(sd, width * 0.5 * k).addScaledVector(nd, thick * 0.5 * k),
      center.clone().addScaledVector(sd, width * 0.5 * k).addScaledVector(nd, -thick * 0.5 * k),
      center.clone().addScaledVector(sd, -width * 0.5 * k).addScaledVector(nd, -thick * 0.5 * k),
    ];
    rings.push(ring.map((p) => b.vertex(p, w, s === 0 ? 0.15 : 0, { gordo: zero, magro: zero })));
    if (o.curve) dirNow.add(o.curve.clone().multiplyScalar(1 / segs)).normalize();
    center = center.clone().addScaledVector(dirNow, len / (segs + 1));
  }
  const tip = b.vertex(center.clone().addScaledVector(dirNow, len / (segs + 1)), w, 0, { gordo: zero, magro: zero });
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < 4; i++) {
      const i1 = (i + 1) % 4;
      b.quad(rings[s][i], rings[s][i1], rings[s + 1][i1], rings[s + 1][i], paint, region);
    }
  }
  const last = rings[segs];
  for (let i = 0; i < 4; i++) b.tri(last[i], last[(i + 1) % 4], tip, paint, region);
  // Root cap (inside the cap, but closes the lock).
  b.quad(rings[0][3], rings[0][2], rings[0][1], rings[0][0], paint, region);
}

/** A box stuck to the body on some bones (pockets, patches, buckles), in character space. */
export function box(b: FacetBuilder, center: THREE.Vector3, size: THREE.Vector3, w: Weights, region: RegionName, paint: Paint, rot = new THREE.Euler()) {
  b.append(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromEuler(rot), size), w, region, paint, { build: 0.15 });
}

/**
 * A strand along a path (braids, dreads, cornrows, ponytails): a low poly tube through `pts` with frames
 * carried along the path (no twisting), radius per point (0..1 along), closed at the start, ending in a
 * point (`tip`) or a flat cap. `w` gives the skin weights along it (long hair follows the chest lower down).
 */
export function strand(
  b: FacetBuilder,
  pts0: readonly THREE.Vector3[],
  radius: (t: number) => number,
  paint: Paint | ((t: number, i: number) => Paint),
  region: RegionName,
  o: { sides?: number; w?: (t: number) => Weights; tip?: boolean; flatten?: number } = {},
) {
  const sides = o.sides ?? 4;
  let pts = pts0;
  // Far LODs: every other point of the path (the ends kept).
  if (b.lod >= 1 && pts.length > 3) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  const n = pts.length;
  if (n < 2) return;
  const zero = new THREE.Vector3();
  const tangent = (i: number) => new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
  // First normal: any vector across the first tangent, then parallel transport.
  let t0 = tangent(0);
  let nrm = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  nrm.addScaledVector(t0, -nrm.dot(t0)).normalize();
  const rings: number[][] = [];
  const paintOf = typeof paint === 'function' ? paint : () => paint;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = tangent(i);
    // Carry the normal: remove its component along the new tangent.
    nrm = nrm.clone().addScaledVector(tan, -nrm.dot(tan)).normalize();
    t0 = tan;
    const bin = new THREE.Vector3().crossVectors(tan, nrm).normalize();
    const r = radius(t);
    const w = o.w ? o.w(t) : ([['head', 1]] as Weights);
    const ring: number[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      const p = pts[i].clone().addScaledVector(nrm, Math.cos(a) * r * (o.flatten ?? 1)).addScaledVector(bin, Math.sin(a) * r);
      ring.push(b.vertex(p, w, i === 0 ? 0.12 : 0, { gordo: zero, magro: zero }));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    const p = paintOf(i / (n - 1), i);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      b.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k], p, region);
    }
  }
  const wEnd = o.w ? o.w(1) : ([['head', 1]] as Weights);
  const last = rings[n - 1];
  if (o.tip !== false) {
    const dir = new THREE.Vector3().subVectors(pts[n - 1], pts[n - 2]).normalize();
    const tip = b.vertex(pts[n - 1].clone().addScaledVector(dir, radius(1) * 2.2), wEnd, 0, { gordo: zero, magro: zero });
    for (let k = 0; k < sides; k++) b.tri(last[k], last[(k + 1) % sides], tip, paintOf(1, n - 1), region);
  } else {
    for (let k = 1; k < sides - 1; k++) b.tri(last[0], last[k], last[k + 1], paintOf(1, n - 1), region);
  }
  const first = rings[0];
  for (let k = 1; k < sides - 1; k++) b.tri(first[0], first[k + 1], first[k], paintOf(0, 0), region);
}
