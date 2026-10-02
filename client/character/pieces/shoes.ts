// Shoes (feet slot): the 30 shoes, boots and sandals of the catalog. Every pair is built per foot from a few
// low poly blocks on a shared "last" (the shoe form) that follows the body's foot (body.ts `foot`):
// - a sole: the foot outline extruded in layers (outsole, midsole, a colored stripe), its bottom always on
//   the ground (the feet are planted at y = 0 by IK), the toe a little up (toe spring); heeled shoes raise the
//   sole under the heel and stand on a separate heel block;
// - an upper: a 6-point section (flat sides, sloped shoulders, a flat instep where the laces go) lofted over
//   7 stations from the heel to the toe, closed by a point at each end (rounded heel and toe);
// - a collar around the shin (padded ring with a lining), or a shaft up the shin for boots (a tube that
//   follows the calf and the build morphs, with a cuff);
// - details as faces and small volumes: laces and straps as raised strips on the upper, studs, buckles,
//   pull tabs, elastic gores and toe caps painted on the upper's faces.
// The foot under a closed shoe is hidden (registry `hides`), so a thick sole or a heel may overlap it; open
// shoes (sandals, flats, clogs) keep the foot and only hug it. Barefoot is an empty piece.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { PieceGeometry } from '.';
import { BodyParts, sideName, type Side } from '../body';
import { FacetBuilder, segment, type Rim, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, type Paint } from '../palette';
import type { BoneName, RegionName } from '../rig';
import { box, start } from './common';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number, e0: number, e1: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Stations along the shoe, from the back of the heel (0) to the toe tip (1). */
const U = [0, 0.1, 0.3, 0.52, 0.74, 0.9, 1] as const;
/** Half width of the shoe at each station (× the body's foot width). */
const HW = [0.6, 0.86, 0.92, 1.0, 1.05, 0.9, 0.5];
/** Section of an upper (across −1..1, up 0..1), from one bottom edge over the top to the other. */
const PROFILE = [
  [-1, 0],
  [-1, 0.46],
  [-0.52, 1],
  [0.52, 1],
  [1, 0.46],
  [1, 0],
] as const;
/** The body's foot sections (body.ts): t along the foot, half width, height (× the foot's width / 0.085). */
const BODY_FOOT = [
  [0, 0.62, 0.62],
  [0.14, 0.86, 1.0],
  [0.3, 0.92, 1.0],
  [0.55, 1.0, 0.72],
  [0.78, 1.04, 0.5],
  [0.93, 0.9, 0.36],
  [1, 0.62, 0.26],
] as const;
const FOOT_H = 0.085;
/** Height where the pants' hem region (ankle) ends: tall boots hide the pants under it. */
const PANTS_CUT = 0.231;

/** Piecewise linear values at the stations. */
function stations(vals: readonly number[]): (u: number) => number {
  return (u) => {
    if (u <= 0) return vals[0];
    if (u >= 1) return vals[vals.length - 1];
    let i = 0;
    while (U[i + 1] < u) i++;
    return lerp(vals[i], vals[i + 1], (u - U[i]) / (U[i + 1] - U[i]));
  };
}

function bodyFoot(t: number, col: 1 | 2): number {
  const T = clamp01(t);
  let i = 0;
  while (i < BODY_FOOT.length - 2 && BODY_FOOT[i + 1][0] < T) i++;
  const a = BODY_FOOT[i];
  const b = BODY_FOOT[i + 1];
  return lerp(a[col], b[col], clamp01((T - a[0]) / (b[0] - a[0])));
}

// Fixed cells: soles and hardware never take the player's colors.
const RUBBER = fixed('rubber');
const RUBBER_GRAY = fixed('rubberGray');
const OFF_WHITE = fixed('offWhite');
const STEEL = fixed('steel');
const P1 = darker(PRIMARY, 1);
const P2 = darker(PRIMARY, 2);
const P3 = darker(PRIMARY, 3);

/** A layer boundary of a sole: height (m, per station u) and extra half width (bevels, lugs). */
interface Level {
  y: number | ((u: number) => number);
  out?: number;
}

/** Simple cupsole: a bevel at the ground, `h` at the heel, `h2` at the toe. */
const cup = (h: number, h2 = h * 0.85): Level[] => [{ y: 0, out: -0.002 }, { y: (u) => lerp(h, h2, u) }];
/** Lugged boot sole: a beveled tread band and the midsole over it. */
const lug = (h: number, h2: number, tread = 0.012): Level[] => [{ y: 0, out: -0.004 }, { y: tread, out: 0.003 }, { y: (u) => lerp(h, h2, u) }];
/** Heeled sole: raised under the heel (the heel block stands under it), thin at the forefoot. */
const heeled = (heel: number, thick: number): Level[] => {
  const bottom = (u: number) => heel * (1 - smooth(u, 0.22, 0.62));
  return [{ y: bottom }, { y: (u) => bottom(u) + thick }];
};

/** Upper heights (absolute y at each station). */
const TOPS = {
  low: [0.108, 0.118, 0.118, 0.088, 0.066, 0.052, 0.038],
  boot: [0.118, 0.128, 0.124, 0.094, 0.07, 0.056, 0.042],
  dress: [0.102, 0.112, 0.114, 0.08, 0.058, 0.044, 0.03],
  chunky: [0.11, 0.122, 0.12, 0.094, 0.074, 0.062, 0.046],
};

interface LastOptions {
  /** Extra length past the toes (pointed toes), m. */
  long?: number;
  /** Width scale. */
  width?: number;
  /** Tip width (× foot width): 0.5 round, ~0.25 pointed, 0.7 square. */
  tip?: number;
  /** Toe spring (m the sole's tip rises). */
  spring?: number;
  /** Clearance of the upper over the foot. */
  d?: number;
}

/**
 * One foot's shoe: the last (stations along the foot), the weights that keep the shoe on the foot and the
 * ankle, and the blocks a shoe is made of.
 */
class Foot {
  readonly x: number;
  readonly foot: BoneName & RegionName;
  readonly shin: BoneName & RegionName;
  readonly thigh: BoneName;
  readonly ankle: RegionName;
  readonly region: RegionName;
  readonly W: number;
  readonly len: number;
  readonly zH: number;
  readonly zT: number;
  readonly d: number;
  readonly spring: number;
  private hwT: (u: number) => number;
  /** Top of the last sole built (the upper sits on it). */
  soleTop: (u: number) => number = () => 0.02;
  // The last upper built (laces and straps follow it).
  private bed: (u: number) => number = () => 0;
  private top: (u: number) => number = () => FOOT_H;
  private extra = 0;
  /** Radius of the last shaft built, by height. */
  shaftR: (y: number) => number = (y) => this.shinR(y) + 0.02;

  constructor(
    readonly b: FacetBuilder,
    readonly p: BodyParts,
    readonly s: Side,
    o: LastOptions = {},
  ) {
    const f = p.s.foot;
    this.x = s * p.j.legX;
    this.foot = sideName('foot', s);
    this.shin = sideName('shin', s);
    this.thigh = sideName('thigh', s);
    this.ankle = sideName('ankle', s);
    this.region = this.foot;
    this.len = f.len;
    this.W = f.w * (o.width ?? 1);
    this.zH = 0.06 + 0.026;
    this.zT = 0.06 - f.len - 0.014 - (o.long ?? 0);
    const hw = [...HW];
    if (o.tip !== undefined) {
      hw[6] = o.tip;
      hw[5] = Math.min(hw[5], 0.55 + o.tip);
    }
    this.hwT = stations(hw);
    this.d = o.d ?? 0.012;
    this.spring = o.spring ?? 0.01;
  }

