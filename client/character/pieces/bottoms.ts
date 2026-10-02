// Bottoms (legs slot): the 30 pants and the 30 shorts and skirts of the catalog. Pants and shorts are a waist
// (the pelvis with a raised waistband over the top's hem: tops are tucked in) and one tube per leg from the
// crotch down, built here over the body's thigh and shin profile so each item has its own silhouette: skinny
// follows the calf, straight hangs from the knee, baggy and wide-leg grow toward the hem, flares open below the
// knee, jodhpurs balloon at the thigh. Hems are modeled bands (rolled cuffs, elastic cuffs, frayed edges); knee
// and crotch folds are diagonal cuts; pockets, flaps, pads and loops are volumes; stitching, stripes, plaid,
// camo, rips and panels are faces or patches that follow the cloth (`Surf`: the leg, the skirt and the waist
// share the same patch, slab and box helpers). Skirts hang from the band; each side follows the thigh under it
// from just below the band (and the shin below the knee), only a narrow, finely cut strip between the legs blends
// both, so no leg comes through in any pose. The lower shin is in the ankle regions, so tall boots (`over:
// ankle`) hide the pants' hem and the pants read bloused into them (a cone closes the cut); wide legs are worn
// over boots instead (`overBoots`), and loose hems stand off the shoe's heel.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { PieceGeometry } from '.';
import { ANKLE_T, type BodyParts, sideName, type Side } from '../body';
import { lodSegments, segment, type FacetBuilder, type Rim, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, SKIN, type Paint } from '../palette';
import type { RegionName } from '../rig';
import { FIT, foldShade, folds, start } from './common';
import { angDist, column, deg, FRONT, hash, Kit, lerp, SEGMENTS, segmentRect, type Row } from './kit';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
const smooth = THREE.MathUtils.smoothstep;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
/** Boxy sections like the torso's (hips under a skirt). */
const superellipse = (n: number) => (a: number) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), 1 / n);
const HIPS = superellipse(2.4);

// Leg and skirt tubes run downward: a = 0 is +X (the wearer's right), 90° the front (-Z), 270° the back.
const L_FRONT = Math.PI / 2;
const L_BACK = (3 * Math.PI) / 2;
/** Angle on a leg `k` radians from the front toward the outer side (π/2 = the outer side, π = the back, < 0 inward). */
const legA = (s: Side, k: number) => L_FRONT - s * k;
/** 1 on the outer side of a leg, −1 on the inner side. */
const outward = (a: number, s: Side) => s * Math.cos(a);
/** Width of the legs' sections (they are a little narrower than deep, like the body's). */
const SX = 0.94;

// --- Surfaces -------------------------------------------------------------------------------------------------

interface SurfPoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
  /** Center of the section (the inside, for winding). */
  c: THREE.Vector3;
  w: Weights;
  region: RegionName;
  gordo: THREE.Vector3;
  magro: THREE.Vector3;
}

/** A garment surface details can be stuck to: a point (with skin weights and build morphs) at a height and angle. */
interface Surf {
  readonly b: FacetBuilder;
  /** Ring heights of the cloth (patches get rows there, so they never cut under a fold). */
  readonly ys: readonly number[];
  /** Angle between the cloth's vertices. */
  readonly step: number;
  at(y: number, a: number, off?: number): SurfPoint;
}

interface LegShape {
  d: number;
  /** Shin: 0 follows the calf, 1 hangs straight from the knee. */
  loose: number;
  /** Extra radius by height (bagginess, flares). */
  bag: (y: number) => number;
  /** Extra radius by height and angle (folds, creases, puffs, wings). */
  bump: (y: number, a: number, s: Side) => number;
  /** Ring heights, top (inside the waist) to the hem. */
  ys: number[];
  seg: number;
  /**
   * Worn over boots (wide legs): the lower leg isn't in the ankle and shin regions that boots hide, and it is
   * kept wide enough for any boot shaft.
   */
  overBoots?: boolean;
  /** A loose hem stands off the back of the shoe's heel (instead of the heel tab poking through its folds). */
  heel?: boolean;
}

/** Radius a leg worn over boots keeps up to mid-calf (the widest shafts with their cuffs and buckles). */
const BOOT_ROOM = 0.112;
/** How far the back of a shoe (heel counter, pull tab) reaches behind the leg's axis, and up to where. */
const HEEL_R = 0.108;
const HEEL_Y = 0.17;

/** One leg of pants or shorts: a tube over the body's thigh and shin profile, from the crotch to the hem. */
class LegSurf implements Surf {
  readonly ys: number[];
  readonly step: number;
  readonly yAnkle: number;
  private readonly yHip: number;
  private readonly yKnee: number;
  private readonly yShin0: number;
  private readonly yShin1: number;

  constructor(
    readonly b: FacetBuilder,
    readonly p: BodyParts,
    readonly s: Side,
    readonly o: LegShape,
  ) {
    const j = p.j;
    this.ys = o.ys;
    this.step = TAU / lodSegments(o.seg, b.lod);
    this.yHip = j.hipY + 0.03;
    this.yKnee = j.kneeY;
    this.yShin0 = j.kneeY + 0.01;
    this.yShin1 = j.ankleY + 0.02;
    this.yAnkle = lerp(this.yShin0, this.yShin1, ANKLE_T);
  }

  private thighT(y: number) {
    return clamp01((this.yHip - y) / (this.yHip - this.yKnee));
  }

  private shinT(y: number) {
    return clamp01((this.yShin0 - y) / (this.yShin0 - this.yShin1));
  }

  /** Radius of the cloth before the per-angle bumps (body profile + fabric offset + bagginess). */
  base(y: number) {
    const { p, o } = this;
    const r = y >= this.yKnee ? lerp(p.s.thigh[0], p.s.thigh[1], Math.pow(this.thighT(y), 0.85)) : lerp(p.shinRadius(this.shinT(y)), p.s.shin[1][1], o.loose);
    const out = r + o.d + this.bag(y);
    // Over boots: room for the shaft all around, the inner side too (wide legs move their axis outward).
    return o.overBoots ? Math.max(out, (BOOT_ROOM + this.shift(y) / SX) * smooth(0.52 - y, 0, 0.1)) : out;
  }

  /** Bagginess, none at the top of the leg (inside the waist: wide legs don't come out over it). */
  bag(y: number) {
    return this.o.bag(y) * (1 - smooth(y, 0.84, 0.89));
  }

  /** The body's quadriceps and calf (so the cloth stays over them) plus the item's own bumps. */
  bumpAt(y: number, a: number) {
    const o = this.o;
    const muscle =
      y >= this.yKnee
        ? 0.006 * bell(this.thighT(y), 0.45, 0.35) * bell(angDist(a, L_FRONT), 0, deg(55))
        : (1 - o.loose) * 0.008 * bell(this.shinT(y), 0.25, 0.25) * bell(angDist(a, L_BACK), 0, deg(60));
    const heel = o.heel ? Math.max(0, HEEL_R - this.base(y)) * smooth(HEEL_Y - y, 0, 0.05) * bell(angDist(a, L_BACK), 0, 1.3) : 0;
    return muscle + o.bump(y, a, this.s) + heel;
  }

  /** Wide legs move their axis outward so the two never cross between the feet. */
  shift(y: number) {
    return this.bag(y) * 0.5;
  }

  weights(y: number): Weights {
    const s = this.s;
    if (y >= this.yKnee) return segment(sideName('thigh', s), 'hips', sideName('shin', s), 0.14)(this.thighT(y));
    return segment(sideName('shin', s), sideName('thigh', s), sideName('foot', s), 0.12)(this.shinT(y));
  }

  region(y: number): RegionName {
    // Over boots: the whole leg is "thigh" for the hiding masks (only a missing leg hides it).
    if (this.o.overBoots) return sideName('thigh', this.s);
    return y >= this.yKnee ? sideName('thigh', this.s) : y >= this.yAnkle ? sideName('shin', this.s) : sideName('ankle', this.s);
  }

  build(y: number) {
    return lerp(0.12, 0.2, smooth(y, 0.46, 0.54));
  }

  at(y: number, a: number, off = 0): SurfPoint {
    const ys = this.ys;
    let i = 0;
    while (i < ys.length - 2 && y < ys[i + 1]) i++;
    // Linear between rings, like the faces: a patch never sinks under a fold.
    const f = clamp01((ys[i] - y) / (ys[i] - ys[i + 1] || 1));
    const rad = lerp(this.base(ys[i]) + this.bumpAt(ys[i], a), this.base(ys[i + 1]) + this.bumpAt(ys[i + 1], a), f);
    const c = new THREE.Vector3(this.s * (this.p.j.legX + lerp(this.shift(ys[i]), this.shift(ys[i + 1]), f)), y, 0);
    const n = new THREE.Vector3(Math.cos(a) / SX, 0, -Math.sin(a)).normalize();
    const p = c.clone().add(new THREE.Vector3(Math.cos(a) * rad * SX, 0, -Math.sin(a) * rad)).addScaledVector(n, off);
    const gordo = p.clone().sub(c).multiplyScalar(this.build(y));
    return { p, n, c, w: this.weights(y), region: this.region(y), gordo, magro: gordo.clone().multiplyScalar(-0.45) };
  }

  tube(o: { paint: (y: number, a: number) => Paint; shade: (y: number, a: number) => number; rim?: Rim; lift?: (a: number) => number }) {
    const { b, p, s, ys } = this;
    const y0 = ys[0];
    const y1 = ys[ys.length - 1];
    const yOf = (t: number) => lerp(y0, y1, clamp01(t));
    // Hem lifts (side splits, frayed teeth) fade in over the last 8 cm.
    const tl = 1 - Math.min(0.6, 0.08 / (y0 - y1));
    const lift = o.lift;
    b.tube({
      from: new THREE.Vector3(s * p.j.legX, y0, 0),
      to: new THREE.Vector3(s * p.j.legX, y1, 0),
      radius: (t) => this.base(yOf(t)),
      sx: () => SX,
      shiftX: (t) => s * this.shift(yOf(t)),
      bump: (t, a) => this.bumpAt(yOf(t), a),
      along: lift ? (t, a) => -lift(a) * clamp01((t - tl) / (1 - tl)) : undefined,
      ts: ys.map((y) => (y0 - y) / (y0 - y1)),
      segments: this.o.seg,
      a0: L_FRONT,
      region: (t) => this.region(yOf(t)),
      weights: (t) => this.weights(yOf(t)),
      paint: (t, a) => o.paint(yOf(t), a),
      shade: (t, a) => o.shade(yOf(t), a),
      build: (t) => this.build(yOf(t)),
      rimEnd: o.rim,
    });
  }
}

interface SkirtShape {
  /** Top (under the waistband) and hem heights. */
  y0: number;
  y1: number;
  /** Extra radius at the hem (m): A-line, circle. */
  flare: number;
  /** Narrowing toward the hem (m): pencil. */
  taper: number;
  /** Knife pleats around (count) and how deep (fraction of the hips' half width). */
  pleats: number;
  depth: number;
  /** Where the pleats are (1) or the cloth lies flat (0), by angle. */
  pleatOn: (a: number) => number;
  /** Soft folds of a circle skirt (godets), fraction of the half width. */
  godets: number;
  /** Tiers: heights where the skirt steps out (m out). */
  tiers: readonly (readonly [number, number])[];
  /** The hem drops by angle (m): wrap skirts. */
  dip?: (a: number) => number;
  seg: number;
  rings?: readonly number[];
}

/** Half width (m) of the strip at the middle of the front and back where a skirt blends both thighs. */
const SKIRT_MID = 0.03;
/** Finest column spacing at the middle strips (about 9°): coarse skirts are cut 2–3 times finer there. */
const SKIRT_FINE_STEP = (9 * Math.PI) / 180;
/** Rings where the cloth goes over from the hips to the thighs (the weights change fast there). */
const SKIRT_TOP_RINGS = [0.94, 0.9, 0.86];
/** Build morph strength (of the offset from the skirt's axis): the band's own, under the hips' and thighs'. */
const SKIRT_BUILD = 0.15;
/** The cloth follows the thighs from SKIRT_K0 down, fully SKIRT_K1 lower (like the body's thighs at ~0.88 m). */
const SKIRT_K0 = 0.96;
const SKIRT_K1 = 0.16;
/** Below the knee it goes over to the shins, from SKIRT_S0 down over SKIRT_S1. */
const SKIRT_S0 = 0.55;
const SKIRT_S1 = 0.3;

/** A skirt: a hips-shaped tube from the waistband down, flaring, pleated or tiered. */
class SkirtSurf implements Surf {
  readonly ys: number[];
  readonly step: number;
  /** How many times finer the middle strips are cut (1: one plain tube). */
  readonly fine: number;
  readonly sx: number;
  readonly sz: number;
  private readonly w: number;
  private readonly fwd: number;

