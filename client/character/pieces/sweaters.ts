// Sweaters (torso slot, catalog "blusa"): hoodies, sweatshirts, knits, fleeces, ponchos and tunics, built by
// the tee engine (tops.ts) from this spec table plus the blocks they need: a body that blouses over the pants'
// waistband, raised panels with walls (kangaroo pockets, zips, plackets, patches), the hood lying on the back or
// up over the head (with a balaclava under it), an open cardigan front with a tee under it, a skirt below the
// hips (tunics, long cardigans), cape sleeves and fringes (poncho), ruffles, and knit textures as ridges and
// shades (ribs, cables, chunky knit). Everything stuck to the torso follows the build morphs.
import * as THREE from 'three';
import type { BodyParts, Side } from '../body';
import type { FacetBuilder, Rim, Weights } from '../builder';
import { darker, DETAIL, PRIMARY, SECONDARY, SKIN, type Paint } from '../palette';
import type { RegionName } from '../rig';
import { FIT } from './common';
import { angDist, BACK, column, deg, FRONT, hash, Kit, lerp, rowBand, segmentRect, sideness, type Row } from './kit';
import type { TopSpec } from './tops';

/** Torso section (body.ts): a superellipse, so details sit on the same curve as the tube. */
const se = (a: number) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 2.4) + Math.pow(Math.abs(Math.sin(a)), 2.4), 1 / 2.4);
/** Build morph strength and belly of the torso (body.ts), for parts built along it. */
const buildK = (y: number) => (y < 0.99 ? 0.18 : lerp(0.2, 0.12, smooth(y, 1.2, 1.3)));
const bellyK = (y: number) => (y > 0.99 && y < 1.25 ? 0.3 * Math.sin(((y - 0.99) / 0.26) * Math.PI) : 0);
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
const smooth = THREE.MathUtils.smoothstep;
const zero = new THREE.Vector3();
/** Build morph deltas of a vertex. */
type Morphs = { gordo: THREE.Vector3; magro: THREE.Vector3 };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Ring positions of a part (t 0..1) from the body's rows and extra heights (body.ts). */
const mergeTs = (base: readonly number[], t0: number, t1: number, extra: readonly number[] = []) => {
  const all = [...base.map((t) => (t - t0) / (t1 - t0)), ...extra.map((t) => (t - t0) / (t1 - t0)), 0, 1].filter((t) => t >= -1e-6 && t <= 1 + 1e-6);
  return [...new Set(all.map((t) => Math.round(clamp01(t) * 1e4) / 1e4))].sort((a, b) => a - b);
};

/**
 * Rings of a sweater's body: fewer than the skin's (the loose cloth hides the waist), all of them where the chest,
 * the bust and the shoulders curve; one just past where the belly's build morph ends (1.25), so details on the
 * cloth never sink into a "gordo" belly.
 */
const ROWS = [0.93, 0.99, 1.11, 1.255, 1.29, 1.35, 1.4, 1.435, 1.46];

/**
 * The Kit over a sweater's body, which is wider than the plain offset in places: `drape(y)` is the extra offset
 * there (m: the blousing near the hem, a poncho widening down) and `band` the hem band standing out (unitless,
 * like the tube's rims), so patches, pockets and zips sit on the real cloth. Skinned like the skin under it (and
 * like the pants' waist: a hem following the thighs more would let the pants' seat out when crouching).
 */
export class Knit extends Kit {
  constructor(
    b: FacetBuilder,
    p: BodyParts,
    d: number,
    hem: number,
    readonly drape: (y: number) => number = () => 0,
    readonly band?: { top: number; out: number },
  ) {
    super(b, p, d, hem);
  }

  override surf(y: number, a: number, off = 0) {
    const D = this.drape(y);
    const s = super.surf(y, a, off + D);
    if (this.band && y < this.band.top - 1e-4) {
      const t = this.p.torsoAt(y);
      const k = se(a) * this.band.out;
      const add = new THREE.Vector3(-Math.cos(a) * k * (t.w + this.d + D), 0, -Math.sin(a) * k * (t.d + this.d + D));
      s.p.add(add);
      const bk = buildK(y);
      s.gordo.addScaledVector(add, bk);
      s.magro.addScaledVector(add, -bk * 0.45);
    }
    return s;
  }