  z(u: number) {
    return lerp(this.zH, this.zT, u);
  }
  /** Center line: the toe a little toward the big toe (inward). */
  cx(u: number) {
    return this.x - this.s * 0.006 * u * u;
  }
  hw(u: number, extra = 0) {
    return this.W * this.hwT(u) + this.d + extra;
  }
  lift(u: number) {
    return this.spring * smooth(u, 0.78, 1);
  }
  /** Where a height falls along the body's shin (0 knee, 1 its lower end). */
  shinT(y: number) {
    const j = this.p.j;
    return (j.kneeY + 0.01 - y) / (j.kneeY - j.ankleY - 0.01);
  }
  shinR(y: number) {
    return this.p.shinRadius(this.shinT(y));
  }

  /**
   * Skin weights: the shin's own weights above its lower end; below, the foot with the shin blended in at
   * the heel (as on the body's foot) and more of the shin toward the ankle, so collars bend with it.
   */
  w(z: number, y: number): Weights {
    const ty = this.shinT(y);
    if (ty < 1 && z > -0.08) return segment(this.shin, this.thigh, this.foot, 0.12)(clamp01(ty));
    const t = clamp01((0.06 - z) / this.len);
    const sole = t < 0.2 ? 0.7 + t * 1.5 : 1;
    const k = z > -0.08 ? smooth(y, 0.06, 0.1) : 0;
    const foot = lerp(sole, 0.5, k);
    return [
      [this.foot, foot],
      [this.shin, 1 - foot],
    ];
  }

  v(p: THREE.Vector3, ao = 0) {
    return this.b.vertex(p, this.w(p.z, p.y), ao);
  }

  /** A flat face (3 or 4 vertices) turned to face `dir`. */
  face(ids: readonly number[], dir: THREE.Vector3, paint: Paint, region: RegionName = this.region, shade = 0) {
    const b = this.b;
    const a = b.position(ids[0]);
    let n = new THREE.Vector3().crossVectors(b.position(ids[1]).sub(a), b.position(ids[2]).sub(a));
    if (n.lengthSq() < 1e-14 && ids.length > 3) n = new THREE.Vector3().crossVectors(b.position(ids[2]).sub(a), b.position(ids[3]).sub(a));
    const o = n.dot(dir) >= 0 ? ids : [...ids].reverse();
    for (let i = 1; i < o.length - 1; i++) b.tri(o[0], o[i], o[i + 1], paint, region, shade);
  }

  private centroid(ids: readonly number[]) {
    const c = new THREE.Vector3();
    for (const id of ids) c.add(this.b.position(id));
    return c.divideScalar(ids.length);
  }