  constructor(
    readonly b: FacetBuilder,
    readonly p: BodyParts,
    wd: number,
    readonly o: SkirtShape,
  ) {
    const r = p.torsoAt(0.93);
    this.w = r.w;
    this.fwd = r.fwd;
    this.sx = r.w + wd + 0.004;
    this.sz = r.d + wd + 0.012;
    // Patches take the finest column spacing (the strips at the middle, see `tube`).
    this.fine = b.lod ? 1 : Math.min(3, Math.max(1, Math.round(TAU / o.seg / SKIRT_FINE_STEP)));
    this.step = b.lod ? TAU / lodSegments(o.seg, b.lod) : TAU / o.seg / this.fine;
    const ys = [o.y0, ...SKIRT_TOP_RINGS, ...(o.rings ?? [0.9, 0.82, 0.72, 0.6, 0.48, 0.36, 0.24]), o.y1];
    for (const [y] of o.tiers) ys.push(y + 0.002, y - 0.002);
    // The item's own rings closer than 2.5 cm to the top ones are dropped (no thin bands of faces).
    const near = (y: number) => !SKIRT_TOP_RINGS.includes(y) && SKIRT_TOP_RINGS.some((r) => Math.abs(r - y) < 0.025);
    this.ys = [...new Set(ys.filter((y) => y <= o.y0 && y >= o.y1 && (y === o.y1 || y > o.y1 + 0.03) && !near(y)))].sort((x, y) => y - x);
  }

  tOf(y: number) {
    return clamp01((this.o.y0 - y) / (this.o.y0 - this.o.y1));
  }

  radius(y: number) {
    const o = this.o;
    const t = this.tOf(y);
    let add = o.flare * Math.pow(t, 1.25) - o.taper * t;
    for (const [ty, out] of o.tiers) if (y < ty) add += out;
    return 1 + add / this.w;
  }

  bump(y: number, a: number) {
    const o = this.o;
    const t = this.tOf(y);
    let r = 0;
    if (o.pleats) r += o.depth * Math.pow(t, 0.6) * Math.abs(Math.sin((a - L_FRONT) * (o.pleats / 2))) * o.pleatOn(a);
    if (o.godets) r += o.godets * Math.pow(t, 1.4) * Math.max(0, Math.sin((a - L_FRONT) * 3 + 0.4)) ** 2;
    return r;
  }

  dip(y: number, a: number) {
    const t = this.tOf(y);
    return this.o.dip ? this.o.dip(a) * t * t : 0;
  }

  weights(y: number, a: number): Weights {
    // Each side of the cloth follows the thigh under it from just below the band (like the body's own thigh,
    // fully on the thigh by ~0.88 m), so a leg never comes through when it swings or folds; only a narrow
    // strip at the middle (front and back, between the legs) blends both thighs and stretches between them.
    // Below the knee the cloth goes over to the shin, over a long span so the bent knee stays covered.
    const x = Math.cos(a) * this.radius(y) * HIPS(a) * this.sx;
    const right = smooth(x, -SKIRT_MID, SKIRT_MID);
    const k = smooth(SKIRT_K0 - y, 0, SKIRT_K1);
    const shin = smooth(SKIRT_S0 - y, 0, SKIRT_S1);
    const kL = k * (1 - right);
    const kR = k * right;
    return [
      ['hips', 1 - k],
      ['thigh_L', kL * (1 - shin)],
      ['shin_L', kL * shin],
      ['thigh_R', kR * (1 - shin)],
      ['shin_R', kR * shin],
    ];
  }

  at(y: number, a: number, off = 0): SurfPoint {
    const ys = this.ys;
    let i = 0;
    while (i < ys.length - 2 && y < ys[i + 1]) i++;
    const f = clamp01((ys[i] - y) / (ys[i] - ys[i + 1] || 1));
    const radAt = (yy: number) => this.radius(yy) * HIPS(a) + this.bump(yy, a);
    const rad = lerp(radAt(ys[i]), radAt(ys[i + 1]), f);
    const c = new THREE.Vector3(0, y - this.dip(y, a), -this.fwd);
    const n = new THREE.Vector3(Math.cos(a) / this.sx, 0, -Math.sin(a) / this.sz).normalize();
    const p = c.clone().add(new THREE.Vector3(Math.cos(a) * rad * this.sx, 0, -Math.sin(a) * rad * this.sz)).addScaledVector(n, off);
    const gordo = p.clone().sub(c).multiplyScalar(SKIRT_BUILD);
    return { p, n, c, w: this.weights(y, a), region: 'pelvis', gordo, magro: gordo.clone().multiplyScalar(-0.45) };
  }

  tube(o: { paint: (y: number, a: number) => Paint; shade: (y: number, a: number) => number; rim: Rim }) {
    const { b, ys } = this;
    const y0 = ys[0];
    const y1 = ys[ys.length - 1];
    const yOf = (t: number) => lerp(y0, y1, clamp01(t));
    const seg = this.o.seg;
    const s = TAU / seg;
    // Up close the middle of the front and back (between the legs, where the cloth stretches from one thigh to
    // the other) is cut three times finer: the stretch stays in a narrow strip, and the faces next to it follow
    // each thigh, so a forward thigh never cuts the corner. Four open strips (front, side, back, side); the
    // far levels are one plain tube.
    const fine = this.fine;
    const strips: [number, number | undefined, number][] =
      fine === 1
        ? [[L_FRONT, undefined, seg]]
        : [
            [L_FRONT - s, 2 * s, 2 * fine],
            [L_FRONT + s, Math.PI - 2 * s, seg / 2 - 2],
            [L_BACK - s, 2 * s, 2 * fine],
            [L_BACK + s, Math.PI - 2 * s, seg / 2 - 2],
          ];
    for (const [a0, arc, segments] of strips)
      b.tube({
        from: new THREE.Vector3(0, y0, 0),
        to: new THREE.Vector3(0, y1, 0),
        radius: (t) => this.radius(yOf(t)),
        sx: () => this.sx,
        sz: () => this.sz,
        shift: () => this.fwd,
        section: HIPS,
        bump: (t, a) => this.bump(yOf(t), a),
        along: this.o.dip ? (t, a) => this.dip(yOf(t), a) : undefined,
        ts: ys.map((y) => (y0 - y) / (y0 - y1)),
        segments,
        a0,
        arc,
        region: 'pelvis',
        weights: (t, a) => this.weights(yOf(t), a),
        paint: (t, a) => o.paint(yOf(t), a),
        shade: (t, a) => o.shade(yOf(t), a),
        build: () => SKIRT_BUILD,
        rimEnd: o.rim,
      });
  }
}

/**
 * The waist and hips (torso convention: a = 0 is the wearer's left, 90° the front), at the waistband's offset
 * less `pull` (m): the front of the crotch comes in to the legs' level under the band.
 */
class TorsoSurf implements Surf {
  readonly ys: number[];
  readonly step = TAU / 10;
  constructor(
    readonly b: FacetBuilder,
    readonly p: BodyParts,
    readonly d: number,
    readonly pull: (y: number, a: number) => number = () => 0,
  ) {
    this.ys = p.s.torso.map((r) => r[0]).sort((x, y) => y - x);
  }

  at(y: number, a: number, off = 0): SurfPoint {
    const s = this.p.torsoSurface(y, a, this.d + off - this.pull(y, a));
    return { p: s.p, n: s.n, c: new THREE.Vector3(0, y, -this.p.torsoAt(y).fwd), w: s.w, region: s.region, gordo: s.gordo, magro: s.magro };
  }
}

const morphsOf = (q: SurfPoint) => ({ gordo: q.gordo, magro: q.magro });

/**
 * A patch lying on a surface between rows (height, angle from, angle to), with rows added at the cloth's own
 * rings and columns at half its face angle, so it stays above the faces. Dropped at the far LOD unless `keep`.
 */
function patchOn(S: Surf, rows: readonly Row[], paint: Paint, o: { off?: number; shade?: number; keep?: boolean; cols?: number; rings?: boolean } = {}) {
  const b = S.b;
  if (b.lod >= 2 && !o.keep) return;
  const off = o.off ?? 0.003;
  const sorted = [...rows].sort((r1, r2) => r1[0] - r2[0]);
  const list: Row[] = [];
  const rings = o.rings === false ? [] : [...S.ys].sort((x, y) => x - y);
  for (let r = 0; r < sorted.length; r++) {
    list.push(sorted[r]);
    if (r + 1 >= sorted.length) break;
    const [y0, a00, a01] = sorted[r];
    const [y1, a10, a11] = sorted[r + 1];
    for (const yr of rings) {
      if (yr <= y0 + 1e-3 || yr >= y1 - 1e-3) continue;
      const f = (yr - y0) / (y1 - y0);
      list.push([yr, lerp(a00, a10, f), lerp(a01, a11, f)]);
    }
  }
  // Columns: a band of constant angles takes the cloth's own vertex angles (its faces then lie parallel to the
  // cloth's); a shaped patch gets columns at half the face angle.
  const lo = Math.min(sorted[0][1], sorted[0][2]);
  const hi = Math.max(sorted[0][1], sorted[0][2]);
  const straight = o.cols === undefined && list.every(([, a0, a1]) => Math.abs(Math.min(a0, a1) - lo) < 1e-6 && Math.abs(Math.max(a0, a1) - hi) < 1e-6);
  let fr: number[];
  if (straight) {
    const angles = [lo];
    for (let i = Math.ceil((lo - L_FRONT) / S.step + 0.02); L_FRONT + i * S.step < hi - 0.02 * S.step; i++) angles.push(L_FRONT + i * S.step);
    angles.push(hi);
    fr = angles.map((x) => (x - lo) / (hi - lo || 1));
  } else {
    const span = Math.max(...list.map(([, a0, a1]) => Math.abs(a1 - a0)));
    const n = o.cols ?? Math.max(1, Math.ceil(span / (S.step / 2)));
    fr = Array.from({ length: n + 1 }, (_, i) => i / n);
  }
  const cols = fr.length - 1;
  const angleAt = (row: Row, i: number) => (straight ? lerp(lo, hi, fr[i]) : lerp(row[1], row[2], fr[i]));
  const grid = list.map((row) =>
    fr.map((_, i) => {
      const q = S.at(row[0], angleAt(row, i), off);
      return b.vertex(q.p, q.w, 0, morphsOf(q));
    }),
  );
  for (let r = 0; r < list.length - 1; r++) {
    for (let i = 0; i < cols; i++) {
      const ym = (list[r][0] + list[r + 1][0]) / 2;
      const am = (angleAt(list[r], i) + angleAt(list[r], i + 1) + angleAt(list[r + 1], i) + angleAt(list[r + 1], i + 1)) / 4;
      const q = S.at(ym, am);
      const [v00, v01, v10, v11] = [grid[r][i], grid[r][i + 1], grid[r + 1][i], grid[r + 1][i + 1]];
      b.triAway(v00, v10, v11, q.c, paint, q.region, o.shade ?? 0);
      b.triAway(v00, v11, v01, q.c, paint, q.region, o.shade ?? 0);
    }
  }
}

/** A wall standing on the surface along a line (y, a), from offset `off0` to `off1`: the edge of a raised panel. */
function wallOn(S: Surf, line: readonly (readonly [number, number])[], off0: number, off1: number, paint: Paint, inward: (y: number, a: number) => readonly [number, number]) {
  const b = S.b;
  const v = line.map(([y, a]) => {
    const q0 = S.at(y, a, off0);
    const q1 = S.at(y, a, off1);
    return [b.vertex(q0.p, q0.w, 0, morphsOf(q0)), b.vertex(q1.p, q1.w, 0, morphsOf(q1))];
  });
  for (let i = 0; i < line.length - 1; i++) {
    const ym = (line[i][0] + line[i + 1][0]) / 2;
    const am = (line[i][1] + line[i + 1][1]) / 2;
    // The inside of the wall: a point toward the panel's middle.
    const [yi, ai] = inward(ym, am);
    const inside = S.at(yi, ai, (off0 + off1) / 2).p;
    const region = S.at(ym, am).region;
    b.triAway(v[i][0], v[i + 1][0], v[i + 1][1], inside, paint, region, -0.4);
    b.triAway(v[i][0], v[i + 1][1], v[i][1], inside, paint, region, -0.4);
  }
}