  /** The sweater's body from y0 up to y1: the torso at the offset plus the drape. */
  torso(y0: number, y1: number, o: { paint: Paint | ((y: number, a: number) => Paint); bump?: (y: number, a: number) => number; shade?: (y: number, a: number) => number; segments?: number; ts?: readonly number[]; rimStart?: Rim; rimEnd?: Rim }) {
    const p = this.p;
    const yOf = (t: number) => lerp(y0, y1, t);
    const off = (y: number) => this.d + this.drape(y);
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(0, y0, 0),
      to: new THREE.Vector3(0, y1, 0),
      radius: () => 1,
      sx: (t) => p.torsoAt(yOf(t)).w + off(yOf(t)),
      sz: (t) => p.torsoAt(yOf(t)).d + off(yOf(t)),
      shift: (t) => p.torsoAt(yOf(t)).fwd,
      section: se,
      bump: (t, a) => p.torsoBump(yOf(t), a) * (off(yOf(t)) > 0.03 ? 0.4 : 1) + (o.bump ? o.bump(yOf(t), a) : 0),
      ts: mergeTs(
        // A body closing into its collar (top over 1.47) goes from 1.435 straight to its shelf ring.
        ROWS.filter((y) => Math.abs(y - y0) > 0.006 && Math.abs(y - y1) > 0.004 && Math.abs(y - y0 - (o.rimStart?.h ?? 0)) > 0.015 && !(y === 1.46 && y1 > 1.47)),
        y0,
        y1,
        o.ts,
      ),
      segments: o.segments ?? 10,
      a0: FRONT,
      region: (t) => p.torsoSurface(yOf(t), FRONT, 0).region,
      // The skin's own weights (the hips' sides follow the thighs a little, like the pants' waist under it).
      weights: (t, a) => p.torsoSurface(yOf(t), a, 0).w,
      paint: typeof paint === 'function' ? (t, a) => paint(yOf(t), a) : paint,
      shade: o.shade ? (t, a) => o.shade!(yOf(t), a) : undefined,
      build: (t) => buildK(yOf(t)),
      belly: (t) => bellyK(yOf(t)),
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  /**
   * A raised panel over the cloth between rows going up (pockets, plackets, zips, patches): the top `h` out, and
   * walls down to the cloth on every side (style guide: thickness on every edge). `walls` paints them per side
   * (left = the lower angle); null = a flat sheet with no walls.
   */
  slab(
    rows: readonly Row[],
    paint: Paint | ((y: number, a: number) => Paint),
    o: { h?: number | ((y: number, a: number) => number); off?: number; walls?: Paint | null | { l?: Paint; r?: Paint; b?: Paint; t?: Paint }; cols?: number; region?: RegionName; shade?: number } = {},
  ) {
    // Far LOD: no panels (they read as the cloth's color from far away).
    if (this.b.lod >= 2) return;
    const b = this.b;
    const off = o.off ?? 0.003;
    const hOf = typeof o.h === 'function' ? o.h : () => (o.h as number | undefined) ?? 0.005;
    const paintOf = typeof paint === 'function' ? paint : () => paint;
    const span = Math.max(...rows.map(([, a0, a1]) => a1 - a0));
    const cols = o.cols ?? Math.max(1, Math.ceil(span / 0.2));
    const vert = (y: number, a: number, h: number) => {
      const s = this.surf(y, a, off + h);
      return b.vertex(s.p, s.w, 0, { gordo: s.gordo, magro: s.magro });
    };
    const top = rows.map(([y, a0, a1]) => Array.from({ length: cols + 1 }, (_, i) => vert(y, lerp(a0, a1, i / cols), hOf(y, lerp(a0, a1, i / cols)))));
    const regionAt = (y: number) => o.region ?? this.surf(y, FRONT).region;
    for (let r = 0; r < rows.length - 1; r++) {
      const ym = (rows[r][0] + rows[r + 1][0]) / 2;
      for (let i = 0; i < cols; i++) {
        const am = (lerp(rows[r][1], rows[r][2], (i + 0.5) / cols) + lerp(rows[r + 1][1], rows[r + 1][2], (i + 0.5) / cols)) / 2;
        b.quad(top[r][i], top[r + 1][i], top[r + 1][i + 1], top[r][i + 1], paintOf(ym, am), regionAt(ym), o.shade ?? 0);
      }
    }
    if (o.walls === null) return;
    const w = o.walls;
    const wallPaint = (side: 'l' | 'r' | 'b' | 't', fallback: Paint) => (w === undefined ? fallback : typeof w === 'number' ? w : (w[side] ?? fallback));
    const base = (y: number, a: number) => vert(y, a, 0);
    const P = (y: number, a: number) => wallPaint('b', darker(paintOf(y, a), 1));
    const quadAway = (v0: number, v1: number, v2: number, v3: number, inside: THREE.Vector3, paint: Paint, region: RegionName) => {
      b.triAway(v0, v1, v2, inside, paint, region, -0.3);
      b.triAway(v0, v2, v3, inside, paint, region, -0.3);
    };
    const n = rows.length - 1;
    // Bottom and top edges.
    for (const [r, inner, side] of [
      [0, 1, 'b'],
      [n, n - 1, 't'],
    ] as const) {
      const [y, a0, a1] = rows[r];
      const bs = Array.from({ length: cols + 1 }, (_, i) => base(y, lerp(a0, a1, i / cols)));
      for (let i = 0; i < cols; i++) {
        const inside = b.position(top[inner][i]).add(b.position(top[inner][i + 1])).multiplyScalar(0.5);
        const am = lerp(a0, a1, (i + 0.5) / cols);
        quadAway(bs[i], bs[i + 1], top[r][i + 1], top[r][i], inside, side === 'b' ? P(y, am) : wallPaint('t', darker(paintOf(y, am), 1)), regionAt(y));
      }
    }
    // Side edges.
    for (const [i, inner, side] of [
      [0, 1, 'l'],
      [cols, cols - 1, 'r'],
    ] as const) {
      const bs = rows.map(([y, a0, a1]) => base(y, lerp(a0, a1, i / cols)));
      for (let r = 0; r < n; r++) {
        const inside = b.position(top[r][inner]).add(b.position(top[r + 1][inner])).multiplyScalar(0.5);
        const ym = (rows[r][0] + rows[r + 1][0]) / 2;
        quadAway(bs[r], bs[r + 1], top[r + 1][i], top[r][i], inside, wallPaint(side, darker(paintOf(ym, rows[r][1]), 1)), regionAt(ym));
      }
    }
  }

  /** Rows of a strip X0..X1 (m) from y0 to y1 on the front (or the back), every `step`, plus `ys`. */
  rowsX(X0: number, X1: number, y0: number, y1: number, back = false, step = 0.06, ys: number[] = []): Row[] {
    const list = [...new Set([y0, y1, ...ys.filter((y) => y > y0 && y < y1), ...Array.from({ length: Math.max(0, Math.ceil((y1 - y0) / step) - 1) }, (_, i) => y0 + (i + 1) * step)])].sort((a, b) => a - b);
    return list.map((y): Row => {
      const a = this.angX(X0, y, back);
      const c = this.angX(X1, y, back);
      return [y, Math.min(a, c), Math.max(a, c)];
    });
  }
}

// --- Blocks -----------------------------------------------------------------------------------------------------

/**
 * Sweaters hang over the pants' waistband (it stands up to ~4 cm out between 0.86 and 1.04 m): extra offset (m) at
 * height y, a little less on the rib band at the hem.
 */
export function blouseAt(hem: number, bandH: number, amount: number) {
  return (y: number) => {
    if (y < hem + bandH + 1e-4) return amount * 0.85;
    const rise = smooth(y, hem + bandH, hem + bandH + 0.05);
    const fall = 1 - smooth(y, 1.04, 1.17);
    return amount * (0.85 + 0.15 * rise) * fall;
  };
}

/**
 * A ring band around the torso standing out over the cloth (belts, wide stripes): 4 rings, the outer face and
 * both edges, no inside.
 */
export function torsoBand(k: Knit, y0: number, y1: number, out: number, paint: Paint, segments = 10) {
  const p = k.p;
  const yOf = (t: number) => lerp(y0, y1, t);
  const e = 1e-3;
  k.b.tube({
    from: new THREE.Vector3(0, y0, 0),
    to: new THREE.Vector3(0, y1, 0),
    radius: () => 1,
    sx: (t) => p.torsoAt(yOf(t)).w + k.d + k.drape(yOf(t)) + (t > e && t < 1 - e ? out : 0),
    sz: (t) => p.torsoAt(yOf(t)).d + k.d + k.drape(yOf(t)) + (t > e && t < 1 - e ? out : 0),
    shift: (t) => p.torsoAt(yOf(t)).fwd,
    section: se,
    ts: [0, 2 * e, 1 - 2 * e, 1],
    segments,
    a0: FRONT,
    region: () => p.torsoSurface((y0 + y1) / 2, FRONT, 0).region,
    weights: (t, a) => p.torsoSurface(yOf(t), a, 0).w,
    paint,
    build: (t) => buildK(yOf(t)),
    belly: (t) => bellyK(yOf(t)),
  });
}

/** An arc of cloth hanging from the torso (ruffles): y0 → y1 going up, over `arc` from `a0`. */
function torsoArc(k: Knit, o: { y0: number; y1: number; d: number; a0: number; arc: number; flare: (t: number) => number; bump?: (t: number, a: number) => number; paint: Paint; rimStart?: Rim; segments: number }) {
  const p = k.p;
  const yOf = (t: number) => lerp(o.y0, o.y1, t);
  k.b.tube({
    from: new THREE.Vector3(0, o.y0, 0),
    to: new THREE.Vector3(0, o.y1, 0),
    radius: (t) => 1 + o.flare(t) / Math.max(0.05, p.torsoAt(yOf(t)).w),
    sx: (t) => p.torsoAt(yOf(t)).w + o.d,
    sz: (t) => p.torsoAt(yOf(t)).d + o.d,
    shift: (t) => p.torsoAt(yOf(t)).fwd,
    section: se,
    bump: (t, a) => p.torsoBump(yOf(t), a) + (o.bump ? o.bump(t, a) : 0),
    ts: [0, 0.5, 1],
    segments: o.segments,
    a0: o.a0,
    arc: o.arc,
    region: (t) => p.torsoSurface(yOf(t), FRONT, 0).region,
    weights: (t, a) => p.torsoSurface(yOf(t), a, 0).w,
    paint: o.paint,
    build: (t) => buildK(yOf(t)),
    rimStart: o.rimStart,
  });
}

/** Drawstrings hanging from (X, y) down `len`: flat cords lying on the cloth (under 1 cm wide: decoration). */
export function strings(k: Knit, X: number, y: number, len: number, paint: Paint, off = 0.008) {
  for (const s of [-1, 1]) {
    const yc = y - len / 2;
    k.stud(yc, k.angX(s * X, yc), 0.0035, paint, off, len / 2);
  }
}

/** Kangaroo pocket on the belly: a trapezoid, the slanted sides open (dark walls). `gap`: split by a zip. */
export function kangaroo(k: Knit, o: { y0?: number; y1?: number; w0?: number; w1?: number; paint?: Paint; gap?: number } = {}) {
  const y0 = o.y0 ?? 0.965;
  const y1 = o.y1 ?? 1.115;
  const w0 = o.w0 ?? 0.125;
  const w1 = o.w1 ?? 0.088;
  const paint = o.paint ?? PRIMARY;
  const ys = [y0, (y0 + y1) / 2, y1];
  const half = (y: number) => lerp(w0, w1, (y - y0) / (y1 - y0));
  const open = darker(paint, 4);
  const seam = darker(paint, 2);
  if (o.gap) {
    for (const s of [-1, 1]) {
      const rows = ys.map((y): Row => {
        const a = k.angX(s * half(y), y);
        const c = k.angX(s * o.gap!, y);
        return [y, Math.min(a, c), Math.max(a, c)];
      });
      k.slab(rows, paint, { h: 0.007, shade: 0.3, cols: 1, walls: { l: s < 0 ? open : seam, r: s < 0 ? seam : open, b: seam, t: seam } });
    }
  } else {
    k.slab(
      ys.map((y): Row => [y, k.angX(-half(y), y), k.angX(half(y), y)]),
      paint,
      { h: 0.007, shade: 0.3, cols: 3, walls: { l: open, r: open, b: seam, t: seam } },
    );
  }
}

/** A zipper from y0 up to y1 at the front center (teeth in `paint`), with its pull at the top. */
export function zipper(k: Knit, y0: number, y1: number, paint: Paint, o: { pull?: boolean; X?: number; back?: boolean; w?: number } = {}) {
  const X = o.X ?? 0;
  const w = o.w ?? 0.0065;
  k.slab(k.rowsX(X - w, X + w, y0, y1, o.back, 0.15), paint, { h: 0.0035, cols: 1 });
  // The pull: a tab lying on the teeth.
  if (o.pull !== false) k.stud(y1 - 0.016, k.angX(X, y1 - 0.016), 0.0055, paint, 0.0075, 0.012);
}

/** Zipper teeth up the front of a stand collar (neck tube of radius r from 1.43 to y1). */
export function collarZip(k: Knit, r: number, y1: number, paint: Paint) {
  const p = k.p;
  const yc = (1.43 + y1) / 2;
  const z = (0.004 - 0.008 * ((yc - 1.43) / (y1 - 1.43))) - (p.s.neck + r) * 0.94 - 0.002;
  k.b.append(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(new THREE.Vector3(0, yc, z), new THREE.Quaternion(), new THREE.Vector3(0.011, y1 - 1.43 + 0.012, 0.006)), [['neck', 0.5], ['chest', 0.5]], 'neck', paint);
}

/**
 * The hood down: a thick roll around the back of the neck (its two edges crossing in front) and the hood lying on
 * the upper back.
 */
export function hoodDown(k: Knit, o: { paint?: Paint; lining?: Paint; size?: number } = {}) {
  const P = o.paint ?? PRIMARY;
  const L = o.lining ?? darker(P, 2);
  const size = o.size ?? 1;
  const b = k.b;
  // The roll: from just right of the front center around the left, the back and the right, to just left of it.
  const n = 8;
  const a0 = FRONT + 0.16;
  const a1 = FRONT - 2 * Math.PI - 0.16;
  const pts: THREE.Vector3[] = [];
  const morphs: Morphs[] = [];
  const rr = (t: number) => {
    const f = angDist(lerp(a0, a1, t), FRONT);
    return (0.009 + 0.012 * smooth(f, 0, deg(80))) * size;
  };
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = lerp(a0, a1, t);
    const f = angDist(a, FRONT);
    const y = 1.392 + 0.068 * smooth(f, deg(5), deg(85)) + (size - 1) * 0.01;
    const s = k.surf(Math.min(1.465, y), a, rr(t) * 0.8 + 0.002);
    pts.push(s.p.add(new THREE.Vector3(0, rr(t) * 0.35, 0)));
    morphs.push({ gordo: s.gordo, magro: s.magro });
  }
  strandTube(b, pts, rr, (t) => (t < 0.06 || t > 0.94 ? L : P), 'neck', [['chest', 0.75], ['neck', 0.25]], 4, morphs);
  // The hood on the back: a cushion between the shoulder blades, narrowing to a point.
  const prof: [number, number][] = [
    [1.255, 5],
    [1.29, 18],
    [1.34, 31],
    [1.39, 42],
    [1.43, 50],
    [1.462, 50],
  ];
  const drop = (size - 1) * 0.06;
  // Rows going up (the patch's winding).
  const rows = prof.map(([y, h], i): Row => {
    const yy = i === prof.length - 1 ? y : y - drop * (1 - i / (prof.length - 1));
    const hh = deg(h) * (0.9 + 0.1 * size);
    return [yy, BACK - hh, BACK + hh];
  });
  k.slab(rows, (y) => (y > 1.43 ? L : P), {
    h: (y, a) => {
      const across = 1 - (angDist(a, BACK) / deg(55)) ** 2;
      const along = bell(y, 1.37 - drop * 0.5, 0.14 + drop * 0.5);
      return 0.009 + 0.02 * size * Math.max(0, across) * along;
    },
    walls: darker(P, 2),
    cols: 3,
    // Like long hair down the back: a backpack worn over it hides it (its straps and panel would cut through).
    region: 'hairBack',
  });
}