  /**
   * The sole: the outline of the last extruded through `levels` (bottom to top), each layer painted by
   * `paint(layer, u)`, closed at the ground and on top (the welt around the upper).
   */
  sole(levels: readonly Level[], paint: Paint | ((layer: number, u: number) => Paint), o: { top?: Paint; bottom?: Paint; welt?: number } = {}) {
    const welt = o.welt ?? 0.005;
    const paintOf = typeof paint === 'function' ? paint : () => paint;
    const yOf = (L: Level, u: number) => (typeof L.y === 'number' ? L.y : L.y(u)) + (L.y === 0 ? 0 : this.lift(u));
    const rings = levels.map((L) =>
      U.map((u) => {
        const y = yOf(L, u) + (L.y === 0 ? this.lift(u) * 0.8 : 0);
        const hw = this.hw(u, welt + (L.out ?? 0));
        const z = this.z(u) + (u === 0 ? 0.006 : u === 1 ? -0.004 : 0);
        return [this.v(V(this.cx(u) - hw, y, z)), this.v(V(this.cx(u) + hw, y, z))];
      }),
    );
    const n = U.length;
    for (let l = 0; l < levels.length - 1; l++) {
      const lo = rings[l];
      const hi = rings[l + 1];
      for (let i = 0; i < n - 1; i++) {
        const um = (U[i] + U[i + 1]) / 2;
        for (const k of [0, 1]) {
          const ids = [lo[i][k], lo[i + 1][k], hi[i + 1][k], hi[i][k]];
          const c = this.centroid(ids);
          this.face(ids, c.sub(V(this.cx(um), c.y, this.z(um))), paintOf(l, um));
        }
      }
      this.face([lo[0][0], lo[0][1], hi[0][1], hi[0][0]], V(0, 0, 1), paintOf(l, 0));
      this.face([lo[n - 1][0], lo[n - 1][1], hi[n - 1][1], hi[n - 1][0]], V(0, 0, -1), paintOf(l, 1));
    }
    const bot = rings[0];
    const top = rings[levels.length - 1];
    for (let i = 0; i < n - 1; i++) {
      this.face([bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]], V(0, -1, 0), o.bottom ?? paintOf(0, 0.5));
      this.face([top[i][0], top[i + 1][0], top[i + 1][1], top[i][1]], V(0, 1, 0), o.top ?? darker(paintOf(levels.length - 2, 0.5), 1));
    }
    const last = levels[levels.length - 1];
    this.soleTop = (u) => yOf(last, u);
  }

  /**
   * A heel block under the back of a heeled sole: 5-sided (round back), `h` tall, its foot smaller
   * (`taper`) and moved forward (`slant`: western and cuban heels).
   */
  heel(h: number, paint: Paint, o: { u1?: number; taper?: number; slant?: number; w?: number } = {}) {
    const u1 = o.u1 ?? 0.24;
    const taper = o.taper ?? 0.85;
    const wk = o.w ?? 0.95;
    const top = [
      V(this.cx(0), 0, this.z(0) + 0.005),
      V(this.cx(0.06) + this.hw(0.06) * wk, 0, this.z(0.06)),
      V(this.cx(u1) + this.hw(u1) * wk, 0, this.z(u1)),
      V(this.cx(u1) - this.hw(u1) * wk, 0, this.z(u1)),
      V(this.cx(0.06) - this.hw(0.06) * wk, 0, this.z(0.06)),
    ];
    const mid = top.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(top.length);
    const hi = top.map((p) => this.v(p.clone().setY(h + 0.002)));
    const lo = top.map((p) => this.v(p.clone().sub(mid).multiplyScalar(taper).add(mid).add(V(0, 0, -(o.slant ?? 0)))));
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      const ids = [lo[i], lo[j], hi[j], hi[i]];
      const c = this.centroid(ids);
      this.face(ids, c.clone().sub(V(mid.x, c.y, mid.z - (o.slant ?? 0) / 2)), paint);
    }
    this.face(lo, V(0, -1, 0), darker(paint, 1));
  }

  /**
   * The upper: PROFILE sections over the stations (from station `from`), `top` the heights (absolute), on
   * the sole. `paint(u, k)` by face: k = 0..4 across (0 and 4 the low sides, 2 the instep). Closed by a point
   * at the heel (unless open-backed: then a rim) and at the toe.
   */
  upper(o: { top: readonly number[]; extra?: number; paint: (u: number, k: number) => Paint; heel?: Paint; toe?: Paint; from?: number; bed?: (u: number) => number }) {
    const bed = o.bed ?? ((u: number) => this.soleTop(u) - 0.003);
    const topT = stations(o.top);
    const top = (u: number) => Math.max(topT(u) + this.lift(u), bed(u) + 0.022);
    const extra = o.extra ?? 0;
    this.bed = bed;
    this.top = top;
    this.extra = extra;
    const i0 = o.from ?? 0;
    const center = (u: number) => V(this.cx(u), bed(u) + 0.3 * (top(u) - bed(u)), this.z(u));
    const rings: number[][] = [];
    for (let i = i0; i < U.length; i++) {
      const u = U[i];
      rings.push(PROFILE.map(([fx, fy]) => this.v(V(this.cx(u) + fx * this.hw(u, extra), bed(u) + fy * (top(u) - bed(u)), this.z(u)), fy === 0 ? 0.12 : 0)));
    }
    for (let r = 0; r < rings.length - 1; r++) {
      const um = (U[i0 + r] + U[i0 + r + 1]) / 2;
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const ids = [rings[r][k], rings[r + 1][k], rings[r + 1][k + 1], rings[r][k + 1]];
        this.face(ids, this.centroid(ids).sub(center(um)), o.paint(um, k));
      }
    }
    const end = (ring: number[], u: number, dz: number, paint: (k: number) => Paint) => {
      const h = top(u) - bed(u);
      const pole = this.v(V(this.cx(u), bed(u) + 0.42 * h, this.z(u) + dz));
      const c = center(u).add(V(0, 0, -dz));
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const ids = [pole, ring[k], ring[k + 1]];
        this.face(ids, this.centroid(ids).sub(c), paint(k));
      }
      // Under the point, down to the sole.
      this.face([pole, ring[PROFILE.length - 1], ring[0]], V(0, -0.2, dz), paint(2));
    };
    if (i0 === 0) end(rings[0], 0, 0.01, (k) => o.heel ?? o.paint(0, k));
    else {
      // Open back (clogs): a rim of thickness around the opening.
      const u = U[i0];
      const c = center(u);
      const inner = rings[0].map((id) => this.v(this.b.position(id).sub(c).multiplyScalar(0.8).add(c).add(V(0, 0, 0.004))));
      for (let k = 0; k < PROFILE.length - 1; k++) this.face([rings[0][k], rings[0][k + 1], inner[k + 1], inner[k]], V(0, 0.3, 1), P2);
    }
    end(rings[rings.length - 1], 1, -0.012, (k) => o.toe ?? o.paint(1, k));
  }

  /** Point on the last upper at station `u`, `c` 0..1 along its section (0.4–0.6 the instep), raised. */
  at(u: number, c: number, raise = 0.003) {
    const seg = Math.min(PROFILE.length - 2, Math.floor(c * (PROFILE.length - 1)));
    const k = c * (PROFILE.length - 1) - seg;
    const [fx0, fy0] = PROFILE[seg];
    const [fx1, fy1] = PROFILE[seg + 1];
    const bed = this.bed(u);
    const h = this.top(u) - bed;
    const hw = this.hw(u, this.extra);
    const p = V(this.cx(u) + lerp(fx0, fx1, k) * hw, bed + lerp(fy0, fy1, k) * h, this.z(u));
    const n = V(-(fy1 - fy0) * h, (fx1 - fx0) * hw, 0).normalize();
    return p.addScaledVector(n, raise);
  }

  /**
   * A raised strip on the upper (laces, straps, overlays, seams) from `u0` to `u1` and `c0` to `c1`, split
   * at the stations and section corners so it follows the faces; `edge` gives it sides (thickness).
   */
  strip(u0: number, u1: number, c0: number, c1: number, paint: Paint, o: { raise?: number; edge?: number } = {}) {
    const raise = o.raise ?? 0.003;
    const n = PROFILE.length - 1;
    const cs = [c0, ...Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).filter((c) => c > c0 + 1e-4 && c < c1 - 1e-4), c1];
    const us = [u0, ...U.filter((u) => u > u0 + 1e-4 && u < u1 - 1e-4), u1];
    const grid = us.map((u) => cs.map((c) => this.v(this.at(u, c, raise))));
    const normal = (u: number, c: number) => this.at(u, c, 0.01).sub(this.at(u, c, 0));
    for (let i = 0; i < us.length - 1; i++) {
      for (let j = 0; j < cs.length - 1; j++) {
        this.face([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], normal((us[i] + us[i + 1]) / 2, (cs[j] + cs[j + 1]) / 2), paint);
      }
    }
    if (!o.edge) return;
    const low = raise - o.edge;
    for (const [i, u, dz] of [[0, u0, 1], [us.length - 1, u1, -1]] as const) {
      for (let j = 0; j < cs.length - 1; j++) {
        const a = this.v(this.at(u, cs[j], low));
        const b2 = this.v(this.at(u, cs[j + 1], low));
        this.face([a, b2, grid[i][j + 1], grid[i][j]], V(0, 0, dz), darker(paint, 1));
      }
    }
  }

  /** Lace bars across the instep at stations `us`, plus eyelets in metal when `eyelets`. */
  laces(us: readonly number[], paint: Paint, half = 0.085) {
    this.b.detail(() => {
      for (const u of us) this.strip(u - 0.008, u + 0.008, 0.5 - half, 0.5 + half, paint, { raise: 0.004 });
    });
  }

  /**
   * A padded ring around the shin (collars, cuffs, ankle straps): from `y0` up to `y1(a)` (a = π/2 at the
   * front), `out` over the shin, with a lining band on top going in to the skin; `bottom` closes it below
   * (straps that float over the skin).
   */
  ring(o: { y0: number; y1: (a: number) => number; out: number; paint: Paint; lining?: Paint; segs?: number; zc?: number; bottom?: boolean; wall?: Paint }) {
    const segs = o.segs ?? 7;
    const zc = o.zc ?? 0.004;
    const pt = (a: number, y: number, extra: number) => {
      const r = this.shinR(y);
      return V(this.x - Math.cos(a) * (r * 0.92 + extra), y, zc - Math.sin(a) * (r + extra));
    };
    const ob: number[] = [];
    const ot: number[] = [];
    const it: number[] = [];
    const ib: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = Math.PI / 2 + (i / segs) * Math.PI * 2;
      const y1 = o.y1(a);
      ob.push(this.v(pt(a, o.y0, o.out)));
      ot.push(this.v(pt(a, y1, o.out)));
      it.push(this.v(pt(a, y1 - 0.004, 0.004)));
      if (o.bottom) ib.push(this.v(pt(a, o.y0 + 0.003, 0.004)));
    }
    const mid = V(this.x, 0, zc);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const wall = [ob[i], ob[j], ot[j], ot[i]];
      const c = this.centroid(wall);
      const radial = c.clone().sub(mid.clone().setY(c.y));
      this.face(wall, radial, o.wall ?? o.paint);
      this.face([ot[i], ot[j], it[j], it[i]], radial.clone().normalize().add(V(0, 1.5, 0)), o.lining ?? o.paint);
      if (o.bottom) this.face([ob[i], ob[j], ib[j], ib[i]], radial.clone().normalize().add(V(0, -1.5, 0)), darker(o.paint, 1));
    }
  }

  /**
   * A shaft up the shin (boots): a tube from `y0` to `y1` that follows the calf `d` out, with the build
   * morphs; a cuff at the top (`rim`); painted by height and angle (a = π/2 at the front).
   * Where the pants' hem is hidden (the ankle region, under PANTS_CUT) the shaft can be anything; above it
   * the pants and the shaft overlap, so a tall shaft either stays well inside the pants (`snug`: its
   * clearance there, the pants hang bloused over it) or well outside them (`minR`: the pants tucked in).
   */
  shaft(o: {
    y0: number;
    y1: number;
    d: number;
    paint: Paint | ((y: number, a: number) => Paint);
    rim?: Rim;
    segs?: number;
    ts?: readonly number[];
    flare?: (t: number) => number;
    calf?: number;
    along?: (t: number, a: number) => number;
    straight?: number;
    snug?: number;
    minR?: number;
  }) {
    const { y0, y1 } = o;
    const yAt = (t: number) => lerp(y0, y1, t);
    const tAt = (y: number) => (y - y0) / (y1 - y0);
    // Straight shafts (wellies) hang from the widest part of the calf they reach.
    const rOf = (y: number) => lerp(this.shinR(y), Math.max(this.shinR(y), this.shinR(y1)), o.straight ?? 0);
    const radius = (t: number) => {
      const y = yAt(t);
      const d = o.snug === undefined ? o.d : lerp(o.d, o.snug, smooth(y, y0, PANTS_CUT + 0.003));
      const r = rOf(y) + d + (o.flare ? o.flare(t) : 0);
      return o.minR === undefined ? r : Math.max(r, o.minR * smooth(y, y0, PANTS_CUT + 0.003));
    };
    // A ring at the pants' cut, where the shaft must already be inside or outside them.
    let ts = [...(o.ts ?? [0, 1])];
    const tc = tAt(PANTS_CUT + 0.003);
    if ((o.snug !== undefined || o.minR !== undefined) && tc > 0.05 && tc < 0.95) {
      ts = ts.filter((t) => Math.abs(t - tc) > 0.06);
      ts = [...ts, tc].sort((a, b) => a - b);
    }
    this.shaftR = (y) => radius(clamp01((y - y0) / (y1 - y0)));
    const paint = o.paint;
    const calf = o.calf ?? 1;
    this.b.tube({
      from: V(this.x, y0, 0.002),
      to: V(this.x, y1, 0.002),
      radius,
      sx: () => 0.94,
      bump: (t, a) => {
        // The calf at the back (as on the body's shin).
        const st = this.shinT(yAt(t));
        const back = Math.max(0, 1 - (Math.abs(Math.atan2(Math.sin(a - 1.5 * Math.PI), Math.cos(a - 1.5 * Math.PI))) / 1.05) ** 2);
        return calf * 0.008 * Math.max(0, 1 - ((st - 0.25) / 0.25) ** 2) * back * (1 - (o.straight ?? 0));
      },
      along: o.along,
      ts,
      segments: o.segs ?? 7,
      a0: Math.PI / 2,
      region: (t) => (yAt(t) < 0.23 ? this.ankle : this.shin),
      weights: (t) => this.w(0, yAt(t)),
      paint: typeof paint === 'function' ? (t, a) => paint(yAt(t), a) : paint,
      build: () => 0.12,
      rimEnd: o.rim,
    });
  }

  /** Point on the last shaft at height y and angle a (π/2 the front), raised. */
  onShaft(y: number, a: number, raise = 0.003) {
    const r = this.shaftR(y) + raise;
    return V(this.x - Math.cos(a) * r * 0.94, y, 0.002 - Math.sin(a) * r);
  }

  /** Lace bars up the front of the shaft (each over the front ridge: two faces). */
  shaftLaces(ys: readonly number[], paint: Paint, half = 0.42) {
    this.b.detail(() => {
      for (const y of ys) {
        const row = (dy: number) => [-half, 0, half].map((da) => this.v(this.onShaft(y + dy, Math.PI / 2 + da, da ? 0.0 : 0.004)));
        const lo = row(-0.0045);
        const hi = row(0.0045);
        for (const k of [0, 1]) this.face([lo[k], lo[k + 1], hi[k + 1], hi[k]], V(0, 0, -1), paint, this.ankleOr(y));
      }
    });
  }

  ankleOr(y: number): RegionName {
    return y < 0.23 ? this.ankle : this.shin;
  }

  /** A small box on the shoe (buckles, tabs, studs), with this foot's weights. */
  box(c: THREE.Vector3, size: THREE.Vector3, paint: Paint, rot = new THREE.Euler(), region: RegionName = this.region) {
    box(this.b, c, size, this.w(c.z, c.y), region, paint, rot);
  }

  /** A flat bar from `lo` to `hi` (straps), `width` across and `thick` deep (its local X faces `across`). */
  beam(lo: THREE.Vector3, hi: THREE.Vector3, width: number, thick: number, paint: Paint) {
    const dir = hi.clone().sub(lo);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    this.box(lo.clone().add(hi).multiplyScalar(0.5), V(thick, dir.length(), width), paint, new THREE.Euler().setFromQuaternion(q));
  }

  /** A stud under the sole (cleats): a 4-sided frustum from the ground up into the sole. */
  stud(u: number, across: number, h: number, r: number, paint: Paint) {
    const c = V(this.cx(u) + across * this.hw(u), 0, this.z(u));
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const lo = corners.map(([a, b]) => this.v(V(c.x + a * r * 0.6, 0, c.z + b * r * 0.6)));
    const hi = corners.map(([a, b]) => this.v(V(c.x + a * r, h + 0.002, c.z + b * r)));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ids = [lo[i], lo[j], hi[j], hi[i]];
      const m = this.centroid(ids);
      this.face(ids, m.sub(V(c.x, m.y, c.z)), paint);
    }
  }

  /** Point on the bare body foot at station u (angle a over its section: 0 one side, π/2 the top, π the other). */
  onFoot(u: number, a: number, raise: number) {
    const z = this.z(u);
    const t = (0.06 - z) / this.len;
    const w = this.p.s.foot.w * bodyFoot(t, 1) + raise;
    const h = FOOT_H * bodyFoot(t, 2) + raise;
    return V(this.x + Math.cos(a) * w, Math.sin(a) * h, z);
  }

  /**
   * A flat strap with thickness along a path on the skin (`pts` with their outward normals): top face and
   * both sides; the ends go into the sole.
   */
  ribbon(pts: readonly THREE.Vector3[], normals: readonly THREE.Vector3[], width: number, thick: number, paint: Paint, region: RegionName = this.region) {
    const L: number[] = [];
    const R: number[] = [];
    const LT: number[] = [];
    const RT: number[] = [];
    const sides: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const tan = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const n = normals[i].clone().normalize();
      const side = new THREE.Vector3().crossVectors(tan, n).normalize();
      sides.push(side);
      const l = pts[i].clone().addScaledVector(side, -width / 2);
      const r = pts[i].clone().addScaledVector(side, width / 2);
      L.push(this.v(l));
      R.push(this.v(r));
      LT.push(this.v(l.clone().addScaledVector(n, thick)));
      RT.push(this.v(r.clone().addScaledVector(n, thick)));
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const n = normals[i].clone().add(normals[i + 1]);
      const side = sides[i].clone().add(sides[i + 1]);
      this.face([LT[i], RT[i], RT[i + 1], LT[i + 1]], n, paint, region);
      this.face([L[i], LT[i], LT[i + 1], L[i + 1]], side.clone().negate(), darker(paint, 1), region);
      this.face([R[i], RT[i], RT[i + 1], R[i + 1]], side, darker(paint, 1), region);
    }
  }

  /** A strap across the bare foot at station u, from the sole on one side over the top to the other. */
  footStrap(u: number, width: number, paint: Paint) {
    const t = (0.06 - this.z(u)) / this.len;
    const h = FOOT_H * bodyFoot(t, 2);
    const a0 = Math.asin(clamp01((this.soleTop(u) - 0.002) / (h + 0.004)));
    const as = Array.from({ length: 5 }, (_, i) => lerp(a0, Math.PI - a0, i / 4));
    const pts = as.map((a) => this.onFoot(u, a, 0.003));
    const normals = as.map((a) => V(Math.cos(a), Math.sin(a), 0));
    this.ribbon(pts, normals, width, 0.005, paint);
  }

  /** Is face k (0..4 across the upper) on the outer side of this foot? */
  outer(k: number) {
    return this.s > 0 ? k >= 3 : k <= 1;
  }
}

