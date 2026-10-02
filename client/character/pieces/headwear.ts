// Headwear and face pieces (catalog "cabeca" and the face and ear part of "acessorio"): caps, hats, helmets,
// ear pieces, wraps, glasses, masks, earrings and piercings. They are rigid items built in character space over
// the head they sit on (body.ts `headShape`, so they fit both faces) and moved into the head bone's space;
// wraps that go down the neck (shemagh, balaclava) add a skinned part on the neck.
//
// Most shapes are lofts: rings around the head (on its surface pushed out, or free ovals) joined in order. The
// profile is walked from the inside bottom outward and up (under a brim, its edge, over it, up the crown), so
// every face looks out by construction, and edges are modeled bands (style guide: no paper-thin edges).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { Generator, PieceGeometry } from '.';
import { BodyParts, headShape, SHAPES, type HeadShape } from '../body';
import { FacetBuilder, lodSegments, M, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, type Paint } from '../palette';
import { lock, strand } from './common';
import { toHeadSpace } from './rigid';

const deg = (d: number) => (d * Math.PI) / 180;
const FRONT = Math.PI / 2;
const BACK = -Math.PI / 2;
const HW: Weights = [['head', 1]];
const UP = new THREE.Vector3(0, 1, 0);
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
/** Angle from the front of the face (0..π). */
const fromFront = (a: number) => angDist(a, FRONT);
/** 0 at the front of the head, 1 at the back. */
const backness = (a: number) => (1 - Math.sin(a)) / 2;
/** 1 over the ears, 0 at the front and the back. */
const sideness = (a: number) => Math.cos(a) ** 2;
/** Where the ears are on the head surface (a little behind the side, like body.ts): s = -1 left, 1 right. */
const earAngle = (s: number) => (s > 0 ? deg(186) : deg(-6));

type Num = number | ((a: number) => number);
const val = (v: Num, a: number) => (typeof v === 'number' ? v : v(a));
/** A ring around the head: the point at angle a (a = 90° is the front, a = 0 the wearer's left, -X). */
type Ring = (a: number) => THREE.Vector3;
/** Paint of a loft face: band j (between rings j and j + 1), its middle angle and height, its column. */
type PaintFn = (j: number, a: number, y: number, i: number) => Paint;

interface LoftOptions {
  cols?: number;
  /** First angle; with `arc`, an open strip from `a0` over `arc` radians. */
  a0?: number;
  arc?: number;
  /** Closes the last ring on this point (a crown). */
  pole?: THREE.Vector3;
  shade?: (j: number, a: number) => number;
  /** Faces left open (eye holes, a cap's strap opening). */
  skip?: (j: number, a: number, y: number) => boolean;
  /** Open strips: close both ends with the profile polygon (the profile must be a closed, convex walk). */
  ends?: Paint;
}

/** A builder for one head item: the head shape, lofts, bills, parts placed on the surface. */
class HeadKit {
  readonly b: FacetBuilder;
  readonly h: HeadShape;
  readonly fem: boolean;
  constructor(
    readonly sex: Sex,
    seed: number,
  ) {
    this.b = new FacetBuilder(seed);
    this.h = headShape(sex);
    this.fem = sex === 'f';
  }

  /** Ring on the head surface at height y(a), pushed d(a) out. */
  on(y: Num, d: Num): Ring {
    return (a) => this.h.point(val(y, a), a, val(d, a));
  }

  /** Free oval around the head's axis: half width, half depth in front and behind, a radius factor per angle. */
  oval(y: Num, rx: number, rzF: number, rzB = rzF, o: { cx?: number; cz?: number; k?: (a: number) => number } = {}): Ring {
    return (a) => {
      const k = o.k ? o.k(a) : 1;
      const s = Math.sin(a);
      return new THREE.Vector3((o.cx ?? 0) - Math.cos(a) * rx * k, val(y, a), (o.cz ?? 0.006) - s * (s > 0 ? rzF : rzB) * k);
    };
  }

  /** Rows of a dome over the skull from edge(a) up to `top`, d(y, a) out (`bias` packs rows near the crown). */
  dome(edge: Num, d: (y: number, a: number) => number, rows = 5, top = 1.79, bias = 1.4): Ring[] {
    return Array.from({ length: rows + 1 }, (_, r) => (a: number) => {
      const y = lerp(val(edge, a), top, 1 - Math.pow(1 - r / rows, bias));
      return this.h.point(y, a, 0).addScaledVector(this.out(y, a), d(y, a));
    });
  }

  /**
   * Outward direction for shells: the surface normal low on the head, turning toward the skull's center near
   * the crown (the head's table ends in a short cylinder under the crown point, whose normal is flat), so
   * thick shells stay round on top instead of ending in a cone.
   */
  out(y: number, a: number) {
    const n = this.h.normal(y, a);
    const radial = this.h.point(y, a).sub(new THREE.Vector3(0, 1.665, 0.006)).normalize();
    return n.lerp(radial, smooth(y, 1.72, 1.78)).normalize();
  }

  /** The pole over the crown of a dome `d` out. */
  crown(d: number, z = 0.012) {
    return new THREE.Vector3(0, this.h.y1 + d + 0.004, z);
  }

  /** Point on the face at horizontal position x (+X = the wearer's right) and height y, d out (like body.ts). */
  face(x: number, y: number, d: number) {
    return this.h.meshPoint(y, FRONT + Math.asin(THREE.MathUtils.clamp(x / 0.082, -0.95, 0.95)), d);
  }