/** A tube through points with `sides` sides and closed ends (the hood's roll), each ring moved by its point's build morphs. */
function strandTube(
  b: FacetBuilder,
  pts: THREE.Vector3[],
  radius: (t: number) => number,
  paint: (t: number) => Paint,
  region: RegionName,
  w: Weights,
  sides: number,
  morphs: Morphs[],
) {
  const n = pts.length;
  const rings: number[][] = [];
  let nrm = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    nrm = nrm.clone().addScaledVector(tan, -nrm.dot(tan)).normalize();
    const bin = new THREE.Vector3().crossVectors(tan, nrm).normalize();
    const r = radius(t);
    rings.push(
      Array.from({ length: sides }, (_, k) => {
        const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
        return b.vertex(pts[i].clone().addScaledVector(nrm, Math.cos(a) * r * 0.8).addScaledVector(bin, Math.sin(a) * r), w, 0, morphs[i]);
      }),
    );
  }
  for (let i = 0; i < n - 1; i++) {
    const p = paint((i + 0.5) / (n - 1));
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      b.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k], p, region);
    }
  }
  for (const [ring, flip] of [
    [rings[0], true],
    [rings[n - 1], false],
  ] as const) {
    for (let k = 1; k < sides - 1; k++) {
      if (flip) b.tri(ring[0], ring[k + 1], ring[k], paint(0), region);
      else b.tri(ring[0], ring[k], ring[k + 1], paint(1), region);
    }
  }
}

/**
 * The hood up over the head: a shell around the skull, roomy enough for flat hair and big afros, open around
 * the face, its edge thick (the lining shows), a peak at the back. With `mask`, a balaclava under it covers
 * the face but the eyes.
 */
export function hoodUp(k: Knit, o: { paint?: Paint; lining?: Paint; mask?: Paint } = {}) {
  const P = o.paint ?? PRIMARY;
  const L = o.lining ?? darker(P, 2);
  const b = k.b;
  const h = k.p.head;
  // Rows: the hoodie's neckline, two rows blending to the head, then over the skull. Opening half angle per row.
  const rows: [number, number][] = [
    [1.462, 0],
    [1.51, 16],
    [1.56, 50],
    [1.61, 64],
    [1.66, 66],
    [1.71, 60],
    [1.75, 40],
    [1.785, 0],
  ];
  // Far LOD: fewer columns.
  const cols = b.lod >= 2 ? 8 : 12;
  const dOf = (y: number, a: number) => {
    const back = 1 - angDist(a, BACK) / Math.PI;
    return 0.044 + 0.012 * bell(y, 1.66, 0.09) + 0.016 * bell(y, 1.73, 0.05) * bell(back, 1, 0.45) - 0.004 * smooth(y, 1.74, 1.8);
  };
  const headAt = (y: number, a: number, d: number) => h.point(y, a, d);
  const point = (y: number, a: number, d: number) => {
    if (y >= 1.6) return headAt(y, a, d);
    const s = (y - 1.462) / (1.61 - 1.462);
    const lo = k.surf(1.462, a, 0.006).p;
    const hi = headAt(1.61, a, d);
    const out = lo.clone().lerp(hi, Math.pow(s, 0.8));
    // Baggy around the neck: pushed out a little between the shoulders and the head.
    const dir = new THREE.Vector3(out.x, 0, out.z + 0.01).normalize();
    out.addScaledVector(dir, 0.016 * Math.sin(Math.PI * s));
    out.y = y;
    return out;
  };
  const weights = (y: number): Weights => (y < 1.49 ? [['chest', 0.55], ['neck', 0.45]] : y < 1.58 ? [['neck', 0.55], ['head', 0.45]] : [['head', 1]]);
  const grid: number[][] = [];
  const angles: number[][] = [];
  for (const [y, half] of rows) {
    const hf = deg(half);
    const line: number[] = [];
    const as: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const a = FRONT + hf + (i / cols) * (2 * Math.PI - 2 * hf);
      as.push(a);
      const s = y < 1.47 ? k.surf(y, a, 0.006) : null;
      line.push(b.vertex(s ? s.p : point(y, a, dOf(y, a)), weights(y), y > 1.75 ? 0 : 0.04, s ? { gordo: s.gordo, magro: s.magro } : { gordo: zero, magro: zero }));
    }
    grid.push(line);
    angles.push(as);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < cols; i++) {
      const am = (angles[r][i] + angles[r][i + 1] + angles[r + 1][i] + angles[r + 1][i + 1]) / 4;
      // The center seam over the crown and down the back.
      const seam = angDist(am, BACK) < 0.25 ? -0.3 : 0;
      b.quad(grid[r][i], grid[r + 1][i], grid[r + 1][i + 1], grid[r][i + 1], P, 'none', seam);
    }
  }
  // Crown: a point a little behind the top of the skull.
  const crown = b.vertex(new THREE.Vector3(0, h.y1 + dOf(1.79, BACK) - 0.004, 0.022), [['head', 1]], 0, { gordo: zero, magro: zero });
  const last = grid[grid.length - 1];
  for (let i = 0; i < cols; i++) b.tri(last[i], crown, last[i + 1], P, 'none');
  // The edge around the face folds inward and the lining goes on inside toward the ears (thickness; looking
  // into the hood shows the lining, not the background). Both face the head.
  for (const [i, dir] of [
    [0, 1],
    [cols, -1],
  ] as const) {
    const lines = [9, 42].map((back, j) =>
      rows.map(([y], r) => {
        const a = angles[r][i] + dir * deg(back);
        const s = y < 1.47 ? k.surf(y, a, 0.002) : null;
        return b.vertex(s ? s.p : point(y, a, dOf(y, a) - (j ? 0.016 : 0.022)), weights(y), 0.15, s ? { gordo: s.gordo, magro: s.magro } : { gordo: zero, magro: zero });
      }),
    );
    const strips = [grid.map((line) => line[i]), ...lines];
    for (let j = 0; j < (b.lod >= 1 ? 1 : 2); j++) {
      const [e, q] = [strips[j], strips[j + 1]];
      for (let r = 0; r < rows.length - 1; r++) {
        if (rows[r][1] === 0 && rows[r + 1][1] === 0) continue;
        const c = b.position(e[r]).add(b.position(q[r + 1])).multiplyScalar(0.5);
        const inside = c.clone().add(new THREE.Vector3(c.x, 0, c.z + 0.01).normalize().multiplyScalar(0.1));
        b.triAway(e[r], e[r + 1], q[r + 1], inside, j ? darker(L, 1) : L, 'none', -0.4);
        b.triAway(e[r], q[r + 1], q[r], inside, j ? darker(L, 1) : L, 'none', -0.4);
      }
    }
  }
  if (o.mask !== undefined) balaclava(k, o.mask);
}