type Make = (f: Foot) => void;

/** A shoe: its last and how each foot is built. */
interface ShoeDef {
  last?: LastOptions;
  make: Make;
}

/** The padded collar of a low shoe: higher at the heel (pull tab) and the tongue, dipping under the ankles. */
const collar = (f: Foot, paint: Paint, lining: Paint, o: { y?: number; out?: number; tongue?: number; back?: number; segs?: number } = {}) => {
  const y = o.y ?? 0.124;
  f.ring({
    y0: y - 0.026,
    y1: (a) => y + (o.back ?? 0.012) * Math.max(0, -Math.sin(a)) + (o.tongue ?? 0.008) * Math.max(0, Math.sin(a)) ** 2 - 0.006 * Math.cos(a) ** 2,
    out: o.out ?? 0.012,
    paint,
    lining,
    segs: o.segs ?? 8,
  });
};

/** Sneaker side stripe on both sides of the upper (a slanted pair of strips). */
const sideStripes = (f: Foot, u0: number, u1: number, paint: Paint) => {
  f.b.detail(() => {
    f.strip(u0, u1, 0.03, 0.17, paint);
    f.strip(u0, u1, 0.83, 0.97, paint);
  });
};

/** The common sneaker paint: heel counter and toe in `accent`, the instep `tongue`. */
const sneakerPaint =
  (accent: Paint, tongue: Paint, toe: Paint = accent) =>
  (u: number, k: number) => {
    if (u < 0.1) return accent;
    if (u > 0.9) return toe;
    if (k === 2 && u < 0.45) return tongue;
    return PRIMARY;
  };