  /** Joins rings in order (see the header): quads between consecutive rings, an optional pole and ends. */
  loft(rings: Ring[], paint: Paint | PaintFn, o: LoftOptions = {}) {
    const b = this.b;
    const closed = o.arc === undefined;
    // Far LOD: ¾ of the columns (only at 2: fewer columns up close would let the head through thin shells).
    const cols = b.lod >= 2 ? lodSegments(o.cols ?? 14, 1) : (o.cols ?? 14);
    const arc = o.arc ?? Math.PI * 2;
    const a0 = o.a0 ?? FRONT;
    const n = closed ? cols : cols + 1;
    const paintOf: PaintFn = typeof paint === 'function' ? paint : () => paint;
    const angles = Array.from({ length: n }, (_, i) => a0 + (i / cols) * arc);
    const pts = rings.map((r) => angles.map((a) => r(a)));
    const ids = pts.map((row) => row.map((p) => b.vertex(p, HW)));
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < cols; i++) {
        const i1 = closed ? (i + 1) % cols : i + 1;
        const aMid = a0 + ((i + 0.5) / cols) * arc;
        const yMid = (pts[j][i].y + pts[j][i1].y + pts[j + 1][i].y + pts[j + 1][i1].y) / 4;
        if (o.skip?.(j, aMid, yMid)) continue;
        b.quad(ids[j][i], ids[j + 1][i], ids[j + 1][i1], ids[j][i1], paintOf(j, aMid, yMid, i), 'none', o.shade?.(j, aMid) ?? 0);
      }
    }
    if (o.pole) {
      const top = ids[ids.length - 1];
      const pole = b.vertex(o.pole, HW);
      for (let i = 0; i < cols; i++) {
        const i1 = closed ? (i + 1) % cols : i + 1;
        b.tri(top[i], pole, top[i1], paintOf(rings.length - 1, a0 + ((i + 0.5) / cols) * arc, o.pole.y, i), 'none');
      }
    }
    if (!closed && o.ends !== undefined) {
      const lat = (a: number) => new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
      b.poly(
        pts.map((r) => r[0]),
        HW,
        'none',
        o.ends,
        { facing: lat(a0).negate() },
      );
      b.poly(
        pts.map((r) => r[n - 1]),
        HW,
        'none',
        o.ends,
        { facing: lat(a0 + arc) },
      );
    }
    return pts;
  }

  /** A flat face (any winding: it is turned to face `facing`). */
  quad(pts: THREE.Vector3[], paint: Paint, facing: THREE.Vector3, shade = 0) {
    this.b.poly(pts, HW, 'none', paint, { facing, shade });
  }

  /** Any three.js part placed by a matrix in character space. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint) {
    this.b.append(geo, m, HW, 'none', paint);
  }

  /** A matrix at p whose local +Z is `n` (parts lying on a surface: boxes, discs, cups). */
  at(p: THREE.Vector3, n: THREE.Vector3, sx = 1, sy = 1, sz = 1) {
    const up = Math.abs(n.dot(UP)) > 0.98 ? new THREE.Vector3(0, 0, -1) : UP;
    return new THREE.Matrix4().lookAt(p.clone().add(n), p, up).setPosition(p).scale(new THREE.Vector3(sx, sy, sz));
  }

  /** A box lying on the head surface at (y, a), `d` out (patches, rails, mounts). */
  plate(y: number, a: number, d: number, w: number, hgt: number, t: number, paint: Paint) {
    const p = this.h.point(y, a, d + t / 2);
    this.add(new THREE.BoxGeometry(w, hgt, t), this.at(p, this.h.normal(y, a)), paint);
  }

  /** A small flat square on the head surface at (y, a), `d` out (holes, rivets painted as faces). */
  dot(y: number, a: number, d: number, half: number, paint: Paint) {
    const p = this.h.point(y, a, d);
    const n = this.h.normal(y, a);
    const t = new THREE.Vector3().crossVectors(UP, n).normalize();
    const u = new THREE.Vector3().crossVectors(n, t).normalize();
    const c = (x: number, z: number) => p.clone().addScaledVector(t, x * half).addScaledVector(u, z * half);
    this.quad([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)], paint, n);
  }

  /** A cylinder whose axis is `n`, centered at p. */
  cyl(p: THREE.Vector3, n: THREE.Vector3, r0: number, r1: number, len: number, seg: number, paint: Paint) {
    // Cylinders stand on Y: lay the axis on +Z (r0 toward -n, r1 toward +n).
    const g = new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2);
    this.add(g, this.at(p, n), paint);
  }

  /**
   * A bill (cap peaks, visors): a plate with thickness from the crown at (y, angle aC) outward, its root
   * following the head, straight further out, rounded at the tip; `droop` lowers the tip, `bend` the sides.
   */
  bill(aC: number, y: number, d: number, o: { half: number; len: number; width: number; droop?: number; bend?: number; thick?: number; top?: Paint; under?: Paint; cols?: number }) {
    const out = new THREE.Vector3(-Math.cos(aC), 0, -Math.sin(aC));
    const lat = new THREE.Vector3(Math.sin(aC), 0, -Math.cos(aC));
    const cols = o.cols ?? 6;
    const rows = 2;
    const th = (o.thick ?? 0.008) / 2;
    const root = (u: number) => this.h.point(y, aC + u * o.half, d);
    const r0 = root(0);
    const rootHalf = root(1).distanceTo(root(-1)) / 2;
    const grid: THREE.Vector3[][] = [];
    for (let r = 0; r <= rows; r++) {
      const k = r / rows;
      const line: THREE.Vector3[] = [];
      for (let i = 0; i <= cols; i++) {
        const u = (i / cols) * 2 - 1;
        const straight = r0
          .clone()
          .addScaledVector(out, o.len * k * (1 - 0.32 * u * u))
          .addScaledVector(lat, u * lerp(rootHalf, o.width / 2, k));
        straight.y = y - (o.droop ?? 0) * k - (o.bend ?? 0) * u * u * k;
        line.push(root(u).lerp(straight, k));
      }
      grid.push(line);
    }
    const top = o.top ?? SECONDARY;
    const under = o.under ?? darker(top, 2);
    const up = (p: THREE.Vector3) => p.clone().setY(p.y + th);
    const dn = (p: THREE.Vector3) => p.clone().setY(p.y - th);
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const q = [grid[r][i], grid[r][i + 1], grid[r + 1][i + 1], grid[r + 1][i]];
        this.quad(q.map(up), top, UP);
        this.quad(q.map(dn), under, UP.clone().negate(), -1);
      }
    }
    // Thickness: the outer edge and the two sides.
    const edge = grid[rows];
    for (let i = 0; i < cols; i++) {
      const dir = out.clone().addScaledVector(lat, ((i + 0.5) / cols) * 2 - 1);
      this.quad([up(edge[i]), up(edge[i + 1]), dn(edge[i + 1]), dn(edge[i])], top, dir, -0.5);
    }
    for (let r = 0; r < rows; r++) {
      this.quad([up(grid[r][0]), up(grid[r + 1][0]), dn(grid[r + 1][0]), dn(grid[r][0])], top, lat.clone().negate(), -0.5);
      this.quad([up(grid[r][cols]), up(grid[r + 1][cols]), dn(grid[r + 1][cols]), dn(grid[r][cols])], top, lat, -0.5);
    }
  }

  /** A cord along points (straps, chin cords, loops). */
  cord(pts: THREE.Vector3[], r: number, paint: Paint, sides = 4) {
    strand(this.b, pts, () => r, paint, 'none', { sides, tip: false });
  }

  /** Chin straps: from (y0, f0 from the front) on each side, down the cheeks to under the chin. */
  chinStrap(y0: number, f0: number, paint: Paint, r = 0.0035) {
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        pts.push(this.h.point(lerp(y0, 1.55, t), FRONT + s * lerp(f0, deg(14), t * t), 0.008));
      }
      pts.push(this.h.point(1.538, FRONT, 0.012));
      this.cord(pts, r, paint);
    }
  }

  /** An ear cup over each ear: pad, cup; returns the outer centers and the outward directions. */
  earCups(r: number, depth: number, cup: Paint, pad: Paint, seg = 8) {
    return [-1, 1].map((s) => {
      const a = earAngle(s);
      const base = this.h.point(1.648, a, 0);
      const n = this.h.normal(1.648, a);
      const padT = 0.012;
      this.cyl(base.clone().addScaledVector(n, 0.008 + padT / 2), n, r * 1.02, r * 1.02, padT, seg, pad);
      this.cyl(base.clone().addScaledVector(n, 0.008 + padT + depth / 2), n, r, r * 0.9, depth, seg, cup);
      return { s, c: base.clone().addScaledVector(n, 0.008 + padT + depth / 2), n, out: 0.008 + padT + depth };
    });
  }

  /** A band over the head between two points (headsets): an arch up to `top`, flat across. */
  arch(left: THREE.Vector3, right: THREE.Vector3, top: number, r: number, paint: Paint, dz = 0) {
    const rx = (right.x - left.x) / 2;
    const y0 = (left.y + right.y) / 2;
    const z = (left.z + right.z) / 2 + dz;
    const pts = Array.from({ length: 9 }, (_, k) => {
      const t = (k / 8) * Math.PI;
      return new THREE.Vector3(-Math.cos(t) * rx, y0 + (top - y0) * Math.sin(t), z);
    });
    strand(this.b, pts, () => r, paint, 'none', { sides: 4, tip: false, flatten: 0.45 });
  }

  done(skinned?: THREE.BufferGeometry): PieceGeometry {
    return { rigid: toHeadSpace(this.b, this.sex), skinned };
  }
}

// --- Caps and knit hats --------------------------------------------------------------------------------------

/** Caps: a crown of panels and a bill; `back` turns it around (strap opening at the forehead). */
function cap(k: HeadKit, o: { flatBill?: boolean; back?: boolean; tactical?: boolean }) {
  const edge = (a: number) => 1.712 - 0.02 * backness(a);
  // Flat-brim caps have a tall structured front panel.
  const d = (y: number, a: number) => 0.025 + (y - 1.7) * 0.04 + (o.flatBill ? 0.018 * Math.max(0, Math.sin(a)) ** 2 * smooth(y, 1.71, 1.77) : 0);
  const cols = 14;
  // Panel seams: 6 panels, a darker line every other column on the upper rows.
  const seam = (j: number, i: number) => j >= 3 && i % 2 === 1 && !o.tactical;
  k.loft([k.on(edge, 0.006), k.on((a) => edge(a) - 0.002, (a) => d(edge(a), a) + 0.004), ...k.dome((a) => edge(a) + 0.006, d, 4, 1.79, 1.3)], (j, _a, _y, i) => (seam(j, i) ? darker(PRIMARY, 1) : PRIMARY), {
    cols,
    pole: k.crown(d(1.79, FRONT)),
    // Backwards: the strap opening shows at the forehead.
    skip: (j, a) => !!o.back && j === 2 && fromFront(a) < deg(26),
  });
  const billA = o.back ? BACK : FRONT;
  const by = edge(billA) + 0.004;
  k.bill(billA, by, d(by, billA), {
    half: deg(o.flatBill ? 50 : 46),
    len: o.flatBill ? 0.09 : 0.075,
    width: o.flatBill ? 0.19 : 0.16,
    droop: o.flatBill ? 0 : o.back ? 0.012 : 0.016,
    bend: o.flatBill ? 0 : 0.016,
    thick: 0.008,
    top: o.flatBill ? PRIMARY : SECONDARY,
    under: o.flatBill ? SECONDARY : darker(SECONDARY, 2),
  });
  // Button on top.
  k.add(new THREE.CylinderGeometry(0.011, 0.013, 0.008, 6), M(0, k.crown(d(1.79, FRONT)).y + 0.002, 0.012), SECONDARY);
  if (o.back) {
    // The strap across the opening, with its buckle.
    const y = edge(FRONT) + 0.016;
    k.plate(y, FRONT, d(y, FRONT), 0.07, 0.01, 0.004, SECONDARY);
    k.plate(y, FRONT, d(y, FRONT) + 0.004, 0.016, 0.014, 0.004, fixed('steel'));
  }
  if (o.tactical) {
    // Velcro patch on the front panel, a flag in the detail color with a darker border.
    k.plate(1.748, FRONT, d(1.748, FRONT), 0.064, 0.04, 0.004, darker(PRIMARY, 2));
    k.plate(1.748, FRONT, d(1.748, FRONT) + 0.003, 0.054, 0.03, 0.004, DETAIL);
  }
}