/**
 * A balaclava over the face (under a hood): the front half of the head and the neck, pushed out over the nose
 * and the lips, open across the eyes (with a lip of thickness around the opening).
 */
function balaclava(k: Knit, paint: Paint) {
  const b = k.b;
  const h = k.p.head;
  const neckR = k.p.s.neck;
  const ys = [1.47, 1.538, 1.556, 1.578, 1.6, 1.625, 1.656, 1.694, 1.72, 1.75, 1.78];
  const eye0 = 1.656;
  // The front of the head past the ears (the hood covers the rest), a vertex at the front (the nose ridge).
  const cols = 10;
  const step = deg(22.5);
  const a0 = FRONT - step * 5;
  const dOf = (y: number, a: number) => {
    const f = angDist(a, FRONT);
    const ear = Math.min(angDist(a, deg(186)), angDist(a, deg(-6)));
    return 0.008 + 0.03 * bell(y, 1.627, 0.045) * bell(f, 0, deg(21)) + 0.005 * bell(y, 1.565, 0.04) * bell(f, 0, deg(50)) + 0.02 * bell(y, 1.648, 0.045) * bell(ear, 0, deg(30));
  };
  const point = (y: number, a: number, d: number) => {
    const neck = new THREE.Vector3(-Math.cos(a) * (neckR + d + 0.004), y, -Math.sin(a) * (neckR + d + 0.004) * 0.94);
    if (y < 1.53) return neck;
    const head = h.point(y, a, d);
    if (y > 1.6) return head;
    const dir = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    return head.dot(dir) >= neck.dot(dir) ? head : neck;
  };
  const W = (y: number): Weights => (y < 1.5 ? [['neck', 1]] : y < 1.56 ? [['neck', 0.5], ['head', 0.5]] : [['head', 1]]);
  const grid = ys.map((y) => Array.from({ length: cols + 1 }, (_, i) => b.vertex(point(y, a0 + i * step, dOf(y, a0 + i * step)), W(y), 0, { gordo: zero, magro: zero })));
  const open = (r: number, i: number) => ys[r] === eye0 && Math.abs(a0 + (i + 0.5) * step - FRONT) < deg(45);
  for (let r = 0; r < ys.length - 1; r++) {
    for (let i = 0; i < cols; i++) {
      if (open(r, i)) continue;
      b.quad(grid[r][i], grid[r + 1][i], grid[r + 1][i + 1], grid[r][i + 1], paint, 'none');
    }
  }
  // Lip around the eye opening, down to the skin.
  const r0 = ys.indexOf(eye0);
  const inside = new THREE.Vector3(0, 1.675, 0.04);
  const skin = (r: number, i: number) => b.vertex(point(ys[r], a0 + i * step, 0.0015), W(ys[r]), 0.2, { gordo: zero, magro: zero });
  const iL = Math.round((FRONT - deg(45) - a0) / step);
  const iR = Math.round((FRONT + deg(45) - a0) / step);
  const lip = (u: number, v: number, su: number, sv: number) => {
    b.triAway(u, v, sv, inside, darker(paint, 2), 'none', -0.6);
    b.triAway(u, sv, su, inside, darker(paint, 2), 'none', -0.6);
  };
  for (let i = iL; i < iR; i++) {
    lip(grid[r0][i], grid[r0][i + 1], skin(r0, i), skin(r0, i + 1));
    lip(grid[r0 + 1][i], grid[r0 + 1][i + 1], skin(r0 + 1, i), skin(r0 + 1, i + 1));
  }
  for (const i of [iL, iR]) lip(grid[r0][i], grid[r0 + 1][i], skin(r0, i), skin(r0 + 1, i));
}

/** An open front: the tee under it (`inner`) and a raised band along each edge (a V up to the neck above `vY`). */
export function openFront(k: Knit, o: { vY: number; gap: number; top?: number; bandW?: number; inner: Paint; band: Paint; buttons?: Paint; bandH?: number }) {
  const top = o.top ?? 1.462;
  const bw = o.bandW ?? 0.026;
  const w = (y: number) => k.p.torsoAt(y).w + k.d;
  const e = (y: number) => (y <= o.vY ? Math.asin(Math.min(0.9, o.gap / w(y))) : lerp(Math.asin(Math.min(0.9, o.gap / w(o.vY))), deg(36), smooth(y, o.vY, top)));
  const hem = k.hem;
  const bandTop = hem + (o.bandH ?? 0.022);
  // The body's own rows (so the panels never dip under its faces), the band, the bottom of the V.
  const ys = [...new Set([hem, bandTop, ...ROWS.filter((y) => y > bandTop + 0.01 && y < top - 0.004 && Math.abs(y - o.vY) > 0.015), o.vY, top])].filter((y) => y >= hem && y <= top).sort((a, b) => a - b);
  k.slab(
    ys.map((y): Row => [y, FRONT - e(y), FRONT + e(y)]),
    o.inner,
    { h: 0.001, walls: null, off: 0.004, cols: 1 },
  );
  for (const s of [-1, 1]) {
    k.slab(
      ys.map((y): Row => {
        const a = FRONT + s * e(y);
        const c = FRONT + s * (e(y) + bw / w(y));
        return [y, Math.min(a, c), Math.max(a, c)];
      }),
      o.band,
      { h: 0.0065, cols: 1, walls: { l: s < 0 ? darker(o.band, 1) : darker(o.band, 3), r: s < 0 ? darker(o.band, 3) : darker(o.band, 1) } },
    );
  }
  if (o.buttons !== undefined) {
    const n = Math.max(2, Math.round((o.vY - hem - 0.06) / 0.1) + 1);
    for (let i = 0; i < n; i++) {
      const y = lerp(hem + 0.06, o.vY - 0.02, i / (n - 1));
      k.stud(y, FRONT - e(y) - bw / w(y) / 2, 0.0065, o.buttons, 0.0085);
    }
  }
}

/**
 * The skirt of a long top below the hips (tunic, long cardigan): from `bottom` up to `top`, the hips at the top,
 * each thigh pulling its side lower down; `gap` leaves the front open.
 */
export function skirt(k: Knit, o: { top: number; bottom: number; flare: number; paint: Paint | ((t: number, a: number) => Paint); hemPaint: Paint; gap?: number; segments?: number }) {
  const p = k.p;
  const hem = k.hem;
  const gap = o.gap ?? 0;
  const yOf = (t: number) => lerp(o.bottom, o.top, t);
  // Above the body's hem the skirt hides under it (a little inside); below, it comes out and flares.
  const ref = (y: number) => p.torsoAt(Math.max(y, 0.93));
  const off = (y: number) => (y > hem + 0.003 ? k.d + k.drape(y) - 0.005 : k.d + k.drape(hem) + 0.008);
  const fl = (y: number) => (y >= hem ? 0 : o.flare * Math.pow((hem - y) / (hem - o.bottom), 1.2));
  const tHem = (hem - o.bottom) / (o.top - o.bottom);
  const tIn = (hem + 0.006 - o.bottom) / (o.top - o.bottom);
  k.b.tube({
    from: new THREE.Vector3(0, o.bottom, 0),
    to: new THREE.Vector3(0, o.top, 0),
    radius: () => 1,
    sx: (t) => ref(yOf(t)).w + off(yOf(t)) + fl(yOf(t)),
    sz: (t) => ref(yOf(t)).d + off(yOf(t)) + 0.006 + fl(yOf(t)) * 0.8,
    shift: (t) => ref(yOf(t)).fwd,
    ts: [0, tHem, tIn, 1],
    segments: o.segments ?? 10,
    a0: FRONT + gap,
    arc: gap ? 2 * Math.PI - 2 * gap : undefined,
    region: 'pelvis',
    // Each thigh pulls its side lower down (a = 0 is the wearer's left on upward tubes).
    weights: (t, a) => {
      const kk = THREE.MathUtils.clamp((hem - yOf(t)) / (hem - o.bottom), 0, 1) * 0.75;
      const l = Math.max(0, Math.cos(a)) * kk;
      const r = Math.max(0, -Math.cos(a)) * kk;
      return [['hips', 1 - l - r], ['thigh_L', l], ['thigh_R', r]];
    },
    paint: o.paint,
    shade: (t, a) => 0.5 * Math.sin(a * 5 + t * 3) * (1 - t),
    build: () => 0.2,
    rimStart: { h: 0.026, out: 0.03, paint: o.hemPaint },
  });
}