const SHOES: Record<string, ShoeDef> = {
  // Casual sneaker: cupsole in the detail color over a gray outsole edge, heel counter and toe overlay.
  tenis: {
    make: (f) => {
      f.sole(cup(0.028, 0.022), DETAIL, { bottom: RUBBER_GRAY });
      f.upper({ top: TOPS.low, paint: sneakerPaint(SECONDARY, P1) });
      collar(f, P1, P3);
      sideStripes(f, 0.36, 0.5, SECONDARY);
      f.laces([0.36, 0.43, 0.5], DETAIL);
    },
  },
  // Running shoe: chunky midsole (detail) on a rubber outsole, rocker heel; mesh upper with overlays.
  tenisCorrida: {
    last: { spring: 0.018 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.003 }, { y: 0.007, out: 0.002 }, { y: (u) => lerp(0.04, 0.024, u), out: 0.004 }], (l) => (l === 0 ? RUBBER : DETAIL), { bottom: RUBBER });
      f.upper({
        top: TOPS.low,
        paint: (u, k) => {
          if (u < 0.1) return SECONDARY;
          if (u > 0.9) return SECONDARY;
          if ((k === 1 || k === 3) && u > 0.25 && u < 0.6) return SECONDARY;
          if ((k === 0 || k === 4) && u > 0.25 && u < 0.85) return P1;
          return PRIMARY;
        },
      });
      collar(f, PRIMARY, P3, { back: 0.018, out: 0.01 });
      f.laces([0.35, 0.42, 0.49, 0.56], DETAIL, 0.075);
    },
  },
  // High-top: canvas-like upper with a padded ankle shaft, rubber toe cap and laces up to the top.
  canoAlto: {
    make: (f) => {
      f.sole(cup(0.03, 0.026), DETAIL, { bottom: RUBBER_GRAY });
      f.upper({ top: TOPS.low, paint: (u) => (u > 0.86 ? DETAIL : u < 0.1 ? SECONDARY : PRIMARY) });
      f.shaft({ y0: 0.075, y1: 0.205, d: 0.014, paint: (y, a) => (Math.sin(a) > 0.85 && y > 0.1 ? P1 : PRIMARY), rim: { h: 0.014, out: 0.004, paint: P1 }, calf: 0 });
      f.laces([0.36, 0.46], DETAIL);
      f.shaftLaces([0.125, 0.155, 0.185], DETAIL);
      // Round patch on the inner ankle.
      f.b.detail(() => {
        const a = f.s > 0 ? 0 : Math.PI;
        const ids = [V(0, -0.016, 0), V(0, 0, 0.3), V(0, 0.016, 0), V(0, 0, -0.3)].map((d) => f.v(f.onShaft(0.15 + d.y, a + d.z, 0.003)));
        f.face(ids, V(-Math.cos(a), 0, 0), SECONDARY, f.ankle);
      });
    },
  },
  // Skate shoe: wide, flat vulcanized sole, suede toe, puffy tongue and a fat padded collar.
  skate: {
    last: { width: 1.08, spring: 0.006, tip: 0.6 },
    make: (f) => {
      f.sole(cup(0.03, 0.028), OFF_WHITE, { bottom: RUBBER_GRAY, top: OFF_WHITE });
      f.upper({ top: TOPS.chunky, paint: (u, k) => (u > 0.72 || u < 0.1 ? P1 : k === 2 && u < 0.5 ? SECONDARY : PRIMARY), heel: P1 });
      // Fat padded collar with a puffy tongue rising in front of the shin.
      collar(f, PRIMARY, P3, { out: 0.018, y: 0.128, tongue: 0.024 });
      f.laces([0.38, 0.46, 0.54], OFF_WHITE, 0.09);
    },
  },
  // Basketball: mid-top with an ankle strap, chunky midsole on rubber, panels in the secondary color.
  tenisBasquete: {
    last: { width: 1.04 },
    make: (f) => {
      f.sole(cup(0.036, 0.026), DETAIL, { bottom: RUBBER, top: DETAIL });
      f.upper({ top: TOPS.chunky, paint: (u, k) => ((k === 0 || k === 4) && u > 0.2 && u < 0.7 ? SECONDARY : u < 0.1 || u > 0.9 ? SECONDARY : PRIMARY) });
      f.shaft({ y0: 0.075, y1: 0.19, d: 0.013, paint: (_y, a) => (Math.sin(a) > 0.85 ? P1 : PRIMARY), rim: { h: 0.018, out: 0.004, paint: SECONDARY }, calf: 0 });
      f.laces([0.36, 0.44, 0.52], DETAIL);
      // Ankle strap across the front of the shaft.
      f.box(f.onShaft(0.135, Math.PI / 2, 0.002), V(0.05, 0.018, 0.005), SECONDARY, new THREE.Euler(), f.ankle);
    },
  },
  // Slip-on: no laces, elastic gores beside the tongue, a checkered vamp, thin padded topline.
  slipOn: {
    last: { spring: 0.006 },
    make: (f) => {
      f.sole(cup(0.028, 0.026), OFF_WHITE, { bottom: RUBBER_GRAY, top: OFF_WHITE });
      f.upper({
        top: [0.104, 0.112, 0.112, 0.086, 0.064, 0.05, 0.036],
        paint: (u, k) => {
          if ((k === 1 || k === 3) && u > 0.2 && u < 0.45) return P2;
          if (u > 0.45 && k > 0 && k < 4) return (Math.floor(u * 12) + k) % 2 ? SECONDARY : PRIMARY;
          return PRIMARY;
        },
      });
      collar(f, P1, P3, { y: 0.118, out: 0.008, tongue: 0.004, back: 0.008, segs: 7 });
    },
  },
  // Combat boot: lugged rubber sole, tall laced shaft with a padded cuff (pants bloused over it).
  bota: {
    last: { spring: 0.008 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.005 }, { y: (u) => lerp(0.032, 0.024, u), out: 0.002 }], RUBBER, { top: RUBBER_GRAY });
      f.upper({ top: TOPS.boot, paint: (u, k) => (k === 2 && u > 0.25 && u < 0.5 ? P1 : PRIMARY) });
      f.shaft({ y0: 0.07, y1: 0.27, d: 0.022, snug: 0.011, paint: (_y, a) => (Math.sin(a) > 0.9 ? P1 : PRIMARY), rim: { h: 0.022, out: 0.004, paint: P2 } });
      f.laces([0.36, 0.44], SECONDARY);
      f.shaftLaces([0.14, 0.18, 0.22], SECONDARY);
    },
  },
  // Tactical boot: leather toe and heel, nylon side panels (secondary), rubber toe bumper, pull loop.
  botaTatica: {
    last: { spring: 0.01, width: 1.03 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.005 }, { y: (u) => lerp(0.034, 0.024, u), out: 0.002 }], RUBBER, { top: RUBBER_GRAY });
      f.upper({ top: TOPS.boot, paint: (u, k) => (u > 0.9 ? RUBBER_GRAY : (k === 0 || k === 4 || k === 1 || k === 3) && u > 0.2 && u < 0.6 ? SECONDARY : PRIMARY) });
      f.shaft({ y0: 0.07, y1: 0.25, d: 0.022, snug: 0.011, paint: (_y, a) => (Math.abs(Math.cos(a)) > 0.6 ? SECONDARY : PRIMARY), rim: { h: 0.02, out: 0.004, paint: P2 } });
      f.laces([0.36, 0.44], fixed('black'));
      f.shaftLaces([0.13, 0.165, 0.2], fixed('black'));
      f.b.detail(() => f.box(f.onShaft(0.262, -Math.PI / 2, 0.004), V(0.02, 0.03, 0.005), SECONDARY, new THREE.Euler(), f.shin));
    },
  },
  // Desert boot (chukka): soft suede to just over the ankle, two eyelet rows, crepe sole.
  botaDeserto: {
    last: { spring: 0.006 },
    make: (f) => {
      f.sole(cup(0.026, 0.022), fixed('leather5'), { bottom: fixed('leather4') });
      f.upper({ top: TOPS.boot, paint: (u, k) => (k === 2 && u > 0.28 && u < 0.5 ? P1 : PRIMARY) });
      f.shaft({ y0: 0.07, y1: 0.165, d: 0.017, paint: (_y, a) => (Math.sin(a) > 0.9 ? P1 : PRIMARY), rim: { h: 0.008, out: 0.002, paint: P1 }, calf: 0 });
      f.laces([0.36, 0.44], SECONDARY, 0.1);
      f.shaftLaces([0.13], SECONDARY);
    },
  },
  // Hiking boot: lugged rubber outsole, midsole (detail), suede overlays, rubber toe rand, padded collar.
  botaTrilha: {
    last: { spring: 0.012, width: 1.04 },
    make: (f) => {
      f.sole(lug(0.036, 0.026, 0.01), (l) => (l === 0 ? RUBBER : DETAIL), { bottom: RUBBER });
      f.upper({ top: TOPS.boot, paint: (u, k) => (u > 0.9 ? RUBBER_GRAY : u > 0.72 || u < 0.1 ? SECONDARY : (k === 0 || k === 4) && u < 0.55 ? SECONDARY : PRIMARY) });
      f.shaft({ y0: 0.07, y1: 0.19, d: 0.015, paint: PRIMARY, rim: { h: 0.022, out: 0.005, paint: SECONDARY }, calf: 0 });
      f.laces([0.36, 0.44], DETAIL);
      f.shaftLaces([0.13, 0.165], DETAIL);
    },
  },
  // Moc-toe work boot: flat cream wedge sole, the U seam over the toe, laced shaft.
  botaTrabalho: {
    last: { spring: 0.004, width: 1.03, tip: 0.62 },
    make: (f) => {
      f.sole([{ y: 0, out: 0 }, { y: (u) => lerp(0.03, 0.026, u) }], SECONDARY, { bottom: darker(SECONDARY, 2) });
      f.upper({ top: TOPS.boot, paint: (u, k) => (k === 2 && u > 0.25 && u < 0.5 ? P1 : PRIMARY) });
      f.b.detail(() => {
        f.strip(0.56, 0.58, 0.26, 0.74, P3);
        f.strip(0.58, 0.93, 0.25, 0.28, P3);
        f.strip(0.58, 0.93, 0.72, 0.75, P3);
      });
      f.shaft({ y0: 0.07, y1: 0.25, d: 0.022, snug: 0.011, paint: (_y, a) => (Math.sin(a) > 0.9 ? P1 : PRIMARY), rim: { h: 0.02, out: 0.004, paint: P1 } });
      f.laces([0.38], P3);
      f.shaftLaces([0.135, 0.17, 0.205], P3);
    },
  },
  // Biker (engineer) boot: tall plain shaft with a buckled strap at the top and one over the instep, heel.
  botaMoto: {
    last: { spring: 0.006, tip: 0.55 },
    make: (f) => {
      f.sole(heeled(0.026, 0.014), RUBBER, { top: RUBBER_GRAY });
      f.heel(0.026, RUBBER);
      f.upper({ top: TOPS.boot, paint: () => PRIMARY });
      // The cuff is the buckled strap around the top.
      f.shaft({ y0: 0.07, y1: 0.32, d: 0.026, minR: 0.086, segs: 6, paint: PRIMARY, rim: { h: 0.026, out: 0.004, paint: P2 } });
      // Strap over the instep; the buckle on the outer side of the top strap.
      f.strip(0.3, 0.36, 0.1, 0.9, P2, { raise: 0.005 });
      f.b.detail(() => {
        f.box(f.onShaft(0.305, f.s > 0 ? Math.PI : 0, 0.004), V(0.006, 0.022, 0.022), DETAIL, new THREE.Euler(), f.shin);
      });
    },
  },
  // Cowboy boot: pointed toe, slanted cuban heel, a two-tone shaft scalloped at the top, pull loops.
  botaCauboi: {
    last: { long: 0.03, tip: 0.18, spring: 0.012 },
    make: (f) => {
      f.sole(heeled(0.04, 0.012), fixed('leather1'));
      f.heel(0.04, fixed('leather1'), { taper: 0.78, slant: 0.012 });
      f.upper({ top: [0.13, 0.15, 0.13, 0.092, 0.064, 0.044, 0.03], paint: (u, k) => (k === 2 && u > 0.55 && u < 0.85 ? SECONDARY : PRIMARY) });
      f.shaft({
        y0: 0.08,
        y1: 0.34,
        d: 0.026,
        minR: 0.086,
        flare: (t) => 0.008 * t,
        segs: 8,
        // Two-tone: the shaft in the secondary leather over the foot.
        paint: SECONDARY,
        // Peaks at the front and back, dips at the sides.
        along: (t, a) => (t > 0.9 ? -0.032 * Math.cos(a) ** 2 : 0),
        rim: { h: 0.012, out: 0.003, paint: P1 },
      });
      f.b.detail(() => {
        // Pull loops: thin two-sided straps standing up on both sides.
        for (const a of [0, Math.PI]) {
          const c = f.onShaft(0.31, a, 0.003);
          const ids = [V(0, 0, -0.008), V(0, 0, 0.008), V(0, 0.04, 0.007), V(0, 0.04, -0.007)].map((d) => f.v(c.clone().add(d)));
          f.face(ids, V(-Math.cos(a), 0, 0), P1, f.shin);
          f.face(ids, V(Math.cos(a), 0, 0), P2, f.shin);
        }
      });
    },
  },
  // Rain boot: one smooth rubber piece to mid-calf, straight shaft with a rolled top, flat tread.
  botaChuva: {
    last: { spring: 0.006, width: 1.04 },
    make: (f) => {
      f.sole(lug(0.026, 0.022, 0.01), RUBBER, { top: P2 });
      f.upper({ top: TOPS.boot, paint: (u) => (u > 0.86 ? P1 : PRIMARY), extra: 0.002 });
      f.shaft({ y0: 0.07, y1: 0.38, d: 0.024, minR: 0.09, straight: 0.8, flare: (t) => 0.008 * t, paint: PRIMARY, rim: { h: 0.016, out: 0.005, paint: P1 } });
    },
  },
  // Snow boot: bulky rubber lower, quilted shaft, a fur cuff with a ragged edge, toggle laces.
  botaNeve: {
    last: { width: 1.12, spring: 0.008, d: 0.016 },
    make: (f) => {
      f.sole(cup(0.034, 0.028), RUBBER, { top: RUBBER_GRAY });
      f.upper({ top: TOPS.chunky, paint: (u, k) => (k === 2 && u > 0.25 && u < 0.6 ? P1 : PRIMARY) });
      // Quilted: vertical channels in two shades.
      f.shaft({ y0: 0.07, y1: 0.22, d: 0.03, paint: (_y, a) => (Math.floor(((a - Math.PI / 2) / (Math.PI * 2)) * 7 + 7) % 2 ? P1 : PRIMARY), calf: 0.5 });
      f.b.tube({
        from: V(f.x, 0.205, 0.002),
        to: V(f.x, 0.27, 0.002),
        radius: (t) => f.shinR(lerp(0.205, 0.27, t)) + 0.044,
        sx: () => 0.94,
        // Ragged fur: the bottom edge zigzags.
        along: (t, a) => (t < 0.01 ? 0.007 * Math.cos(4 * (a - Math.PI / 2)) : 0),
        ts: [0, 1],
        segments: 8,
        a0: Math.PI / 2,
        region: f.shin,
        weights: (t) => f.w(0, lerp(0.205, 0.27, t)),
        paint: SECONDARY,
        build: () => 0.12,
        rimEnd: { h: 0.01, out: 0.002, paint: darker(SECONDARY, 1) },
      });
      f.laces([0.36, 0.46], SECONDARY, 0.1);
      f.shaftLaces([0.13, 0.17], SECONDARY);
    },
  },
  // Chelsea boot: sleek ankle boot, elastic gores on both sides, pull tab at the back, low stacked heel.
  chelsea: {
    last: { long: 0.008, spring: 0.008 },
    make: (f) => {
      f.sole(heeled(0.022, 0.012), RUBBER, { top: fixed('leather1') });
      f.heel(0.022, fixed('leather1'));
      f.upper({ top: TOPS.dress.map((y, i) => (i < 3 ? y + 0.01 : y)), paint: () => PRIMARY });
      f.shaft({ y0: 0.07, y1: 0.2, d: 0.017, paint: (y, a) => (Math.abs(Math.cos(a)) > 0.85 && y > 0.1 ? SECONDARY : PRIMARY), rim: { h: 0.008, out: 0.002, paint: P1 }, calf: 0 });
      f.b.detail(() => f.box(f.onShaft(0.208, -Math.PI / 2, 0.003), V(0.016, 0.026, 0.004), SECONDARY));
    },
  },
  // Knee-high boot: slim shaft up to the knee following the calf, side zip, heel.
  botaCanoLongo: {
    last: { long: 0.012, spring: 0.01, tip: 0.36 },
    make: (f) => {
      f.sole(heeled(0.035, 0.012), RUBBER, { top: RUBBER_GRAY });
      f.heel(0.035, RUBBER, { taper: 0.75 });
      f.upper({ top: TOPS.dress.map((y, i) => (i < 3 ? y + 0.02 : y)), paint: () => PRIMARY });
      const zip = f.s > 0 ? Math.PI : 0;
      f.shaft({
        y0: 0.075,
        y1: f.p.j.kneeY + 0.005,
        d: 0.016,
        ts: [0, 0.35, 0.6, 1],
        flare: (t) => 0.008 * smooth(t, 0.7, 1),
        paint: (_y, a) => (Math.abs(Math.atan2(Math.sin(a - zip), Math.cos(a - zip))) < 0.3 ? P2 : PRIMARY),
        rim: { h: 0.014, out: 0.004, paint: P1 },
      });
    },
  },
  // Dress shoe (oxford): sleek almond toe, cap toe seam, thin laces, leather sole and a low heel.
  sapatoSocial: {
    last: { long: 0.014, tip: 0.38, spring: 0.008, d: 0.01 },
    make: (f) => {
      f.sole(heeled(0.02, 0.01), SECONDARY, { top: SECONDARY });
      f.heel(0.02, SECONDARY);
      f.upper({ top: TOPS.dress, paint: (u, k) => (k === 2 && u > 0.25 && u < 0.45 ? P1 : PRIMARY) });
      f.b.detail(() => f.strip(0.76, 0.785, 0.02, 0.98, P2, { raise: 0.002 }));
      collar(f, PRIMARY, P3, { y: 0.112, out: 0.008, tongue: 0, back: 0.004, segs: 7 });
      f.laces([0.37, 0.43, 0.49], SECONDARY, 0.07);
    },
  },
  // Loafer: moc apron seam over the vamp, a penny strap across it, low heel.
  mocassim: {
    last: { long: 0.01, tip: 0.42, spring: 0.008, d: 0.01 },
    make: (f) => {
      f.sole(heeled(0.016, 0.01), fixed('leather2'), { top: fixed('leather2') });
      f.heel(0.016, fixed('leather1'));
      f.upper({ top: [0.098, 0.106, 0.1, 0.08, 0.058, 0.044, 0.03], paint: (u, k) => (k === 2 && u > 0.5 ? P1 : PRIMARY) });
      f.b.detail(() => {
        f.strip(0.48, 0.5, 0.3, 0.7, P3, { raise: 0.003 });
        f.strip(0.5, 0.92, 0.28, 0.31, P3, { raise: 0.003 });
        f.strip(0.5, 0.92, 0.69, 0.72, P3, { raise: 0.003 });
      });
      f.strip(0.4, 0.46, 0.2, 0.8, P1, { raise: 0.005, edge: 0.004 });
      f.b.detail(() => f.strip(0.415, 0.445, 0.44, 0.56, P3, { raise: 0.0062 }));
      collar(f, P1, P3, { y: 0.108, out: 0.006, tongue: 0, back: 0.004, segs: 6 });
    },
  },
  // Work shoe (safety): chunky lugged sole, tall rounded steel toe, padded collar.
  sapatoTrabalho: {
    last: { width: 1.06, tip: 0.62, spring: 0.01 },
    make: (f) => {
      f.sole(lug(0.034, 0.026), RUBBER, { top: RUBBER_GRAY });
      f.upper({ top: [0.11, 0.122, 0.12, 0.094, 0.078, 0.068, 0.052], paint: (u, k) => (u > 0.72 ? P1 : k === 2 && u < 0.5 ? P2 : PRIMARY) });
      collar(f, P1, P3, { out: 0.014 });
      f.laces([0.36, 0.43, 0.5], fixed('black'));
    },
  },
  // Flats: a thin shell around the toes and the sides of the foot (the instep shows), a bow on the toe.
  sapatilha: {
    last: { d: 0.005, spring: 0.004, tip: 0.5 },
    make: (f) => {
      f.sole(cup(0.01, 0.008), RUBBER, { top: PRIMARY });
      f.upper({ top: [0.042, 0.044, 0.046, 0.062, 0.056, 0.044, 0.03], paint: () => PRIMARY });
      f.b.detail(() => {
        const c = f.at(0.66, 0.5, 0.004);
        for (const s of [-1, 1]) f.box(c.clone().add(V(s * 0.011, 0, 0)), V(0.016, 0.006, 0.012), DETAIL, new THREE.Euler(0, 0, s * 0.35));
        f.box(c, V(0.007, 0.008, 0.009), darker(DETAIL, 1));
      });
    },
  },
  // Sport sandal: thick footbed (secondary) on a rubber outsole, webbing straps over the toes, the instep
  // and around the ankle, a heel strap.
  papete: {
    last: { spring: 0.008 },
    make: (f) => {
      f.sole(cup(0.026, 0.02), SECONDARY, { top: darker(SECONDARY, 2), bottom: RUBBER });
      f.footStrap(0.78, 0.024, PRIMARY);
      f.footStrap(0.44, 0.03, PRIMARY);
      f.ring({ y0: 0.098, y1: () => 0.124, out: 0.008, paint: PRIMARY, segs: 6, bottom: true });
      // Heel strap from the footbed up the back to the ankle strap; side straps down to the sole.
      const back = f.shinR(0.1) + 0.006;
      f.beam(V(f.x, f.soleTop(0) - 0.004, f.z(0) - 0.004), V(f.x, 0.104, back), 0.004, 0.024, PRIMARY);
      for (const side of [-1, 1]) {
        const lo = V(f.cx(0.24) + side * f.hw(0.24, -0.004), f.soleTop(0.24) - 0.004, f.z(0.24));
        const hi = V(f.x + side * (f.shinR(0.11) * 0.92 + 0.007), 0.108, 0.004);
        f.beam(lo, hi, 0.022, 0.006, PRIMARY);
      }
      f.b.detail(() => f.box(f.onFoot(0.44, f.s > 0 ? 0.35 : Math.PI - 0.35, 0.01), V(0.01, 0.018, 0.026), darker(PRIMARY, 2), new THREE.Euler(0, 0, f.s * 0.9)));
    },
  },
  // Flip-flop: a thin two-tone sole and the Y strap from the toe post down to both sides.
  chinelo: {
    last: { spring: 0.004, d: 0.008 },
    make: (f) => {
      f.sole([{ y: 0 }, { y: 0.008 }, { y: 0.017 }], (l) => (l === 0 ? SECONDARY : PRIMARY), { top: PRIMARY, bottom: SECONDARY });
      const top = f.soleTop(0.8);
      for (const k of [-1, 1]) {
        // From the post between the toes over the foot to the sole at the middle of the foot.
        const a = (t: number) => Math.PI / 2 + k * t * (Math.PI / 2 - 0.25);
        const us = [0.8, 0.72, 0.6, 0.5];
        const ts = [0, 0.45, 0.85, 1];
        const pts = us.map((u, i) => f.onFoot(u, a(ts[i]), 0.002));
        pts[0] = V(f.cx(0.8) - f.s * 0.012, top + 0.012, f.z(0.8));
        pts[3].y = Math.max(pts[3].y, top);
        const normals = us.map((_, i) => V(Math.cos(a(ts[i])), Math.sin(a(ts[i])), 0));
        f.ribbon(pts, normals, 0.014, 0.005, SECONDARY);
      }
      f.box(V(f.cx(0.8) - f.s * 0.012, top + 0.006, f.z(0.8)), V(0.008, 0.016, 0.01), SECONDARY);
    },
  },
  // Cleats: a thin plate on studs (the studs stand on the ground), sleek low upper, stripes on the side.
  chuteira: {
    last: { spring: 0.004, d: 0.01 },
    make: (f) => {
      const h = 0.012;
      f.sole([{ y: h }, { y: (u) => lerp(h + 0.014, h + 0.01, u) }], SECONDARY, { top: SECONDARY });
      for (const [u, a] of [[0.12, -0.5], [0.12, 0.5], [0.6, -0.6], [0.62, 0.6], [0.84, -0.45], [0.86, 0.45]] as const) f.stud(u, a, h, 0.008, SECONDARY);
      // Sock-like knit collar: the upper itself rises around the ankle.
      f.upper({ top: [0.122, 0.126, 0.12, 0.09, 0.064, 0.05, 0.036], paint: (u, k) => (u < 0.1 ? P1 : k === 2 && u < 0.45 ? P2 : PRIMARY) });
      f.b.detail(() => {
        for (const u of [0.42, 0.49]) {
          f.strip(u, u + 0.03, 0.02, 0.19, DETAIL);
          f.strip(u, u + 0.03, 0.81, 0.98, DETAIL);
        }
      });
      f.laces([0.36, 0.43, 0.5], OFF_WHITE, 0.07);
    },
  },
  // Classic canvas sneaker: off-white rubber sole with a colored stripe, rubber toe cap and bumper.
  lona: {
    last: { spring: 0.006 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.002 }, { y: (u) => lerp(0.02, 0.018, u) }, { y: (u) => lerp(0.026, 0.023, u) }], (l) => (l === 0 ? OFF_WHITE : SECONDARY), { top: OFF_WHITE, bottom: fixed('leather4') });
      f.upper({ top: [0.104, 0.112, 0.112, 0.086, 0.062, 0.048, 0.036], paint: (u) => (u > 0.86 ? OFF_WHITE : PRIMARY), heel: SECONDARY });
      collar(f, PRIMARY, OFF_WHITE, { y: 0.118, out: 0.008, tongue: 0.006, back: 0.006, segs: 7 });
      f.laces([0.36, 0.42, 0.48, 0.54], OFF_WHITE, 0.08);
    },
  },
  // Work galoshes: tall rubber boot with a reinforced toe and heel, straight shaft, heavy tread.
  galocha: {
    last: { width: 1.06, spring: 0.008, tip: 0.6 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.005 }, { y: (u) => lerp(0.03, 0.024, u), out: 0.002 }], RUBBER, { top: P2 });
      f.upper({ top: TOPS.chunky, paint: (u) => (u > 0.74 || u < 0.1 ? P2 : PRIMARY), extra: 0.002 });
      f.shaft({ y0: 0.07, y1: 0.36, d: 0.028, minR: 0.092, straight: 1, paint: (y) => (y < 0.12 ? P2 : PRIMARY), ts: [0, 0.2, 1], rim: { h: 0.02, out: 0.006, paint: P2 } });
    },
  },
  // Heeled boot: tall slim heel, pointed toe, mid-calf shaft with a side zip.
  botaSalto: {
    last: { long: 0.02, tip: 0.26, spring: 0.008, d: 0.01 },
    make: (f) => {
      const h = 0.066;
      f.sole(heeled(h, 0.01), RUBBER, { top: RUBBER_GRAY });
      f.heel(h, RUBBER, { taper: 0.45, u1: 0.2, w: 0.75, slant: -0.004 });
      f.upper({ top: [0.17, 0.17, 0.15, 0.1, 0.064, 0.046, 0.032], paint: () => PRIMARY });
      const zip = f.s > 0 ? Math.PI : 0;
      f.shaft({
        y0: 0.08,
        y1: 0.33,
        d: 0.016,
        snug: 0.009,
        paint: (_y, a) => (Math.abs(Math.atan2(Math.sin(a - zip), Math.cos(a - zip))) < 0.3 ? P2 : PRIMARY),
        rim: { h: 0.012, out: 0.003, paint: P1 },
      });
    },
  },
  // Clog: thick wooden sole (secondary) on rubber, a closed leather front, open back, rivets.
  tamanco: {
    last: { spring: 0.012, width: 1.04, d: 0.008 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.002 }, { y: 0.006 }, { y: (u) => lerp(0.03, 0.022, u), out: 0.002 }], (l) => (l === 0 ? RUBBER : SECONDARY), { top: darker(SECONDARY, 1) });
      f.upper({ from: 2, top: [0.1, 0.1, 0.1, 0.098, 0.08, 0.064, 0.048], paint: (u, k) => (k === 2 && u > 0.6 ? P1 : PRIMARY) });
      f.b.detail(() => {
        for (const c of [0.03, 0.97]) for (const u of [0.42, 0.7]) f.box(f.at(u, c, 0.001).add(V(0, 0.004, 0)), V(0.006, 0.006, 0.006), STEEL);
      });
    },
  },
  // Platform sneaker: a tall off-white platform with a colored band, canvas upper over it.
  plataforma: {
    last: { spring: 0.006, width: 1.03 },
    make: (f) => {
      f.sole([{ y: 0, out: -0.002 }, { y: 0.038 }, { y: (u) => lerp(0.05, 0.046, u), out: 0.002 }], (l) => (l === 0 ? OFF_WHITE : SECONDARY), { top: OFF_WHITE, bottom: RUBBER_GRAY });
      f.upper({ top: [0.14, 0.15, 0.142, 0.118, 0.1, 0.088, 0.074], paint: (u) => (u > 0.88 ? OFF_WHITE : PRIMARY), heel: SECONDARY });
      collar(f, PRIMARY, OFF_WHITE, { y: 0.152, out: 0.01, tongue: 0.006, back: 0.006, segs: 7 });
      f.laces([0.36, 0.43, 0.5, 0.57], OFF_WHITE, 0.08);
    },
  },
};

export function shoes(id: string, sex: Sex): PieceGeometry {
  // Barefoot: nothing at all (the body's feet show).
  if (id === 'descalco') return {};
  const def = SHOES[id] ?? SHOES.tenis;
  const { b, p } = start(sex, id.length * 23 + 1);
  for (const s of [-1, 1] as Side[]) def.make(new Foot(b, p, s, def.last));
  return { skinned: b.build() };
}