/** Wool beanie: a slouchy knit shell (a little loose at the back) and a ribbed folded cuff. */
function woolBeanie(k: HeadKit) {
  const cols = 14;
  const d = (y: number, a: number) => 0.022 + (y - 1.7) * 0.09 + 0.014 * backness(a) * smooth(y, 1.72, 1.79);
  k.loft(k.dome(1.7, d, 4, 1.79, 1.3), PRIMARY, { cols, pole: k.crown(0.034, 0.024).setY(1.85) });
  // Cuff: ribs as alternating faces, a band on each edge; above the brows in front, lower at the back.
  const cy0 = (a: number) => 1.704 - 0.04 * backness(a);
  const cy1 = (a: number) => cy0(a) + 0.044;
  k.loft([k.on(cy0, 0.008), k.on(cy0, 0.032), k.on(cy1, 0.034), k.on(cy1, 0.02)], (_j, _a, _y, i) => (i % 2 ? darker(SECONDARY, 1) : SECONDARY), { cols });
}

/** Skullcap: a tight shell down to the ears, seams every third column. */
function skullcap(k: HeadKit) {
  const edge = (a: number) => 1.704 - 0.045 * backness(a) ** 1.5;
  // Thick enough low down to cover fringes and the tops of hair curtains under it, thin over the crown.
  const d = (y: number) => 0.024 - 0.01 * smooth(y, 1.75, 1.79);
  k.loft([k.on(edge, 0.004), k.on((a) => edge(a) - 0.002, 0.028), ...k.dome((a) => edge(a) + 0.006, d, 4, 1.79, 1.4)], (j, _a, _y, i) => (j >= 2 && i % 3 === 0 ? darker(PRIMARY, 1) : PRIMARY), {
    cols: 12,
    pole: k.crown(0.014),
  });
}

// --- Brimmed hats --------------------------------------------------------------------------------------------

interface BrimSpec {
  /** The hat line on the head. */
  band: (a: number) => number;
  /** Brim: half width, front and back reach, height of its edge over the band (per angle), thickness. */
  rx: number;
  rzF: number;
  rzB: number;
  lift: (a: number) => number;
  /** How much of the lift is already there halfway out (0.5 straight, lower: curled at the edge). */
  curl: number;
  thick: number;
  /** Crown: half width and depths at the base, top height, the top ring's radius factor, the pole height. */
  crown: [number, number, number];
  top: number;
  k?: (a: number) => number;
  pole: number;
  /** Band height (secondary color) over the brim. */
  bandH: number;
  /** Band paint per column (loops of a boonie). */
  bandPaint?: (i: number) => Paint;
  cols?: number;
}

/** A hat with a brim: under the brim, its edge, over it, the band, the crown and a pole (creases). */
function brimmed(k: HeadKit, s: BrimSpec) {
  const [cx, cf, cb] = s.crown;
  const mid = 0.55;
  const midR = (r: number, c: number) => lerp(c, r, mid);
  const yb = (f: number) => (a: number) => s.band(a) + s.lift(a) * f;
  const rings: Ring[] = [
    k.on(s.band, 0.006),
    k.oval(yb(s.curl), midR(s.rx, cx), midR(s.rzF, cf), midR(s.rzB, cb)),
    k.oval(yb(1), s.rx, s.rzF, s.rzB),
    k.oval((a) => yb(1)(a) + s.thick, s.rx, s.rzF, s.rzB),
    k.oval((a) => yb(s.curl)(a) + s.thick, midR(s.rx, cx), midR(s.rzF, cf), midR(s.rzB, cb)),
    k.oval((a) => s.band(a) + s.thick + 0.002, cx, cf, cb),
    k.oval((a) => s.band(a) + s.thick + s.bandH, cx * 0.995, cf * 0.995, cb * 0.995),
    k.oval((a) => lerp(s.band(a) + s.thick + s.bandH, s.top, 0.5), cx * 0.965, cf * 0.965, cb * 0.965),
    k.oval(s.top, cx * 0.89, cf * 0.89, cb * 0.89, { k: s.k }),
  ];
  k.loft(rings, (j, _a, _y, i) => (j === 5 ? (s.bandPaint ? s.bandPaint(i) : SECONDARY) : PRIMARY), {
    cols: s.cols ?? 14,
    pole: new THREE.Vector3(0, s.pole, 0.006),
    // The underside of the brim a little darker (the gradient does the rest), the band's edge in shadow.
    shade: (j) => (j <= 1 ? -0.6 : 0),
  });
}

const BUCKET: BrimSpec = {
  band: (a) => 1.712 - 0.018 * backness(a),
  rx: 0.14,
  rzF: 0.162,
  rzB: 0.162,
  lift: () => -0.042,
  curl: 0.5,
  thick: 0.008,
  crown: [0.1, 0.124, 0.122],
  top: 1.8,
  pole: 1.806,
  bandH: 0.012,
};

// --- Helmets -------------------------------------------------------------------------------------------------

/** A lower edge per angle: `front` up to fs from the front, down to `side` at fe, then to `back`. */
const edgeOf = (front: number, side: number, back: number, fs = deg(35), fe = deg(95)) => (a: number) => {
  const f = fromFront(a);
  return f < fs ? front : f < fe ? lerp(front, side, smooth(f, fs, fe)) : lerp(side, back, smooth(f, fe, Math.PI));
};

/** A helmet shell: lining, a lip with thickness, the dome rows and the pole. */
function shell(k: HeadKit, edge: (a: number) => number, d: (y: number, a: number) => number, paint: PaintFn, o: { lip?: number; rows?: number; cols?: number; skip?: LoftOptions['skip'] } = {}) {
  const lip = o.lip ?? 0.006;
  return k.loft(
    [
      k.on(edge, 0.006),
      k.on((a) => edge(a) - 0.003, (a) => d(edge(a), a) + lip),
      k.on((a) => edge(a) + 0.007, (a) => d(edge(a), a) + lip),
      ...k.dome((a) => edge(a) + 0.014, d, o.rows ?? 5, 1.79, 1.35),
    ],
    paint,
    { cols: o.cols ?? 16, pole: k.crown(d(1.79, FRONT)), skip: o.skip },
  );
}

/** Tactical (high cut) helmet: above the ears, side rails, the night-vision shroud, velcro on top. */
function tacticalHelmet(k: HeadKit, nvg: boolean) {
  const edge = (a: number) => {
    const f = fromFront(a);
    // Cut high over the ears, down at the back.
    return f < deg(40) ? 1.712 : f < deg(115) ? lerp(1.712, 1.694, smooth(f, deg(40), deg(75))) : lerp(1.694, 1.635, smooth(f, deg(115), deg(165)));
  };
  const d = (y: number) => 0.03 + (y > 1.76 ? 0.002 : 0);
  shell(k, edge, d, (j) => (j === 0 ? darker(SECONDARY, 1) : PRIMARY), { cols: nvg ? 12 : 14, rows: nvg ? 4 : 5 });
  // Side rails (two blocks each side) and the shroud at the front.
  for (const s of [-1, 1]) {
    for (const off of nvg ? [0] : [-1, 1]) {
      const a = FRONT + s * deg(nvg ? 88 : 88 + off * 14);
      k.plate(1.708, a, 0.03, nvg ? 0.05 : 0.03, 0.016, 0.01, SECONDARY);
    }
  }
  k.plate(1.738, FRONT, 0.03, 0.044, 0.03, 0.012, DETAIL);
  k.plate(1.778, FRONT, 0.032, 0.07, 0.045, 0.003, SECONDARY);
  if (!nvg) k.plate(1.735, BACK, 0.03, 0.06, 0.04, 0.003, SECONDARY);
  k.chinStrap(1.7, deg(80), SECONDARY, nvg ? 0.003 : 0.0035);
  if (nvg) {
    // Night vision flipped down: an arm from the shroud, a bridge, two tubes in front of the eyes.
    const zf = k.h.point(1.672, FRONT, 0).z;
    const mount = k.h.point(1.738, FRONT, 0.042);
    k.add(new THREE.BoxGeometry(0.02, 0.05, 0.016), M(0, mount.y - 0.022, mount.z - 0.012, -0.5, 0, 0), DETAIL);
    k.add(new THREE.BoxGeometry(0.08, 0.026, 0.034), M(0, 1.69, zf - 0.052), DETAIL);
    for (const s of [-1, 1]) {
      const c = new THREE.Vector3(s * 0.034, 1.674, zf - 0.07);
      k.cyl(c, new THREE.Vector3(0, 0, -1), 0.017, 0.015, 0.06, 6, DETAIL);
      k.cyl(c.clone().setZ(c.z - 0.031), new THREE.Vector3(0, 0, -1), 0.013, 0.013, 0.004, 6, fixed('lensDark'));
    }
  }
}