/** A raised panel with thickness (bibs, aprons, pocket flaps that follow the cloth): top patch plus edge walls. */
function slabOn(S: Surf, rows: readonly Row[], paint: Paint, o: { off?: number; thick?: number; edge?: Paint; cols?: number; rings?: boolean } = {}) {
  const off = o.off ?? 0.002;
  const thick = o.thick ?? 0.006;
  const sorted = [...rows].sort((r1, r2) => r1[0] - r2[0]);
  patchOn(S, sorted, paint, { off: off + thick, keep: true, cols: o.cols, rings: o.rings });
  const edge = o.edge ?? darker(paint, 1);
  const mid = (y: number) => {
    // Angle range of the panel at height y (between the bracketing rows).
    let i = 0;
    while (i < sorted.length - 2 && y > sorted[i + 1][0]) i++;
    const f = clamp01((y - sorted[i][0]) / (sorted[i + 1][0] - sorted[i][0] || 1));
    return [lerp(sorted[i][1], sorted[i + 1][1], f), lerp(sorted[i][2], sorted[i + 1][2], f)] as const;
  };
  const inward = (y: number) => {
    const [a0, a1] = mid(y);
    return [y, (a0 + a1) / 2] as const;
  };
  const yMid = (sorted[0][0] + sorted[sorted.length - 1][0]) / 2;
  const n = 3;
  const across = (row: Row) => Array.from({ length: n + 1 }, (_, i) => [row[0], lerp(row[1], row[2], i / n)] as const);
  wallOn(S, sorted.map(([y, a0]) => [y, a0] as const), off, off + thick, edge, inward);
  wallOn(S, sorted.map(([y, , a1]) => [y, a1] as const), off, off + thick, edge, inward);
  wallOn(S, across(sorted[0]), off, off + thick, edge, (_y, a) => [yMid, a]);
  wallOn(S, across(sorted[sorted.length - 1]), off, off + thick, edge, (_y, a) => [yMid, a]);
}

type BoxPaint = Paint | ((centroid: THREE.Vector3, normal: THREE.Vector3) => Paint);

/**
 * A box (or any unit geometry) on a surface at (y, a): size = width, height, thickness; `tilt` turns it on
 * the cloth, `at` moves it in its own plane (after the tilt). Follows the build morphs.
 */
function boxOn(S: Surf, y: number, a: number, size: THREE.Vector3, paint: BoxPaint, o: { off?: number; tilt?: number; at?: readonly [number, number]; geo?: THREE.BufferGeometry } = {}) {
  const q = S.at(y, a);
  const x = new THREE.Vector3().crossVectors(UP, q.n).normalize();
  const up = new THREE.Vector3().crossVectors(q.n, x).normalize();
  const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, q.n));
  if (o.tilt) rot.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), o.tilt));
  // Sunk a little: the flat back stays on the curved cloth at the edges.
  const c = q.p.clone().addScaledVector(q.n, (o.off ?? 0) + size.z / 2 - 0.003);
  if (o.at) c.add(new THREE.Vector3(o.at[0], o.at[1], 0).applyQuaternion(rot));
  const m = (d: THREE.Vector3) => new THREE.Matrix4().compose(c.clone().add(d), rot, size);
  S.b.append(o.geo ?? new THREE.BoxGeometry(1, 1, 1), m(new THREE.Vector3()), q.w, q.region, paint, { morphs: { gordo: m(q.gordo), magro: m(q.magro) } });
}