/** Sawtooth fringe hanging from a ring of points (poncho hems): both faces, `len` along `dir`, following the points' morphs. */
function fringe(b: FacetBuilder, pts: THREE.Vector3[], morphs: Morphs[], dir: THREE.Vector3, len: number, paint: Paint, w: (i: number) => Weights, region: RegionName) {
  for (let i = 0; i < pts.length - 1; i++) {
    const tip = pts[i].clone().lerp(pts[i + 1], 0.5).addScaledVector(dir, len * (0.8 + 0.4 * hash(i)));
    const ww = w(i);
    const mid = { gordo: morphs[i].gordo.clone().lerp(morphs[i + 1].gordo, 0.5), magro: morphs[i].magro.clone().lerp(morphs[i + 1].magro, 0.5) };
    const v0 = b.vertex(pts[i], ww, 0.1, morphs[i]);
    const v1 = b.vertex(pts[i + 1], ww, 0.1, morphs[i + 1]);
    const v2 = b.vertex(tip, ww, 0, mid);
    b.tri(v0, v1, v2, paint, region);
    b.tri(v0, v2, v1, darker(paint, 2), region, -0.5);
  }
}

/**
 * The inside of an opening around the upper arm, from t0 to t1 (a short sleeve, a cape): a band facing the arm, at
 * the arm's radius (biceps included) plus `extra(t)` (m), darker (the inside of the cloth, in its shadow). Single
 * sided cloth would read as a thin hoop when a raised arm shows the opening.
 */
export function armLining(p: BodyParts, s: Side, t0: number, t1: number, paint: Paint, o: { extra: (t: number) => number; n?: number }) {
  const b = p.b;
  const j = p.j;
  const [r0, r1] = p.s.upperArm;
  const n = o.n ?? 8;
  const rings = [t0, t1].map((t) => {
    const c = new THREE.Vector3(s * lerp(j.shoulder - 0.07, j.elbow, t), j.armY - 0.012 * (1 - t), 0);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const R = lerp(r0, r1, t) * (0.72 + 0.28 * Math.min(1, t / 0.24)) + o.extra(t) + 0.006 * bell(t, 0.55, 0.3) * bell(angDist(a, deg(s < 0 ? 270 : 90)), 0, deg(55));
      // The tube's frame on an arm (axis ±X): width along Z, depth along ±Y (sz 0.92).
      const off = new THREE.Vector3(0, s * Math.sin(a) * R * 0.92, Math.cos(a) * R);
      const g = off.clone().multiplyScalar(0.16);
      return { id: b.vertex(c.clone().add(off), p.upperArmWeights(s, t), 0.2, { gordo: g, magro: g.clone().multiplyScalar(-0.45) }), out: c.clone().addScaledVector(off, 3) };
    });
  });
  const region = s < 0 ? 'upperArm_L' : 'upperArm_R';
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    // Facing the arm: away from a point out past the ring.
    const out = rings[0][i].out.clone().add(rings[1][i1].out).multiplyScalar(0.5);
    b.triAway(rings[0][i].id, rings[1][i].id, rings[1][i1].id, out, paint, region);
    b.triAway(rings[0][i].id, rings[1][i1].id, rings[0][i1].id, out, paint, region);
  }
}

/** Poncho: wide capes over the upper arms (they follow the arms) with a fringe at the end, lined near the opening. */
export function capes(k: Knit, o: { t1: number; flare: number; paint: (t: number, a: number, s: Side) => Paint; fringe: Paint; d: number }) {
  const p = k.p;
  const j = p.j;
  const [r0, r1] = p.s.upperArm;
  const flare = (t: number) => 0.012 + o.flare * Math.pow(t / o.t1, 1.4);
  for (const s of [-1, 1] as Side[]) {
    p.upperArm(s, 0, o.t1, o.d, {
      flare,
      paint: (t, a) => o.paint(t, a, s),
      rimEnd: { h: 0.018, out: 0.005, paint: darker(PRIMARY, 1) },
      segments: 10,
      rings: [0, 0.25, 0.5, 0.75, 1],
      shade: (t, a) => 0.5 * Math.sin(a * 4 + t * 6) * t,
    });
    if (k.b.lod >= 2) continue;
    k.b.detail(() => armLining(p, s, o.t1 * 0.55, o.t1 - 0.004, darker(o.paint(o.t1, 0, s), 3), { extra: (t) => o.d + flare(t) - 0.005, n: 10 }));
    // Fringe at the end ring (the tube's own formula: center, radius, an oval section).
    const t = o.t1;
    const x = s * lerp(j.shoulder - 0.07, j.elbow, t);
    const c = new THREE.Vector3(x, j.armY - 0.012 * (1 - t), 0);
    const r = lerp(r0, r1, t) + o.d + flare(t) + 0.004;
    const up = new THREE.Vector3(0, s > 0 ? 1 : -1, 0);
    const pts = Array.from({ length: 11 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return c.clone().add(new THREE.Vector3(0, 0, Math.cos(a) * r)).addScaledVector(up, Math.sin(a) * r * 0.92);
    });
    const w = p.upperArmWeights(s, t);
    // The arm tubes grow from their axis (build 0.16).
    const morphs = pts.map((q) => {
      const g = q.clone().sub(c).multiplyScalar(0.16);
      return { gordo: g, magro: g.clone().multiplyScalar(-0.45) };
    });
    fringe(k.b, pts, morphs, new THREE.Vector3(s, 0, 0), 0.04, o.fringe, () => w, s < 0 ? 'upperArm_L' : 'upperArm_R');
  }
}

/** Fringe around the hem of the torso. */
export function hemFringe(k: Knit, paint: Paint, n = 16) {
  if (k.b.lod >= 2) return;
  const y = k.hem;
  const ring = Array.from({ length: n + 1 }, (_, i) => k.surf(y, FRONT + (i / n) * Math.PI * 2, 0.003));
  const ws = Array.from({ length: n }, (_, i) => k.surf(y, FRONT + ((i + 0.5) / n) * Math.PI * 2).w);
  fringe(
    k.b,
    ring.map((s) => s.p),
    ring.map((s) => ({ gordo: s.gordo, magro: s.magro })),
    new THREE.Vector3(0, -1, 0),
    0.045,
    paint,
    (i) => ws[i],
    'pelvis',
  );
}

/** Ruffles: a wavy flounce over the chest and the back, hanging from the top edge of an off-shoulder top. */
export function flounce(k: Knit, top: number, paint: Paint, trim: Paint) {
  for (const c of [FRONT, BACK]) {
    torsoArc(k, {
      y0: top - 0.1,
      y1: top,
      d: k.d + 0.006,
      a0: c - deg(68),
      arc: deg(136),
      flare: (t) => 0.026 * (1 - t),
      bump: (t, a) => 0.07 * (1 - t) * Math.abs(Math.sin(a * 7)),
      paint,
      rimStart: { h: 0.014, out: 0.03, paint: trim },
      segments: 10,
    });
  }
}

/** Seven-segment letters (block letters on college sweatshirts). */
const LETTERS: Record<string, string> = { A: 'abcefg', C: 'adef', E: 'adefg', U: 'bcdef', L: 'def', H: 'bcefg', S: 'afgcd', O: 'abcdef' };

/** A word across the chest, arched (the middle higher). */
export function word(k: Knit, text: string, cy: number, h: number, arch: number, paint: Paint) {
  const w = h * 0.56;
  const t = h * 0.18;
  const gap = w * 0.32;
  const total = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, i) => {
    const cx = -total / 2 + w / 2 + i * (w + gap);
    const yy = cy + arch * (1 - (cx / (total / 2)) ** 2);
    for (const seg of LETTERS[ch] ?? '') {
      const [x0, x1, y0, y1] = segmentRect(seg, w, h, t);
      // The viewer's right is −X in front of the wearer.
      k.rect(-(cx + x1), -(cx + x0), yy + y0, yy + y1, paint, false, 0.004);
    }
  });
}

