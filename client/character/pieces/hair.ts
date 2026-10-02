// Hair (hair slot) and facial hair (beard slot), faceted (style guide): three layers — a base shell glued to the
// skull with an irregular hairline (3–5 points, sideburns, cut around the ears, a pointed nape), medium locks
// that give the volume and the flow of the cut, and 2–4 accent locks that break the silhouette. Every lock is a
// ridged prism lying on what is under it (a lit face and a shaded face on top, the dark underside below) that
// tapers to one vertex. Hair that falls below the skull hangs straight down and drapes over the body: it is
// pushed out of the chest, the back and the shoulders (with room for jackets and vests) and follows them (their
// weights and their gordo/magro deltas), so no build and no pose lets the body through. The top of the hair is its
// own region (hats hide it); under a hat everything near the hat line is pressed to the skull (`flat`).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { PieceGeometry } from '.';
import { BodyParts, HEAD_W, headShape, headShell, SHAPES, type HeadShape } from '../body';
import { FacetBuilder, type Weights } from '../builder';
import { darker, DETAIL, HAIR, type Paint } from '../palette';
import type { BoneName, RegionName } from '../rig';

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const deg = (d: number) => (d * Math.PI) / 180;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const FRONT = Math.PI / 2;
const BACK = FRONT + Math.PI;
/** An angle around the head from a signed angle in degrees from the front (+ toward the wearer's right, +X). */
const A = (s: number) => FRONT + deg(s);
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
const ZERO = V();
const UP = V(0, 1, 0);

/** Top row of the head mesh (above it the crown is a fan up to the pole). */
const Y_TOP = 1.785;
/** Hair falls straight down from this height (the widest part of the skull). */
const HANG = 1.665;
/** Faces above this height are the top of the hair (a hat hides them). */
const TOP_Y = 1.74;
/** Under a hat: how far out hair may stand near the hat line (inside every hat's wall). */
const FLAT_D = 0.018;
const topRegion = (y: number): RegionName => (y > TOP_Y ? 'hairTop' : 'hair');
/**
 * Hair hanging down the back below this height is its own region (backpacks hide it: it goes behind the pack).
 * Just above the top of most packs, so the hair seems to go behind it, not to end in the air.
 */
const CUT = 1.385;
/** Region of a face of hair by its center: the top, the back below the cut, or the rest. */
const regionAt = (c: V3): RegionName => (c.y > TOP_Y ? 'hairTop' : c.y < CUT && c.z > 0.05 && Math.abs(c.x) < 0.15 ? 'hairBack' : 'hair');

/** Table of rows: y, then values; linear interpolation by y (the head table of a body shape). */
function sampleTable(table: readonly (readonly number[])[], y: number, col: number): number {
  if (y <= table[0][0]) return table[0][col];
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][0]) return lerp(table[i - 1][col], table[i][col], (y - table[i - 1][0]) / (table[i][0] - table[i - 1][0]));
  }
  return table[table.length - 1][col];
}

/** (1 − k)·a + k·b. */
function mixW(a: Weights, b: Weights, k: number): Weights {
  const m = new Map<BoneName, number>();
  for (const [n, x] of a) m.set(n, (m.get(n) ?? 0) + x * (1 - k));
  for (const [n, x] of b) m.set(n, (m.get(n) ?? 0) + x * k);
  return [...m];
}

/** Uniform Catmull-Rom through control rows (any width), `n` samples from the first to the last. */
function spline(ctrl: readonly (readonly number[])[], n: number): number[][] {
  const m = ctrl.length;
  if (m === 1) return Array.from({ length: n }, () => [...ctrl[0]]);
  return Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * (m - 1);
    const k = Math.min(m - 2, Math.floor(u));
    const t = u - k;
    const p0 = ctrl[Math.max(0, k - 1)];
    const p1 = ctrl[k];
    const p2 = ctrl[k + 1];
    const p3 = ctrl[Math.min(m - 1, k + 2)];
    return p1.map((_, j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t * t * t));
  });
}

// --- Hairline ------------------------------------------------------------------------------------------------

interface Line {
  /** Forehead line, how deep its points go and which drop (7 values, from 45° left to 45° right of the front). */
  fore?: number;
  depth?: number;
  zig?: readonly number[];
  /** The temples (a little higher), the sideburn's tip, over the ears, the nape (with a point in the middle). */
  temple?: number;
  burn?: number;
  ear?: number;
  nape?: number;
}

const ZIG = [0.25, 0.85, 0.1, 1, 0.2, 0.75, 0.15];

/**
 * The hairline per angle (style guide: never straight): points on the forehead, the temples receding, a
 * sideburn in front of the ear, cut up around the ear, down behind it to a pointed nape.
 */
function hairline(o: Line = {}) {
  const fore = o.fore ?? 1.718;
  const depth = o.depth ?? 0.01;
  const zig = o.zig ?? ZIG;
  const temple = o.temple ?? fore + 0.005;
  const burn = o.burn ?? 1.648;
  const ear = o.ear ?? 1.686;
  const nape = o.nape ?? 1.6;
  const forehead = (s: number) => {
    const u = clamp((s + 45) / 15, 0, 6);
    const i = Math.min(5, Math.floor(u));
    return fore + depth * 0.4 - depth * lerp(zig[i], zig[i + 1], u - i);
  };
  const prof: [number, number][] = [
    [57, temple],
    [75, burn],
    [86, ear],
    [106, ear],
    [122, nape + 0.03],
    [140, nape + 0.008],
    [180, nape],
  ];
  return (a: number) => {
    const s = (Math.atan2(Math.sin(a - FRONT), Math.cos(a - FRONT)) * 180) / Math.PI;
    const f = Math.abs(s);
    if (f <= 45) return forehead(s);
    let prev: [number, number] = [45, forehead(Math.sign(s) * 45)];
    for (const p of prof) {
      if (f <= p[0]) {
        const y = lerp(prev[1], p[1], (f - prev[0]) / (p[0] - prev[0]));
        // The nape ends in a point in the middle, tapered up at the sides.
        return f > 135 ? y - 0.006 * Math.cos(deg(f - 180) * 5) * smooth(f, 135, 150) : y;
      }
      prev = p;
    }
    return nape;
  };
}

// --- Kit -----------------------------------------------------------------------------------------------------

/** A point of a lock's spine: position, outward direction, skin weights and build morph deltas. */
interface Frame {
  p: V3;
  n: V3;
  w: Weights;
  g?: V3;
  m?: V3;
}

interface BodyOpts {
  /** Drapes over the chest (true) or the back (false); by default from the angle. */
  front?: boolean;
  /** Room over the skin of the torso (clothes, vests). */
  clear?: number;
  /** How much it moves out while it falls (per meter). */
  spread?: number;
}

interface RibbonOpts {
  width: number | ((t: number) => number);
  thick: number | ((t: number) => number);
  paint?: Paint | ((i: number) => Paint);
  under?: Paint;
  region?: RegionName;
  /** Ends in one vertex (default) or open (hidden under something). */
  tip?: boolean;
  /** Closes the root (when it shows). */
  cap?: boolean;
  /** Edges bent down onto a curved surface (locks on the skull). */
  wrap?: boolean;
}

interface MantleOpts {
  /** Columns from a0 over arc (around the head). */
  a0: number;
  arc: number;
  cols: number;
  /** Rows hanging below HANG and rows on the skull above it. */
  hangRows: number;
  headRows?: number;
  top: (a: number) => number;
  bottom: (a: number) => number;
  d: (y: number, a: number) => number;
  th?: number;
  /** Vertical creases (every other column out): the locks. */
  ridge?: number;
  /** Ends in points (one per lock). */
  tip?: number;
  wave?: (y: number, a: number, i: number) => number;
  /** The ends tuck in (a bob). */
  tuck?: number;
  clear?: number;
  spread?: number;
  /** Drape over the chest instead of the back, per angle. */
  front?: (a: number) => boolean;
}

class HairKit {
  readonly b: FacetBuilder;
  readonly h: HeadShape;
  readonly parts: BodyParts;
  /** Center of the skull: projections onto it start here. */
  readonly c = V(0, 1.68, 0.004);

  constructor(
    readonly sex: Sex,
    readonly flat: boolean,
    seed: number,
    readonly P: Paint,
  ) {
    this.b = new FacetBuilder(seed);
    this.h = headShape(sex);
    this.parts = new BodyParts(this.b, SHAPES[sex]);
  }

  // --- Where things are ------------------------------------------------------------------------------------

  private row(y: number) {
    const t = this.h.s.head;
    return { w: sampleTable(t, y, 1), dep: sampleTable(t, y, 2), fwd: sampleTable(t, y, 3) };
  }

  /** Head angle of a point (the inverse of HeadShape.point) and its radius against the skull's there. */
  private polar(p: V3) {
    const y = clamp(p.y, this.h.y0, Y_TOP);
    const r = this.row(y);
    const u = -p.x / r.w;
    const v = -(p.z + r.fwd) / r.dep;
    const a = Math.atan2(v, u);
    const q = this.h.point(y, a);
    return { a, rho: Math.hypot(u, v), rq: Math.hypot(-q.x / r.w, -(q.z + r.fwd) / r.dep), r };
  }

  private inside(p: V3) {
    if (p.y < this.h.y0 || p.y > this.h.y1) return false;
    const { rho, rq } = this.polar(p);
    const k = p.y > Y_TOP ? (p.y - Y_TOP) / (this.h.y1 - Y_TOP) : 0;
    return rho < rq * (1 - k);
  }