/** A strap (overall straps): a flat 3-sided band through points on surfaces, `width` wide and `thick` thick. */
function strap(b: FacetBuilder, pts: readonly SurfPoint[], width: number, thick: number, paint: Paint) {
  const rings = pts.map((q, i) => {
    const t = new THREE.Vector3().subVectors(pts[Math.min(pts.length - 1, i + 1)].p, pts[Math.max(0, i - 1)].p).normalize();
    const side = new THREE.Vector3().crossVectors(t, q.n).normalize().multiplyScalar(width / 2);
    const lift = q.n.clone().multiplyScalar(thick);
    const corners = [q.p.clone().sub(side), q.p.clone().sub(side).add(lift), q.p.clone().add(side).add(lift), q.p.clone().add(side)];
    return corners.map((c) => b.vertex(c, q.w, 0, morphsOf(q)));
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const inside = pts[i].p.clone().add(pts[i + 1].p).multiplyScalar(0.5).addScaledVector(pts[i].n, -0.03);
    const region = pts[i].region;
    for (let k = 0; k < 3; k++) {
      const [a, c] = [rings[i][k], rings[i][k + 1]];
      const [bb, d] = [rings[i + 1][k], rings[i + 1][k + 1]];
      b.triAway(a, bb, d, inside, paint, region, k === 1 ? 0 : -0.5);
      b.triAway(a, d, c, inside, paint, region, k === 1 ? 0 : -0.5);
    }
  }
}

// --- Specs ------------------------------------------------------------------------------------------------------

type Hem = 'band' | 'cuff' | 'elastic' | 'raw' | 'fray';
type Pattern = (y: number, a: number, s: Side | 0) => Paint;

interface BottomSpec {
  kind: 'pants' | 'shorts' | 'skirt';
  fit: number;
  /** Hem height (m): pants ~0.1 (the ankle), shorts on the thigh, skirts anywhere. */
  hem: number;
  hemKind?: Hem;
  hemPaint?: Paint;
  /** Hem band height (overrides the kind's). */
  hemH?: number;
  /** Shin: 0 follows the calf, 1 hangs straight from the knee. */
  loose?: number;
  /** Extra leg radius by height (m). */
  bag?: (y: number) => number;
  /** Extra leg radius by height, angle (leg convention) and side: creases, puffs, wings. */
  bump?: (y: number, a: number, s: Side) => number;
  /** Fold strength (1 = by fabric). */
  folds?: number;
  /** Extra leg rings (heights). */
  rings?: number[];
  segments?: number;
  /** Paint of the legs (a: leg angle) and of the waist (s = 0, a: torso angle). */
  paint?: Pattern;
  shade?: (y: number, a: number, s: Side | 0) => number;
  /** Hem raised by angle (m): side splits. */
  lift?: (a: number, s: Side) => number;
  /** Top of the waistband (m) and the band: height, how far it stands out, paint, ribbed (elastic). */
  waist?: number;
  band?: { h?: number; out?: number; paint?: Paint; ribbed?: boolean };
  /** Offset of the waist (default: clears the tops' hems). */
  wd?: number;
  skirt?: Partial<SkirtShape> & { flare: number };
  /** Skorts: shorts under the skirt. */
  under?: number;
  /** Wide legs worn over boots (instead of tucked into them). */
  overBoots?: boolean;
  extra?: (c: Ctx) => void;
}

interface Ctx {
  b: FacetBuilder;
  p: BodyParts;
  spec: BottomSpec;
  /** The waist (Kit, for the torso helpers) and the same as a surface. */
  k: Kit;
  waist: TorsoSurf;
  top: number;
  band: Required<Omit<Rim, 'paint'>> & { paint: Paint };
  legs: LegSurf[];
  skirt?: SkirtSurf;
}

const HEMS: Record<Hem, { h: number; out: number }> = {
  band: { h: 0.024, out: 0.005 },
  cuff: { h: 0.045, out: 0.011 },
  elastic: { h: 0.045, out: 0.003 },
  raw: { h: 0.014, out: 0.003 },
  fray: { h: 0.014, out: 0.003 },
};

const P1 = darker(PRIMARY, 1);
const P2 = darker(PRIMARY, 2);
const BRASS = fixed('brass');
const STEEL = fixed('steel');
const Y_BAND = (c: Ctx) => c.top - c.band.h / 2;

// Patterns.
/** Plaid: bands every `step` m and every few columns, `cross` where they meet. */
const plaid =
  (base: Paint, band: Paint, cross: Paint, rows: readonly (readonly [number, number])[] = PLAID_ROWS, cols = 8): Pattern =>
  (y, a, s) => {
    const r = rows.some(([hi, lo]) => y < hi && y > lo);
    const c = column(a, s === 0 ? 10 : cols) % 4 === 0;
    return r && c ? cross : r || c ? band : base;
  };
/** Plaid's horizontal bands on legs (most edges are the legs' own rings; `PLAID_RINGS` adds the rest). */
const PLAID_ROWS = [
  [0.9, 0.86],
  [0.7, 0.645],
  [0.495, 0.445],
  [0.29, 0.2312],
  [0.99, 0.93],
] as const;
const PLAID_RINGS = [0.9, 0.7, 0.29];
/** Camo blotches: smooth noise thresholds in the primary, a darker shade and the detail color. */
const camoAt = (y: number, a: number, s: number) => {
  const n = Math.sin(y * 23 + a * 3.1 + s * 1.3) + 0.8 * Math.sin(y * 11.3 - a * 4.4 + s * 2.2) + 0.6 * Math.sin(a * 7.1 + y * 6 + 1.7);
  return n > 0.8 ? DETAIL : n < -0.85 ? darker(PRIMARY, 5) : n > 0.05 && n < 0.4 ? darker(SECONDARY, 0) : PRIMARY;
};
const camo: Pattern = (y, a, s) => camoAt(y, a, s);
/** The same blotches for boxes stuck on the cloth (by where their faces are). */
const camoBox = (p: THREE.Vector3) => camoAt(p.y, Math.atan2(-p.z, p.x) * 1.7, Math.sign(p.x));
/** Fine wrinkles (linen): faces nudged lighter and darker at random. */
const wrinkles = (y: number, a: number, s: number) => (hash(Math.round(y * 30) * 13 + Math.round(a * 3) * 7 + s * 3) - 0.5) * 1.1;
/** A pressed crease down the front (and back) of the leg. */
const crease = (amp: number, back = true) => (_y: number, a: number) => amp * (bell(angDist(a, L_FRONT), 0, 0.5) + (back ? 0.6 * bell(angDist(a, L_BACK), 0, 0.5) : 0));
/** Cloth stacking over the shoe. */
const stack = (y0: number, amp: number) => (y: number, a: number, s: Side) => amp * bell(y, y0, 0.07) * Math.sin(a * 3 + y * 70 + s);

// --- Detail helpers ------------------------------------------------------------------------------------------------

/** Belt loops around the band (front, sides and the back middle). */
function loops(c: Ctx, paint: Paint = PRIMARY, wide = false, few = false) {
  const y = Y_BAND(c);
  const xs = [-0.12, 0.12];
  const backs = few ? [0] : [-0.1, 0, 0.1];
  const size = new THREE.Vector3(wide ? 0.022 : 0.011, c.band.h + 0.012, 0.005);
  for (const X of xs) c.k.box(y, c.k.angX(X, y), size, paint, c.band.out);
  for (const X of backs) c.k.box(y, c.k.angX(X, y, true), size, paint, c.band.out);
}

/** The front button (or snap) on the band. */
function button(c: Ctx, paint: Paint = BRASS, X = 0) {
  const y = Y_BAND(c);
  c.k.box(y, c.k.angX(X, y), new THREE.Vector3(0.015, 0.015, 0.006), paint, c.band.out);
}

/** The fly: a flap down the front with a stitched edge. */
function fly(c: Ctx, stitch: Paint | null = SECONDARY, paint: Paint = P1) {
  const y1 = c.top - c.band.h;
  const y0 = Math.min(0.89, y1 - 0.07);
  const band = (X0: number, X1: number, ya: number, off: number, p: Paint) =>
    patchOn(c.waist, [ya, (ya + y1) / 2, y1].map((y): Row => [y, c.k.angX(X0, y), c.k.angX(X1, y)]), p, { off, cols: 1, rings: false });
  band(-0.004, 0.022, y0, 0.0025, paint);
  if (stitch !== null) band(0.017, 0.021, y0 + 0.012, 0.0035, stitch);
}

/** Front pocket openings: a J curve (jeans) or a straight slant (chinos, dress pants), from the band to the side. */
function frontPockets(c: Ctx, paint: Paint = P2, style: 'j' | 'slant' = 'j') {
  const yTop = c.top - c.band.h;
  const y0 = yTop - 0.075;
  for (const s of [-1, 1]) {
    const rows: Row[] = [0, 0.4, 0.75, 1].map((f) => {
      const y = lerp(y0, yTop, f);
      const X = s * (style === 'j' ? lerp(0.15, 0.078, Math.sqrt(f)) : lerp(0.15, 0.1, f));
      const a0 = c.k.angX(X, y);
      const a1 = c.k.angX(X - s * 0.012, y);
      return [y, Math.min(a0, a1), Math.max(a0, a1)];
    });
    patchOn(c.waist, rows, paint, { off: 0.0025, cols: 1, rings: false });
  }
}

/** Back pockets: patch pockets as volumes (with a stitched line or a flap and button), or welts. */
function backPockets(c: Ctx, paint: Paint = PRIMARY, o: { stitch?: Paint; flap?: Paint; snap?: Paint; welt?: boolean; w?: number } = {}) {
  const y = c.top - c.band.h - 0.058;
  const w = o.w ?? 0.072;
  for (const s of [-1, 1]) {
    const a = c.k.angX(s * 0.072, y, true);
    if (o.welt) {
      // A slit with a button above it.
      const yw = y + 0.03;
      c.k.patch(
        [
          [yw - 0.004, c.k.angX(s * 0.04, yw, true), c.k.angX(s * 0.105, yw, true)],
          [yw + 0.004, c.k.angX(s * 0.04, yw, true), c.k.angX(s * 0.105, yw, true)],
        ].map(([yy, a0, a1]) => [yy, Math.min(a0, a1), Math.max(a0, a1)] as Row),
        P2,
        { off: 0.003 },
      );
      if (o.snap !== undefined) c.k.box(yw + 0.012, a, new THREE.Vector3(0.01, 0.01, 0.004), o.snap, 0.002);
      continue;
    }
    c.k.box(y, a, new THREE.Vector3(w, 0.085, 0.007), paint);
    if (o.flap !== undefined) c.k.box(y + 0.036, c.k.angX(s * 0.072, y + 0.036, true), new THREE.Vector3(w + 0.006, 0.026, 0.01), o.flap);
    else if (o.stitch !== undefined) c.k.box(y + 0.022, a, new THREE.Vector3(w - 0.012, 0.005, 0.0085), o.stitch);
    if (o.snap !== undefined) c.k.box(y + 0.03, a, new THREE.Vector3(0.01, 0.01, 0.004), o.snap, 0.009);
  }
}

/** Drawstring cords hanging from an elastic band. */
function drawstring(c: Ctx, paint: Paint = DETAIL) {
  const yk = Y_BAND(c) - 0.006;
  for (const s of [-1, 1]) boxOn(c.waist, yk, FRONT, new THREE.Vector3(0.006, 0.075, 0.006), paint, { off: c.band.out + 0.002, tilt: s * 0.22, at: [s * 0.008, -0.034] });
  // The knot.
  c.k.box(yk, FRONT, new THREE.Vector3(0.02, 0.012, 0.008), paint, c.band.out);
}

/** A belt in the band's paint, with a buckle. */
function buckle(c: Ctx, paint: Paint = STEEL, X = 0) {
  const y = Y_BAND(c);
  c.k.box(y, c.k.angX(X, y), new THREE.Vector3(0.042, c.band.h + 0.006, 0.006), paint, c.band.out);
  c.k.box(y, c.k.angX(X, y), new THREE.Vector3(0.026, c.band.h - 0.01, 0.004), darker(c.band.paint, 1), c.band.out + 0.004);
}

/** Leg helpers run on both legs; `s` is the side. */
const eachLeg = (c: Ctx, fn: (L: LegSurf, s: Side) => void) => c.legs.forEach((L) => fn(L, L.s));

/** A pocket with a flap on the leg (cargo), as volumes; the flap and snap follow the pocket's tilt. */
function cargo(L: LegSurf, y: number, k: number, pocket: BoxPaint, flap: BoxPaint, o: { snap?: Paint; w?: number; h?: number; tilt?: number } = {}) {
  const a = legA(L.s, k);
  const w = o.w ?? 0.08;
  const h = o.h ?? 0.11;
  const tilt = (o.tilt ?? 0) * -L.s;
  boxOn(L, y, a, new THREE.Vector3(w, h, 0.016), pocket, { tilt });
  boxOn(L, y, a, new THREE.Vector3(w + 0.008, 0.03, 0.021), flap, { tilt, at: [0, h / 2 - 0.01] });
  if (o.snap !== undefined) boxOn(L, y, a, new THREE.Vector3(0.012, 0.012, 0.006), o.snap, { tilt, off: 0.017, at: [0, h / 2 - 0.016] });
}

/** A stripe down the outer side of the leg (`k` from the front, `half` its half angle), continued up the hip. */
function sideStripe(c: Ctx, paint: Paint, k = Math.PI / 2, half = 0.09, o: { y0?: number; y1?: number; hip?: boolean } = {}) {
  eachLeg(c, (L, s) => {
    const y0 = o.y0 ?? L.ys[L.ys.length - 1] + 0.03;
    const y1 = o.y1 ?? 0.92;
    const a0 = legA(s, k - half);
    const a1 = legA(s, k + half);
    patchOn(L, [
      [y0, Math.min(a0, a1), Math.max(a0, a1)],
      [y1, Math.min(a0, a1), Math.max(a0, a1)],
    ], paint, { off: 0.0025 });
    if (o.hip !== false) {
      // Up the hip to the band (torso: the wearer's left is a = 0).
      const side = s < 0 ? 0 : Math.PI;
      const h = (half * 0.09) / 0.17;
      c.k.patch(
        [
          [0.88, side - h, side + h],
          [c.top - c.band.h, side - h, side + h],
        ],
        paint,
        { off: 0.003 },
      );
    }
  });
}

/** A reinforced panel over the front of the knee (double knee, articulated knee). */
function kneePanel(L: LegSurf, paint: Paint, y0 = 0.42, y1 = 0.6, half = 0.95) {
  const a0 = legA(L.s, -half * 0.8);
  const a1 = legA(L.s, half);
  patchOn(L, [
    [y0, Math.min(a0, a1), Math.max(a0, a1)],
    [y1, Math.min(a0, a1), Math.max(a0, a1)],
  ], paint, { off: 0.003 });
}

/** A rounded pad over the knee (knee pads, moto armor), with optional ribs. */
function kneePad(L: LegSurf, paint: Paint, o: { y?: number; size?: THREE.Vector3; ribs?: number; ribPaint?: Paint; off?: number } = {}) {
  const y = o.y ?? 0.5;
  const size = o.size ?? new THREE.Vector3(0.1, 0.13, 0.04);
  const puck = new THREE.CylinderGeometry(0.36, 0.5, 1, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6);
  boxOn(L, y, legA(L.s, 0.08), size, paint, { geo: puck, off: o.off ?? 0 });
  for (let i = 0; i < (o.ribs ?? 0); i++) {
    const dy = (i - ((o.ribs ?? 1) - 1) / 2) * 0.03;
    boxOn(L, y, legA(L.s, 0.08), new THREE.Vector3(size.x * 0.6, 0.008, 0.006), o.ribPaint ?? darker(paint, 2), { off: size.z - 0.004 + (o.off ?? 0), at: [0, dy] });
  }
}

/** Skin showing through ragged tears, with threads across (ripped jeans). */
function rip(L: LegSurf, y: number, k: number, w: number, h: number, thread: Paint) {
  const c = legA(L.s, k);
  const rows: Row[] = [
    [y - h, c - w * 0.3, c + w * 0.15],
    [y - h * 0.35, c - w, c + w * 0.6],
    [y + h * 0.35, c - w * 0.7, c + w],
    [y + h, c - w * 0.15, c + w * 0.35],
  ];
  patchOn(L, rows, SKIN, { off: 0.0025, cols: 2 });
  for (const dy of h > 0.025 ? [-0.3, 0.25] : [0]) {
    const yy = y + dy * h;
    patchOn(L, [
      [yy - 0.0025, c - w * 0.85, c + w * 0.85],
      [yy + 0.0025, c - w * 0.85, c + w * 0.85],
    ], thread, { off: 0.004, cols: 2 });
  }
}

/** Digits on a leg (soccer shorts), read from the front. */
function legNumber(L: LegSurf, text: string, cy: number, h: number, k: number, paint: Paint) {
  const w = h * 0.56;
  const t = h * 0.18;
  const gap = w * 0.3;
  const total = text.length * w + (text.length - 1) * gap;
  const r = L.base(cy) + 0.004;
  const a0 = legA(L.s, k);
  [...text].forEach((ch, i) => {
    const cx = -total / 2 + w / 2 + i * (w + gap);
    for (const seg of SEGMENTS[ch] ?? '') {
      const [x0, x1, y0, y1] = segmentRect(seg, w, h, t);
      // Viewer's right is the wearer's left: the angle grows toward −X.
      const aa = a0 + (cx + x0) / r;
      const ab = a0 + (cx + x1) / r;
      patchOn(L, [
        [cy + y0, Math.min(aa, ab), Math.max(aa, ab)],
        [cy + y1, Math.min(aa, ab), Math.max(aa, ab)],
      ], paint, { off: 0.004, cols: 1 });
    }
  });
}

/** Jeans: J pockets, a coin pocket, the fly, a button, loops and stitched back pockets. */
const jeans =
  (o: { loops?: boolean; back?: boolean; stitch?: Paint } = {}) =>
  (c: Ctx) => {
    const stitch = o.stitch ?? SECONDARY;
    frontPockets(c, P2, 'j');
    // Coin pocket on the right.
    const y = c.top - c.band.h - 0.03;
    c.k.rect(0.09, 0.115, y - 0.012, y + 0.012, P1, false, 0.0025);
    fly(c, stitch);
    button(c, BRASS);
    if (o.loops !== false) loops(c, PRIMARY);
    if (o.back !== false) backPockets(c, PRIMARY, { stitch });
  };

// --- The catalog -----------------------------------------------------------------------------------------------

const SPECS: Record<string, BottomSpec> = {
  // ---- Pants ----
  calcaJeans: { kind: 'pants', fit: FIT.regular, hem: 0.105, loose: 0.6, bag: () => 0.004, extra: jeans() },
  jeansSkinny: { kind: 'pants', fit: FIT.tight, hem: 0.115, loose: 0, bump: stack(0.15, 0.004), rings: [0.15], folds: 0.7, extra: jeans() },
  jeansRasgada: {
    kind: 'pants',
    fit: FIT.regular,
    hem: 0.105,
    loose: 0.45,
    extra: (c) => {
      jeans()(c);
      eachLeg(c, (L, s) => {
        rip(L, 0.5, 0.1, 0.55, 0.042, fixed('offWhite'));
        if (s < 0) rip(L, 0.72, 0.35, 0.3, 0.022, fixed('offWhite'));
      });
    },
  },
  jeansDobrada: { kind: 'pants', fit: FIT.regular, hem: 0.135, hemKind: 'cuff', hemH: 0.05, hemPaint: SECONDARY, loose: 0.65, bag: () => 0.004, extra: jeans() },
  jeans90: {
    kind: 'pants',
    overBoots: true,
    fit: FIT.loose,
    hem: 0.065,
    loose: 1,
    bag: (y) => 0.014 + 0.014 * clamp01((0.9 - y) / 0.8),
    bump: stack(0.14, 0.008),
    rings: [0.17, 0.12],
    folds: 1.3,
    extra: (c) => {
      jeans({ back: false })(c);
      backPockets(c, PRIMARY, { stitch: SECONDARY, w: 0.084 });
    },
  },
  cargoTatica: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.105,
    loose: 0.6,
    bag: () => 0.006,
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, fixed('gunmetal'));
      loops(c, P1, true, true);
      backPockets(c, PRIMARY, { flap: SECONDARY });
      eachLeg(c, (L) => {
        kneePanel(L, SECONDARY, 0.43, 0.59, 0.8);
        cargo(L, 0.66, 1.35, PRIMARY, SECONDARY, { w: 0.08, h: 0.12 });
      });
    },
  },
  calcaCargo: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.105,
    loose: 0.85,
    bag: () => 0.008,
    band: { paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, BRASS);
      loops(c, PRIMARY);
      backPockets(c, PRIMARY, { stitch: P2 });
      eachLeg(c, (L) => cargo(L, 0.62, Math.PI / 2, PRIMARY, SECONDARY, { snap: DETAIL, w: 0.085, h: 0.12 }));
    },
  },
  combate: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.115,
    hemKind: 'elastic',
    hemPaint: P1,
    loose: 0.5,
    bag: (y) => 0.008 + 0.01 * bell(y, 0.18, 0.08),
    band: { h: 0.045, paint: SECONDARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      buckle(c, fixed('gunmetal'));
      loops(c, SECONDARY, true, true);
      eachLeg(c, (L) => {
        // Knee pads in their pockets, angled thigh pockets.
        kneePad(L, DETAIL, { y: 0.5, size: new THREE.Vector3(0.095, 0.12, 0.034), ribs: 1, off: 0.004 });
        cargo(L, 0.68, 1.2, PRIMARY, SECONDARY, { tilt: 0.25, w: 0.08, h: 0.12 });
      });
    },
  },
  calcaCamuflada: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.105,
    loose: 0.8,
    bag: () => 0.006,
    rings: [0.78, 0.17],
    paint: camo,
    band: { paint: darker(PRIMARY, 3) },
    extra: (c) => {
      fly(c, null, darker(PRIMARY, 3));
      button(c, fixed('gunmetal'));
      loops(c, darker(PRIMARY, 3));
      eachLeg(c, (L) => cargo(L, 0.64, Math.PI / 2, camoBox, darker(PRIMARY, 3), { w: 0.085, h: 0.12 }));
    },
  },
  chino: {
    kind: 'pants',
    fit: FIT.regular,
    hem: 0.11,
    loose: 0.7,
    bag: () => 0.003,
    bump: crease(0.003, false),
    band: { paint: PRIMARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, darker(PRIMARY, 4));
      loops(c, PRIMARY);
      backPockets(c, PRIMARY, { welt: true, snap: darker(PRIMARY, 4) });
    },
  },
  social: {
    kind: 'pants',
    fit: FIT.regular,
    hem: 0.1,
    loose: 0.85,
    bump: crease(0.005),
    // The belt takes the (fixed) secondary color, the buckle the detail one.
    band: { h: 0.032, paint: SECONDARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      buckle(c, DETAIL);
      loops(c, PRIMARY);
      backPockets(c, PRIMARY, { welt: true });
    },
  },
  calcaTerno: {
    kind: 'pants',
    fit: FIT.regular,
    hem: 0.1,
    loose: 0.9,
    bag: () => 0.002,
    bump: crease(0.005),
    band: { h: 0.04, paint: PRIMARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, darker(PRIMARY, 4), 0.012);
      backPockets(c, PRIMARY, { welt: true, snap: darker(PRIMARY, 4) });
      // Front pleats and side adjusters (no loops: a suit's waist has none).
      const y1 = c.top - c.band.h;
      for (const X of [-0.06, 0.06]) c.k.rect(X - 0.003, X + 0.003, y1 - 0.06, y1, P2, false, 0.0025);
      for (const s of [-1, 1]) c.k.box(Y_BAND(c), s < 0 ? 0.05 : Math.PI - 0.05, new THREE.Vector3(0.03, 0.016, 0.005), STEEL, c.band.out);
    },
  },
  calcaMoletom: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.115,
    hemKind: 'elastic',
    hemH: 0.055,
    hemPaint: SECONDARY,
    loose: 0.3,
    bag: (y) => 0.004 + 0.016 * bell(y, 0.22, 0.12),
    folds: 1.4,
    band: { h: 0.05, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      frontPockets(c, P2, 'slant');
    },
  },
  calcaAgasalho: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.1,
    hemPaint: SECONDARY,
    loose: 0.8,
    bag: () => 0.006,
    band: { h: 0.045, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      sideStripe(c, SECONDARY, Math.PI / 2 - 0.13, 0.05);
      sideStripe(c, SECONDARY, Math.PI / 2 + 0.13, 0.05);
      // Ankle zips.
      eachLeg(c, (L, s) => boxOn(L, 0.15, legA(s, Math.PI / 2), new THREE.Vector3(0.008, 0.07, 0.004), STEEL));
    },
  },
  legging: {
    kind: 'pants',
    fit: FIT.skin + 0.001,
    hem: 0.12,
    hemKind: 'raw',
    hemPaint: SECONDARY,
    loose: 0,
    folds: 0.4,
    waist: 1.04,
    wd: 0.016,
    band: { h: 0.07, out: 0.003, paint: SECONDARY },
    extra: (c) => sideStripe(c, SECONDARY, Math.PI / 2, 0.08, { hip: false }),
  },
  calcaTrabalho: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.1,
    loose: 0.95,
    bag: () => 0.01,
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'j');
      fly(c, SECONDARY);
      button(c, BRASS);
      loops(c, PRIMARY, true, true);
      backPockets(c, PRIMARY, { stitch: SECONDARY });
      eachLeg(c, (L, s) => {
        kneePanel(L, SECONDARY, 0.38, 0.6, 0.9);
        if (s > 0) {
          // Tool pocket with pen slots on the right thigh.
          const a = legA(s, 1.25);
          boxOn(L, 0.7, a, new THREE.Vector3(0.075, 0.1, 0.012), PRIMARY);
          for (const dx of [-0.018, 0.012]) boxOn(L, 0.7, a, new THREE.Vector3(0.016, 0.06, 0.008), SECONDARY, { off: 0.009, at: [dx, 0.02] });
        } else {
          // Hammer loop on the left thigh.
          boxOn(L, 0.7, legA(s, 1.45), new THREE.Vector3(0.02, 0.07, 0.016), SECONDARY);
        }
      });
    },
  },
  jardineira: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.105,
    loose: 0.8,
    bag: () => 0.006,
    band: { paint: PRIMARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      bib(c);
    },
  },
  calcaCouro: {
    kind: 'pants',
    fit: FIT.tight,
    hem: 0.11,
    loose: 0.25,
    folds: 0.7,
    band: { paint: PRIMARY },
    // Leather sheen: lit fronts, dark sides.
    shade: (_y, a, s) => (s === 0 ? 0 : angDist(a, L_FRONT) < 0.5 ? 0.85 : angDist(a, L_BACK) < 0.6 ? 0.3 : -0.5),
    rings: [0.66, 0.56],
    extra: (c) => {
      fly(c, null);
      button(c, STEEL);
      loops(c, PRIMARY);
      // Zipped slant pockets and the knee seams.
      for (const s of [-1, 1]) {
        const y1 = c.top - c.band.h - 0.01;
        const a0 = c.k.angX(s * 0.11, y1);
        const a1 = c.k.angX(s * 0.15, y1 - 0.06);
        c.k.patch(
          [
            [y1 - 0.06, Math.min(a1, a1 + s * 0.06), Math.max(a1, a1 + s * 0.06)],
            [y1, Math.min(a0, a0 + s * 0.06), Math.max(a0, a0 + s * 0.06)],
          ],
          STEEL,
          { off: 0.003 },
        );
      }
      eachLeg(c, (L, s) => {
        for (const y of [0.56, 0.44]) {
          const a0 = legA(s, -0.9);
          const a1 = legA(s, 0.9);
          patchOn(L, [
            [y - 0.003, Math.min(a0, a1), Math.max(a0, a1)],
            [y + 0.003, Math.min(a0, a1), Math.max(a0, a1)],
          ], darker(PRIMARY, 3), { off: 0.002 });
        }
      });
    },
  },
  calcaMoto: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.11,
    loose: 0.6,
    bag: () => 0.008,
    band: { h: 0.04, paint: SECONDARY },
    extra: (c) => {
      fly(c, null);
      button(c, STEEL);
      frontPockets(c, STEEL, 'slant');
      eachLeg(c, (L, s) => {
        // Knee armor with ribs, a hip pad, an accordion stretch panel above the knee, a calf zip.
        kneePad(L, SECONDARY, { y: 0.5, size: new THREE.Vector3(0.11, 0.15, 0.04), ribs: 2, off: 0.003 });
        boxOn(L, 0.85, legA(s, Math.PI / 2), new THREE.Vector3(0.07, 0.09, 0.014), SECONDARY);
        for (const y of [0.61, 0.645]) {
          const a0 = legA(s, -0.7);
          const a1 = legA(s, 0.7);
          patchOn(L, [
            [y - 0.006, Math.min(a0, a1), Math.max(a0, a1)],
            [y + 0.006, Math.min(a0, a1), Math.max(a0, a1)],
          ], darker(PRIMARY, 2), { off: 0.003 });
        }
        boxOn(L, 0.18, legA(s, Math.PI / 2 + 0.3), new THREE.Vector3(0.008, 0.12, 0.004), STEEL);
      });
    },
  },
  pantalona: {
    kind: 'pants',
    overBoots: true,
    fit: FIT.loose,
    hem: 0.05,
    loose: 1,
    waist: 1.06,
    bag: (y) => 0.018 + 0.075 * Math.pow(clamp01((0.92 - y) / 0.85), 1.1),
    rings: [0.24, 0.12],
    folds: 1.2,
    band: { h: 0.045, paint: PRIMARY },
    // Long soft folds down the wide legs.
    shade: (y, a, s) => (s === 0 ? 0 : 0.5 * Math.sin(a * 4 + s) * smooth(0.8 - y, 0, 0.3)),
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, darker(PRIMARY, 4));
      const y1 = c.top - c.band.h;
      for (const X of [-0.065, 0.065]) c.k.rect(X - 0.003, X + 0.003, y1 - 0.08, y1, P2, false, 0.0025);
    },
  },
  linho: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.135,
    loose: 1,
    bag: () => 0.012,
    folds: 1.3,
    shade: (y, a, s) => wrinkles(y, a, s),
    rings: [0.78, 0.3],
    band: { h: 0.04, out: 0.004, paint: PRIMARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      frontPockets(c, P2, 'slant');
    },
  },
  calcaXadrez: {
    kind: 'pants',
    fit: FIT.regular,
    hem: 0.105,
    loose: 0.6,
    rings: PLAID_RINGS,
    paint: plaid(PRIMARY, SECONDARY, darker(SECONDARY, 2)),
    band: { paint: darker(PRIMARY, 2) },
    extra: (c) => {
      frontPockets(c, darker(PRIMARY, 3), 'slant');
      fly(c, null, darker(PRIMARY, 2));
      button(c, darker(PRIMARY, 4));
    },
  },
  calcaEsqui: {
    kind: 'pants',
    overBoots: true,
    fit: FIT.heavy,
    hem: 0.05,
    hemKind: 'band',
    hemH: 0.03,
    hemPaint: SECONDARY,
    loose: 1,
    bag: (y) => 0.012 + 0.012 * clamp01((0.6 - y) / 0.5),
    folds: 1.2,
    waist: 1.06,
    wd: 0.03,
    band: { h: 0.05, paint: SECONDARY },
    rings: [0.15],
    extra: (c) => {
      buckle(c, fixed('rubber'));
      eachLeg(c, (L, s) => {
        // Scuff guards at the inner ankles, articulated knee seams, a thigh vent zip.
        const a0 = legA(s, -Math.PI / 2 - 0.7);
        const a1 = legA(s, -Math.PI / 2 + 0.7);
        patchOn(L, [
          [0.08, Math.min(a0, a1), Math.max(a0, a1)],
          [0.2, Math.min(a0, a1), Math.max(a0, a1)],
        ], SECONDARY, { off: 0.003 });
        kneePanel(L, darker(PRIMARY, 1), 0.44, 0.58, 0.9);
        const za = legA(s, Math.PI / 2 - 0.25);
        patchOn(L, [
          [0.64, za - 0.04, za + 0.04],
          [0.84, za - 0.04, za + 0.04],
        ], SECONDARY, { off: 0.003, cols: 1 });
        boxOn(L, 0.82, za, new THREE.Vector3(0.01, 0.022, 0.006), STEEL, { off: 0.003 });
      });
    },
  },
  pijama: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.1,
    hemPaint: SECONDARY,
    loose: 1,
    bag: () => 0.012,
    segments: 10,
    folds: 1.2,
    paint: (_y, a) => (column(a, 10) % 2 ? SECONDARY : PRIMARY),
    band: { h: 0.04, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      drawstring(c, darker(SECONDARY, 3));
      // A button fly.
      for (const y of [0.94, 0.91]) c.k.box(y, c.k.angX(0.008, y), new THREE.Vector3(0.009, 0.009, 0.004), DETAIL, 0.001);
    },
  },
  montaria: {
    kind: 'pants',
    fit: FIT.tight,
    hem: 0.12,
    hemKind: 'raw',
    loose: 0,
    waist: 1.04,
    band: { h: 0.04, paint: P1 },
    // Jodhpur wings: the thigh balloons out to the side and narrows into a tight knee.
    // (Centered under the hands hanging at the sides.)
    bump: (y, a, s) => 0.06 * bell(y, 0.69, 0.16) * Math.pow(Math.max(0, outward(a, s)), 1.2) + 0.015 * bell(y, 0.69, 0.16) * Math.max(0, -Math.sin(a)),
    rings: [0.76, 0.66],
    folds: 0.6,
    extra: (c) => {
      fly(c, null);
      button(c, BRASS);
      loops(c, PRIMARY);
      // Suede patches on the inner knees and calves.
      eachLeg(c, (L, s) => {
        const a0 = legA(s, -Math.PI / 2 - 0.55);
        const a1 = legA(s, -Math.PI / 2 + 0.55);
        patchOn(L, [
          [0.28, Math.min(a0, a1), Math.max(a0, a1)],
          [0.58, Math.min(a0, a1), Math.max(a0, a1)],
        ], darker(PRIMARY, 3), { off: 0.003 });
      });
    },
  },
  enfermagem: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.1,
    loose: 1,
    bag: () => 0.01,
    band: { h: 0.04, out: 0.004, paint: PRIMARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      frontPockets(c, P2, 'slant');
      backPockets(c, PRIMARY, { stitch: P2 });
      eachLeg(c, (L, s) => {
        if (s < 0) boxOn(L, 0.66, legA(s, 1.35), new THREE.Vector3(0.075, 0.11, 0.012), PRIMARY);
      });
    },
  },
  paraquedista: {
    kind: 'pants',
    fit: FIT.loose,
    hem: 0.115,
    hemKind: 'elastic',
    hemPaint: SECONDARY,
    loose: 0.4,
    bag: (y) => 0.012 + 0.03 * bell(y, 0.45, 0.32) - 0.012 * bell(y, 0.13, 0.08),
    bump: (y, a, s) => 0.008 * Math.sin(a * 2 + y * 26 + s * 2) * smooth(0.85 - y, 0, 0.2),
    folds: 1.4,
    rings: [0.78, 0.3, 0.2],
    // Shiny nylon.
    shade: (_y, a, s) => (s === 0 ? 0 : angDist(a, L_FRONT) < 0.45 ? 0.7 : 0),
    band: { h: 0.045, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      eachLeg(c, (L, s) => {
        // Diagonal zips across the thigh and the shin, toggled cords at the ankle.
        for (const [y0, y1, k0, k1] of [
          [0.62, 0.8, 0.9, -0.2],
          [0.28, 0.42, -0.4, 0.6],
        ]) {
          const rows: Row[] = [y0, (y0 + y1) / 2, y1].map((y, i) => {
            const a = legA(s, lerp(k0, k1, i / 2));
            return [y, a - 0.06, a + 0.06];
          });
          patchOn(L, rows, SECONDARY, { off: 0.004, cols: 1 });
        }
        for (const k of [0.7, 1.0]) boxOn(L, 0.1, legA(s, k), new THREE.Vector3(0.006, 0.05, 0.006), SECONDARY, { off: 0.006, at: [0, -0.01] });
        boxOn(L, 0.075, legA(s, 0.85), new THREE.Vector3(0.016, 0.016, 0.012), fixed('rubber'), { off: 0.008 });
      });
    },
  },
  caminhada: {
    kind: 'pants',
    fit: FIT.regular + 0.002,
    hem: 0.1,
    loose: 0.7,
    bag: () => 0.004,
    rings: [0.575, 0.56],
    // The zip-off line above the knee.
    paint: (y) => (y < 0.575 && y > 0.56 ? SECONDARY : PRIMARY),
    band: { h: 0.035, paint: SECONDARY },
    extra: (c) => {
      buckle(c, fixed('rubber'));
      fly(c, null);
      frontPockets(c, P2, 'slant');
      eachLeg(c, (L, s) => {
        const za = legA(s, 1.15);
        patchOn(L, [
          [0.66, za - 0.12, za + 0.12],
          [0.672, za - 0.12, za + 0.12],
        ], SECONDARY, { off: 0.003, cols: 2 });
        boxOn(L, 0.666, za, new THREE.Vector3(0.008, 0.024, 0.005), STEEL, { off: 0.003, at: [0.03 * s, -0.01] });
        boxOn(L, 0.135, legA(s, 1.6), new THREE.Vector3(0.022, 0.035, 0.008), SECONDARY);
      });
    },
  },
  bocaSino: {
    kind: 'pants',
    fit: FIT.tight + 0.002,
    hem: 0.035,
    loose: 0.4,
    waist: 1.04,
    // Fitted to the knee, then the bell opens to the floor.
    bag: (y) => 0.085 * Math.pow(clamp01((0.47 - y) / 0.43), 1.6),
    rings: [0.3, 0.12],
    extra: (c) => {
      frontPockets(c, P2, 'j');
      fly(c, SECONDARY);
      button(c, BRASS);
      loops(c, PRIMARY, false, true);
      backPockets(c, PRIMARY, { stitch: SECONDARY });
    },
  },
  escolar: {
    kind: 'pants',
    fit: FIT.regular + 0.004,
    hem: 0.1,
    loose: 0.8,
    bag: () => 0.004,
    band: { h: 0.04, out: 0.004, paint: PRIMARY, ribbed: true },
    extra: (c) => {
      drawstring(c, SECONDARY);
      sideStripe(c, SECONDARY, Math.PI / 2, 0.16);
      // School crest on the left thigh.
      const L = c.legs[0];
      boxOn(L, 0.78, legA(-1, 0.15), new THREE.Vector3(0.05, 0.058, 0.004), SECONDARY);
      boxOn(L, 0.78, legA(-1, 0.15), new THREE.Vector3(0.03, 0.012, 0.004), DETAIL, { off: 0.002, at: [0, 0.008] });
    },
  },

  // ---- Shorts ----
  bermudaJeans: { kind: 'shorts', fit: FIT.regular, hem: 0.58, hemKind: 'cuff', hemH: 0.035, hemPaint: P1, bag: (y) => 0.006 + 0.008 * clamp01((0.9 - y) / 0.3), extra: jeans() },
  shortJeans: {
    kind: 'shorts',
    fit: FIT.regular,
    hem: 0.81,
    hemKind: 'fray',
    hemPaint: fixed('offWhite'),
    bag: () => 0.01,
    extra: (c) => {
      jeans({ stitch: SECONDARY })(c);
      // Pocket bags peeking out under the frayed hem.
      eachLeg(c, (L, s) => boxOn(L, 0.81, legA(s, 0.6), new THREE.Vector3(0.04, 0.03, 0.008), fixed('offWhite'), { off: -0.002 }));
    },
  },
  bermudaCargo: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.55,
    bag: (y) => 0.01 + 0.01 * clamp01((0.9 - y) / 0.3),
    band: { paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, BRASS);
      loops(c, PRIMARY);
      backPockets(c, PRIMARY, { flap: SECONDARY });
      eachLeg(c, (L) => cargo(L, 0.66, Math.PI / 2, PRIMARY, SECONDARY, { w: 0.085, h: 0.11 }));
    },
  },
  bermudaTatica: {
    kind: 'shorts',
    fit: FIT.regular + 0.003,
    hem: 0.63,
    bag: () => 0.012,
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      buckle(c, fixed('gunmetal'));
      loops(c, P1, true);
      backPockets(c, PRIMARY, { flap: SECONDARY });
      eachLeg(c, (L) => {
        cargo(L, 0.75, 1.3, PRIMARY, SECONDARY, { w: 0.075, h: 0.1 });
        // Velcro patch on the flap.
        boxOn(L, 0.75, legA(L.s, 1.3), new THREE.Vector3(0.05, 0.016, 0.004), DETAIL, { off: 0.018, at: [0, 0.04] });
      });
    },
  },
  shortMoletom: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.7,
    hemPaint: SECONDARY,
    bag: () => 0.014,
    folds: 1.2,
    band: { h: 0.05, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      frontPockets(c, P2, 'slant');
    },
  },
  shortCorrida: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.8,
    hemKind: 'raw',
    hemPaint: SECONDARY,
    bag: (y) => 0.016 + 0.012 * clamp01((0.92 - y) / 0.12),
    // Split hem at the outer side.
    lift: (a, s) => 0.035 * Math.pow(Math.max(0, outward(a, s)), 3),
    band: { h: 0.04, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => drawstring(c, DETAIL),
  },
  bermudaEsportiva: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.49,
    hemPaint: SECONDARY,
    bag: (y) => 0.024 + 0.012 * clamp01((0.9 - y) / 0.4),
    folds: 1.2,
    paint: (_y, a, s) => (s !== 0 && outward(a, s) > 0.8 ? SECONDARY : PRIMARY),
    band: { h: 0.055, out: 0.005, paint: SECONDARY, ribbed: true },
    extra: (c) => sideStripe(c, DETAIL, Math.PI / 2, 0.05, { hip: false }),
  },
  shortFutebol: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.71,
    hemPaint: SECONDARY,
    bag: () => 0.02,
    band: { h: 0.04, out: 0.004, paint: SECONDARY, ribbed: true },
    extra: (c) => {
      sideStripe(c, SECONDARY, Math.PI / 2, 0.08);
      legNumber(c.legs[1], '7', 0.79, 0.07, 0.35, DETAIL);
    },
  },
  bermudaPraia: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.57,
    bag: (y) => 0.012 + 0.01 * clamp01((0.9 - y) / 0.3),
    paint: (_y, a, s) => (s !== 0 && outward(a, s) > 0.55 ? DETAIL : PRIMARY),
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      // Velcro fly flap and laces.
      fly(c, null);
      const y = Y_BAND(c);
      for (const s of [-1, 1]) c.k.box(y - 0.03, c.k.angX(s * 0.01, y), new THREE.Vector3(0.005, 0.055, 0.005), DETAIL, c.band.out);
      c.k.box(y, FRONT, new THREE.Vector3(0.032, 0.008, 0.007), DETAIL, c.band.out);
    },
  },
  bermudaChino: {
    kind: 'shorts',
    fit: FIT.regular,
    hem: 0.62,
    hemKind: 'cuff',
    hemH: 0.035,
    hemPaint: P1,
    bag: () => 0.012,
    bump: crease(0.003, false),
    band: { paint: PRIMARY },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, darker(PRIMARY, 4));
      loops(c, PRIMARY);
      backPockets(c, PRIMARY, { welt: true, snap: darker(PRIMARY, 4) });
    },
  },
  bermudaXadrez: {
    kind: 'shorts',
    fit: FIT.regular,
    hem: 0.6,
    hemKind: 'cuff',
    hemH: 0.03,
    hemPaint: darker(SECONDARY, 1),
    bag: () => 0.012,
    rings: [0.9, 0.7],
    paint: plaid(PRIMARY, SECONDARY, darker(SECONDARY, 2), [
      [0.99, 0.93],
      [0.9, 0.85],
      [0.75, 0.7],
    ]),
    band: { paint: darker(PRIMARY, 2) },
    extra: (c) => {
      frontPockets(c, darker(PRIMARY, 3), 'slant');
      fly(c, null, darker(PRIMARY, 2));
      button(c, darker(PRIMARY, 4));
      loops(c, darker(PRIMARY, 2));
    },
  },
  shortCiclista: {
    kind: 'shorts',
    fit: FIT.skin + 0.001,
    hem: 0.66,
    hemH: 0.035,
    hemPaint: SECONDARY,
    folds: 0.4,
    wd: 0.016,
    waist: 1.02,
    band: { h: 0.06, out: 0.003, paint: SECONDARY },
    extra: (c) => sideStripe(c, SECONDARY, Math.PI / 2, 0.22, { hip: false }),
  },
  shortLutador: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.68,
    hemPaint: SECONDARY,
    bag: (y) => 0.02 + 0.012 * clamp01((0.9 - y) / 0.2),
    lift: (a, s) => 0.05 * Math.pow(Math.max(0, outward(a, s)), 4),
    paint: (_y, a, s) => (s !== 0 && outward(a, s) > 0.6 ? SECONDARY : PRIMARY),
    band: { h: 0.06, out: 0.006, paint: SECONDARY },
    extra: (c) => {
      // Velcro closure tab.
      const y = Y_BAND(c);
      c.k.box(y, c.k.angX(0.03, y), new THREE.Vector3(0.06, c.band.h - 0.012, 0.006), darker(SECONDARY, 2), c.band.out);
    },
  },
  bermudaTrabalho: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.57,
    bag: () => 0.014,
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'j');
      fly(c, SECONDARY);
      button(c, BRASS);
      loops(c, PRIMARY, true);
      backPockets(c, PRIMARY, { stitch: SECONDARY });
      eachLeg(c, (L, s) => {
        if (s > 0) {
          const a = legA(s, 1.25);
          boxOn(L, 0.72, a, new THREE.Vector3(0.075, 0.1, 0.012), PRIMARY);
          for (const dx of [-0.022, 0, 0.022]) boxOn(L, 0.72, a, new THREE.Vector3(0.016, 0.06, 0.008), SECONDARY, { off: 0.009, at: [dx, 0.02] });
        } else boxOn(L, 0.72, legA(s, 1.45), new THREE.Vector3(0.02, 0.07, 0.016), SECONDARY);
      });
    },
  },
  shortCinturaAlta: {
    kind: 'shorts',
    fit: FIT.regular,
    hem: 0.8,
    hemKind: 'cuff',
    hemH: 0.028,
    hemPaint: P1,
    waist: 1.08,
    bag: (y) => 0.008 + 0.02 * clamp01((0.92 - y) / 0.12),
    band: { h: 0.05, paint: PRIMARY },
    extra: (c) => {
      // A thin belt and a sailor front of two button rows.
      const y = Y_BAND(c);
      c.k.patch(
        [
          [y - 0.008, 0, Math.PI * 2],
          [y + 0.008, 0, Math.PI * 2],
        ],
        DETAIL,
        { off: c.band.out + 0.002 },
      );
      for (const X of [-0.06, 0.06]) for (const yy of [0.99, 0.94]) c.k.box(yy, c.k.angX(X, yy), new THREE.Vector3(0.016, 0.016, 0.006), DETAIL, 0.001);
      backPockets(c, PRIMARY, { stitch: P2 });
    },
  },
  shortMeiaCalca: {
    kind: 'shorts',
    fit: FIT.regular,
    hem: 0.8,
    hemKind: 'cuff',
    hemH: 0.028,
    hemPaint: P1,
    bag: () => 0.012,
    extra: (c) => {
      frontPockets(c, P2, 'j');
      button(c, BRASS);
      fly(c, null);
      // Tights from under the shorts to the ankles.
      for (const s of [-1, 1] as Side[]) {
        const T = new LegSurf(c.b, c.p, s, { d: FIT.skin, loose: 0, bag: () => 0, bump: () => 0, ys: [0.83, 0.645, 0.545, 0.495, 0.445, 0.36, c.legs[0].yAnkle, 0.1], seg: 8 });
        T.tube({
          paint: () => SECONDARY,
          shade: (y, a) => (angDist(a, L_FRONT) < 0.6 ? 0.35 : 0) + 0.4 * foldShade(0.5, 0.07, 3, s)(y, a),
          rim: { h: 0.012, out: 0.002, paint: darker(SECONDARY, 1) },
        });
      }
    },
  },
  bermudaJoelheira: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.58,
    bag: () => 0.014,
    band: { h: 0.04, paint: P1 },
    extra: (c) => {
      frontPockets(c, P2, 'slant');
      fly(c, null);
      button(c, fixed('gunmetal'));
      loops(c, P1, true);
      eachLeg(c, (L) => cargo(L, 0.72, Math.PI / 2, PRIMARY, P1, { w: 0.075, h: 0.1 }));
      // Knee pads on the bare knees, with their strap around the back.
      for (const s of [-1, 1] as Side[]) {
        const K = new LegSurf(c.b, c.p, s, { d: 0.006, loose: 0, bag: () => 0, bump: () => 0, ys: [0.56, 0.5, 0.44], seg: 8 });
        kneePad(K, SECONDARY, { y: 0.5, size: new THREE.Vector3(0.105, 0.13, 0.045), ribs: 2 });
        for (const y of [0.535, 0.465]) {
          const a0 = legA(s, Math.PI / 2 - 0.3);
          const a1 = legA(s, (3 * Math.PI) / 2 + 0.3);
          patchOn(K, [
            [y - 0.012, Math.min(a0, a1), Math.max(a0, a1)],
            [y + 0.012, Math.min(a0, a1), Math.max(a0, a1)],
          ], darker(SECONDARY, 2), { off: 0.002, keep: true });
        }
      }
    },
  },
  shortBanho: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.77,
    hemPaint: DETAIL,
    bag: (y) => 0.014 + 0.01 * clamp01((0.92 - y) / 0.15),
    lift: (a, s) => 0.02 * Math.pow(Math.max(0, outward(a, s)), 4),
    band: { h: 0.04, out: 0.004, paint: PRIMARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      sideStripe(c, DETAIL, Math.PI / 2, 0.05);
    },
  },
  bermudaLinho: {
    kind: 'shorts',
    fit: FIT.loose,
    hem: 0.58,
    bag: () => 0.016,
    folds: 1.3,
    shade: (y, a, s) => wrinkles(y, a, s),
    band: { h: 0.04, out: 0.004, paint: PRIMARY, ribbed: true },
    extra: (c) => {
      drawstring(c, DETAIL);
      frontPockets(c, P2, 'slant');
    },
  },

  // ---- Skirts ----
  saiaJeans: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.74,
    hemKind: 'fray',
    hemPaint: P1,
    skirt: { flare: 0.025, seg: 14 },
    extra: (c) => {
      button(c, BRASS);
      loops(c, PRIMARY);
      const S = c.skirt!;
      // Front seam with stitching, front pockets, back pockets.
      patchOn(S, [
        [0.745, L_FRONT - 0.03, L_FRONT + 0.03],
        [0.96, L_FRONT - 0.03, L_FRONT + 0.03],
      ], SECONDARY, { off: 0.002, cols: 1 });
      for (const s of [-1, 1] as Side[]) {
        const a = legA(s, 0.55);
        patchOn(S, [
          [0.9, a - 0.05, a + 0.05],
          [0.95, a - 0.3 * s - 0.05, a - 0.3 * s + 0.05],
        ].map(([y, a0, a1]) => [y, Math.min(a0, a1), Math.max(a0, a1)] as Row), P2, { off: 0.0025, cols: 2 });
        boxOn(S, 0.87, legA(s, Math.PI - 0.45), new THREE.Vector3(0.07, 0.08, 0.007), PRIMARY);
        boxOn(S, 0.89, legA(s, Math.PI - 0.45), new THREE.Vector3(0.058, 0.005, 0.009), SECONDARY);
      }
    },
  },
  saiaLapis: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.55,
    skirt: { flare: 0, taper: 0.024, seg: 14 },
    band: { h: 0.035, paint: P1 },
    extra: (c) => {
      // The back vent and zip.
      const S = c.skirt!;
      patchOn(S, [
        [0.56, L_BACK - 0.05, L_BACK + 0.05],
        [0.64, L_BACK - 0.012, L_BACK + 0.012],
      ], darker(PRIMARY, 5), { off: 0.002, cols: 1 });
      patchOn(S, [
        [0.8, L_BACK - 0.012, L_BACK + 0.012],
        [0.96, L_BACK - 0.012, L_BACK + 0.012],
      ], darker(PRIMARY, 3), { off: 0.002, cols: 1 });
    },
  },
  saiaPregas: { kind: 'skirt', fit: FIT.regular, hem: 0.62, skirt: { flare: 0.075, pleats: 12, depth: 0.08, seg: 24, rings: [0.9, 0.8, 0.7] }, band: { paint: SECONDARY } },
  saiaRodada: { kind: 'skirt', fit: FIT.regular, hem: 0.43, skirt: { flare: 0.1, godets: 0.1, seg: 18 }, band: { paint: P1 } },
  saiaLonga: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.14,
    skirt: { flare: 0.05, tiers: [[0.64, 0.014], [0.38, 0.016]], seg: 14, rings: [0.76, 0.52, 0.26] },
    band: { h: 0.04, paint: P1 },
    // Gathers under each tier seam.
    shade: (y, a) => (column(a, 16) % 2 ? 0.35 : -0.35) * (y < 0.64 ? 1 : 0.5),
  },
  saiaXadrez: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.69,
    skirt: { flare: 0.08, pleats: 10, depth: 0.05, seg: 20, rings: [0.91, 0.85, 0.79, 0.73] },
    paint: (y, a, s) =>
      s === 0
        ? darker(PRIMARY, 2)
        : plaid(PRIMARY, SECONDARY, darker(SECONDARY, 2), [
            [0.91, 0.85],
            [0.79, 0.73],
          ], 20)(y, a, 1),
    band: { paint: darker(PRIMARY, 2) },
  },
  saiaCouro: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.69,
    skirt: { flare: 0.02, seg: 14 },
    band: { paint: darker(PRIMARY, 2) },
    shade: (_y, a) => (angDist(a, L_FRONT) < 0.5 ? 0.85 : angDist(a, L_BACK) < 0.6 ? 0.3 : -0.5),
    extra: (c) => {
      const S = c.skirt!;
      patchOn(S, [
        [0.7, L_FRONT - 0.018, L_FRONT + 0.018],
        [0.96, L_FRONT - 0.018, L_FRONT + 0.018],
      ], DETAIL, { off: 0.003, cols: 1 });
      boxOn(S, 0.945, L_FRONT, new THREE.Vector3(0.012, 0.03, 0.006), DETAIL, { off: 0.003 });
      buckle(c, STEEL, -0.05);
    },
  },
  kilt: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.51,
    skirt: { flare: 0.05, pleats: 10, depth: 0.07, seg: 20, pleatOn: (a) => smooth(-Math.sin(a), -0.2, 0.3), rings: [0.7] },
    band: { h: 0.045, paint: P1 },
    extra: (c) => {
      const S = c.skirt!;
      loops(c, P1, true, true);
      buckle(c, fixed('gunmetal'), 0.06);
      // The flat front apron (a panel with thickness) with its snaps.
      const half = 1.05;
      slabOn(S, [
        [0.52, L_FRONT - half, L_FRONT + half],
        [0.96, L_FRONT - half, L_FRONT + half],
      ], PRIMARY, { off: 0.001, thick: 0.005, cols: 6 });
      for (const y of [0.86, 0.66]) boxOn(S, y, L_FRONT - half + 0.08, new THREE.Vector3(0.012, 0.012, 0.005), DETAIL, { off: 0.007 });
      // Cargo pouches on the hips, a little behind the sides (clear of the hands hanging there).
      for (const s of [-1, 1] as Side[]) {
        const a = legA(s, 2.05);
        boxOn(S, 0.76, a, new THREE.Vector3(0.09, 0.12, 0.022), SECONDARY, { off: 0.003 });
        boxOn(S, 0.76, a, new THREE.Vector3(0.096, 0.032, 0.026), darker(SECONDARY, 1), { off: 0.003, at: [0, 0.05] });
        boxOn(S, 0.76, a, new THREE.Vector3(0.012, 0.012, 0.005), DETAIL, { off: 0.026, at: [0, 0.045] });
      }
    },
  },
  saiaEnvelope: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.6,
    skirt: { flare: 0.06, seg: 16, dip: (a) => 0.045 * bell(angDist(a, L_FRONT - 0.5), 0, 1.1) },
    band: { paint: PRIMARY },
    extra: (c) => {
      const S = c.skirt!;
      // The overlapping front panel: from its diagonal edge (the hem on the right up to the left hip) to the left side.
      const rows: Row[] = [0.625, 0.7, 0.8, 0.9, 0.96].map((y) => [y, lerp(L_FRONT - 0.4, L_FRONT + 0.7, (y - 0.625) / 0.335), L_FRONT + 1.55]);
      slabOn(S, rows, PRIMARY, { off: 0.003, thick: 0.005, cols: 6, edge: P2 });
      // The tie at the left hip: a knot and two hanging ends.
      const a = L_FRONT + 0.8;
      boxOn(S, 0.95, a, new THREE.Vector3(0.026, 0.02, 0.012), SECONDARY, { off: 0.01 });
      for (const [dx, tilt] of [
        [-0.012, 0.18],
        [0.014, -0.12],
      ]) boxOn(S, 0.9, a, new THREE.Vector3(0.016, 0.1, 0.005), SECONDARY, { off: 0.012, at: [dx, 0], tilt });
    },
  },
  saiaShort: { kind: 'skirt', fit: FIT.regular, hem: 0.745, under: 0.725, skirt: { flare: 0.07, seg: 16 }, band: { paint: P1 } },
  saiaTenis: {
    kind: 'skirt',
    fit: FIT.regular,
    hem: 0.78,
    skirt: { flare: 0.06, pleats: 10, depth: 0.06, seg: 20, rings: [0.9, 0.84, 0.81, 0.8] },
    paint: (y) => (y < 0.81 && y > 0.8 ? SECONDARY : PRIMARY),
    hemPaint: SECONDARY,
    band: { paint: SECONDARY },
  },
};