/** A Christmas tree on the chest: three tiers, a trunk and a star. */
function tree(k: Knit, cy: number, h: number, paint: Paint, star: Paint) {
  const tri = (y0: number, y1: number, w: number) =>
    k.patch(
      [
        [y0, k.angX(-w, y0), k.angX(w, y0)],
        [y1, k.angX(-0.003, y1), k.angX(0.003, y1)],
      ],
      paint,
      { off: 0.004 },
    );
  const y0 = cy - h / 2;
  tri(y0 + h * 0.12, y0 + h * 0.5, h * 0.42);
  tri(y0 + h * 0.36, y0 + h * 0.72, h * 0.33);
  tri(y0 + h * 0.58, y0 + h * 0.92, h * 0.24);
  k.rect(-0.008, 0.008, y0, y0 + h * 0.13, darker(paint, 2), false, 0.004);
  k.box(y0 + h * 0.95, FRONT, new THREE.Vector3(0.016, 0.016, 0.004), star, 0.004);
}

// --- Knit textures and sleeve details ------------------------------------------------------------------------------

/** Angle of a sleeve face around the arm, in steps (for ribs and stripes). */
const armStep = (a: number, n: number) => Math.floor((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / n));
/** The outer side of a sleeve when the arm hangs (T pose: up). */
const armOuter = (s: Side) => (s < 0 ? deg(270) : deg(90));
/** Elbow patches (T pose: the elbow points back, a = 0 on the arm tubes): t 0..1 upper arm, 1..2 forearm. */
const onElbow = (t: number, a: number, t0 = 0.8, t1 = 1.25, half = 46) => t > t0 - 1e-3 && t < t1 + 1e-3 && angDist(a, 0) < deg(half);
/** Index of the torso vertex column at angle a (n columns from the front). */
const vcol = (a: number, n: number) => (((Math.round((a - FRONT) / ((2 * Math.PI) / n)) % n) + n) % n);
/** Rib knit: columns alternating in two values of the color, ridges on the light ones. */
const ribPaint = (n: number, P: Paint) => (_y: number, a: number) => (column(a, n) % 2 ? darker(P, 1) : P);
const armRibPaint = (n: number, P: Paint) => (_t: number, a: number) => (armStep(a, n) % 2 ? darker(P, 1) : P);
const ribBump = (n: number, amp: number) => (_y: number, a: number) => (vcol(a, n) % 2 === 0 ? amp : 0);
/** Raglan seam (shoulders in another color): from the neck down to the armpit. */
const raglan = (y: number, a: number) => {
  const fromSide = Math.min(angDist(a, 0), angDist(a, Math.PI));
  return fromSide < deg(68) && y > 1.33 + 0.13 * (fromSide / deg(68));
};
/** Fleece: a few faces lighter or darker at random (a nubby surface). */
const fleece = (y: number, a: number) => (hash(Math.round(y * 50) * 31 + column(a, 12)) - 0.5) * 0.7;
/** Rows every 6 cm for knit patterns (the sweater's body has fewer by default). */
const KNIT_ROWS = [1.05, 1.17];

// --- The table ----------------------------------------------------------------------------------------------------

const RIB = darker(PRIMARY, 1);

/** Hoodie base: loose, hanging over the waistband, a deep rib hem, sleeves bunching into rib cuffs. */
const HOODIE: TopSpec = {
  hem: 0.885,
  sleeve: 2,
  fit: FIT.loose,
  neck: 'hood',
  collar: RIB,
  band: RIB,
  bandH: 0.05,
  bandOut: 0.03,
  blouse: 0,
  cuff: 'rib',
  cuffPaint: RIB,
  flare: 0.012,
  bunch: true,
  hood: { kind: 'down' },
};
/** Sweatshirt / sweater base: the same without the hood, a crew neck. */
const SWEAT: TopSpec = { ...HOODIE, neck: 'crew', hood: undefined, flare: 0.01 };