  /** On the skull at (y, a), `d` out along its normal (above the top row: on the crown's fan). */
  onHead(y: number, a: number, d: number): Frame {
    const h = this.h;
    if (y <= Y_TOP) {
      const n = h.normal(y, a);
      return { p: h.point(y, a).addScaledVector(n, d), n, w: HEAD_W };
    }
    const k = Math.min(1, (y - Y_TOP) / (h.y1 - Y_TOP));
    const n = h.normal(Y_TOP - 0.004, a).lerp(UP, 0.5 + 0.5 * k).normalize();
    return { p: h.point(Y_TOP, a).lerp(V(0, h.y1, 0.012), k).addScaledVector(n, d), n, w: HEAD_W };
  }

  /** The skull seen from its center through `q`, `d` out along the normal. */
  proj(q: V3, d: number): Frame {
    const dir = q.clone().sub(this.c).normalize();
    let lo = 0;
    let hi = 0.25;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (this.inside(this.c.clone().addScaledVector(dir, m))) lo = m;
      else hi = m;
    }
    const hit = this.c.clone().addScaledVector(dir, lo);
    return this.onHead(hit.y, this.polar(hit).a, d);
  }

  /** A direction on the skull along the midline: φ from the front (0) over the top (90°) to the back (180°) and
   *  under it; λ to the sides (+ the wearer's right). Lines of one λ run front to back side by side. */
  S(phi: number, lam: number): V3 {
    const p = deg(phi);
    const l = deg(lam);
    return this.c.clone().add(V(Math.sin(l), Math.cos(l) * Math.sin(p), -Math.cos(l) * Math.cos(p)).multiplyScalar(0.1));
  }

  /** On the skull at height y and a signed angle from the front (degrees). */
  H(y: number, s: number): V3 {
    return this.h.point(Math.min(y, Y_TOP), A(s));
  }

  /** Frames through control points [point, offset] projected onto the skull. */
  path(ctrl: [V3, number][], n: number): Frame[] {
    return spline(
      ctrl.map(([p, d]) => [p.x, p.y, p.z, d]),
      n,
    ).map(([x, y, z, d]) => this.proj(V(x, y, z), d));
  }

  /** Extra room over the ears for hair passing over them. */
  earPad(y: number, a: number) {
    return 0.024 * bell(angDist(a, FRONT), deg(96), deg(24)) * bell(y, 1.648, 0.05);
  }

  /** Hair at height y falling from angle a: on the skull above HANG, then straight down, draped over the body. */
  hang(y: number, a: number, d: number, o: BodyOpts = {}): Frame {
    if (y >= HANG) return this.onHead(y, a, d + this.earPad(y, a));
    const p = this.onHead(HANG, a, d + this.earPad(HANG, a)).p;
    const out = V(p.x, 0, p.z).normalize();
    p.addScaledVector(out, (HANG - y) * (o.spread ?? 0.08));
    p.y = y;
    return this.onBody(p, a, o);
  }

  /**
   * A point of hanging hair kept out of the body: out of a cylinder around the neck (collars, scarves), in front
   * of the chest or behind the back with room for clothes, at every build (the push for the gordo and magro
   * torsos become its morph deltas). Weights: the head up top, the spine chain under the shoulders.
   */
  onBody(p0: V3, a: number, o: BodyOpts = {}): Frame {
    const p = p0.clone();
    const front = o.front ?? angDist(a, FRONT) < deg(88);
    const R = 0.105 * smooth(p.y, 1.36, 1.42) * (1 - smooth(p.y, 1.535, 1.585));
    const rn = Math.hypot(p.x, p.z);
    if (rn < R) {
      p.x *= R / Math.max(rn, 1e-4);
      p.z *= R / Math.max(rn, 1e-4);
    }
    const g = V();
    const m = V();
    if (p.y < 1.48) {
      const C = o.clear ?? HairKit.clear(front);
      const k = this.buildK(p.y);
      const z0 = p.z;
      const pick = (z: number | null) => (z === null ? z0 : front ? Math.min(z0, z) : Math.max(z0, z));
      p.z = pick(this.torsoZ(p.x, p.y, front, C, 1));
      g.z = pick(this.torsoZ(p.x, p.y, front, C, 1 + k)) - p.z;
      m.z = pick(this.torsoZ(p.x, p.y, front, C, 1 - 0.45 * k)) - p.z;
    }
    const kh = smooth(p.y, 1.5, 1.62);
    const tw = this.parts.torsoSurface(clamp(p.y, 0.95, 1.47), front ? FRONT : BACK, 0).w;
    return { p, n: V(p.x, 0, p.z).normalize(), w: kh >= 1 ? HEAD_W : mixW(tw, HEAD_W, kh), g, m };
  }

  /**
   * Room over the torso's skin for hanging hair: in front, over shirts and jackets (3.4 cm); behind, over a hood
   * lying down on the back and the plates of a vest (8.2 cm).
   */
  static clear(front: boolean) {
    return front ? 0.034 : 0.082;
  }

  /** Gordo strength of the torso at y (its deltas are the offset from the center times this). */
  private buildK(y: number) {
    const q = this.parts.torsoSurface(y, BACK, 0);
    const off = q.p.clone().sub(V(0, y, -this.parts.torsoAt(y).fwd));
    return q.gordo.length() / Math.max(1e-6, off.length());
  }

  /** z of the torso's front or back at x, C over the skin, the section scaled by s (null: x is beside it). */
  private torsoZ(x: number, y: number, front: boolean, C: number, s: number): number | null {
    const P = this.parts;
    const cz = -P.torsoAt(y).fwd;
    // Full bumps (bust, pecs, shoulder blades): sample just under the offset where clothes flatten them.
    const at = (u: number) => P.torsoSurface(y, front ? u * Math.PI : 2 * Math.PI - u * Math.PI, 0.029).p;
    if (x <= at(0).x * s || x >= at(1).x * s) return null;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).x * s < x) lo = mid;
      else hi = mid;
    }
    const q = at((lo + hi) / 2);
    return cz + (q.z - cz) * s + (front ? -1 : 1) * (C - 0.029) * s;
  }

  // --- Vertices and faces ------------------------------------------------------------------------------------

  /**
   * Under a hat: offsets near the hat line squeezed (softly, so layers keep their order) inside its wall; at the
   * sides and the back also down to the jaw line (helmets come down over the ears and the nape).
   */
  flatD(y: number, d: number, a = FRONT) {
    if (!this.flat || y < 1.572) return d;
    const f = angDist(a, FRONT);
    const side = smooth(f, deg(48), deg(64)) * smooth(y, 1.572, 1.584);
    let lim = y < 1.655 ? Infinity : lerp(0.045, FLAT_D, smooth(y, 1.66, 1.7));
    if (side > 0) lim = Math.min(lim, lerp(0.09, 0.03, side));
    if (!Number.isFinite(lim)) return d;
    const half = lim / 2;
    return d <= half ? d : half + half * (1 - Math.exp(-(d - half) / half));
  }

  private squash(p: V3): V3 {
    if (!this.flat || p.y < 1.572 || p.y > Y_TOP) return p;
    const { a, rho, rq, r } = this.polar(p);
    const scale = Math.hypot(p.x, p.z + r.fwd) / Math.max(rho, 1e-6);
    const dist = (rho - rq) * scale;
    const nd = this.flatD(p.y, dist, a);
    if (dist <= 0 || nd >= dist) return p;
    const k = (rq * scale + nd) / (rho * scale);
    return V(p.x * k, p.y, (p.z + r.fwd) * k - r.fwd);
  }

  v(p: V3, w: Weights, ao = 0, g?: V3, m?: V3): number {
    return this.b.vertex(this.squash(p), w, ao, { gordo: g ?? ZERO, magro: m ?? ZERO });
  }

  private quadAway(a: number, b: number, c: number, d: number, inside: V3, paint: Paint, region: RegionName, shade = 0) {
    this.b.triAway(a, b, c, inside, paint, region, shade);
    this.b.triAway(a, c, d, inside, paint, region, shade);
  }

  private yOf(...ids: number[]) {
    return this.cOf(...ids).y;
  }

  /** Center of some vertices. */
  private cOf(...ids: number[]) {
    const p = V();
    return ids.reduce((s, id) => s.add(this.b.position(id, p)), V()).divideScalar(ids.length);
  }

  /**
   * A lock along frames: a ridged prism (two lit faces on top, the dark underside below) that tapers to one
   * vertex. Its width and height per t (0 root … 1 tip).
   */
  ribbon(frames0: Frame[], o: RibbonOpts) {
    const b = this.b;
    let frames = frames0;
    if (b.lod >= 1 && frames.length > 3) frames = frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1);
    const n = frames.length;
    const W = typeof o.width === 'number' ? () => o.width as number : o.width;
    const T = typeof o.thick === 'number' ? () => o.thick as number : o.thick;
    const paintOf = typeof o.paint === 'function' ? o.paint : () => (o.paint as Paint | undefined) ?? this.P;
    const tip = o.tip !== false;
    const rings: number[][] = [];
    const centers: V3[] = [];
    const count = tip ? n - 1 : n;
    for (let i = 0; i < count; i++) {
      const f = frames[i];
      const t = i / (n - 1);
      const tan = frames[Math.min(n - 1, i + 1)].p.clone().sub(frames[Math.max(0, i - 1)].p).normalize();
      const N = f.n.clone().addScaledVector(tan, -f.n.dot(tan));
      if (N.lengthSq() < 1e-8) N.set(0, 0, 1).addScaledVector(tan, -tan.z);
      N.normalize();
      const S = V().crossVectors(tan, N).normalize();
      const hw = W(t) / 2;
      const th = T(t);
      const sag = o.wrap === false ? 0 : (hw * hw) / 0.2;
      const pts = [
        f.p.clone().addScaledVector(S, -hw).addScaledVector(N, -sag),
        f.p.clone().addScaledVector(N, th),
        f.p.clone().addScaledVector(S, hw).addScaledVector(N, -sag),
        f.p.clone().addScaledVector(N, -sag - th * 0.3),
      ];
      rings.push(pts.map((p) => this.v(p, f.w, i === 0 ? 0.2 : 0, f.g, f.m)));
      centers.push(pts.reduce((s, p) => s.add(p), V()).multiplyScalar(0.25));
    }
    const regionOf = (...ids: number[]) => o.region ?? regionAt(this.cOf(...ids));
    for (let i = 0; i < rings.length - 1; i++) {
      const c = centers[i].clone().add(centers[i + 1]).multiplyScalar(0.5);
      const paint = paintOf(i);
      const under = o.under ?? darker(paint, 3);
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        const q = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]] as const;
        this.quadAway(q[0], q[1], q[2], q[3], c, k >= 2 ? under : paint, regionOf(...q), k >= 2 ? -0.6 : k === 1 ? -0.15 : 0.1);
      }
    }
    const last = rings[rings.length - 1];
    if (tip) {
      const f = frames[n - 1];
      const tv = this.v(f.p, f.w, 0, f.g, f.m);
      const c = centers[centers.length - 1];
      const paint = paintOf(rings.length - 1);
      for (let k = 0; k < 4; k++) b.triAway(last[k], last[(k + 1) % 4], tv, c, k >= 2 ? (o.under ?? darker(paint, 3)) : paint, regionOf(last[k], tv), k >= 2 ? -0.6 : 0);
    }
    if (o.cap && rings.length > 1) {
      const r0 = rings[0];
      this.quadAway(r0[0], r0[1], r0[2], r0[3], centers[1], darker(paintOf(0), 1), regionOf(...r0));
    }
  }

  /** Lock width: full a little after the root, narrowing toward the tip. */
  static taper(w: number, root = 0.75, end = 0.5) {
    return (t: number) => w * (t < 0.25 ? lerp(root, 1, t / 0.25) : lerp(1, end, (t - 0.25) / 0.75));
  }

  /** A lock lying on the skull through [point, offset] control points. */
  lock(ctrl: [V3, number][], w: number, th: number, o: Partial<RibbonOpts> & { n?: number } = {}) {
    this.ribbon(this.path(ctrl, o.n ?? 4), { width: HairKit.taper(w), thick: HairKit.taper(th, 0.8, 0.6), ...o });
  }

  /** A lock falling from (y0, a) down to y1 (on the skull, then hanging over the body). */
  fallLock(y0: number, y1: number, a: number | ((t: number) => number), d: number | ((t: number) => number), w: number | ((t: number) => number), th: number, o: Partial<RibbonOpts> & { n?: number; body?: BodyOpts } = {}) {
    const n = o.n ?? 5;
    const ts = Array.from({ length: n }, (_, i) => i / (n - 1));
    // A frame at the back region's cut, if the lock crosses it.
    if (y1 < CUT - 0.03 && y0 > CUT + 0.03) {
      const tc = (y0 - CUT) / (y0 - y1);
      let best = 1;
      for (let i = 1; i < n - 1; i++) if (Math.abs(ts[i] - tc) < Math.abs(ts[best] - tc)) best = i;
      if (best < n - 1) ts[best] = tc;
    }
    const frames = ts.map((t) => this.hang(lerp(y0, y1, t), typeof a === 'number' ? a : a(t), typeof d === 'number' ? d : d(t), o.body));
    this.ribbon(frames, { width: typeof w === 'number' ? HairKit.taper(w, 0.9, 0.55) : w, thick: th, ...o });
  }

  /** A strand through points in space (ponytails, braids): each point kept out of the body. */
  strandOnBody(pts: V3[], n: number, o: RibbonOpts & { head?: number }) {
    const frames = spline(
      pts.map((p) => [p.x, p.y, p.z]),
      n,
    ).map(([x, y, z], i) => {
      const f = this.onBody(V(x, y, z), BACK, { front: false });
      // The first points sit in the knot: the head carries them.
      if (i < (o.head ?? 1)) f.w = HEAD_W;
      return f;
    });
    this.ribbon(frames, { wrap: false, ...o });
  }

  // --- Blocks ----------------------------------------------------------------------------------------------

  /** Base shell: the hair glued to the skull, its hairline closed onto the skin (a band of thickness, in AO). */
  base(o: { d: (y: number, a: number) => number; line?: Line; rows?: number; cols?: number; paint?: (y: number, a: number) => Paint; y1?: number; lift?: (y: number, a: number) => number; tips?: (a: number) => number; close?: boolean }) {
    const edge = hairline(o.line);
    const P = this.P;
    // Thin shells need rows packed near the crown (the skull curves fast there and would come through).
    const thin = o.d(1.775, FRONT) < 0.007;
    const ids = headShell(this.b, this.h, {
      y0: 1.55,
      y1: o.y1 ?? 1.79,
      rows: thin ? Math.max(6, o.rows ?? 6) : (o.rows ?? 5),
      bias: thin ? 1.9 : 1.5,
      cols: o.cols ?? 20,
      edge,
      // Never under 4 mm: the skull's facets would come through thinner shells.
      d: (y, a) => this.flatD(y, Math.max(0.0042, o.d(y, a)), a),
      paint: (y, a) => (y < edge(a) + 0.003 ? darker(P, 2) : o.paint ? o.paint(y, a) : P),
      region: (y) => topRegion(y),
      // Volumes close with their own flat crown (the shell's pole would make a cone).
      closeTop: o.y1 === undefined && !o.lift,
      close: o.close ?? true,
      lift: o.lift,
      tips: o.tips,
      ao: (y, a) => (y < edge(a) + 0.006 ? 0.2 : 0),
    });
    if (o.y1 === undefined && o.lift) this.crown(ids[ids.length - 1], 0.008);
    return ids;
  }

  /** Closes a ring of vertices with a low fan (a rounded top, not a cone). */
  crown(ring: number[], rise: number) {
    const c = V();
    const p = V();
    for (const id of ring) c.add(this.b.position(id, p));
    c.divideScalar(ring.length);
    c.y += rise;
    const pole = this.v(c, HEAD_W);
    const inside = c.clone().add(V(0, -0.1, 0));
    for (let i = 0; i < ring.length; i++) this.b.triAway(ring[i], ring[(i + 1) % ring.length], pole, inside, this.P, 'hairTop');
  }

  /**
   * A mantle of hanging hair (bobs and long hair): columns around the head from the skull down to `bottom`,
   * creased into locks (every other column out), each lock ending in a point; a thickness with a dark inside;
   * draped over the body below the head.
   */
  mantle(o: MantleOpts) {
    const b = this.b;
    const cols = b.lod >= 1 ? Math.max(4, Math.round((o.cols * (b.lod === 1 ? 0.75 : 0.5)) / 2) * 2) : o.cols;
    const hr = b.lod >= 2 ? Math.max(2, Math.ceil(o.hangRows * 0.6)) : o.hangRows;
    const sr = o.headRows ?? 2;
    const rows = hr + sr;
    const th = o.th ?? 0.011;
    const C = o.clear;
    const outer: number[][] = [];
    const inner: number[][] = [];
    const P = this.P;
    // A row exactly at the cut of the back region (a clean line where a backpack hides the hair below).
    const mid = o.bottom(o.a0 + o.arc / 2);
    const rc = mid < CUT - 0.04 && hr >= 2 ? clamp(Math.round(((CUT - mid) / (HANG - mid)) * hr), 1, hr - 1) : 0;
    for (let r = 0; r <= rows; r++) {
      const lo: number[] = [];
      const li: number[] = [];
      for (let i = 0; i <= cols; i++) {
        const a = o.a0 + (i / cols) * o.arc;
        const bot = o.bottom(a);
        let y = r > hr ? lerp(HANG, o.top(a), (r - hr) / sr) : rc > 0 ? (r <= rc ? lerp(bot, CUT, r / rc) : lerp(CUT, HANG, (r - rc) / (hr - rc))) : lerp(bot, HANG, r / hr);
        if (r === 0 && o.tip) y -= o.tip * (i % 2 === 0 ? 0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + 1)) : 0.08);
        const rk = r === rows ? 0 : r > hr ? 0.5 : 1;
        const tuck = o.tuck && r < hr ? o.tuck * (1 - r / hr) ** 2 : 0;
        const d = o.d(y, a) + (i % 2 === 0 ? 1 : -0.4) * (o.ridge ?? 0.005) * rk + (o.wave ? o.wave(y, a, i) : 0) - tuck;
        const front = o.front ? o.front(a) : angDist(a, FRONT) < deg(88);
        const c = C ?? HairKit.clear(front);
        const fo = this.hang(y, a, d, { front, clear: c + th, spread: o.spread });
        const fi = this.hang(y, a, d - th, { front, clear: c, spread: o.spread });
        const ao = r === rows ? 0.12 : 0;
        lo.push(this.v(fo.p, fo.w, ao, fo.g, fo.m));
        li.push(this.v(fi.p, fi.w, 0.2, fi.g, fi.m));
      }
      outer.push(lo);
      inner.push(li);
    }
    const axis = (y: number) => V(0, y, 0.01);
    const pos = (id: number) => b.position(id, V());
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const q = [outer[r][i], outer[r][i + 1], outer[r + 1][i + 1], outer[r + 1][i]] as const;
        const y = this.yOf(...q);
        const paint = (i >> 1) % 3 === 1 ? darker(P, 1) : P;
        this.quadAway(q[0], q[1], q[2], q[3], axis(y), paint, r < hr ? regionAt(this.cOf(...q)) : topRegion(y));
        if (r < hr) {
          // The inside faces the body: dark.
          const qi = [inner[r][i], inner[r][i + 1], inner[r + 1][i + 1], inner[r + 1][i]] as const;
          const c = pos(qi[0]).add(pos(qi[2])).multiplyScalar(0.5);
          const away = c.clone().multiplyScalar(2).sub(axis(c.y));
          this.quadAway(qi[0], qi[1], qi[2], qi[3], away, darker(P, 4), regionAt(this.cOf(...qi)), -0.8);
        }
      }
    }
    // The ends: a band of thickness, darker.
    for (let i = 0; i < cols; i++) {
      const q = [outer[0][i], outer[0][i + 1], inner[0][i + 1], inner[0][i]] as const;
      const c = pos(q[0]).add(pos(q[2])).multiplyScalar(0.5).add(V(0, 0.05, 0));
      this.quadAway(q[0], q[1], q[2], q[3], c, darker(P, 2), regionAt(this.cOf(...q)), -0.4);
    }
    // The sides.
    for (const [i, j] of [
      [0, 1],
      [cols, cols - 1],
    ]) {
      for (let r = 0; r < hr; r++) {
        const q = [outer[r][i], inner[r][i], inner[r + 1][i], outer[r + 1][i]] as const;
        this.quadAway(q[0], q[1], q[2], q[3], pos(outer[r][j]).add(pos(inner[r + 1][j])).multiplyScalar(0.5), darker(P, 2), regionAt(this.cOf(...q)), -0.3);
      }
    }
  }

  /** A faceted ball (buns, curls). */
  ball(c: V3, r: number, region: RegionName = 'hairTop', paint: Paint = this.P, w: Weights = HEAD_W, segs: [number, number] = [8, 5], twist = false) {
    // A twisted bun: the hair wound around it, as spiral bands of the darker tone.
    const paintOf = twist ? (p: V3) => (Math.sin(Math.atan2(p.z - c.z, p.x - c.x) * 2 + ((p.y - c.y) / r) * 3.2) > 0.35 ? darker(paint, 1) : paint) : paint;
    this.b.append(new THREE.SphereGeometry(1, segs[0], segs[1]), new THREE.Matrix4().compose(c, new THREE.Quaternion(), V(r, r * 0.88, r)), w, region, paintOf, { ao: 0.04 });
  }

  /** A hair tie in the detail color, around `axis` at c. */
  tie(c: V3, r: number, axis: V3, region: RegionName = 'hair', w: Weights = HEAD_W) {
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), axis.clone().normalize());
    this.b.append(new THREE.TorusGeometry(r, r * 0.32, 4, 8), new THREE.Matrix4().compose(c, q, V(1, 1, 1)), w, region, DETAIL);
  }

  /** Locks pulled back from the hairline to a knot (ponytails, buns), thin and tight on the skull. */
  pulled(knot: V3, roots: [number, number][], o: { d?: number; w?: number } = {}) {
    roots.forEach(([y, s], i) => {
      const r = this.H(y, s);
      const mid = r.clone().lerp(knot, 0.5);
      this.lock(
        [
          [r, 0.008],
          [mid, (o.d ?? 0.011) + 0.002],
          [knot.clone().lerp(r, 0.12), o.d ?? 0.011],
        ],
        o.w ?? 0.05,
        0.007,
        { n: 5, paint: i % 3 === 1 ? darker(this.P, 1) : this.P, tip: true },
      );
    });
  }

  build(): PieceGeometry {
    return { skinned: this.b.build() };
  }
}