/** The overall's bib and straps over the top: a raised panel on the chest, crossed straps at the back, buckles. */
function bib(c: Ctx) {
  const { b, p } = c;
  // Over the top's chest: tops sit within ~2 cm (pockets and plackets included), loose and oversized tees flare
  // to ~3 cm at the waist, so the bib stands a little further out toward its bottom.
  const BIB = 0.026;
  const T = new TorsoSurf(b, p, BIB, (y) => -0.008 * (1 - smooth(y, 1.0, 1.2)));
  const k = new Kit(b, p, BIB, 0);
  const yTop = 1.32;
  const y0 = c.top - c.band.h;
  const rows: Row[] = [y0, 1.1, 1.2, yTop].map((y) => {
    const X = y < 1.1 ? 0.115 : lerp(0.115, 0.1, (y - 1.1) / (yTop - 1.1));
    return [y, k.angX(-X, y), k.angX(X, y)];
  });
  slabOn(T, rows, PRIMARY, { off: 0, thick: 0.006, cols: 4, rings: false });
  // Bib pocket (stitched in the secondary color).
  boxOn(T, 1.22, FRONT, new THREE.Vector3(0.1, 0.09, 0.007), SECONDARY, { off: 0.006 });
  boxOn(T, 1.215, FRONT, new THREE.Vector3(0.088, 0.08, 0.007), PRIMARY, { off: 0.007 });
  // Straps: from the bib's corners over the shoulders, crossing at the back down to the waistband.
  for (const s of [-1, 1] as Side[]) {
    const off = 0.004 + (s > 0 ? 0.002 : 0);
    const front = (y: number, X: number) => T.at(y, k.angX(X, y), off);
    // The back has nothing on it: the straps lie closer.
    const backAt = (y: number, X: number) => T.at(y, k.angX(X, y, true), off - 0.006);
    const over = (z: number): SurfPoint => {
      const pt = new THREE.Vector3(s * 0.098, 1.478, z);
      const w: Weights = [
        ['chest', 0.75],
        ['neck', 0.25],
      ];
      return { p: pt, n: UP.clone(), c: new THREE.Vector3(s * 0.098, 1.4, z), w, region: 'chest', gordo: new THREE.Vector3(s * 0.006, 0.004, 0), magro: new THREE.Vector3(s * -0.003, -0.002, 0) };
    };
    const pts = [front(yTop - 0.01, s * 0.085), front(1.4, s * 0.095), over(-0.05), over(0.04), backAt(1.4, s * 0.09), backAt(1.25, s * 0.025), backAt(1.1, -s * 0.045), backAt(y0 + 0.01, -s * 0.075)];
    strap(b, pts, 0.03, 0.005, PRIMARY);
    // Buckles on the bib corners.
    boxOn(T, yTop - 0.012, k.angX(s * 0.085, yTop), new THREE.Vector3(0.036, 0.03, 0.006), DETAIL, { off: 0.011 });
    boxOn(T, yTop - 0.012, k.angX(s * 0.085, yTop), new THREE.Vector3(0.018, 0.016, 0.006), darker(DETAIL, 3), { off: 0.014 });
  }
}