export const SWEATERS: Record<string, TopSpec> = {
  moletomCanguru: {
    ...HOODIE,
    hood: { kind: 'down', lining: SECONDARY },
    extra: (k) => {
      kangaroo(k);
      strings(k, 0.032, 1.4, 0.13, SECONDARY);
    },
  },
  moletomCapuz: {
    ...HOODIE,
    neck: 'none',
    hood: { kind: 'up', lining: SECONDARY },
    extra: (k) => {
      kangaroo(k);
      strings(k, 0.03, 1.462, 0.15, SECONDARY, 0.01);
    },
  },
  moletomZiper: {
    ...HOODIE,
    hood: { kind: 'down', lining: SECONDARY },
    extra: (k) => {
      kangaroo(k, { gap: 0.016 });
      zipper(k, k.hem, 1.452, DETAIL);
      strings(k, 0.04, 1.405, 0.12, SECONDARY);
    },
  },
  moletomSemCapuz: {
    ...SWEAT,
    collar: SECONDARY,
    band: SECONDARY,
    cuffPaint: SECONDARY,
    extra: (k) => {
      // The V insert under the collar ("dorito"), in the rib's color.
      k.patch(
        [
          [1.385, k.angX(-0.004, 1.385), k.angX(0.004, 1.385)],
          [1.44, k.angX(-0.03, 1.44), k.angX(0.03, 1.44)],
        ],
        SECONDARY,
        { off: 0.004 },
      );
    },
  },
  moletomOversized: {
    ...HOODIE,
    hem: 0.87,
    fit: FIT.heavy,
    bandH: 0.055,
    blouse: 0.026,
    flare: 0.03,
    hood: { kind: 'down', size: 1.25, lining: SECONDARY },
    extra: (k) => {
      kangaroo(k, { y0: 0.94, y1: 1.1, w0: 0.14, w1: 0.1 });
      strings(k, 0.036, 1.4, 0.16, SECONDARY, 0.009);
    },
  },
  moletomCropped: {
    ...HOODIE,
    hem: 1.1,
    fit: FIT.regular,
    bandH: 0.04,
    blouse: undefined,
    flare: 0.008,
    hood: { kind: 'down', size: 0.9, lining: SECONDARY },
    extra: (k) => strings(k, 0.03, 1.4, 0.11, SECONDARY),
  },
  universitario: {
    ...SWEAT,
    collar: SECONDARY,
    band: SECONDARY,
    cuffPaint: SECONDARY,
    // A varsity stripe around the upper arms, an arched word on the chest.
    armTs: [0.56],
    arm: (t) => (t > 0.45 && t < 0.56 ? SECONDARY : PRIMARY),
    extra: (k) => word(k, 'ACE', 1.25, 0.08, 0.018, DETAIL),
  },
  bicolor: {
    ...SWEAT,
    collar: PRIMARY,
    band: darker(SECONDARY, 1),
    cuffPaint: darker(SECONDARY, 1),
    // Color block: the top in the first color, the bottom and the forearms in the second, a piping between.
    ts: [1.2, 1.215],
    body: (y) => (y > 1.215 ? PRIMARY : y > 1.2 ? darker(PRIMARY, 3) : SECONDARY),
    armTs: [0.86, 0.9],
    arm: (t) => (t < 0.86 ? PRIMARY : t < 0.9 ? darker(PRIMARY, 3) : SECONDARY),
  },
  trico: {
    ...SWEAT,
    hem: 0.875,
    fit: FIT.heavy,
    neck: 'roll',
    collar: RIB,
    bandH: 0.065,
    flare: 0.016,
    segments: 12,
    ts: KNIT_ROWS,
    // Chunky rib knit: thick ridges, rows of stitches alternating light and dark.
    body: ribPaint(12, PRIMARY),
    bump: ribBump(12, 0.05),
    shade: (y) => (rowBand(y) % 2 ? 0.35 : -0.35),
    arm: armRibPaint(8, PRIMARY),
    armShade: (t) => (Math.floor(t / 0.25) % 2 ? 0.35 : -0.35),
    armBump: (_t, a) => (Math.round(a / (Math.PI / 4)) % 2 === 0 ? 0.005 : 0),
  },
  golaAlta: {
    hem: 0.9,
    sleeve: 2,
    fit: FIT.regular,
    neck: 'turtle',
    collar: PRIMARY,
    band: RIB,
    bandH: 0.035,
    cuff: 'rib',
    cuffPaint: RIB,
    segments: 12,
    // Fine rib knit all over.
    shade: (_y, a) => (column(a, 12) % 2 ? 0.5 : -0.5),
    armShade: (_t, a) => (armStep(a, 8) % 2 ? 0.45 : -0.45),
  },
  sueterV: {
    ...SWEAT,
    neck: 'v',
    collar: SECONDARY,
    v: { y: 1.31, half: deg(30), fill: SKIN, trim: SECONDARY },
    band: SECONDARY,
    bandH: 0.045,
    cuffPaint: SECONDARY,
    flare: 0.008,
    shade: (y, a) => (rowBand(y) % 2 ? 0.25 : -0.25) + (column(a, 10) % 2 ? 0.15 : -0.15),
  },
  natalino: {
    ...SWEAT,
    collar: SECONDARY,
    band: SECONDARY,
    bandH: 0.045,
    cuffPaint: SECONDARY,
    segments: 12,
    // A band of zigzags across the chest (two rows of offset checkers between two bands), on the knit's rows.
    ts: [1.22, 1.272],
    body: (y, a) => {
      const c = column(a, 12);
      if ((y > 1.22 && y < 1.255) || (y > 1.29 && y < 1.35)) return SECONDARY;
      if (y > 1.255 && y < 1.272) return c % 2 ? DETAIL : PRIMARY;
      if (y > 1.272 && y < 1.29) return c % 2 ? PRIMARY : DETAIL;
      return PRIMARY;
    },
    arm: (t, a) => (t > 0.2 && t < 0.5 ? (armStep(a, 8) % 2 ? DETAIL : SECONDARY) : PRIMARY),
    extra: (k) => tree(k, 1.11, 0.13, DETAIL, SECONDARY),
  },
  cardiga: {
    ...SWEAT,
    hem: 0.88,
    // The tee under it: its crew band.
    neck: 'tee',
    collar: DETAIL,
    bandH: 0.045,
    flare: 0.008,
    shade: (y, a) => (rowBand(y) % 2 ? 0.2 : -0.2) + (column(a, 10) % 2 ? 0.15 : -0.15),
    extra: (k) => {
      openFront(k, { vY: 1.25, gap: 0.03, inner: DETAIL, band: RIB, buttons: darker(PRIMARY, 4), bandH: 0.045 });
    },
  },
  cardigaLongo: {
    ...SWEAT,
    // The tee under it: its crew band.
    neck: 'tee',
    hem: 0.93,
    collar: SECONDARY,
    band: null,
    blouse: 0,
    flare: 0.012,
    shade: (_y, a) => (column(a, 10) % 2 ? 0.25 : -0.25),
    // Down to mid thigh, open in front; the front edges are the bands.
    // Straight sleeves (no bunching before the cuff).
    bunch: false,
    skirt: { top: 1.0, bottom: 0.58, flare: 0.03, gap: deg(15), segments: 8 },
    skirtPaint: (_t, a) => (angDist(a, FRONT) < deg(15) + deg(32) ? RIB : PRIMARY),
    extra: (k) => openFront(k, { vY: 1.24, gap: 0.03, inner: SECONDARY, band: RIB, bandH: 0 }),
  },
  pescador: {
    ...SWEAT,
    hem: 0.88,
    fit: FIT.heavy,
    neck: 'roll',
    collar: PRIMARY,
    band: PRIMARY,
    bandH: 0.055,
    cuffPaint: PRIMARY,
    flare: 0.012,
    segments: 12,
    ts: KNIT_ROWS,
    // Aran knit: raised cables (twisting light and dark row by row) either side of a diamond panel, front and back.
    body: (y, a) => {
      const c = column(a, 12);
      const r = rowBand(y);
      if (c === 1 || c === 10 || c === 4 || c === 7) return r % 2 ? darker(PRIMARY, 1) : PRIMARY;
      if (c === 11 || c === 0 || c === 5 || c === 6) return (r + c) % 2 ? darker(PRIMARY, 1) : PRIMARY;
      return PRIMARY;
    },
    bump: (_y, a) => ([1, 2, 10, 11, 4, 5, 7, 8].includes(vcol(a, 12)) ? 0.045 : 0),
    shade: (y, a) => (column(a, 12) % 3 === 2 ? (rowBand(y) % 2 ? 0.3 : -0.3) : 0),
    arm: (t, a) => (armStep(a, 8) === 1 || armStep(a, 8) === 5 ? (Math.floor(t / 0.2) % 2 ? darker(PRIMARY, 1) : PRIMARY) : PRIMARY),
    armBump: (_t, a) => (angDist(a, deg(45)) < 0.2 || angDist(a, deg(90)) < 0.2 || angDist(a, deg(225)) < 0.2 || angDist(a, deg(270)) < 0.2 ? 0.005 : 0),
  },
  fleeceMeioZiper: {
    ...SWEAT,
    neck: 'stand',
    collar: PRIMARY,
    band: SECONDARY,
    bandH: 0.03,
    cuff: 'elastic',
    cuffPaint: SECONDARY,
    flare: 0.012,
    bunch: false,
    segments: 12,
    // A yoke in the second color over the shoulders, a nubby fleece surface.
    ts: [1.33],
    body: (y, a) => (y > 1.33 && sideness(a) > 0.25 ? SECONDARY : PRIMARY),
    shade: fleece,
    arm: (t) => (t < 0.2 ? SECONDARY : PRIMARY),
    armShade: (t, a) => (hash(Math.round(t * 12) * 13 + armStep(a, 8)) - 0.5) * 0.7,
    extra: (k) => {
      zipper(k, 1.3, 1.455, DETAIL);
      // Zipped chest pocket on the left.
      k.slab(k.rowsX(-0.115, -0.05, 1.24, 1.245), DETAIL, { h: 0.003, cols: 1 });
    },
  },
  fleeceTatico: {
    ...SWEAT,
    neck: 'stand',
    collar: SECONDARY,
    band: SECONDARY,
    bandH: 0.03,
    cuff: 'elastic',
    cuffPaint: SECONDARY,
    bunch: false,
    segments: 12,
    // Reinforced shoulders and elbows (second color), velcro on the upper arms, zips.
    body: (y, a) => (raglan(y, a) ? SECONDARY : PRIMARY),
    shade: fleece,
    arm: (t, a) => (t < 0.2 || onElbow(t, a, 0.88, 1.12) ? SECONDARY : PRIMARY),
    armBump: (t, a) => (onElbow(t, a, 0.88, 1.12) ? 0.004 : 0),
    extra: (k) => {
      zipper(k, k.hem, 1.452, DETAIL);
      for (const s of [-1, 1] as Side[]) k.armBox(s, 0.4, new THREE.Vector3(0.07, 0.006, 0.05), DETAIL);
      for (const s of [-1, 1]) k.slab(k.rowsX(s * 0.05, s * 0.13, 1.2, 1.205), DETAIL, { h: 0.003, cols: 1, walls: null });
    },
  },
  termicaMontanha: {
    hem: 0.9,
    sleeve: 2,
    fit: FIT.tight,
    neck: 'stand',
    collar: PRIMARY,
    zip: SECONDARY,
    band: RIB,
    bandH: 0.025,
    cuff: 'rib',
    cuffPaint: SECONDARY,
    segments: 12,
    // Side panels down from the armpits and under the arms, a band across the chest.
    ts: [1.255],
    body: (y, a) => (sideness(a) > 0.9 || (y > 1.255 && y < 1.29) ? SECONDARY : PRIMARY),
    armTs: [0.52],
    arm: (t, a, s) => (angDist(a, armOuter(s) + Math.PI) < deg(50) || (t > 0.45 && t < 0.52) ? SECONDARY : PRIMARY),
    extra: (k) => zipper(k, 1.3, 1.455, SECONDARY),
  },
  anorak: {
    ...HOODIE,
    band: SECONDARY,
    bandH: 0.03,
    cuff: 'elastic',
    cuffPaint: SECONDARY,
    bunch: false,
    hood: { kind: 'down', lining: SECONDARY },
    extra: (k) => {
      // Half zip, the big chest pocket with a flap.
      zipper(k, 1.3, 1.455, DETAIL);
      k.slab(k.rowsX(-0.13, 0.13, 1.08, 1.25, false, 0.2), PRIMARY, { h: 0.006, cols: 2, walls: { t: darker(PRIMARY, 4) } });
      k.slab(k.rowsX(-0.135, 0.135, 1.235, 1.29), SECONDARY, { h: 0.011, cols: 2, walls: darker(SECONDARY, 1) });
    },
  },
  puloverMilitar: {
    ...SWEAT,
    neck: 'roll',
    collar: PRIMARY,
    band: PRIMARY,
    bandH: 0.06,
    cuffPaint: PRIMARY,
    flare: 0.006,
    segments: 12,
    // Commando sweater: rib knit, patches on the shoulders and the elbows, a pen pocket on the sleeve.
    ts: [1.36],
    body: (y, a) => (y > 1.36 && sideness(a) > 0.5 ? SECONDARY : column(a, 12) % 2 ? darker(PRIMARY, 1) : PRIMARY),
    bump: ribBump(12, 0.035),
    // (The patches end on the sleeve's own rings: 0.2 on the shoulder, 0.7 and the forearm's 0.35 at the elbow.)
    arm: (t, a, s) => ((t < 0.2 && angDist(a, armOuter(s)) < deg(100)) || onElbow(t, a, 0.7, 1.35, 50) ? SECONDARY : armStep(a, 8) % 2 ? darker(PRIMARY, 1) : PRIMARY),
    armBump: (t, a, s) => ((t < 0.2 && angDist(a, armOuter(s)) < deg(100)) || onElbow(t, a, 0.7, 1.35, 50) ? 0.004 : 0),
    extra: (k) => k.armBox(-1, 0.45, new THREE.Vector3(0.05, 0.007, 0.035), SECONDARY),
  },
  sueterHoquei: {
    ...SWEAT,
    hem: 0.875,
    neck: 'v',
    collar: SECONDARY,
    v: { y: 1.4, half: deg(18), fill: SKIN, trim: SECONDARY },
    band: SECONDARY,
    bandH: 0.04,
    cuffPaint: SECONDARY,
    flare: 0.014,
    // Wide stripes around the body and the upper arms (on the knit's own rings), a crest on the chest.
    body: (y) => (y > 0.99 && y < 1.11 ? SECONDARY : PRIMARY),
    armTs: [0.6],
    arm: (t) => (t > 0.45 && t < 0.6 ? SECONDARY : PRIMARY),
    extra: (k) => {
      const cy = 1.27;
      const r = 0.055;
      k.slab(
        Array.from({ length: 4 }, (_, i): Row => {
          const y = cy - r + (2 * r * i) / 3;
          const hw = Math.sqrt(Math.max(r * r - (y - cy) ** 2, (r * 0.45) ** 2));
          return [y, k.angX(-hw, y), k.angX(hw, y)];
        }),
        SECONDARY,
        { h: 0.004 },
      );
      k.patch(
        [
          [cy - r * 0.5, k.angX(-r * 0.45, cy), k.angX(r * 0.45, cy)],
          [cy + r * 0.45, k.angX(-r * 0.15, cy), k.angX(r * 0.15, cy)],
        ],
        PRIMARY,
        { off: 0.0085 },
      );
    },
  },
  golaCanoa: {
    hem: 0.92,
    top: 1.385,
    sleeve: 2,
    sleeveFrom: 0.3,
    fit: FIT.regular,
    neck: 'boat',
    collar: darker(PRIMARY, 1),
    band: RIB,
    bandH: 0.03,
    cuff: 'rib',
    cuffPaint: RIB,
    flare: 0.01,
    shade: (_y, a) => (column(a, 10) % 2 ? 0.25 : -0.25),
  },
  ciganinha: {
    hem: 0.93,
    top: 1.385,
    sleeve: 0.62,
    sleeveFrom: 0.3,
    fit: FIT.regular,
    neck: 'boat',
    collar: SECONDARY,
    band: SECONDARY,
    cuff: 'roll',
    cuffPaint: SECONDARY,
    // Puffed short sleeves.
    armFlare: (t) => 0.022 * Math.sin(Math.min(1, Math.max(0, (t - 0.3) / 0.32)) * Math.PI * 0.85),
    extra: (k) => flounce(k, 1.385, PRIMARY, SECONDARY),
  },
  poncho: {
    hem: 0.96,
    sleeve: 0,
    fit: FIT.heavy,
    neck: 'cowl',
    collar: SECONDARY,
    band: DETAIL,
    bandH: 0.03,
    bandOut: 0.03,
    segments: 12,
    // Widening down from the shoulders; the capes over the upper arms make the rest of its width (the arms come
    // forward to aim: a cone wide enough to cover them hanging would let them through).
    drape: (y) => 0.07 * Math.pow(Math.max(0, (1.41 - y) / 0.45), 0.75),
    // Woven stripes (the upper one on the knit's own rows).
    ts: [1.05, 1.08],
    body: (y) => ((y > 1.05 && y < 1.08) || (y > 1.255 && y < 1.29) ? SECONDARY : y > 1.08 && y < 1.11 ? DETAIL : PRIMARY),
    shade: (y, a) => 0.35 * Math.sin(a * 6 + y * 4),
    cape: { t1: 0.64, flare: 0.05 },
    arm: (t) => (t > 0.25 && t < 0.5 ? SECONDARY : PRIMARY),
    extra: (k) => hemFringe(k, DETAIL, 16),
  },
  ciclista: {
    hem: 0.92,
    sleeve: 0.5,
    fit: FIT.skin + 0.003,
    neck: 'stand',
    collar: PRIMARY,
    band: SECONDARY,
    bandH: 0.03,
    cuff: 'band',
    cuffPaint: DETAIL,
    segments: 12,
    // Side panels, a band across the chest, the full zip; three pockets on the lower back.
    ts: [1.22, 1.27],
    body: (y, a) => (sideness(a) > 0.85 ? SECONDARY : y > 1.22 && y < 1.27 ? DETAIL : PRIMARY),
    arm: (_t, a, s) => (angDist(a, armOuter(s) + Math.PI) < deg(60) ? SECONDARY : PRIMARY),
    extra: (k) => {
      zipper(k, k.hem, 1.455, DETAIL);
      const ws = [-0.13, -0.045, 0.045, 0.13];
      for (let i = 0; i < 3; i++) k.slab(k.rowsX(ws[i] + 0.003, ws[i + 1] - 0.003, 1.04, 1.13, true, 0.1), PRIMARY, { h: 0.006, cols: 1, walls: { t: darker(PRIMARY, 4) } });
    },
  },
  agasalho: {
    ...SWEAT,
    hem: 0.9,
    neck: 'stand',
    collar: SECONDARY,
    band: SECONDARY,
    bandH: 0.04,
    cuffPaint: SECONDARY,
    armSegments: 10,
    // Two stripes down the outside of the sleeves, a panel down each side.
    body: (_y, a) => (sideness(a) > 0.9 ? SECONDARY : PRIMARY),
    arm: (_t, a, s) => (Math.abs(angDist(a, armOuter(s)) - deg(36)) < deg(5) ? SECONDARY : PRIMARY),
    extra: (k) => {
      zipper(k, k.hem, 1.452, DETAIL);
      for (const s of [-1, 1]) k.slab(k.rowsX(s * 0.08, s * 0.085, 0.96, 1.07, false, 0.11), DETAIL, { h: 0.003, cols: 1, walls: null });
    },
  },
  goleiro: {
    ...SWEAT,
    hem: 0.88,
    collar: SECONDARY,
    band: SECONDARY,
    bandH: 0.03,
    cuffPaint: SECONDARY,
    flare: 0.014,
    bunch: false,
    segments: 12,
    // Raglan shoulders and a wide band across the chest, padded elbows, the number on the back.
    ts: [1.19, 1.25],
    body: (y, a) => (raglan(y, a) || (y > 1.19 && y < 1.25) ? SECONDARY : PRIMARY),
    arm: (t, a) => (t < 0.45 || onElbow(t, a, 0.88, 1.12, 62) ? SECONDARY : PRIMARY),
    armBump: (t, a) => (onElbow(t, a, 0.88, 1.12, 62) ? 0.009 : 0),
    extra: (k) => {
      // The number 1 on the back, centered.
      k.rect(-0.013, 0.013, 1.0, 1.16, SECONDARY, true, 0.004);
      k.rect(0.013, 0.04, 1.13, 1.16, SECONDARY, true, 0.004);
    },
  },
  tunica: {
    ...SWEAT,
    hem: 0.94,
    collar: SECONDARY,
    band: null,
    blouse: 0,
    cuff: 'band',
    cuffPaint: SECONDARY,
    bunch: false,
    flare: 0.028,
    skirt: { top: 1.0, bottom: 0.62, flare: 0.045, segments: 8 },
    extra: (k) => {
      // A slit at the neck with an embroidered edge, a rope belt with its ends hanging.
      k.opening(1.38, 1.462, FRONT, (y) => Math.max(0.03, deg(9) * ((y - 1.38) / 0.082)), SKIN, SECONDARY, 2);
      torsoBand(k, 0.975, 1.015, 0.008, SECONDARY, 8);
      for (const s of [-1, 1]) k.stud(0.95, k.angX(s * 0.012 + 0.05, 0.95), 0.004, SECONDARY, 0.014, 0.035);
    },
  },
  remendos: {
    ...SWEAT,
    collar: RIB,
    shade: (y, a) => (rowBand(y) % 2 ? 0.2 : -0.2) + (column(a, 10) % 2 ? 0.15 : -0.15),
    // Elbow patches, darns on the body.
    armTs: [0.8],
    foreTs: [0.25],
    arm: (t, a) => (onElbow(t, a) ? SECONDARY : PRIMARY),
    armBump: (t, a) => (onElbow(t, a) ? 0.004 : 0),
    extra: (k) => {
      k.slab(k.rowsX(0.04, 0.115, 1.02, 1.1, false, 0.08), SECONDARY, { h: 0.004, walls: darker(SECONDARY, 2) });
      k.slab(k.rowsX(-0.12, -0.06, 1.26, 1.32, false, 0.06), darker(SECONDARY, 1), { h: 0.004, walls: darker(SECONDARY, 3) });
      k.slab(k.rowsX(-0.05, 0.03, 1.15, 1.22, true, 0.07), SECONDARY, { h: 0.004, walls: darker(SECONDARY, 2) });
    },
  },
  balaclavaMoletom: {
    ...HOODIE,
    neck: 'none',
    hood: { kind: 'up', mask: SECONDARY },
  },
};