/** Full-face helmets (moto): a free egg around the head, the chin bar forward; `pilot` changes the details. */
function fullFace(k: HeadKit) {
  // Height, half width, front depth, back depth.
  const rows: [number, number, number, number][] = [
    [1.53, 0.094, 0.136, 0.112],
    [1.545, 0.1, 0.142, 0.12],
    [1.6, 0.116, 0.146, 0.132],
    [1.632, 0.12, 0.146, 0.136],
    [1.712, 0.118, 0.14, 0.134],
    [1.76, 0.106, 0.126, 0.124],
    [1.8, 0.08, 0.1, 0.1],
    [1.826, 0.044, 0.056, 0.058],
  ];
  const visor = (j: number, a: number) => j === 4 && fromFront(a) < deg(62);
  k.loft([k.oval(1.536, 0.064, 0.074, 0.066, { cz: 0 }), ...rows.map(([y, rx, rf, rb]) => k.oval(y, rx, rf, rb, { cz: 0.004 }))], (j, a) => {
    const f = fromFront(a);
    if (j === 0) return fixed('rubber');
    if (j === 1) return SECONDARY;
    if (visor(j, a)) return fixed('lensDark');
    // A trim around the visor and a stripe down the sides.
    if (j === 4 && f < deg(80)) return SECONDARY;
    if (j === 5 && f > deg(70) && f < deg(150)) return SECONDARY;
    return PRIMARY;
  }, { cols: 16, pole: new THREE.Vector3(0, 1.834, 0.006), shade: (j, a) => (visor(j, a) ? 0.6 : 0) });
  // Chin vent and the visor's pivots.
  k.add(new THREE.BoxGeometry(0.05, 0.022, 0.012), M(0, 1.575, -0.144 + 0.004, 0.25, 0, 0), DETAIL);
  for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 6), M(s * 0.12, 1.69, -0.04, 0, 0, Math.PI / 2), DETAIL);
}

// --- Headwear by id --------------------------------------------------------------------------------------------