const defaultFolds = (fit: number, k: number) => {
  const amp = (0.002 + fit * 0.25) * k;
  return (y: number, a: number, s: Side) => folds(0.5, 0.07, amp, 3, s)(y, a) + folds(0.88, 0.06, amp * 0.7, 2, s)(y, a);
};
const defaultFoldShade = (y: number, a: number, s: Side) => foldShade(0.5, 0.07, 3, s)(y, a) + 0.7 * foldShade(0.88, 0.06, 2, s)(y, a);

/** The inside of a shorts' leg near the hem, facing inward: seen from below, the opening isn't see-through. */
function lining(L: LegSurf, hem: number, paint: Paint, lift?: (a: number) => number) {
  const b = L.b;
  const n = Math.round(TAU / L.step);
  const rows = [0, 0.07].map((dy) =>
    Array.from({ length: n }, (_, i) => {
      const a = L_FRONT + i * L.step;
      const q = L.at(hem + dy + (lift ? lift(a) * (dy ? 0.2 : 1) : 0), a, -0.004);
      return { id: b.vertex(q.p, q.w, 0, morphsOf(q)), q };
    }),
  );
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const [v00, v01, v10, v11] = [rows[0][i], rows[0][i1], rows[1][i], rows[1][i1]];
    // Facing away from a point outside the leg: inward.
    const out = v00.q.p.clone().add(v01.q.p).multiplyScalar(0.5).sub(v00.q.c).multiplyScalar(3).add(v00.q.c);
    b.triAway(v00.id, v10.id, v11.id, out, paint, v00.q.region);
    b.triAway(v00.id, v11.id, v01.id, out, paint, v00.q.region);
  }
}