// --- Styles ----------------------------------------------------------------------------------------------------

/** The sides of short cuts: shorter (darker) down low, a fade. */
const fade = (P: Paint, top = 1.705) => (y: number) => (y < top - 0.04 ? darker(P, 2) : y < top ? darker(P, 1) : P);

/**
 * The 30 hair styles of the catalog (style guide, "Catálogo: cabelos"), each in the three layers: base shell,
 * locks of the cut, accent locks. `flat`: the version for under a hat (everything near the hat line pressed to
 * the skull, knots and buns moved down to the nape).
 */
export function hair(id: string, sex: Sex, flat = false): PieceGeometry {
  const k = new HairKit(sex, flat, id.length * 31 + 7, HAIR);
  const P = HAIR;
  const S = (phi: number, lam: number) => k.S(phi, lam);
  const H = (y: number, s: number) => k.H(y, s);
  const alt = (i: number) => (i % 3 === 1 ? darker(P, 1) : P);

  switch (id) {
    // Short.
    case 'raspado':
      k.base({ d: () => 0.0025, rows: 4, cols: 20, line: { fore: 1.722, depth: 0.005, burn: 1.655, ear: 1.688, nape: 1.604 }, paint: () => darker(P, 2) });
      break;
    case 'buzzCut':
      k.base({ d: (y) => 0.005 + 0.002 * smooth(y, 1.7, 1.76), rows: 4, cols: 20, line: { depth: 0.012, burn: 1.65 }, paint: (y) => (y < 1.69 ? darker(P, 2) : darker(P, 1)) });
      break;
    case 'militar':
      // High and tight: the sides shaved up to the corner of the skull, a short flat brush on top with a step.
      k.base({ d: () => 0.003, y1: 1.745, rows: 3, cols: 20, line: { depth: 0.006, burn: 1.66 }, paint: () => darker(P, 2) });
      {
        const ids = headShell(k.b, k.h, {
          y0: 1.728,
          y1: 1.79,
          rows: 4,
          cols: 16,
          bias: 1.4,
          d: (y) => k.flatD(y, 0.004 + smooth(y, 1.728, 1.756) * 0.01 - smooth(y, 1.775, 1.79) * 0.004),
          lift: (y) => (flat ? 0 : smooth(y, 1.76, 1.79) * 0.012),
          paint: (y) => (y < 1.735 ? darker(P, 2) : darker(P, 1)),
          region: (y) => topRegion(y),
        });
        k.crown(ids[ids.length - 1], 0.003);
      }
      break;
    case 'degrade': {
      // Classic fade: the sides fade out; the top (4–5 cm) combed back from a side part, with volume at the front.
      k.base({ d: (y) => 0.0035 + smooth(y, 1.7, 1.745) * 0.008, cols: 20, line: { depth: 0.008, burn: 1.655 }, paint: fade(P) });
      [-30, -17, -4, 9, 22, 35].forEach((l, i) =>
        k.lock(
          [
            [S(21, l), 0.009],
            [S(32, l + 2), 0.026 - Math.abs(l) * 0.0002],
            [S(62, l + 5), 0.022],
            [S(98, l + 8), 0.012],
          ],
          0.046,
          0.014,
          { paint: alt(i), cap: true },
        ),
      );
      // The short side of the part, combed down; the crown.
      k.lock(
        [
          [S(24, -40), 0.008],
          [S(42, -52), 0.016],
          [S(66, -66), 0.008],
        ],
        0.044,
        0.012,
        { paint: darker(P, 1) },
      );
      for (const l of [-24, 4, 30])
        k.lock(
          [
            [S(84, l), 0.013],
            [S(125, l * 1.1), 0.013],
            [S(160, l * 1.25), 0.006],
          ],
          0.05,
          0.011,
        );
      break;
    }
    case 'topete': {
      // Quiff: short sides, the front rising forward and up, then swept back over the top.
      k.base({ d: (y) => 0.004 + smooth(y, 1.7, 1.745) * 0.008, cols: 20, line: { depth: 0.006, burn: 1.655 }, paint: fade(P) });
      [-26, -13, 0, 13, 26].forEach((l, i) =>
        k.lock(
          [
            [S(21, l), 0.008],
            [S(30, l * 1.05), 0.042 - Math.abs(l) * 0.0004],
            [S(52, l * 0.95), 0.05 - Math.abs(l) * 0.0005],
            [S(84, l * 0.8), 0.028],
            [S(118, l * 0.7), 0.012],
          ],
          0.05,
          0.022,
          { n: 6, paint: alt(i), cap: true },
        ),
      );
      for (const s of [-1, 1]) {
        k.lock(
          [
            [S(26, s * 42), 0.008],
            [S(70, s * 52), 0.016],
            [S(124, s * 48), 0.01],
          ],
          0.05,
          0.012,
          { paint: darker(P, 1) },
        );
      }
      for (const l of [-14, 14])
        k.lock(
          [
            [S(110, l), 0.014],
            [S(145, l * 1.3), 0.012],
            [S(170, l * 1.5), 0.006],
          ],
          0.05,
          0.01,
        );
      break;
    }
    case 'franjaReta': {
      // Short straight fringe: everything combed forward from the crown, the fringe ending in a nearly straight
      // line above the brows (small notches between the locks).
      k.base({ d: (y) => 0.009 + Math.max(0, y - 1.7) * 0.06, cols: 20, line: { depth: 0.004, burn: 1.652 } });
      [-42, -28, -14, 0, 14, 28, 42].forEach((l, i) =>
        k.lock(
          [
            [S(92, l * 0.35), 0.014],
            [S(52, l * 0.8), 0.02],
            [S(24, l), 0.017],
            [S(11 + (i % 2) * 1.5, l * 1.05), 0.013],
          ],
          0.048,
          0.014,
          { paint: alt(i) },
        ),
      );
      for (const s of [-1, 1])
        for (const [l, e] of [
          [30, 62],
          [55, 82],
        ])
          k.lock(
            [
              [S(95, s * l * 0.5), 0.013],
              [S(60, s * e * 0.85), 0.016],
              [H(1.692, s * (e + 6)), 0.009],
            ],
            0.05,
            0.012,
            { paint: darker(P, 1) },
          );
      for (const l of [-48, -16, 16, 48])
        k.lock(
          [
            [S(100, l * 0.4), 0.014],
            [S(150, l), 0.014],
            [S(205, l * 1.1), 0.007],
          ],
          0.055,
          0.012,
        );
      break;
    }
    case 'curto': {
      // Messy short: chunky locks in every direction, the fringe broken, a few tips lifted off the head.
      k.base({ d: (y) => 0.011 + Math.max(0, y - 1.7) * 0.06, cols: 20, line: { depth: 0.014 } });
      const fringe: [number, number, number][] = [
        [-30, -38, 12],
        [-10, -16, 9],
        [8, 14, 12],
        [26, 32, 10],
      ];
      if (!flat)
        fringe.forEach(([l0, l1, e], i) =>
          k.lock(
            [
              [S(72, l0 * 0.7), 0.014],
              [S(42, (l0 + l1) / 2), 0.024],
              [S(20, l1), 0.02],
              [S(e, l1 * 1.05), 0.016],
            ],
            0.044,
            0.016,
            { paint: alt(i) },
          ),
        );
      const top: [number, number, number, number][] = [
        [95, -5, 60, -40],
        [92, 15, 64, 50],
        [100, 30, 90, 70],
        [100, -30, 92, -72],
        [108, 0, 74, 4],
      ];
      top.forEach(([p0, l0, p1, l1], i) =>
        k.lock(
          [
            [S(p0, l0), 0.012],
            [S((p0 + p1) / 2, (l0 + l1) / 2), 0.026],
            [S(p1, l1), 0.04],
          ],
          0.046,
          0.018,
          { paint: alt(i + 1) },
        ),
      );
      for (const l of [-34, 0, 34])
        k.lock(
          [
            [S(112, l * 0.6), 0.014],
            [S(160, l), 0.016],
            [S(206, l * 1.15), 0.022],
          ],
          0.05,
          0.014,
        );
      for (const s of [-1, 1])
        k.lock(
          [
            [S(62, s * 50), 0.012],
            [H(1.72, s * 92), 0.016],
            [H(1.69, s * 118), 0.014],
          ],
          0.046,
          0.013,
          { paint: darker(P, 1) },
        );
      break;
    }
    case 'moicano': {
      // Spiked mohawk: shaved sides, a strip along the midline and 6 spikes fanning back.
      k.base({ d: () => 0.0025, rows: 3, cols: 16, line: { depth: 0.006 }, paint: () => darker(P, 4) });
      k.ribbon(
        k.path(
          [
            [S(18, 0), 0.004],
            [S(60, 0), 0.005],
            [S(105, 0), 0.005],
            [S(150, 0), 0.005],
            [S(190, 0), 0.004],
            [S(212, 0), 0.002],
          ],
          7,
        ),
        { width: 0.05, thick: 0.008, tip: true },
      );
      for (let i = 0; i < 6; i++) {
        const phi = 24 + i * 27;
        const len = 0.1 - Math.abs(i - 2.2) * 0.011;
        k.ribbon(
          k.path(
            [
              [S(phi, 0), 0.004],
              [S(phi + 5, 0), len * 0.45],
              [S(phi + 12 + i * 2, 0), len],
            ],
            4,
          ),
          { width: (t) => lerp(0.05, 0.022, t), thick: (t) => lerp(0.018, 0.009, t), paint: i % 2 ? darker(P, 1) : P, wrap: false },
        );
      }
      break;
    }
    case 'moicanoBaixo': {
      // Low mohawk: a 5 cm strip along the midline, short locks combed back on it.
      k.base({ d: () => 0.0025, rows: 3, cols: 16, line: { depth: 0.006 }, paint: () => darker(P, 4) });
      k.ribbon(
        k.path(
          [
            [S(18, 0), 0.006],
            [S(60, 0), 0.008],
            [S(105, 0), 0.008],
            [S(150, 0), 0.007],
            [S(205, 0), 0.003],
          ],
          7,
        ),
        { width: 0.054, thick: 0.014, tip: true, paint: darker(P, 1) },
      );
      for (let i = 0; i < 6; i++) {
        const phi = 22 + i * 27;
        const l = (i % 2 ? 1 : -1) * 6;
        k.lock(
          [
            [S(phi, l), 0.016],
            [S(phi + 14, l * 0.6), 0.026],
            [S(phi + 28, l * 0.2), 0.03],
          ],
          0.04,
          0.014,
          { paint: alt(i) },
        );
      }
      break;
    }
    case 'afroCurto':
      // Short afro: a thick lumpy shell (tight curls), a crisp line-up at the forehead, mottled.
      k.base({
        d: (y, a) => 0.022 + 0.005 * Math.sin(a * 7 + y * 60) * Math.cos(a * 4 - y * 45) + smooth(y, 1.68, 1.76) * 0.006,
        rows: 5,
        cols: 20,
        line: { depth: 0.003, zig: [0, 0.3, 0, 0.5, 0, 0.3, 0], burn: 1.652, ear: 1.684 },
        paint: (y, a) => (Math.sin(a * 13 + y * 170) > 0.55 ? darker(P, 1) : P),
      });
      break;
    case 'blackPower': {
      // Big afro: a round, lumpy volume over the head (wider than the shoulders' line of the head), the face
      // clear: its front sits back at the hairline; under a hat, only what shows under the brim stays full.
      const C = V(0, 1.752, 0.022);
      const R = sex === 'f' ? 0.15 : 0.156;
      const vol = (y: number, a: number) => {
        const s = k.h.point(Math.min(y, Y_TOP), a);
        const n = k.h.normal(Math.min(y, Y_TOP), a);
        // The ray from the skull along its normal to the sphere.
        const oc = s.clone().sub(C);
        const bb = oc.dot(n);
        const cc = oc.lengthSq() - R * R;
        const D = -bb + Math.sqrt(Math.max(0, bb * bb - cc));
        const f = angDist(a, FRONT);
        const lump = 0.011 * Math.sin(a * 5 + y * 30) * Math.cos(a * 3 - y * 50);
        const nearFace = lerp(0.35, 1, smooth(f, deg(20), deg(75))) * lerp(0.4, 1, smooth(y, 1.72, 1.78));
        return { D: Math.max(0.014, D * (f < deg(80) ? nearFace : 1) + lump), n };
      };
      k.base({
        d: (y, a) => {
          const { D, n } = vol(y, a);
          return flat && y > 1.69 ? D * 0.2 : D * Math.hypot(n.x, n.z);
        },
        lift: (y, a) => {
          const { D, n } = vol(y, a);
          return flat ? 0 : D * Math.max(0, n.y);
        },
        rows: 6,
        cols: 22,
        line: { depth: 0.006, burn: 1.655, ear: 1.65, nape: 1.592 },
        paint: (y, a) => (Math.sin(a * 11 + y * 90) > 0.6 ? darker(P, 1) : P),
      });
      break;
    }
    case 'trancasNago': {
      // Cornrows: 7 braided cords tight on the skull, side by side from the forehead over the crown to the nape.
      k.base({ d: () => 0.003, rows: 3, cols: 16, line: { depth: 0.004 }, paint: () => darker(P, 3) });
      for (let j = -3; j <= 3; j++) {
        const l = j * 15;
        k.ribbon(
          k.path(
            [
              [S(22, l), 0.006],
              [S(60, l * 1.02), 0.007],
              [S(100, l), 0.007],
              [S(140, l * 0.92), 0.007],
              [S(180, l * 0.85), 0.006],
              [S(212, l * 0.8), 0.004],
            ],
            9,
          ),
          { width: (t) => (Math.round(t * 8) % 2 ? 0.017 : 0.023), thick: 0.009, paint: (i) => (i % 2 ? darker(P, 1) : P) },
        );
      }
      break;
    }
    case 'dreadsCurtos': {
      // Short dreads: cords from all over the head falling down the skull: to the brows at the front, the jaw at
      // the sides, the neck at the back (the top ones over the others).
      k.base({ d: () => 0.009, rows: 4, cols: 16, line: { depth: 0.006 } });
      const end = (a: number) => {
        const f = angDist(a, FRONT);
        return f < deg(40) ? 1.712 : f < deg(70) ? 1.68 : f < deg(110) ? 1.575 : 1.55;
      };
      const rings: [number, number, number, number][] = [
        // y, offset, count, first angle (deg from the front)
        [1.772, 0.028, 6, 25],
        [1.735, 0.02, 7, 10],
        [1.695, 0.013, 5, 115],
      ];
      let i = 0;
      for (const [y, d, n, s0] of rings) {
        for (let j = 0; j < n; j++) {
          const s = n === 5 ? s0 + j * 32.5 : s0 + (j * 360) / n;
          const a = A(s);
          if (flat && y > 1.7) continue;
          const e = end(a) - (i % 3) * 0.012;
          if (e >= y - 0.01) continue;
          // Each dread lies on the skull from its root (low at the root, its own thickness further down).
          k.fallLock(flat ? 1.69 : y, e, a, (t) => lerp(0.012, d, smooth(t, 0, 0.35)), 0.026, 0.012, { n: 5, paint: alt(i++) });
        }
      }
      break;
    }
    case 'dreadsPresos': {
      // Long dreads tied high: cords up the skull to a knot at the back of the crown, then a thick tail of
      // dreads falling down the back (under a hat the knot is low at the nape).
      k.base({ d: () => 0.009, rows: 4, cols: 16, line: { depth: 0.006 } });
      const knot = flat ? k.onHead(1.598, BACK, 0.028).p : k.onHead(1.775, BACK, 0.035).p;
      if (!flat)
        [-60, -25, 0, 25, 60, -100, 100, -140, 140].forEach((sv, i) => {
          const r = H(sv === 0 ? 1.72 : Math.abs(sv) > 120 ? 1.64 : 1.7, sv);
          k.lock(
            [
              [r, 0.01],
              [r.clone().lerp(knot, 0.5), 0.016],
              [knot.clone().lerp(r, 0.1), 0.014],
            ],
            0.024,
            0.012,
            { n: 4, paint: alt(i), tip: false },
          );
        });
      k.tie(knot, 0.028, V(0, flat ? -0.3 : 0.4, 1), flat ? 'hair' : 'hairTop');
      for (let i = 0; i < 6; i++) {
        const sx = (i - 2.5) * 0.017;
        const pts = flat
          ? [knot.clone().add(V(sx, 0, 0)), V(sx * 1.6, 1.55, 0.15), V(sx * 2.2, 1.5, 0.17), V(sx * 2.5, 1.4 - (i % 2) * 0.03, 0.17)]
          : [knot.clone().add(V(sx, 0.008, 0)), knot.clone().add(V(sx * 1.5, 0.012, 0.05)), V(sx * 2, 1.7, 0.165), V(sx * 2.4, 1.57, 0.185), V(sx * 2.6, 1.44 - (i % 2) * 0.03, 0.17), V(sx * 2.7, 1.36 - (i % 3) * 0.02, 0.15)];
        k.strandOnBody(pts, flat ? 5 : 7, { width: 0.024, thick: 0.012, paint: alt(i), head: 2 });
      }
      break;
    }
    case 'cacheado': {
      // Medium curls: a round curly volume down to the jaw, its lower edge in curls, ringlets on the fringe.
      const C = V(0, 1.708, 0.014);
      const R = sex === 'f' ? 0.12 : 0.124;
      const line: Line = { depth: 0.008, burn: 1.62, ear: 1.6, nape: 1.57 };
      const edge = hairline(line);
      const vol = (y: number, a: number) => {
        const yy = Math.min(y, Y_TOP);
        const s = k.h.point(yy, a);
        const n = k.h.normal(yy, a);
        const oc = s.clone().sub(C);
        const bb = oc.dot(n);
        const D = -bb + Math.sqrt(Math.max(0, bb * bb - (oc.lengthSq() - R * R)));
        const f = angDist(a, FRONT);
        const face = f < deg(80) ? lerp(0.45, 1, smooth(f, deg(30), deg(80))) : 1;
        return { D: Math.max(0.016, D * face + 0.007 * Math.sin(a * 6 + y * 70)) + k.earPad(y, a) * 0.6, n };
      };
      k.base({
        d: (y, a) => {
          const { D, n } = vol(y, a);
          return D * Math.hypot(n.x, n.z);
        },
        lift: (y, a) => {
          const { D, n } = vol(y, a);
          return flat ? 0 : D * Math.max(0, n.y);
        },
        rows: 6,
        cols: 20,
        line,
        tips: (a) => -0.016 * Math.abs(Math.sin(a * 5.5)) * smooth(angDist(a, FRONT), deg(60), deg(90)),
        paint: (y, a) => (Math.sin(a * 9 + y * 110) > 0.5 ? darker(P, 1) : P),
      });
      // Curls along the lower edge: faceted balls half sunk in the volume, the edge breaking into ringlets.
      for (let i = 0; i < 12; i++) {
        const sg = 70 + (i * 220) / 11;
        const a = A(sg > 180 ? sg - 360 : sg);
        const y0 = edge(a) + 0.008 + (i % 3) * 0.012;
        const { D, n } = vol(y0, a);
        k.ball(k.h.point(y0, a).addScaledVector(n, D * 0.82), 0.019 + (i % 2) * 0.004, topRegion(y0), alt(i), HEAD_W, [6, 4]);
      }
      if (!flat)
        [-24, 0, 22].forEach((l, i) =>
          k.lock(
            [
              [S(60, l), 0.03],
              [S(30, l + 4), 0.03],
              [S(16, l + 8), 0.022],
              [S(22, l + 14), 0.03],
            ],
            0.032,
            0.014,
            { paint: alt(i + 1) },
          ),
        );
      break;
    }
    case 'repartido': {
      // Side part: a parting on the left, the big side swept over the top to the right, the short side combed
      // down, the front lock with some lift.
      const part = -28;
      k.base({
        d: (y) => 0.009 + Math.max(0, y - 1.7) * 0.05,
        cols: 20,
        line: { depth: 0.008 },
        paint: (y, a) => (y > 1.735 && y < 1.785 && angDist(a, A(part)) < deg(5) ? darker(P, 4) : P),
      });
      [22, 36, 52, 68, 86].forEach((phi, i) =>
        k.lock(
          [
            [S(phi, part + 3), 0.012],
            [S(phi + 6, part + 30), i === 0 ? 0.03 : 0.024],
            [S(phi + 16, part + 62), 0.02],
            [S(phi + 28, part + 92), 0.012],
          ],
          0.05,
          0.015,
          { paint: alt(i), cap: i === 0 },
        ),
      );
      [26, 48, 72].forEach((phi, i) =>
        k.lock(
          [
            [S(phi, part - 2), 0.011],
            [S(phi + 8, part - 22), 0.015],
            [S(phi + 18, part - 46), 0.009],
          ],
          0.046,
          0.012,
          { paint: alt(i + 1) },
        ),
      );
      for (const l of [-30, 0, 30])
        k.lock(
          [
            [S(102, l), 0.013],
            [S(150, l * 1.05), 0.014],
            [S(198, l * 1.15), 0.007],
          ],
          0.055,
          0.012,
        );
      break;
    }
    case 'penteadoTras':
      // Slicked back: smooth locks side by side from the forehead over the crown to the nape, grooves between.
      k.base({ d: (y) => 0.008 + Math.max(0, y - 1.7) * 0.05, cols: 20, line: { depth: 0.006, zig: [0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2] } });
      for (let j = 0; j < 9; j++) {
        const l = -46 + j * 11.5;
        k.lock(
          [
            [S(21, l * 0.9), 0.01],
            [S(55, l), 0.026],
            [S(100, l * 1.04), 0.024],
            [S(150, l * 1.08), 0.017],
            [S(206, l * 1.1), 0.008],
          ],
          0.05,
          0.012,
          { n: 6, paint: alt(j), cap: true },
        );
      }
      for (const s of [-1, 1])
        k.lock(
          [
            [H(1.705, s * 60), 0.007],
            [H(1.708, s * 100), 0.014],
            [H(1.69, s * 135), 0.013],
            [H(1.64, s * 160), 0.006],
          ],
          0.05,
          0.01,
          { paint: darker(P, 1) },
        );
      break;
    case 'undercut': {
      // Shaved sides, a long top swept over to the right and falling over the shaved side.
      k.base({ d: (y) => (y < 1.74 ? 0.003 : 0.008), cols: 20, line: { depth: 0.006 }, paint: (y) => (y < 1.735 ? darker(P, 2) : P) });
      [-40, -26, -12, 2, 16, 30].forEach((l, i) =>
        k.lock(
          [
            [S(28, l), 0.01],
            [S(50, l + 18), 0.032],
            [S(66, l + 48), 0.036],
            [S(76, l + 76), 0.034],
            [S(82, l + 102), 0.032],
          ],
          0.054,
          0.016,
          { n: 6, paint: alt(i), cap: i === 0 },
        ),
      );
      for (const l of [-24, 0, 24])
        k.lock(
          [
            [S(90, l), 0.012],
            [S(125, l * 1.1), 0.016],
            [S(150, l * 1.2), 0.01],
          ],
          0.055,
          0.012,
        );
      // An accent lock flopping over the forehead.
      if (!flat)
        k.lock(
          [
            [S(44, 10), 0.02],
            [S(26, 26), 0.034],
            [S(10, 34), 0.03],
          ],
          0.04,
          0.014,
          { paint: darker(P, 1) },
        );
      break;
    }

    // Medium.
    case 'medioDesfiado': {
      // Choppy to the chin: two layers of hanging locks with deep points, a broken fringe.
      k.base({ d: (y) => 0.01 + Math.max(0, y - 1.72) * 0.08, cols: 18, rows: 4, line: { depth: 0.012 } });
      k.mantle({ a0: A(-64), arc: deg(-232), cols: 16, hangRows: 2, top: () => 1.745, bottom: () => 1.565, d: () => 0.016, tip: 0.045, ridge: 0.006 });
      k.mantle({ a0: A(-70), arc: deg(-220), cols: 12, hangRows: 1, headRows: 2, top: () => 1.77, bottom: () => 1.625, d: (y) => 0.03 - smooth(y, 1.7, 1.77) * 0.01, tip: 0.035, ridge: 0.006 });
      if (!flat)
        [
          [-34, -42, 14],
          [-14, -18, 9],
          [6, 4, 13],
          [26, 30, 10],
        ].forEach(([l0, l1, e], i) =>
          k.lock(
            [
              [S(80, l0 * 0.6), 0.022],
              [S(40, (l0 + l1) / 2), 0.026],
              [S(e, l1), 0.02],
            ],
            0.046,
            0.014,
            { paint: alt(i) },
          ),
        );
      break;
    }
    case 'chanel':
      // Straight bob to the chin: an even, rounded volume, the ends tucked in, a blunt straight fringe.
      k.base({ d: (y) => 0.012 + Math.max(0, y - 1.72) * 0.08, cols: 18, rows: 4, line: { depth: 0.004 } });
      k.mantle({ a0: A(-62), arc: deg(-236), cols: 18, hangRows: 2, headRows: 3, top: () => 1.775, bottom: () => 1.56, d: (y) => 0.022 - smooth(y, 1.73, 1.775) * 0.006, tip: 0.008, ridge: 0.0045, tuck: 0.014, th: 0.013 });
      headShell(k.b, k.h, {
        y0: 1.704,
        y1: 1.765,
        a0: A(-56),
        arc: deg(112),
        rows: 2,
        cols: 8,
        d: (y) => k.flatD(y, 0.021),
        tips: (a) => -0.003 * Math.abs(Math.sin(a * 23)),
        paint: (_y, a) => (Math.round((a - A(-56)) / deg(14)) % 2 ? darker(P, 1) : P),
        region: (y) => topRegion(y),
        rim: 0.008,
      });
      break;
    case 'franjaLateral': {
      // To the shoulders, a long fringe swept to the left over one eye.
      k.base({ d: (y) => 0.01 + Math.max(0, y - 1.72) * 0.08, cols: 18, rows: 4, line: { depth: 0.008 } });
      k.mantle({ a0: A(-64), arc: deg(-232), cols: 16, hangRows: 3, top: () => 1.765, bottom: (a) => 1.49 + 0.015 * Math.cos(a - BACK), d: () => 0.017, tip: 0.035, ridge: 0.006, front: (a) => angDist(a, FRONT) < deg(80) });
      if (!flat)
        [
          [30, 50, -40, 1.69],
          [36, 70, -58, 1.67],
          [24, 30, -24, 1.7],
        ].forEach(([l0, p0, l1, y1], i) =>
          k.lock(
            [
              [S(p0, l0), 0.02],
              [S(36, (l0 + l1) / 2 + 6), 0.026],
              [S(22, l1 + 6), 0.024],
              [H(y1, l1 - 14), 0.022],
            ],
            0.05,
            0.016,
            { n: 5, paint: alt(i) },
          ),
        );
      break;
    }
    case 'longo':
    case 'longoOndulado': {
      // Long: a mass down the back (to the middle of it straight, to the shoulder blades wavy), locks in front of
      // the shoulders, the fringe swept to one side; the waves bend every lock in S curves.
      const wavy = id === 'longoOndulado';
      const wave = wavy ? (y: number, _a: number, i: number) => (y < HANG ? 0.013 * Math.sin((HANG - y) * 32 + i * 0.9) * smooth(HANG - y, 0, 0.05) : 0) : undefined;
      k.base({ d: (y) => 0.01 + Math.max(0, y - 1.72) * 0.08, cols: 18, rows: 4, line: { depth: 0.008 } });
      k.mantle({
        a0: A(-96),
        arc: deg(-168),
        cols: 14,
        hangRows: 4,
        top: () => 1.765,
        bottom: (a) => (wavy ? 1.3 : 1.23) + 0.05 * (1 - Math.cos(a - BACK)),
        d: () => 0.018,
        tip: 0.04,
        ridge: 0.007,
        wave,
        spread: 0.06,
      });
      // In front of the shoulders: two locks a side.
      for (const s of [-1, 1])
        [
          [62, wavy ? 1.36 : 1.33, 0.018],
          [78, wavy ? 1.4 : 1.38, 0.024],
          [92, 1.47, 0.026],
        ].forEach(([f, y1, d], i) =>
          k.fallLock(1.76, y1, (t) => A(s * (f + t * 6)), (t) => d + (wavy ? 0.012 * Math.sin(t * 9 + i) : 0), (t) => lerp(0.056, 0.03, t), 0.014, {
            n: 6,
            paint: alt(i + (s > 0 ? 1 : 0)),
            body: { front: f < 88, spread: 0.05 },
          }),
        );
      if (!flat)
        [
          [24, 22, -36, 1.695],
          [30, 44, -54, 1.68],
        ].forEach(([l0, p0, l1, y1], i) =>
          k.lock(
            [
              [S(p0, l0), 0.022],
              [S(30, (l0 + l1) / 2), 0.028],
              [H(y1, l1), 0.026],
              [H(y1 - 0.05, l1 - 12), 0.024],
            ],
            0.05,
            0.016,
            { n: 4, paint: alt(i) },
          ),
        );
      break;
    }

    // Tied.
    case 'raboAlto':
    case 'rabo': {
      // Ponytail, high (from the back of the crown, arching out) or low (from the nape): the hair pulled back
      // tight to the tie, the tail falling down the back (from the nape under a hat).
      const high = id === 'raboAlto' && !flat;
      k.base({ d: () => 0.008, cols: 18, rows: 4, line: { depth: 0.006 } });
      const knot = high ? k.onHead(1.765, BACK, 0.03).p : k.onHead(flat ? 1.598 : 1.635, BACK, 0.02).p;
      if (!flat || !high)
        k.pulled(knot, [
          [1.72, -30],
          [1.725, 0],
          [1.72, 30],
          [1.7, -70],
          [1.7, 70],
          [high ? 1.62 : 1.71, high ? -150 : -120],
          [high ? 1.62 : 1.71, high ? 150 : 120],
        ]);
      // The tie sits around the root of the tail, just off the head.
      k.tie(knot.clone().add(high ? V(0, 0.004, 0.014) : V(0, -0.008, 0.012)), high ? 0.022 : 0.02, high ? V(0, 0.3, 1) : V(0, -0.6, 1), high ? 'hairTop' : 'hair');
      const tail = high
        ? [knot, knot.clone().add(V(0, 0.01, 0.03)), V(0, 1.765, 0.135), V(0, 1.69, 0.17), V(0, 1.6, 0.182), V(0.004, 1.51, 0.172), V(0.008, 1.43, 0.155)]
        : [knot, knot.clone().add(V(0, -0.02, 0.03)), V(0, 1.53, 0.15), V(0.004, 1.43, 0.155), V(0.008, 1.34, 0.145)];
      k.strandOnBody(tail, 8, { width: (t) => (t < 0.18 ? lerp(0.04, 0.08, t / 0.18) : lerp(0.08, 0.026, (t - 0.18) / 0.82)), thick: (t) => (t < 0.18 ? lerp(0.022, 0.044, t / 0.18) : lerp(0.044, 0.016, (t - 0.18) / 0.82)), paint: P, head: 2 });
      // Two smaller locks splitting off the tail: the silhouette breaks.
      for (const s of [-1, 1]) {
        const p0 = tail[2].clone().add(V(s * 0.012, 0, 0.004));
        const end = tail[tail.length - 1].clone().add(V(s * 0.03, 0.04, -0.005));
        k.strandOnBody([p0, p0.clone().lerp(end, 0.5).add(V(s * 0.016, 0, 0.012)), end], 4, { width: (t) => lerp(0.03, 0.014, t), thick: 0.012, paint: darker(P, 1) });
      }
      // The low ponytail keeps a side-swept fringe.
      if (!high && !flat)
        [0, 1].forEach((i) =>
          k.lock(
            [
              [S(50, 10 + i * 12), 0.014],
              [S(28, -12 + i * 10), 0.024],
              [H(1.705 - i * 0.02, -46 - i * 10), 0.018],
            ],
            0.048,
            0.014,
            { paint: alt(i) },
          ),
        );
      break;
    }
    case 'coque':
    case 'meioPreso': {
      // High bun (all the hair pulled up into it) or half-up (the top half in a small bun, the rest loose to
      // the shoulders); under a hat the bun sits low at the nape.
      const half = id === 'meioPreso';
      k.base({ d: () => (half ? 0.01 : 0.008), cols: 18, rows: 4, line: { depth: 0.006 } });
      if (half) k.mantle({ a0: A(-66), arc: deg(-228), cols: 16, hangRows: 3, top: () => 1.71, bottom: (a) => 1.49 + 0.015 * Math.cos(a - BACK), d: () => 0.016, tip: 0.03, ridge: 0.006, front: (a) => angDist(a, FRONT) < deg(80) });
      const knot = flat ? k.onHead(1.598, BACK, 0.03).p : k.onHead(half ? 1.75 : 1.772, BACK, half ? 0.03 : 0.042).p;
      const r = half ? 0.032 : 0.05;
      if (!flat)
        k.pulled(
          knot,
          half
            ? [
                [1.72, -32],
                [1.725, 0],
                [1.72, 32],
                [1.72, -76],
                [1.72, 76],
              ]
            : [
                [1.72, -30],
                [1.725, 0],
                [1.72, 30],
                [1.7, -72],
                [1.7, 72],
                [1.62, -150],
                [1.62, 150],
              ],
          { d: 0.012 },
        );
      const bun = knot.clone().add(flat ? V(0, 0, 0.02) : V(0, 0.012, 0.012));
      // Under a hat the half-up's little bun is let down (it would sit on the hanging hair).
      if (!(flat && half)) k.ball(bun, r, flat ? 'hair' : 'hairTop', P, HEAD_W, [8, 5], true);
      if (!(flat && half)) k.tie(bun.clone().add(flat ? V(0, 0, -r * 0.65) : V(0, -r * 0.55, -r * 0.4)), r * 0.62, flat ? V(0, 0, 1) : V(0, 0.8, 0.6), flat ? 'hair' : 'hairTop');
      // Loose wisps in front of the ears.
      if (!half)
        for (const s of [-1, 1]) k.fallLock(1.715, 1.61, A(s * 70), 0.012, 0.022, 0.01, { n: 4, paint: darker(P, 1) });
      break;
    }
    case 'coqueDuplo': {
      // Space buns: a center part, the hair pulled to two buns on the top of the head (low behind the ears
      // under a hat).
      k.base({ d: () => 0.008, cols: 18, rows: 4, line: { depth: 0.006 }, paint: (y, a) => (y > 1.735 && angDist(a, FRONT) < deg(4) ? darker(P, 4) : P) });
      for (const s of [-1, 1]) {
        const knot = flat ? k.onHead(1.6, A(s * 140), 0.03).p : k.onHead(1.765, A(s * 105), 0.035).p;
        if (!flat)
          k.pulled(knot, [
            [1.722, s * 8],
            [1.72, s * 40],
            [1.7, s * 80],
            [1.64, s * 150],
          ]);
        const c = knot.clone().add(V(s * 0.006, flat ? 0 : 0.012, 0));
        k.ball(c, 0.04, flat ? 'hair' : 'hairTop', P, HEAD_W, [7, 5]);
        k.tie(c.clone().add(V(-s * 0.016, flat ? 0 : -0.024, 0)), 0.026, flat ? V(s, 0, -0.2) : V(s * 0.5, 1, 0), flat ? 'hair' : 'hairTop');
      }
      break;
    }
    case 'tranca': {
      // A single braid down the back: the hair pulled back to the nape, the braid in alternating lobes, a tie and
      // a short tuft.
      k.base({ d: () => 0.009, cols: 18, rows: 4, line: { depth: 0.006 } });
      const knot = k.onHead(flat ? 1.598 : 1.64, BACK, 0.02).p;
      if (!flat)
        k.pulled(knot, [
          [1.72, -30],
          [1.725, 0],
          [1.72, 30],
          [1.7, -72],
          [1.7, 72],
          [1.68, -120],
          [1.68, 120],
        ]);
      const pts = [knot, V(0, 1.58, 0.14), V(0, 1.49, 0.152), V(0.004, 1.4, 0.15), V(0.006, 1.3, 0.142), V(0.006, 1.22, 0.134)];
      k.strandOnBody(pts, 11, { width: (t) => (Math.round(t * 10) % 2 ? 0.04 : 0.058) * lerp(1, 0.7, t), thick: (t) => lerp(0.024, 0.016, t), paint: (i) => (i % 2 ? darker(P, 1) : P), tip: false, head: 1 });
      const end = k.onBody(V(0.006, 1.215, 0.134), BACK, { front: false });
      k.tie(end.p, 0.016, V(0, 1, 0), regionAt(end.p), end.w);
      for (const s of [-1, 0, 1]) k.strandOnBody([V(0.006, 1.215, 0.134), V(0.006 + s * 0.012, 1.17, 0.13 + Math.abs(s) * 0.004)], 3, { width: 0.016, thick: 0.009, paint: darker(P, 1) });
      break;
    }
    case 'trancasBox': {
      // Long box braids: square parts on the scalp, thin braids down the back and two in front of each shoulder.
      k.base({ d: () => 0.009, cols: 18, rows: 4, line: { depth: 0.006 }, paint: (y, a) => (Math.abs(Math.sin(a * 8)) < 0.16 || Math.abs(Math.sin(y * 140)) < 0.12 ? darker(P, 3) : P) });
      const roots: [number, number, number, number][] = [];
      // y, signed angle, end, offset
      for (let j = 0; j < 7; j++) roots.push([1.738, 105 + j * 25, 1.26 + (j % 3) * 0.035, 0.022]);
      for (let j = 0; j < 4; j++) roots.push([1.7, 125 + j * 37, 1.3 + (j % 2) * 0.03, 0.014]);
      roots.forEach(([y, s, e, d], i) => {
        const ss = s > 180 ? s - 360 : s;
        k.fallLock(flat ? Math.min(y, 1.7) : y, e, A(ss), d, (t) => (Math.round(t * 6) % 2 ? 0.02 : 0.026), 0.014, { n: 6, paint: alt(i), body: { front: false, spread: 0.05 } });
      });
      for (const s of [-1, 1])
        for (const [f, e] of [
          [62, 1.34],
          [76, 1.38],
        ])
          k.fallLock(flat ? 1.7 : 1.74, e, A(s * f), 0.016, (t) => (Math.round(t * 6) % 2 ? 0.02 : 0.026), 0.014, { n: 7, body: { front: true, spread: 0.05 } });
      break;
    }
    default:
      k.base({ d: () => 0.008 });
  }
  return k.build();
}