function headwear(id: string, sex: Sex): PieceGeometry {
  const k = new HeadKit(sex, id.length * 71 + id.charCodeAt(0));
  const h = k.h;
  switch (id) {
    case 'boneReto':
      cap(k, { flatBill: true });
      break;
    case 'bonePraTras':
      cap(k, { back: true });
      break;
    case 'boneTatico':
      cap(k, { tactical: true });
      break;
    case 'gorroLa':
      woolBeanie(k);
      break;
    case 'touca':
      skullcap(k);
      break;

    case 'cauboi':
      // Cattleman: brim rolled up at the sides, dipping front and back; a tall crown pinched at the front
      // with a crease down the middle (the pole sits lower than the top ring).
      brimmed(k, {
        band: (a) => 1.71 - 0.016 * backness(a),
        rx: 0.19,
        rzF: 0.205,
        rzB: 0.195,
        lift: (a) => 0.05 * sideness(a) ** 1.5 - 0.012 * (1 - sideness(a)),
        curl: 0.22,
        thick: 0.01,
        crown: [0.098, 0.122, 0.118],
        top: 1.872,
        k: (a) => 1 - 0.18 * Math.max(0, Math.sin(a)) ** 2,
        pole: 1.848,
        bandH: 0.026,
      });
      break;
    case 'panama':
      brimmed(k, {
        band: (a) => 1.712 - 0.012 * backness(a),
        rx: 0.15,
        rzF: 0.17,
        rzB: 0.16,
        lift: (a) => -0.014 * Math.max(0, Math.sin(a)) + 0.006 * Math.max(0, -Math.sin(a)),
        curl: 0.5,
        thick: 0.008,
        crown: [0.098, 0.12, 0.118],
        top: 1.818,
        k: (a) => 1 - 0.1 * Math.max(0, Math.sin(a)),
        pole: 1.802,
        bandH: 0.03,
      });
      break;
    case 'fedora':
      // Snap brim: down at the front, up at the back; a teardrop crown with two pinches at the front.
      brimmed(k, {
        band: (a) => 1.712 - 0.012 * backness(a),
        rx: 0.145,
        rzF: 0.168,
        rzB: 0.155,
        lift: (a) => -0.022 * Math.max(0, Math.sin(a)) ** 1.5 + 0.02 * Math.max(0, -Math.sin(a)),
        curl: 0.45,
        thick: 0.008,
        crown: [0.097, 0.12, 0.118],
        top: 1.832,
        k: (a) => 1 - 0.2 * bell(fromFront(a), 0, deg(55)),
        pole: 1.81,
        bandH: 0.026,
      });
      break;
    case 'bucket':
      brimmed(k, BUCKET);
      break;
    case 'boonie':
      // Wide floppy brim, a webbing band of loops around the crown, a chin cord.
      brimmed(k, {
        ...BUCKET,
        rx: 0.172,
        rzF: 0.196,
        rzB: 0.196,
        lift: (a) => -0.048 + 0.008 * Math.sin(a * 5),
        curl: 0.55,
        bandH: 0.03,
        bandPaint: (i) => (i % 2 ? darker(SECONDARY, 2) : SECONDARY),
      });
      for (const s of [-1, 1]) {
        const a = FRONT + s * deg(90);
        k.cord([h.point(1.7, a, 0.026), h.point(1.62, FRONT + s * deg(84), 0.014), h.point(1.57, FRONT + s * deg(72), 0.012), h.point(1.545, FRONT + s * deg(40), 0.012), h.point(1.532, FRONT, 0.012)], 0.0028, SECONDARY, 3);
      }
      break;
    case 'pescadorOculos': {
      // Fisherman's bucket hat with swim goggles strapped around the crown.
      brimmed(k, { ...BUCKET, cols: 12 });
      const y0 = 1.754;
      const y1 = 1.772;
      const r = (y: number, out: number) => k.oval(y, 0.1 * 0.985 + out, 0.124 * 0.985 + out, 0.122 * 0.985 + out);
      k.loft([r(y0, 0), r(y0, 0.006), r(y1, 0.006), r(y1, 0)], SECONDARY, { cols: 12 });
      const zf = -0.124 * 0.985 + 0.006 - 0.006;
      for (const s of [-1, 1]) {
        const c = new THREE.Vector3(s * 0.033, (y0 + y1) / 2, zf - 0.008);
        const n = new THREE.Vector3(s * 0.25, 0.1, -1).normalize();
        k.cyl(c, n, 0.024, 0.022, 0.016, 7, DETAIL);
        k.cyl(c.clone().addScaledVector(n, 0.009), n, 0.018, 0.018, 0.003, 7, fixed('lensLight'));
      }
      k.add(new THREE.BoxGeometry(0.02, 0.006, 0.006), M(0, (y0 + y1) / 2, zf - 0.012), DETAIL);
      break;
    }

    case 'boina': {
      // Beret: a headband, then a soft disc wider than the head, slanting down to the right, a stem on top.
      const band = (a: number) => 1.702 - 0.014 * backness(a);
      const tilt = (a: number) => 0.02 * Math.cos(a);
      k.loft(
        [
          k.on(band, 0.006),
          k.on(band, 0.016),
          k.on((a) => band(a) + 0.014, 0.017),
          k.oval((a) => 1.748 + tilt(a), 0.112, 0.128, 0.124, { cx: 0.016 }),
          k.oval((a) => 1.768 + tilt(a), 0.118, 0.134, 0.13, { cx: 0.02 }),
          k.oval((a) => 1.79 + tilt(a) * 0.8, 0.084, 0.098, 0.096, { cx: 0.016 }),
        ],
        (j) => (j <= 1 ? darker(PRIMARY, 1) : PRIMARY),
        { cols: 14, pole: new THREE.Vector3(0.012, 1.804, 0.006) },
      );
      k.add(new THREE.CylinderGeometry(0.003, 0.005, 0.018, 4), M(0.012, 1.81, 0.006, 0, 0, -0.3), PRIMARY);
      break;
    }
    case 'bandanaCabeca': {
      // Tied over the head: a snug shell with a print of dots, the knot and two tails at the nape.
      const edge = (a: number) => 1.712 - 0.054 * backness(a) ** 1.3;
      const dot = (j: number, i: number) => (i * 5 + j * 3) % 7 === 0;
      k.loft([k.on(edge, 0.005), k.on((a) => edge(a) - 0.002, 0.027), ...k.dome((a) => edge(a) + 0.006, (y, a) => 0.022 - 0.008 * smooth(y, 1.75, 1.79) + 0.003 * Math.sin(a * 3 + y * 50), 4, 1.79, 1.4)], (j, _a, _y, i) => (j >= 2 && dot(j, i) ? SECONDARY : PRIMARY), {
        cols: 14,
        pole: k.crown(0.014),
      });
      const knot = h.point(1.66, BACK, 0.022);
      k.add(new THREE.SphereGeometry(1, 5, 3), new THREE.Matrix4().compose(knot, new THREE.Quaternion(), new THREE.Vector3(0.02, 0.016, 0.016)), PRIMARY);
      for (const s of [-1, 1]) lock(k.b, knot.clone().add(new THREE.Vector3(s * 0.008, -0.004, 0.006)), new THREE.Vector3(s * 0.35, -1, 0.3), 0.075, 0.034, 0.008, s > 0 ? PRIMARY : darker(PRIMARY, 1), 'none', { segments: 1 });
      break;
    }
    case 'faixaCabeca': {
      // Sweatband around the forehead, a stripe in the secondary color; over the hair (not hiding it).
      const y = (a: number) => 1.698 - 0.01 * backness(a);
      const d = (a: number) => 0.016 + 0.012 * backness(a);
      k.loft(
        [
          k.on(y, 0.005),
          k.on(y, d),
          k.on((a) => y(a) + 0.011, (a) => d(a) + 0.002),
          k.on((a) => y(a) + 0.021, (a) => d(a) + 0.002),
          k.on((a) => y(a) + 0.032, d),
          k.on((a) => y(a) + 0.032, 0.005),
        ],
        (j) => (j === 2 ? SECONDARY : PRIMARY),
        { cols: 14 },
      );
      break;
    }

    case 'capaceteMilitar': {
      // Combat helmet: a flared skirt over the ears and the nape, a band around the dome, chin straps.
      const edge = edgeOf(1.708, 1.642, 1.615);
      const d = (y: number) => 0.034 + 0.004 * smooth(y, 1.7, 1.78);
      shell(k, edge, d, (j) => (j === 0 ? darker(PRIMARY, 3) : j <= 2 ? darker(PRIMARY, 1) : j === 4 ? SECONDARY : PRIMARY), { lip: 0.012, cols: 14 });
      k.chinStrap(1.66, deg(72), SECONDARY);
      break;
    }
    case 'capaceteTatico':
      tacticalHelmet(k, false);
      break;
    case 'capaceteVisao':
      tacticalHelmet(k, true);
      break;
    case 'motoAberto': {
      // Open face: the shell covers the ears and the back down to the jaw; a short peak, snaps, a stripe.
      const edge = edgeOf(1.712, 1.578, 1.585, deg(38), deg(80));
      const d = () => 0.032;
      shell(k, edge, d, (j, a) => (j === 0 ? darker(SECONDARY, 1) : j <= 2 ? SECONDARY : angDist(a, FRONT) < deg(11) || angDist(a, BACK) < deg(11) ? SECONDARY : PRIMARY), { cols: 18, rows: 5 });
      k.bill(FRONT, 1.736, 0.036, { half: deg(36), len: 0.045, width: 0.12, droop: 0.008, thick: 0.006, top: PRIMARY, under: darker(PRIMARY, 2), cols: 4 });
      for (const s of [-1, 1]) for (const f of [52, 66]) k.plate(1.71, FRONT + s * deg(f), 0.036, 0.009, 0.009, 0.004, DETAIL);
      break;
    }
    case 'motoFechado':
      fullFace(k);
      break;
    case 'capaceteObra': {
      // Hard hat: a peak at the front, a short brim around, a dome with a ridge front to back.
      brimmed(k, {
        band: (a) => 1.714 - 0.012 * backness(a),
        rx: 0.122,
        rzF: 0.17,
        rzB: 0.14,
        lift: (a) => -0.006 - 0.006 * Math.max(0, Math.sin(a)),
        curl: 0.5,
        thick: 0.008,
        crown: [0.102, 0.126, 0.124],
        top: 1.82,
        k: () => 0.82,
        pole: 1.845,
        bandH: 0.008,
      });
      const ridge = new THREE.TorusGeometry(0.118, 0.008, 3, 8, Math.PI * 0.84).rotateZ(Math.PI * 0.08).rotateY(Math.PI / 2);
      k.add(ridge, M(0, 1.728, 0.006, 0, 0, 0, 1, 1, 1.08), darker(PRIMARY, 1));
      break;
    }
    case 'capaceteBike': {
      // Bike helmet: an elongated shell ending in a tail at the back, two rows of dark vent slots, a small
      // visor, straps to the chin.
      const band = (a: number) => 1.716 - 0.034 * backness(a);
      const tail = (a: number) => 1 + 0.1 * bell(angDist(a, BACK), 0, deg(45));
      const slot = (j: number, a: number, i: number) => (j === 2 || j === 3) && i % 2 === 0 && fromFront(a) > deg(15) && fromFront(a) < deg(165);
      k.loft(
        [
          k.on(band, 0.006),
          k.oval((a) => band(a) - 0.004, 0.1, 0.13, 0.152, { cz: 0.012, k: tail }),
          k.oval((a) => band(a) + 0.012, 0.104, 0.132, 0.156, { cz: 0.014, k: tail }),
          k.oval(1.765, 0.1, 0.124, 0.148, { cz: 0.018, k: tail }),
          k.oval(1.808, 0.078, 0.1, 0.118, { cz: 0.022 }),
          k.oval(1.833, 0.044, 0.058, 0.07, { cz: 0.024 }),
        ],
        (j, a, _y, i) => {
          const f = fromFront(a);
          if (j === 0) return darker(SECONDARY, 1);
          if (j === 1) return SECONDARY;
          if (slot(j, a, i)) return fixed('black');
          return j === 2 && f > deg(28) && f < deg(56) ? DETAIL : PRIMARY;
        },
        { cols: 16, pole: new THREE.Vector3(0, 1.84, 0.024) },
      );
      k.bill(FRONT, band(FRONT) + 0.01, 0.04, { half: deg(30), len: 0.04, width: 0.1, droop: 0.01, thick: 0.005, top: SECONDARY, cols: 4 });
      k.chinStrap(1.695, deg(80), SECONDARY, 0.003);
      break;
    }
    case 'capacetePiloto': {
      // Jet pilot: a shell over the ears, the visor down over the eyes, the oxygen mask and its hose.
      const edge = edgeOf(1.718, 1.585, 1.59, deg(40), deg(80));
      const d = () => 0.034;
      shell(k, edge, d, (j, a) => (j === 0 ? darker(PRIMARY, 3) : j <= 2 ? darker(PRIMARY, 1) : angDist(a, FRONT) < deg(13) ? DETAIL : PRIMARY), { cols: 14, rows: 5 });
      const arc = deg(144);
      // Visor: a dark shield with thickness, its housing on the forehead.
      k.loft([k.on(1.632, 0.03), k.on(1.632, 0.046), k.on(1.712, 0.05), k.on(1.712, 0.034)], (j) => (j === 1 ? fixed('lensDark') : SECONDARY), { a0: FRONT - arc / 2, arc, cols: 8, ends: SECONDARY });
      k.loft([k.on(1.712, 0.034), k.on(1.712, 0.052), k.on(1.734, 0.05), k.on(1.744, 0.034)], DETAIL, { a0: FRONT - arc / 2, arc, cols: 8, ends: DETAIL });
      const mc = k.face(0, 1.598, 0.012);
      k.add(new THREE.SphereGeometry(1, 7, 4), new THREE.Matrix4().compose(mc, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)), new THREE.Vector3(0.042, 0.05, 0.042)), SECONDARY);
      const hose = [mc.clone().add(new THREE.Vector3(0, -0.035, -0.03)), new THREE.Vector3(-0.022, 1.535, mc.z - 0.02), new THREE.Vector3(-0.055, 1.505, mc.z + 0.02), new THREE.Vector3(-0.075, 1.48, mc.z + 0.06)];
      strand(k.b, hose, () => 0.009, (_t, i) => (i % 2 ? darker(SECONDARY, 2) : darker(SECONDARY, 1)), 'none', { sides: 5, tip: false });
      for (const s of [-1, 1]) k.cord([mc.clone().add(new THREE.Vector3(s * 0.036, 0.012, 0.012)), h.point(1.63, FRONT + s * deg(70), 0.038)], 0.004, SECONDARY, 3);
      break;
    }

    case 'headset': {
      // Over-ear headset: cups, a band over the head, a boom mic to the mouth.
      const cups = k.earCups(0.034, 0.022, PRIMARY, darker(SECONDARY, 1));
      const attach = cups.map((c) => c.c.clone().addScaledVector(c.n, 0.006).add(new THREE.Vector3(0, 0.03, 0)));
      k.arch(attach[0], attach[1], 1.818, 0.009, SECONDARY);
      const l = cups[0];
      const mouth = k.face(-0.026, 1.588, 0.022);
      const from = l.c.clone().addScaledVector(l.n, 0.006).add(new THREE.Vector3(0, -0.012, -0.018));
      k.cord([from, new THREE.Vector3(from.x + 0.01, 1.6, from.z - 0.06), mouth.clone().add(new THREE.Vector3(-0.02, 0, 0.004)), mouth], 0.0035, SECONDARY, 4);
      k.add(new THREE.SphereGeometry(1, 5, 3), new THREE.Matrix4().compose(mouth, new THREE.Quaternion(), new THREE.Vector3(0.01, 0.009, 0.009)), darker(SECONDARY, 2));
      break;
    }
    case 'protetorAuricular': {
      // Tactical ear protection: big boxy cups, a twin-wire band, an antenna and a knob.
      const cups = k.earCups(0.042, 0.036, PRIMARY, darker(SECONDARY, 1), 6);
      const attach = cups.map((c) => c.c.clone().addScaledVector(c.n, 0.004).add(new THREE.Vector3(0, 0.036, 0)));
      for (const dz of [-0.016, 0.016]) k.arch(attach[0], attach[1], 1.822, 0.005, SECONDARY, dz);
      const r = cups[1];
      const tip = r.c.clone().addScaledVector(r.n, 0.012).add(new THREE.Vector3(0, 0.03, 0.022));
      k.cord([r.c.clone().addScaledVector(r.n, 0.012).add(new THREE.Vector3(0, 0.012, 0.012)), tip, tip.clone().add(new THREE.Vector3(0, 0.04, 0.012))], 0.004, darker(SECONDARY, 1), 4);
      k.cyl(r.c.clone().addScaledVector(r.n, 0.02).add(new THREE.Vector3(0, -0.012, -0.012)), r.n, 0.008, 0.008, 0.008, 5, SECONDARY);
      break;
    }

    case 'shemagh': {
      // Shemagh: wrapped over the head and across the face below the eyes, folds as diagonal bumps, the
      // checked weave on the veil, a tail at the side; a loose wrap around the neck (skinned).
      const edge = (a: number) => 1.53 + 0.045 * smooth(fromFront(a), deg(50), deg(100));
      const window = (y: number, a: number) => y > 1.615 && y < 1.704 && fromFront(a) < deg(58);
      const fold = (y: number, a: number) => 0.005 * Math.sin(a * 5 + y * 70);
      const nose = (y: number, a: number) => 0.016 * bell(y, 1.612, 0.03) * bell(fromFront(a), 0, deg(24));
      const rows = [0, 0.13, 0.27, 0.4, 0.55, 0.72, 1];
      const yAt = (r: number, a: number) => {
        // Rows meet the window's edges at the front.
        const lo = edge(a);
        return lerp(lo, 1.792, r);
      };
      const fixedRows: Ring[] = [
        k.on(edge, 0.008),
        ...rows.map((r) => (a: number) => {
          const y = r === 0.27 && fromFront(a) < deg(70) ? 1.615 : r === 0.55 && fromFront(a) < deg(70) ? 1.704 : yAt(r, a);
          return h.point(y, a, 0.024 + fold(y, a) + nose(y, a));
        }),
      ];
      k.loft(fixedRows, (j, a, y, i) => (j >= 1 && y < 1.62 && (i + j) % 2 === 0 && fromFront(a) < deg(90) ? SECONDARY : j === 0 ? darker(PRIMARY, 1) : PRIMARY), {
        cols: 14,
        pole: k.crown(0.026),
        skip: (j, a, y) => j >= 1 && window(y, a),
        shade: (j, a) => 0.5 * Math.sin(a * 5 + j * 1.3),
      });
      lock(k.b, h.point(1.69, 0, 0.03), new THREE.Vector3(-0.25, -1, 0.35), 0.13, 0.05, 0.012, PRIMARY, 'none', { segments: 2, curve: new THREE.Vector3(0, -0.2, 0.2) });
      const nb = new FacetBuilder(29);
      new BodyParts(nb, SHAPES[sex]).neck(1.44, 1.575, 0.03, {
        paint: (t, a) => (t < 0.2 && Math.sin(a * 6) > 0 ? SECONDARY : PRIMARY),
        region: 'none',
        bump: (t, a) => 0.006 * Math.sin(a * 4 + t * 6),
        rimStart: { h: 0.012, out: 0.006, paint: SECONDARY },
        segments: 10,
      });
      return k.done(nb.build());
    }

    case 'chapeuChef': {
      // Toque: a headband and a tall pleated puff, wider than the band, domed on top.
      const band = (a: number) => 1.712 - 0.01 * backness(a);
      const pleat = (a: number) => 1 + 0.05 * Math.cos(a * 8);
      k.loft(
        [
          k.on(band, 0.006),
          k.on(band, 0.022),
          k.on((a) => band(a) + 0.045, 0.024),
          k.oval((a) => band(a) + 0.046, 0.1, 0.122, 0.12),
          k.oval(1.8, 0.122, 0.14, 0.138, { k: pleat }),
          k.oval(1.87, 0.134, 0.15, 0.148, { k: pleat }),
          k.oval(1.915, 0.126, 0.142, 0.14, { k: pleat }),
          k.oval(1.936, 0.08, 0.09, 0.09),
        ],
        PRIMARY,
        { cols: 16, pole: new THREE.Vector3(0, 1.945, 0.006), shade: (j, a) => (j <= 1 ? -0.3 : j >= 3 && j <= 5 ? 0.5 * Math.sin(a * 8) : 0) },
      );
      break;
    }
    case 'coroaFlores': {
      // Flower crown: a vine around the head (secondary), five-petal flowers across the front and the sides
      // (star-shaped prisms in the primary color, a raised center in the detail color), leaves between them.
      const y = (a: number) => 1.742 - 0.026 * backness(a);
      k.loft([k.on(y, 0.016), k.on((a) => y(a) - 0.007, 0.027), k.on((a) => y(a) + 0.008, 0.027), k.on(y, 0.016)], SECONDARY, { cols: 12 });
      const flower = (p: THREE.Vector3, n: THREE.Vector3, r: number, rot: number, paint: Paint) => {
        const t = new THREE.Vector3().crossVectors(UP, n).normalize();
        const u = new THREE.Vector3().crossVectors(n, t);
        const ring = (off: number) =>
          Array.from({ length: 10 }, (_, j) => {
            const ang = rot + (j / 10) * Math.PI * 2;
            const rr = j % 2 ? r * 0.5 : r;
            return p.clone().addScaledVector(t, Math.cos(ang) * rr).addScaledVector(u, Math.sin(ang) * rr).addScaledVector(n, off);
          });
        const top = ring(0.003);
        const bottom = ring(-0.003);
        const c = p.clone().addScaledVector(n, 0.006);
        for (let j = 0; j < 10; j++) {
          const j1 = (j + 1) % 10;
          k.quad([c, top[j], top[j1]], paint, n);
          k.quad([top[j], top[j1], bottom[j1], bottom[j]], darker(paint, 1), top[j].clone().add(top[j1]).multiplyScalar(0.5).sub(p));
        }
        k.add(new THREE.ConeGeometry(r * 0.3, 0.008, 4).rotateX(Math.PI / 2), k.at(c, n), DETAIL);
      };
      for (let i = -2; i <= 2; i++) {
        const a = FRONT + i * deg(38);
        const yy = y(a) + 0.003;
        flower(h.point(yy, a, 0.033), h.normal(yy, a), i % 2 ? 0.022 : 0.026, i * 0.7, i % 2 ? darker(PRIMARY, 1) : PRIMARY);
        if (i < 2) {
          const la = a + deg(19);
          k.add(new THREE.OctahedronGeometry(1), k.at(h.point(y(la), la, 0.03), h.normal(y(la), la), 0.02, 0.009, 0.004).multiply(new THREE.Matrix4().makeRotationZ(0.5)), darker(SECONDARY, 1));
        }
      }
      break;
    }
    default:
      return faceItem(id, sex, k);
  }
  return k.done();
}