/**
 * Pants tucked into tall boots: the boots hide the leg's ankle region, so the leg would end in an open cut over
 * the shaft. A cone just inside the cloth closes it down onto the shin (inside the shaft), so the pants read
 * bloused into the boots. Without boots it stays inside the leg, never seen.
 */
/** The body's shin radius at a height. */
const shinAt = (p: BodyParts, y: number) => p.shinRadius((p.j.kneeY + 0.01 - y) / (p.j.kneeY - p.j.ankleY - 0.01));

function blouse(L: LegSurf, paint: Paint) {
  const { b, p, s } = L;
  const n = Math.round(TAU / L.step);
  const yTop = L.yAnkle + 0.028;
  const yLow = L.yAnkle - 0.014;
  const j = p.j;
  const rLow = shinAt(p, yLow) + 0.007;
  const axis = new THREE.Vector3(s * j.legX, yLow, 0);
  const rows = [
    Array.from({ length: n }, (_, i) => {
      const q = L.at(yTop, L_FRONT + i * L.step, -0.003);
      return b.vertex(q.p, q.w, 0.3, morphsOf(q));
    }),
    Array.from({ length: n }, (_, i) => {
      const a = L_FRONT + i * L.step;
      const off = new THREE.Vector3(Math.cos(a) * rLow * SX, 0, -Math.sin(a) * rLow);
      const gordo = off.clone().multiplyScalar(L.build(yLow));
      return b.vertex(axis.clone().add(off), L.weights(yLow), 0.5, { gordo, magro: gordo.clone().multiplyScalar(-0.45) });
    }),
  ];
  const below = axis.clone().setY(yLow - 0.12);
  const region = sideName('shin', s);
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    b.triAway(rows[0][i], rows[1][i], rows[1][i1], below, paint, region, -0.3);
    b.triAway(rows[0][i], rows[1][i1], rows[0][i1], below, paint, region, -0.3);
  }
}