/**
 * Facial hair: shells over the jaw, chin and upper lip (the beard line goes from the sideburn down the cheek),
 * the mouth left open; fuller beards are thicker and end in points under the chin. The long beard hangs in locks
 * that pass from the head to the chest on the way down, so looking down never pushes them into the throat.
 */
export function facialHair(id: string, sex: Sex): PieceGeometry {
  const k = new HairKit(sex, false, id.length * 41 + 9, darker(HAIR, 1));
  const h = k.h;
  const b = k.b;
  const P = k.P;
  const mouth = (y: number, a: number) => y > 1.574 && y < 1.594 && angDist(a, FRONT) < deg(22);
  const beardTop = (a: number) => {
    const f = angDist(a, FRONT);
    // Sideburn high near the ear, dipping along the cheek toward the mustache.
    return f > deg(70) ? 1.655 : lerp(1.6, 1.64, f / deg(70));
  };
  // Mustache: thicker in the middle, its ends drooping toward the corners of the mouth.
  const mustache = (d: number, wide = 1) =>
    headShell(b, h, {
      y0: 1.594,
      y1: 1.606,
      a0: FRONT - deg(27 * wide),
      arc: deg(54 * wide),
      rows: 1,
      cols: 8,
      d: (_y, a) => d * (0.55 + 0.45 * Math.cos(angDist(a, FRONT) * 2.5)),
      tips: (a) => -0.008 * (angDist(a, FRONT) / deg(27 * wide)) ** 2,
      paint: P,
      region: 'beard',
      rim: 0.003,
    });
  const beard = (d: number, hang: number, o: { a?: number; top?: (a: number) => number; paint?: Paint } = {}) => {
    const arc = o.a ?? deg(200);
    const paint = o.paint ?? P;
    headShell(b, h, {
      y0: 1.536,
      y1: 1.66,
      top: o.top ?? beardTop,
      a0: FRONT - arc / 2,
      arc,
      // Enough rows and columns for thin shells to follow the jaw's edge and the chin (the head's 12 facets must
      // stay under); thick beards clear them with fewer rows.
      rows: d >= 0.008 ? 4 : 6,
      cols: 16,
      // Never under 3.5 mm (thin shells let the head's facets through at the jaw); a little fuller on the chin.
      d: (y, a) => Math.max(0.0035, d * (0.6 + 0.4 * Math.max(0, Math.cos(angDist(a, FRONT)))) + (y < 1.56 ? d * 0.6 : 0)) + 0.003 * bell(y, 1.585, 0.035),
      tips: (a) => -hang * Math.max(0, Math.cos(angDist(a, FRONT) * 1.2)) * (0.75 + 0.25 * Math.abs(Math.sin(a * 9))),
      skip: mouth,
      paint: (y, a) => (hang > 0.01 && y < 1.6 && Math.sin(a * 21 + y * 90) > 0.6 ? darker(paint, 1) : paint),
      region: 'beard',
      rim: 0.005,
    });
    // Under the chin: close the beard toward the neck.
    headShell(b, h, { y0: 1.52, y1: 1.538, a0: FRONT - arc * 0.32, arc: arc * 0.64, rows: 1, cols: 8, d: () => Math.max(0.0045, d + 0.004), tips: () => -hang * 0.6, paint: darker(paint, 1), region: 'beard' });
  };
  switch (id) {
    case 'barbaPorFazer':
      // Stubble: a thin shadow of hair, lighter than the beards.
      beard(0.0035, 0, { paint: HAIR });
      break;
    case 'bigode':
      mustache(0.007, 1.1);
      break;
    case 'cavanhaque':
      mustache(0.006);
      headShell(b, h, { y0: 1.53, y1: 1.574, a0: FRONT - deg(24), arc: deg(48), rows: 2, cols: 4, d: () => 0.007, tips: (a) => -0.008 - 0.006 * Math.cos(angDist(a, FRONT) * 3), paint: P, region: 'beard', rim: 0.004 });
      break;
    case 'barbaCurta':
      beard(0.006, 0.005);
      mustache(0.007);
      break;
    case 'barbaLonga': {
      beard(0.011, 0.024);
      mustache(0.01, 1.15);
      // Locks hanging from the chin to the top of the chest, in points: the head carries their roots, the chest
      // their tips (held in front of the collar).
      [-0.032, -0.012, 0.01, 0.03].forEach((x, i) => {
        const pts = [V(x, 1.556, -0.088), V(x * 1.05, 1.525, -0.097), V(x * 0.85, 1.495, -0.096), V(x * 0.55, 1.462 - (i % 2) * 0.012, -0.09)];
        const frames = pts.map((p, j) => {
          const f = k.onBody(p, FRONT, { front: true, clear: 0.03 });
          f.n.set(0, 0, -1);
          f.w = j === 0 ? HEAD_W : mixW(f.w.length ? f.w : HEAD_W, HEAD_W, smooth(p.y, 1.47, 1.55));
          return f;
        });
        k.ribbon(frames, { width: (t) => lerp(0.034, 0.016, t), thick: 0.012, paint: i % 2 ? darker(P, 1) : P, region: 'beard', wrap: false });
      });
      break;
    }
    default:
      // 'barbaCheia'
      beard(0.009, 0.022);
      mustache(0.009, 1.1);
  }
  return k.build();
}