// --- Face and ears ---------------------------------------------------------------------------------------------

/** Temples from (x, y) on the side of the face back to the top of each ear (glasses, goggles). */
function temples(k: HeadKit, from: (s: number) => THREE.Vector3, paint: Paint, w = 0.004) {
  for (const s of [-1, 1]) {
    const f = from(s);
    const ear = k.h.point(1.668, earAngle(s) + s * deg(4), 0.006);
    const mid = f.clone().lerp(ear, 0.5);
    k.add(new THREE.BoxGeometry(w, w * 1.4, f.distanceTo(ear)), new THREE.Matrix4().lookAt(f, ear, UP).setPosition(mid), paint);
  }
}

/** A strap around the back of the head from the side of the face (f from the front) at height y. */
function backStrap(k: HeadKit, y: Num, hgt: number, f: number, d: Num, paint: Paint, cols = 10) {
  const arc = Math.PI * 2 - 2 * f;
  const yy = (a: number) => val(y, a);
  k.loft([k.on(yy, (a) => val(d, a) - 0.004), k.on(yy, d), k.on((a) => yy(a) + hgt, d), k.on((a) => yy(a) + hgt, (a) => val(d, a) - 0.004)], paint, { a0: FRONT + f, arc, cols });
}

function faceItem(id: string, sex: Sex, k: HeadKit): PieceGeometry {
  const h = k.h;
  const fem = k.fem;
  const tipY = fem ? 1.622 : 1.617;
  const mouthY = fem ? 1.587 : 1.584;
  // Over the nose (the tip stands 1.7–2.5 cm off the face), as an offset bump on the head surface.
  const nose = (y: number, a: number, amp = 0.026) => amp * bell(y, tipY + 0.006, 0.034) * bell(fromFront(a), 0, deg(26));
  switch (id) {
    case 'balistico': {
      // Ballistic glasses: one wraparound shield (secondary tint) with a notch for the nose, a frame bar on
      // top, temples to the ears.
      const arc = deg(160);
      const yb = (a: number) => 1.652 + 0.012 * bell(fromFront(a), 0, deg(16)) + 0.004 * (fromFront(a) / deg(80));
      const yt = () => 1.694;
      const d = (a: number) => 0.015 + 0.01 * Math.cos(Math.min(fromFront(a), FRONT));
      k.loft([k.on(yb, (a) => d(a) - 0.004), k.on(yb, d), k.on(yt, (a) => d(a) + 0.002), k.on(yt, (a) => d(a) - 0.003)], (j) => (j === 1 ? SECONDARY : PRIMARY), { a0: FRONT - arc / 2, arc, cols: 10, ends: PRIMARY });
      // The frame bar along the top edge.
      k.loft([k.on(yt, (a) => d(a) - 0.004), k.on(() => yt() - 0.002, (a) => d(a) + 0.004), k.on(() => yt() + 0.007, (a) => d(a) + 0.004), k.on(() => yt() + 0.007, (a) => d(a) - 0.004)], PRIMARY, {
        a0: FRONT - arc / 2,
        arc,
        cols: 10,
        ends: PRIMARY,
      });
      temples(k, (s) => h.point(1.69, FRONT + s * deg(80), d(FRONT + deg(80)) - 0.002), PRIMARY, 0.005);
      break;
    }
    case 'oculosEsqui': {
      // Ski goggles: a deep frame around a big mirrored lens (secondary), a strap around the head.
      const arc = deg(156);
      const yb = (a: number) => 1.638 + 0.016 * bell(fromFront(a), 0, deg(18));
      const yt = () => 1.714;
      const d = (a: number) => 0.022 + 0.01 * Math.cos(Math.min(fromFront(a), FRONT));
      const rings: Ring[] = [
        k.on((a) => yb(a) + 0.002, 0.006),
        k.on((a) => yb(a) - 0.004, (a) => d(a) - 0.006),
        k.on(yb, d),
        k.on((a) => yb(a) + 0.011, (a) => d(a) - 0.002),
        k.on(() => yt() - 0.011, (a) => d(a) - 0.002),
        k.on(yt, d),
        k.on(() => yt() + 0.004, (a) => d(a) - 0.006),
        k.on(() => yt() - 0.002, 0.006),
      ];
      k.loft(rings, (j) => (j === 3 ? SECONDARY : PRIMARY), { a0: FRONT - arc / 2, arc, cols: 12, ends: PRIMARY, shade: (j) => (j === 3 ? 0.7 : 0) });
      backStrap(k, 1.668, 0.032, arc / 2, (a) => 0.02 + 0.012 * backness(a), darker(PRIMARY, 2), 10);
      break;
    }
    case 'mascaraCirurgica': {
      // Surgical mask: pleated shell from the bridge of the nose to under the chin, ear loops.
      const arc = deg(160);
      const top = (a: number) => 1.662 - 0.03 * (fromFront(a) / deg(80)) ** 2;
      const bottom = (a: number) => 1.546 + 0.04 * (fromFront(a) / deg(80)) ** 2;
      const d = (y: number, a: number) => 0.006 + nose(y, a, 0.028) + 0.004 * Math.cos(Math.min(fromFront(a), FRONT));
      const rows = 4;
      const ring = (r: number, extra = 0): Ring => (a) => {
        const y = lerp(bottom(a), top(a), r / rows);
        return h.point(y, a, d(y, a) + extra);
      };
      k.loft([ring(0, -0.004), ...Array.from({ length: rows + 1 }, (_, r) => ring(r)), ring(rows, -0.004)], PRIMARY, {
        a0: FRONT - arc / 2,
        arc,
        cols: 10,
        ends: PRIMARY,
        // Pleats: the rows alternate light and dark.
        shade: (j) => (j >= 1 && j <= rows ? (j % 2 ? 0.6 : -0.6) : -0.4),
      });
      for (const s of [-1, 1]) {
        const ea = earAngle(s);
        const back = s > 0 ? 1 : -1;
        const a0 = FRONT + (s * arc) / 2;
        k.cord([h.point(top(a0) - 0.006, a0, 0.008), h.point(1.672, ea - back * deg(5), 0.008), h.point(1.684, ea + back * deg(8), 0.01), h.point(1.63, ea + back * deg(22), 0.008), h.point(bottom(a0) + 0.008, a0, 0.008)], 0.0018, darker(PRIMARY, 1), 3);
      }
      break;
    }
    case 'bandanaRosto': {
      // Bandana over the face: from the nose down, loose, hanging in a point in front of the neck, a print and
      // a border, tied at the back of the head.
      const arc = deg(196);
      const top = (a: number) => 1.655 - 0.03 * (fromFront(a) / deg(98)) ** 2;
      const bottom = (a: number) => lerp(1.49, 1.6, Math.min(1, fromFront(a) / deg(98)) ** 1.2);
      const d = (y: number, a: number) => 0.012 + nose(y, a, 0.026) + 0.012 * THREE.MathUtils.clamp((1.6 - y) / 0.06, 0, 1);
      // Below the jaw the cloth hangs straight down (and a little forward) from it.
      const hang = (y: number, a: number, extra: number) => {
        const yy = Math.max(y, 1.566);
        const p = h.point(yy, a, d(yy, a) + extra);
        if (y < yy) {
          p.z -= (yy - y) * 0.15 * Math.max(0, Math.sin(a));
          p.y = y;
        }
        return p;
      };
      const rows = 5;
      const ring = (r: number, extra = 0): Ring => (a) => hang(lerp(bottom(a), top(a), r / rows), a, extra);
      const dot = (j: number, i: number) => j >= 3 && (i * 3 + j * 5) % 9 === 0;
      k.loft([ring(0, -0.005), ...Array.from({ length: rows + 1 }, (_, r) => ring(r)), ring(rows, -0.005)], (j, _a, _y, i) => (j <= 1 ? SECONDARY : dot(j, i) ? SECONDARY : PRIMARY), {
        a0: FRONT - arc / 2,
        arc,
        cols: 12,
        ends: PRIMARY,
        shade: (j, a) => (j >= 1 && j <= 3 ? 0.4 * Math.sin(a * 6 + j) : 0),
      });
      backStrap(k, 1.6, 0.026, arc / 2, (a) => 0.016 + 0.012 * backness(a), darker(PRIMARY, 1), 8);
      const knot = h.point(1.612, BACK, 0.034);
      k.add(new THREE.SphereGeometry(1, 5, 3), new THREE.Matrix4().compose(knot, new THREE.Quaternion(), new THREE.Vector3(0.018, 0.015, 0.014)), PRIMARY);
      for (const s of [-1, 1]) lock(k.b, knot.clone().add(new THREE.Vector3(s * 0.006, -0.004, 0.004)), new THREE.Vector3(s * 0.4, -1, 0.3), 0.04, 0.026, 0.007, PRIMARY, 'none', { segments: 1 });
      break;
    }
    case 'mascaraGas': {
      // Gas mask: a rubber face piece from the forehead to under the chin, two round lenses, the filter in
      // front of the mouth (secondary), straps to the back of the head.
      const arc = deg(164);
      const top = (a: number) => 1.712 - 0.035 * (fromFront(a) / deg(82)) ** 2;
      const bottom = (a: number) => 1.542 + 0.045 * (fromFront(a) / deg(82)) ** 2;
      const d = (y: number, a: number) => 0.012 + nose(y, a, 0.022) + 0.006 * bell(y, 1.6, 0.05) * Math.cos(Math.min(fromFront(a), FRONT));
      const rows = 4;
      const ring = (r: number, extra = 0): Ring => (a) => {
        const y = lerp(bottom(a), top(a), r / rows);
        return h.point(y, a, d(y, a) + extra);
      };
      k.loft([ring(0, -0.006), ...Array.from({ length: rows + 1 }, (_, r) => ring(r)), ring(rows, -0.006)], PRIMARY, { a0: FRONT - arc / 2, arc, cols: 10, ends: PRIMARY, shade: (j) => (j === 0 || j === rows + 1 ? -0.6 : 0) });
      for (const s of [-1, 1]) {
        const c = k.face(s * 0.035, 1.672, 0.012);
        const n = new THREE.Vector3(s * 0.32, 0.05, -1).normalize();
        k.cyl(c.clone().addScaledVector(n, 0.008), n, 0.026, 0.024, 0.016, 6, DETAIL);
        k.cyl(c.clone().addScaledVector(n, 0.017), n, 0.019, 0.019, 0.003, 6, fixed('lensDark'));
      }
      const m = k.face(0, mouthY - 0.004, 0.02);
      const fwd = new THREE.Vector3(0, -0.35, -1).normalize();
      k.cyl(m.clone().addScaledVector(fwd, 0.014), fwd, 0.026, 0.02, 0.026, 6, darker(PRIMARY, 1));
      k.cyl(m.clone().addScaledVector(fwd, 0.046), fwd, 0.034, 0.034, 0.042, 8, SECONDARY);
      backStrap(k, (a) => lerp(1.705, 1.72, backness(a)), 0.014, arc / 2, (a) => 0.018 + 0.012 * backness(a), darker(PRIMARY, 2), 6);
      backStrap(k, (a) => lerp(1.585, 1.6, backness(a)), 0.014, arc / 2, (a) => 0.016 + 0.01 * backness(a), darker(PRIMARY, 2), 6);
      break;
    }
    case 'balaclava': {
      // Balaclava: knit over the whole head (bulging over the nose and the ears) with one opening for the
      // eyes; a skinned tube down the neck.
      // Over the ears: room for the biggest ones (de abano, body.ts EARS).
      const earBump = (y: number, a: number) => 0.032 * bell(y, 1.648, 0.042) * Math.max(bell(angDist(a, earAngle(-1)), 0, deg(32)), bell(angDist(a, earAngle(1)), 0, deg(32)));
      // A wider swell over the bridge of the nose too: the columns are 26° apart, the chords between them would
      // let the bridge's sides through.
      const bridge = (y: number, a: number) => 0.005 * bell(y, 1.642, 0.03) * bell(fromFront(a), 0, deg(42));
      // A little looser over the jaw's corners and the chin's sides (the square face bulges between the rows).
      const jaw = (y: number, a: number) => 0.003 * bell(y, 1.585, 0.03) * bell(fromFront(a), deg(62), deg(34)) + 0.003 * bell(y, 1.553, 0.026) * bell(fromFront(a), deg(30), deg(24));
      const d = (y: number, a: number) => 0.007 + nose(y, a, 0.024) + bridge(y, a) + jaw(y, a) + earBump(y, a);
      const edge = (a: number) => 1.546 + 0.034 * smooth(fromFront(a), deg(60), deg(110));
      // Rows close together over the jaw and the chin: a long straight band there would cut under the jaw's
      // bulge (wider on the square face).
      const ys = [0, 1.566, 1.586, 1.606, 1.632, 1.656, 1.7, 1.738, 1.768, 1.79];
      const rings: Ring[] = ys.map((y0, r) => (a: number) => {
        const y = r === 0 ? edge(a) : Math.max(y0, edge(a) + 0.01 * r);
        return h.point(y, a, d(y, a));
      });
      const hole = (j: number, a: number) => j === 5 && fromFront(a) < deg(54);
      k.loft(rings, (j, _a, _y, i) => (j >= 7 && i % 3 === 0 ? darker(PRIMARY, 1) : PRIMARY), { cols: 14, pole: k.crown(0.007), skip: (j, a) => hole(j, a) });
      // The opening's edges: a rolled rim above and below the eyes.
      const arc = deg(108);
      for (const y of [1.656, 1.7]) {
        k.loft([k.on(y - 0.004, (a) => d(y, a)), k.on(y, (a) => d(y, a) + 0.005), k.on(y + 0.004, (a) => d(y, a))], darker(PRIMARY, 1), { a0: FRONT - arc / 2, arc, cols: 6 });
      }
      const nb = new FacetBuilder(31);
      new BodyParts(nb, SHAPES[sex]).neck(1.44, 1.59, 0.01, { paint: PRIMARY, region: 'none', rimStart: { h: 0.012, out: 0.004, paint: darker(PRIMARY, 1) } });
      return k.done(nb.build());
    }
    case 'mascaraHoquei': {
      // Goalie mask: a molded plate over the face, two eye holes, rows of vent holes, red marks (secondary),
      // two straps around the head.
      const arc = deg(124);
      const ys = [1.548, 1.585, 1.62, 1.655, 1.7, 1.735, 1.758];
      const d = (y: number, a: number) => 0.016 + nose(y, a, 0.02) + 0.006 * (1 - Math.cos(Math.min(fromFront(a), FRONT)));
      const ring = (y: number, extra = 0): Ring => (a) => h.point(y, a, d(y, a) + extra);
      const rings = [ring(ys[0], -0.007), ...ys.map((y) => ring(y)), ring(ys[ys.length - 1], -0.007)];
      const eye = (j: number, a: number) => j === 4 && fromFront(a) > deg(6) && fromFront(a) < deg(42);
      k.loft(
        rings,
        (j, a, _y, i) => {
          const f = fromFront(a);
          if ((j === 5 && f > deg(8) && f < deg(36)) || (j === 3 && f > deg(44) && i % 2 === 0)) return SECONDARY;
          return PRIMARY;
        },
        { a0: FRONT - arc / 2, arc, cols: 10, ends: PRIMARY, skip: (j, a) => eye(j, a) },
      );
      // Vent holes: small dark faces just over the plate, in rows on the cheeks, the chin and the forehead.
      const holes: [number, number][] = [
        [1.742, 12],
        [1.742, 26],
        [1.64, 14],
        [1.64, 26],
        [1.64, 38],
        [1.61, 20],
        [1.61, 32],
        [1.572, 0],
        [1.572, 12],
      ];
      for (const [y, f] of holes) for (const s of f ? [-1, 1] : [0]) k.dot(y, FRONT + s * deg(f), d(y, FRONT + s * deg(f)) + 0.0015, 0.0055, fixed('black'));
      backStrap(k, 1.712, 0.014, arc / 2, (a) => 0.02 + 0.012 * backness(a), darker(PRIMARY, 3), 8);
      backStrap(k, 1.6, 0.014, arc / 2, (a) => 0.016 + 0.01 * backness(a), darker(PRIMARY, 3), 8);
      break;
    }
    case 'tapaOlho': {
      // Eye patch over the right eye, a thin strap slanting around the head.
      const x0 = 0.008;
      const x1 = 0.062;
      const a0 = FRONT + Math.asin(x0 / 0.082);
      const a1 = FRONT + Math.asin(x1 / 0.082);
      const u = (a: number) => ((a - a0) / (a1 - a0)) * 2 - 1;
      const yb = (a: number) => 1.65 + 0.008 * u(a) ** 2;
      const yt = (a: number) => 1.696 - 0.01 * u(a) ** 2;
      const pd = (a: number) => 0.007 + 0.004 * (1 - u(a) ** 2);
      k.loft([k.on(yb, 0.003), k.on(yb, pd), k.on((a) => (yb(a) + yt(a)) / 2, (a) => pd(a) + 0.002), k.on(yt, pd), k.on(yt, 0.003)], PRIMARY, { a0, arc: a1 - a0, cols: 4, ends: PRIMARY });
      const aEye = (a0 + a1) / 2;
      const sy = (a: number) => 1.69 + 0.032 * (1 - Math.cos(a - aEye)) / 2;
      const sd = (a: number) => 0.009 + 0.018 * backness(a);
      k.loft([k.on(sy, (a) => sd(a) - 0.003), k.on(sy, sd), k.on((a) => sy(a) + 0.006, sd), k.on((a) => sy(a) + 0.006, (a) => sd(a) - 0.003)], darker(PRIMARY, 1), { a0: a1, arc: Math.PI * 2 - (a1 - a0), cols: 14 });
      break;
    }
    case 'argola':
      // Hoop earrings hanging from the lobes.
      for (const s of [-1, 1]) {
        const a = earAngle(s);
        const n = h.normal(1.648, a);
        const lobe = h.point(1.648 - (fem ? 0.025 : 0.028), a, 0.006);
        const c = lobe.clone().add(new THREE.Vector3(0, -0.013, 0)).addScaledVector(n, 0.002);
        k.add(new THREE.TorusGeometry(0.014, 0.0022, 3, 10), k.at(c, n), PRIMARY);
      }
      break;
    case 'piercings': {
      // A ring in the right nostril, a bar through the left brow (two studs), a ring at the lower lip.
      const ring = (p: THREE.Vector3, axis: THREE.Vector3, r: number) => k.add(new THREE.TorusGeometry(r, 0.0012, 3, 8), k.at(p, axis), PRIMARY);
      ring(k.face(0.017, tipY - 0.009, 0.006), new THREE.Vector3(1, 0, -0.3).normalize(), 0.0055);
      ring(k.face(-0.012, mouthY - 0.008, 0.004), new THREE.Vector3(-1, 0, -0.5).normalize(), 0.0055);
      for (const y of [1.712, 1.692]) k.add(new THREE.SphereGeometry(0.003, 4, 3), M(0, 0, 0).setPosition(k.face(-0.05, y, 0.005)), PRIMARY);
      break;
    }
    default:
      // Unknown ids get a skullcap (never an empty piece).
      skullcap(k);
  }
  return k.done();
}

export const HEADWEAR_GENERATORS: Record<string, Generator> = {
  headwear: (id, sex) => headwear(id, sex),
};