/** Leg ring heights: the item's shape needs (knee folds, ankle region) and its own extras, down to the hem. */
function legRings(spec: BottomSpec, yAnkle: number): number[] {
  // The calf ring only where the leg follows the calf (and the item has no ring of its own near it).
  const calf = (spec.loose ?? 0) < 0.45 && !spec.rings?.some((y) => Math.abs(y - 0.36) < 0.08) ? [0.36] : [];
  const base = spec.kind === 'pants' ? [0.95, 0.89, 0.645, 0.545, 0.495, 0.445, ...calf, yAnkle] : [0.95, 0.89, 0.8, 0.7];
  const all = [...base, ...(spec.rings ?? [])].filter((y) => y > spec.hem + 0.025 || y === yAnkle);
  return [...new Set([...all, spec.hem].map((y) => Math.round(y * 1e4) / 1e4))].sort((x, y) => y - x);
}

export function bottom(id: string, sex: Sex): PieceGeometry {
  const spec = SPECS[id] ?? SPECS.calcaJeans;
  const { b, p } = start(sex, [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % 997);
  const skirt = spec.kind === 'skirt';
  const top = spec.waist ?? 1.0;
  const wd = spec.wd ?? Math.max(FIT.loose, spec.fit) + 0.004;
  const band = { h: spec.band?.h ?? 0.035, out: spec.band?.out ?? 0.006, paint: spec.band?.paint ?? P1 };
  const pattern: Pattern = spec.paint ?? (() => PRIMARY);
  const ribbed = spec.band?.ribbed;

  // Waist: the pelvis (closed under the crotch) with a raised band on top; skirts hang from a shorter one.
  // Legs first (the waist's front comes in to them).
  const legSpec = spec.under ? { ...spec, hem: spec.under } : spec;
  const foldBump = defaultFolds(spec.fit, spec.folds ?? 1);
  const legs =
    skirt && !spec.under
      ? []
      : ([-1, 1] as Side[]).map((s) => {
          // The ankle ring comes from the body (where boots cover the hem).
          const probe = new LegSurf(b, p, s, { d: 0, loose: 0, bag: () => 0, bump: () => 0, ys: [1, 0], seg: 8 });
          const shape: LegShape = {
            d: spec.fit,
            loose: spec.loose ?? 0,
            bag: spec.bag ?? (() => 0),
            bump: (y, a, side) => foldBump(y, a, side) + (spec.bump?.(y, a, side) ?? 0),
            ys: legRings(legSpec, probe.yAnkle),
            seg: spec.segments ?? 8,
            overBoots: spec.overBoots,
          };
          // Loose hems down on the shoe stand off its heel; slim ones go into the shoe behind it.
          const heel = spec.kind === 'pants' && spec.hem < HEEL_Y - 0.03 && new LegSurf(b, p, s, shape).base(0.13) > 0.066;
          return new LegSurf(b, p, s, { ...shape, heel });
        });

  // Under the band, the front of pants comes in toward the legs (no bulge over the thighs), never inside them.
  // Skirts: only the band (the skirt hangs from inside it; a longer tube would sit inside the skirt where the
  // thighs come up into the lap).
  const y0 = skirt ? top - band.h - 0.012 : 0.87;
  const pullAt = (y: number) => {
    if (!legs.length || skirt) return 0;
    const want = (0.012 + wd - spec.fit) * (1 - smooth(y, 0.88, 0.95));
    if (want <= 0) return 0;
    const L = legs[1];
    const t = p.torsoAt(y);
    const aL = FRONT + Math.asin(Math.min(0.95, p.j.legX / (t.w + wd)));
    const zw = -p.torsoSurface(y, aL, wd).p.z;
    const room = (zw - (L.base(y) + L.bumpAt(y, L_FRONT)) + 0.006) / Math.pow(Math.sin(aL), 2.5);
    return Math.max(0, Math.min(want, room));
  };
  const pull = (y: number, a: number) => pullAt(y) * Math.max(0, Math.sin(a)) ** 1.5;
  p.torso(y0, top, wd, {
    capStart: skirt ? undefined : 0.12,
    rimEnd: band,
    bump: (t, a) => -pull(lerp(y0, top, t), a) / (p.torsoAt(lerp(y0, top, t)).d + wd),
    paint: (y, a) => pattern(y, a, 0),
    shade: (y, a) => (ribbed && y > top - band.h ? (column(a, 10) % 2 ? 0.5 : -0.5) : (spec.shade?.(y, a, 0) ?? 0) + (y < 0.9 ? 0.4 * Math.sin(a * 4 + y * 50) : 0)),
  });
  const c: Ctx = { b, p, spec, k: new Kit(b, p, wd, top), waist: new TorsoSurf(b, p, wd, pull), top, band, legs };

  const hemKind = spec.hemKind ?? 'band';
  const hem: Rim = { ...HEMS[hemKind], ...(spec.hemH ? { h: spec.hemH } : {}), paint: spec.hemPaint ?? (hemKind === 'elastic' ? SECONDARY : P1) };
  // Frayed hems: teeth along the edge.
  const fray = hemKind === 'fray' ? (a: number) => 0.009 * Math.abs(Math.sin(a * 9)) : undefined;

  for (const L of legs) {
    const s = L.s;
    const lift = spec.lift || fray ? (a: number) => (spec.lift?.(a, s) ?? 0) - (fray?.(a) ?? 0) : undefined;
    L.tube({
      paint: (y, a) => pattern(y, a, s),
      shade: (y, a) => defaultFoldShade(y, a, s) * (spec.folds ?? 1) + (spec.shade?.(y, a, s) ?? 0),
      rim: hem,
      lift,
    });
    // Shorts: the inside of the leg opening (seen from below).
    if (spec.kind === 'shorts') lining(L, legSpec.hem, darker(PRIMARY, 4), lift);
    // Pants (unless worn over boots): bloused into tall boots.
    if (spec.kind === 'pants' && !spec.overBoots && spec.hem < L.yAnkle - 0.02 && L.base(L.yAnkle + 0.02) > shinAt(p, L.yAnkle + 0.02) + 0.013) blouse(L, darker(PRIMARY, 1));
  }

  if (skirt) {
    const o = spec.skirt ?? { flare: 0.05 };
    const S = new SkirtSurf(b, p, wd, {
      y0: top - band.h * 0.4,
      y1: spec.hem,
      flare: o.flare,
      taper: o.taper ?? 0,
      pleats: o.pleats ?? 0,
      depth: o.depth ?? 0,
      pleatOn: o.pleatOn ?? (() => 1),
      godets: o.godets ?? 0,
      tiers: o.tiers ?? [],
      dip: o.dip,
      seg: o.seg ?? 16,
      rings: o.rings,
    });
    const pleats = o.pleats ?? 0;
    S.tube({
      paint: (y, a) => pattern(y, a, 1),
      // Pleats: the faces turning away from the light darker, the others lighter.
      shade: (y, a) => (pleats ? (Math.cos((a - L_FRONT) * (pleats / 2)) > 0 ? 0.5 : -0.5) * (o.pleatOn?.(a) ?? 1) : 0) + (spec.shade?.(y, a, 1) ?? 0),
      rim: hem,
    });
    if (fray) {
      // Frayed skirt hems: threads hanging in front of the band.
      S.b.detail(() => {
        for (let i = 0; i < 9; i++) boxOn(S, spec.hem + 0.006, L_FRONT + (i - 4) * 0.42 + 0.1, new THREE.Vector3(0.004, 0.018, 0.003), fixed('offWhite'), { off: 0.002 });
      });
    }
    c.skirt = S;
  }

  spec.extra?.(c);
  return { skinned: b.build(), doubleSided: skirt };
}
