// Jackets, coats and vests (over-torso slot): the 30 pieces of the catalog's "jaqueta" category, worn over the
// top. Everything sits at D (3.4 cm) over the skin, which clears every top and its details (tops go up to
// ~2 cm with pockets and collar points; over 3 cm the body keeps only part of the chest's shape, a few mm); the
// hips flare a little more so the jacket goes over the pants' waistband. Long sleeves hide the top's sleeves
// (`over` in the item list) and end before the wrist.
//
// The torso is a sheet over the body's own surface (body.ts `torsoSurface`, so it follows the build morphs)
// that can leave the front open (a V or a straight gap: the top shows in front) with the cloth's thickness
// turned in along the edges. Coats hang a skirt from the hips in two panels (left and right, each following its
// thigh) split at the front and at a back vent, so the legs never cut through when walking; the panels have a
// lining, and the edges and hem bridge the two, which is the fabric's thickness. Quilted pieces bulge between
// horizontal seams. Collars: stand, ribbed, shirt (fall collar + points), notch lapels, fur, hood down; capes
// and ponchos are cones over the shoulders (with the hood up for the hooded cape).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { Generator, PieceGeometry } from '.';
import { headShell, sideName, type BodyParts, type Side } from '../body';
import { segment, type FacetBuilder, type Rim, type Weights } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY, type Paint } from '../palette';
import type { BoneName, RegionName } from '../rig';
import { foldShade, folds, start } from './common';
import { angDist, BACK, column, deg, FRONT, hash, Kit, lerp, segmentRect, sideness } from './kit';

type Surf = ReturnType<BodyParts['torsoSurface']>;
/** A surface over the body: (height, angle, offset, panel side) → point, normal, weights, region, morphs. */
type SurfFn = (y: number, a: number, off: number, side?: Side) => Surf;

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
/** 0 above `hi`, 1 below `lo` (smoothstep going down). */
const below = (x: number, hi: number, lo: number) => 1 - smooth(x, lo, hi);

/** Offset over the skin: clears the tops and their details (flat pockets stand off the curve at their corners). */
const D = 0.034;
/** Extra room in the sleeves at the elbow. */
const ELBOW = 0.006;
/** Coats: the skirt hangs from here (the torso sheet ends here). */
const YJ = 0.95;
/** Top of the torso sheet (the collar covers the edge). */
const TOP = 1.465;
const METAL = fixed('steel');
const BRASS = fixed('brass');
const BAND = darker(PRIMARY, 1);
const LINING = darker(PRIMARY, 3);

type Collar = 'stand' | 'tall' | 'rib' | 'shirt' | 'notch' | 'fur' | 'mandarin' | 'none';

interface JacketSpec {
  /** Bottom of the jacket (y): the torso's hem, or the coat's hem (under YJ the coat hangs a skirt). */
  hem: number;
  /** Coats: how much the skirt flares at the hem (m), the top of the back vent (y), the front panels wrapping. */
  coat?: { flare: number; vent?: number; wrap?: boolean; lining?: Paint };
  /** No sleeves. */
  vest?: boolean;
  /** Extra offset (puffy, structured) and the hip flare over the pants (m). */
  fit?: number;
  hip?: number;
  /** Hem band (null = none). */
  band?: { h: number; out: number; paint: Paint } | null;
  cuff?: Rim | null;
  /** Where the sleeve ends along the forearm (0..1). */
  sleeveEnd?: number;
  armFlare?: number;
  /** Front opening: half width (m) by height (the top shows); none = closed. */
  open?: (y: number) => number;
  collar: Collar;
  collarPaint?: Paint;
  /** Lapels (notch / fur): from the top button `y` up, `w` wide. */
  lapel?: { y: number; w: number; paint?: Paint; h?: number };
  /** A hood down on the back (its lining paint). */
  hood?: Paint;
  /** Quilting: rings `step` m apart bulging `amp` m. */
  puff?: { step: number; amp: number };
  body?: (y: number, a: number) => Paint;
  arm?: (t: number, a: number, s: Side) => Paint;
  /** Extra rows of the torso (color blocks) and of the forearms (t). */
  ts?: number[];
  foreRings?: number[];
  cols?: number;
  extra?: (j: Jacket) => void;
}

/** A jacket over a body: the Kit's helpers (patches, boxes, buttons, pockets) on the jacket's own surface. */
class Jacket extends Kit {
  readonly coat: boolean;
  constructor(
    b: FacetBuilder,
    p: BodyParts,
    readonly spec: JacketSpec,
  ) {
    super(b, p, D + (spec.fit ?? 0), spec.hem);
    this.coat = !!spec.coat;
  }

  /** Quilting bulge at height y (seams every `step` from the hem, or from YJ on coats). */
  puffAt(y: number) {
    const q = this.spec.puff;
    if (!q) return 0;
    const y0 = this.coat ? YJ : this.spec.hem;
    return q.amp * Math.abs(Math.sin((Math.PI * (y - y0)) / q.step));
  }

  /** Offset over the skin at height y above the skirt: the fit, a looser hip over the waistband, quilting. */
  prof(y: number) {
    // A little more room over the shoulder blades and the yoke (bulky tops' shoulder pads when the arms come forward).
    // The hip flare goes up over the belly a little (a hoodie's kangaroo pocket under a closed jacket).
    return this.d + (this.spec.hip ?? 0.022) * (1 - smooth(y, 1.02, 1.17)) + 0.006 * (1 - smooth(y, 1.12, 1.25)) + 0.005 * smooth(y, 1.25, 1.38) + this.puffAt(y);
  }

  /** How far down the skirt (0 at YJ, 1 at the hem). */
  skirtU(y: number) {
    return clamp((YJ - y) / (YJ - this.spec.hem), 0, 1);
  }

  /**
   * The coat's skirt: the hips' section at YJ pushed out and moved down, each panel weighted to its thigh.
   * Below the groin the front and the sides ride the thigh almost rigidly (a lifted knee carries the cloth over
   * it instead of coming through: crouching, running, sliding; the very front a little less, so it sags onto
   * the thigh instead of standing up like a roof), the back only half way (it hangs behind when crouched, clear
   * of the folded calves, yet goes back with a leg swinging back), more of it toward the hem. Below the knee
   * part of it follows the shin, so a long hem drapes down over a bent knee and swings back with a kick.
   */
  skirtSurf(y: number, a: number, off: number, side?: Side): Surf {
    const u = this.skirtU(y);
    // The flare opens to the sides and the back; the front hangs close to the thighs (the closer it is, the less
    // it lifts when a knee comes up).
    const flare = this.spec.coat!.flare * Math.pow(u, 1.4) * (1 - 0.6 * smooth(Math.sin(a), 0.2, 0.9));
    const s = this.p.torsoSurface(YJ, a, this.prof(YJ) + flare + this.puffAt(y) + off);
    s.p.y = y;
    // Details on the skirt (no side given) at the front edge go on the right panel, which wraps over the left one
    // on closed coats: a zipper or a storm flap must not straddle the split.
    const wrap = this.spec.coat!.wrap ? 0.18 : 0.06;
    const sd: Side = side ?? (angDist(a, FRONT) < wrap ? 1 : Math.cos(a) > 0 ? -1 : 1);
    const low = below(y, 0.55, 0.3);
    const sn = Math.sin(a);
    const k = below(y, 0.935, 0.8) * lerp(lerp(0.42, 0.8, low), lerp(0.97, 0.87, smooth(sn, 0.6, 0.95)), smooth(sn, -0.9, 0.3));
    const shin = 0.5 * low;
    s.w = [
      ['hips', 1 - k],
      [sideName('thigh', sd), k * (1 - shin)],
      [sideName('shin', sd), k * shin],
    ];
    s.region = 'pelvis';
    return s;
  }

  override surf(y: number, a: number, off = 0, side?: Side): Surf {
    if (this.coat && y < YJ) return this.skirtSurf(y, a, off, side);
    return this.p.torsoSurface(y, a, this.prof(y) + this.backRoom(y, a) + off);
  }

  /**
   * More room over the back: the arms coming forward stretch it over the top's back prints (jersey numbers), and
   * a hoodie's hood lies between the shoulder blades (a soft hump the jacket goes over).
   */
  backRoom(y: number, a: number) {
    const back = smooth(-Math.sin(a), 0.2, 0.8);
    return 0.006 * back * smooth(y, 1.0, 1.12) + 0.016 * bell(angDist(a, BACK), 0, deg(75)) * bell(y, 1.385, 0.14);
  }

  /** Half width of the jacket's section at height y (for X → angle). */
  halfWidth(y: number) {
    if (this.coat && y < YJ) return this.p.torsoAt(YJ).w + this.prof(YJ) + this.spec.coat!.flare * Math.pow(this.skirtU(y), 1.4) + this.puffAt(y);
    return this.p.torsoAt(y).w + this.prof(y);
  }

  override angX(X: number, y: number, back = false) {
    const k = Math.asin(clamp(X / this.halfWidth(y), -0.95, 0.95));
    return back ? BACK - k : FRONT + k;
  }

  /** Half angle of the front opening at y (0 = closed). */
  half(y: number) {
    return this.spec.open ? this.angX(this.spec.open(y), y) - FRONT : 0;
  }

  v(s: Surf, ao = 0) {
    return this.b.vertex(s.p, s.w, ao, { gordo: s.gordo, magro: s.magro });
  }

  /** A quad of vertices added before, wound to face `out`. */
  quadOut(a: number, b: number, c: number, d: number, out: THREE.Vector3, paint: Paint, region: RegionName, shade = 0) {
    const B = this.b;
    const n = new THREE.Vector3().crossVectors(B.position(c).sub(B.position(a)), B.position(d).sub(B.position(b)));
    if (n.dot(out) >= 0) B.quad(a, b, c, d, paint, region, shade);
    else B.quad(d, c, b, a, paint, region, shade);
  }

  // --- Torso ------------------------------------------------------------------------------------------------

  /** Rows of the torso sheet: hem band, the body's own rows (or the quilting seams), color blocks, the top. */
  torsoRows(): { y: number; off: number; paint?: Paint }[] {
    const s = this.spec;
    const y0 = this.coat ? YJ : s.hem;
    const band = this.coat ? null : s.band === undefined ? { h: 0.03, out: 0.006, paint: BAND } : s.band;
    const bh = band?.h ?? 0;
    const ys = new Set<number>();
    if (s.puff) {
      for (let y = y0 + s.puff.step / 2; y < TOP - 0.02; y += s.puff.step / 2) if (y > y0 + bh + 0.01) ys.add(Math.round(y * 1e4) / 1e4);
      for (const y of [1.435, 1.45]) ys.add(y);
    } else {
      // The body's own rows: all of them over the chest and shoulders (the pecs), every other one lower down (loose cloth).
      this.p.s.torso.forEach((r, i) => {
        if (r[0] > y0 + bh + 0.015 && r[0] < TOP - 0.004 && (r[0] > 1.2 || i % 2 === 1)) ys.add(r[0]);
      });
    }
    for (const y of s.ts ?? []) if (y > y0 + bh && y < TOP) ys.add(y);
    const rows: { y: number; off: number; paint?: Paint }[] = [];
    if (band) rows.push({ y: y0, off: -0.004, paint: band.paint }, { y: y0, off: band.out, paint: band.paint }, { y: y0 + bh, off: band.out, paint: band.paint }, { y: y0 + bh, off: 0 });
    else rows.push({ y: y0, off: 0 });
    for (const y of [...ys].sort((a, b) => a - b)) rows.push({ y, off: 0 });
    rows.push({ y: TOP, off: 0 });
    return rows;
  }

  /** The torso sheet, open in front if the spec says so, with the cloth's thickness turned in along the edges. */
  torso() {
    const s = this.spec;
    const rows = this.torsoRows();
    const cols = s.cols ?? 10;
    const paint = s.body ?? (() => PRIMARY);
    const at = (y: number, i: number) => {
      const h = this.half(y);
      return lerp(FRONT + h, FRONT + TAU - h, i / cols);
    };
    const grid = rows.map((r) => Array.from({ length: cols + 1 }, (_, i) => this.v(this.surf(r.y, at(r.y, i), r.off))));
    for (let j = 0; j < rows.length - 1; j++) {
      const yM = (rows[j].y + rows[j + 1].y) / 2;
      for (let i = 0; i < cols; i++) {
        const aM = at(yM, i + 0.5);
        const m = this.surf(yM, aM);
        // Folds: tension under the arms, bunching over the waist.
        const shade = yM > 1.25 && yM < 1.42 ? 0.5 * Math.sin(aM * 5 + yM * 40) : yM < 1.08 ? 0.35 * Math.sin(aM * 3 + yM * 30) : 0;
        this.quadOut(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i], m.n, rows[j + 1].paint ?? rows[j].paint ?? paint(yM, aM), m.region, shade);
      }
    }
    if (!s.open) return;
    // The edges of the open front: a facing turned in (the cloth's thickness).
    for (const [col, dir] of [
      [0, -1],
      [cols, 1],
    ] as const) {
      for (let j = 0; j < rows.length - 1; j++) {
        const r0 = rows[j];
        const r1 = rows[j + 1];
        if (Math.abs(r1.y - r0.y) < 1e-4) continue;
        const a0 = at(r0.y, col);
        const a1 = at(r1.y, col);
        const i0 = this.v(this.surf(r0.y, a0, r0.off - 0.008));
        const i1 = this.v(this.surf(r1.y, a1, r1.off - 0.008));
        const yM = (r0.y + r1.y) / 2;
        const aM = (a0 + a1) / 2;
        const m = this.surf(yM, aM);
        const out = this.surf(yM, aM + dir * 0.08).p.sub(m.p);
        this.quadOut(grid[j][col], grid[j + 1][col], i1, i0, out, darker(PRIMARY, 2), m.region);
      }
    }
  }

  /** A ring around the torso standing out `out` (belts, drawcord channels; `walls` false: a flush stripe). */
  band(y0: number, y1: number, out: number, paint: Paint, walls = true, cols = this.spec.cols ?? 10) {
    const rows = [
      { y: y0, off: 0 },
      { y: y0, off: out },
      { y: y1, off: out },
      { y: y1, off: 0 },
    ];
    const at = (y: number, i: number) => {
      const h = this.half(y);
      return lerp(FRONT + h, FRONT + TAU - h, i / cols);
    };
    const grid = rows.map((r) => Array.from({ length: cols + 1 }, (_, i) => this.v(this.surf(r.y, at(r.y, i), r.off))));
    for (let j = walls ? 0 : 1; j < (walls ? 3 : 2); j++) {
      for (let i = 0; i < cols; i++) {
        const yM = (rows[j].y + rows[j + 1].y) / 2;
        const m = this.surf(yM, at(yM, i + 0.5));
        const out = j === 0 ? new THREE.Vector3(0, -1, 0) : j === 2 ? new THREE.Vector3(0, 1, 0) : m.n;
        this.quadOut(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i], out, paint, m.region);
      }
    }
  }

  // --- Panels (coat skirts, capes) --------------------------------------------------------------------------

  /**
   * A panel of cloth with a lining: rows `ys` (top to bottom), angles from `range(y)` over `cols` columns, on
   * the surface `f`. The edges and the bottom bridge the outside and the lining (the fabric's thickness).
   * `lift(a)` raises some columns off the surface (an overlapping flap).
   */
  panel(
    f: SurfFn,
    ys: readonly number[],
    range: (y: number) => readonly [number, number],
    cols: number,
    o: { side?: Side; paint?: (y: number, a: number) => Paint; lining?: Paint; lift?: (a: number) => number; thick?: number; liningYs?: readonly number[] },
  ) {
    const lift = o.lift ?? (() => 0);
    const thick = o.thick ?? 0.01;
    const paint = o.paint ?? (() => PRIMARY);
    const lining = o.lining ?? LINING;
    const at = (y: number, i: number) => {
      const [a0, a1] = range(y);
      return lerp(a0, a1, i / cols);
    };
    const innerAt = (y: number, i: number) => this.v(f(y, at(y, i), lift(at(y, i)) - thick, o.side));
    const outer = ys.map((y) => Array.from({ length: cols + 1 }, (_, i) => this.v(f(y, at(y, i), lift(at(y, i)), o.side))));
    for (let j = 0; j < ys.length - 1; j++) {
      const yM = (ys[j] + ys[j + 1]) / 2;
      for (let i = 0; i < cols; i++) {
        const aM = at(yM, i + 0.5);
        const m = f(yM, aM, 0, o.side);
        const shade = 0.5 * Math.sin(aM * 4 + yM * 9);
        this.quadOut(outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i], m.n, paint(yM, aM), m.region, shade);
      }
    }
    // The lining (it may have fewer rows: it is only seen through the openings).
    const lys = o.liningYs ?? ys;
    const inner = lys.map((y) => Array.from({ length: cols + 1 }, (_, i) => innerAt(y, i)));
    for (let j = 0; j < lys.length - 1; j++) {
      const yM = (lys[j] + lys[j + 1]) / 2;
      for (let i = 0; i < cols; i++) {
        const m = f(yM, at(yM, i + 0.5), 0, o.side);
        this.quadOut(inner[j][i], inner[j][i + 1], inner[j + 1][i + 1], inner[j + 1][i], m.n.clone().negate(), lining, m.region);
      }
    }
    // Side edges: from the outside to the lining (the cloth's thickness).
    for (const [col, dir] of [
      [0, -1],
      [cols, 1],
    ] as const) {
      const edge = ys.map((y) => innerAt(y, col));
      for (let j = 0; j < ys.length - 1; j++) {
        const yM = (ys[j] + ys[j + 1]) / 2;
        const aM = (at(ys[j], col) + at(ys[j + 1], col)) / 2;
        const m = f(yM, aM, 0, o.side);
        const out = f(yM, aM + dir * 0.08, 0, o.side).p.sub(m.p);
        this.quadOut(outer[j][col], outer[j + 1][col], edge[j + 1], edge[j], out, darker(PRIMARY, 1), m.region);
      }
    }
    // Bottom edge (the hem's thickness).
    const last = ys.length - 1;
    const lLast = lys.length - 1;
    for (let i = 0; i < cols; i++) {
      const m = f(ys[last], at(ys[last], i + 0.5), 0, o.side);
      this.quadOut(outer[last][i], outer[last][i + 1], inner[lLast][i + 1], inner[lLast][i], new THREE.Vector3(0, -1, 0), darker(PRIMARY, 1), m.region);
    }
  }

  /** The coat's skirt: two panels split at the front (open, or wrapping on closed coats) and at a back vent. */
  skirt() {
    const s = this.spec;
    const c = s.coat!;
    const n = s.puff ? Math.max(3, Math.round((YJ - s.hem) / (s.puff.step / 2))) : 3;
    // Quilted skirts: the seams of puffAt fall on these rows.
    const ys = Array.from({ length: n + 1 }, (_, i) => YJ - ((YJ - s.hem) * i) / n);
    // Rows at the groin, where the panels turn from the hips to the thighs.
    if (!s.puff && s.hem > 0.72) ys.splice(0, ys.length, YJ, 0.87, s.hem);
    else if (!s.puff) {
      const m = Math.max(1, Math.round((0.8 - s.hem) / 0.16));
      ys.splice(0, ys.length, YJ, 0.885, ...Array.from({ length: m + 1 }, (_, i) => 0.8 - ((0.8 - s.hem) * i) / m));
    }
    const wrap = c.wrap ? 0.16 : 0;
    const over = 0.14;
    for (const side of [-1, 1] as Side[]) {
      // Right panel (+X): from the front round the right side to past the back (it covers the vent); the left one
      // from the back round to the front. On closed coats the right front wraps over the left one.
      const range = (y: number): readonly [number, number] => {
        const h = this.half(y);
        return side > 0 ? [FRONT + h - wrap, BACK + over] : [BACK, FRONT + TAU - h];
      };
      const lift = side > 0 ? (a: number) => (a > BACK + 0.01 || a < FRONT - 0.01 ? 0.008 : 0) : undefined;
      // The lining bends with the cloth where its weights change (the groin, the knee); the thigh between carries
      // it rigidly, so rows there can be skipped (quilted skirts skip every other one).
      const liningYs = s.puff ? ys.filter((_, i) => i % 2 === 0 || i === ys.length - 1) : ys.filter((y, i) => y >= 0.8 || y <= 0.58 || i === ys.length - 1);
      // Quilted: the lining (fewer rows) sits under the seams' valleys too.
      const thick = 0.01 + (s.puff?.amp ?? 0);
      this.panel((y, a, off) => this.skirtSurf(y, a, off, side), ys, range, 6, { side, paint: s.body ? (y, a) => s.body!(y, a) : undefined, lining: c.lining, lift, liningYs, thick });
    }
  }

  // --- Sleeves ----------------------------------------------------------------------------------------------

  sleeves() {
    const s = this.spec;
    if (s.vest) return;
    const p = this.p;
    const end = s.sleeveEnd ?? 0.84;
    const cuff = s.cuff === undefined ? { h: 0.028, out: 0.005, paint: BAND } : (s.cuff ?? undefined);
    const fl = s.armFlare ?? 0;
    const q = s.puff;
    // Quilted sleeves: rings along the arm.
    const puffU = (t: number) => (q ? q.amp * 0.85 * Math.abs(Math.sin((Math.PI * t) / 0.5)) : 0);
    const puffF = (t: number) => (q ? q.amp * 0.8 * Math.abs(Math.sin((Math.PI * t) / (end / 2))) : 0);
    const upRings = q ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.35, 0.7, 1];
    const foreRings = q ? [0, end / 4, end / 2, (3 * end) / 4, end] : [0, 0.45, end, ...(s.foreRings ?? [])].sort((a, b) => a - b);
    for (const side of [-1, 1] as Side[]) {
      const paint = s.arm ? (t: number, a: number) => s.arm!(t, a, side) : PRIMARY;
      p.upperArm(side, 0, 1, this.d + 0.002, {
        // Room at the elbow (a bent arm's point never comes through).
        flare: (t) => (0.004 + fl) * t + puffU(t) + ELBOW * bell(t, 1, 0.2) + 0.005 * (1 - smooth(t, 0.1, 0.5)),
        bump: folds(0.1, 0.12, 0.005, 3),
        shade: foldShade(0.1, 0.12),
        paint,
        rings: upRings,
      });
      p.forearm(side, 0, end, this.d + 0.004, {
        rimEnd: cuff,
        // Elbow folds; the sleeve narrows into the cuff.
        flare: (t) => 0.004 + fl * (1 - 0.5 * t) - 0.008 * smooth(t, 0.4, end) + puffF(t) + ELBOW * bell(t, 0, 0.2),
        bump: folds(0.06, 0.1, 0.006, 3, side),
        shade: foldShade(0.06, 0.1, 3, side),
        paint: typeof paint === 'function' ? (t, a) => paint(1 + t, a) : paint,
        rings: foreRings,
      });
    }
  }

  /**
   * A box on a sleeve: `t` along the upper arm (or the forearm), at angle `ang` around it (0 = the top in T
   * pose, the outside when the arm hangs; 90° the back). Patches, pockets, straps, elbow patches.
   */
  armPatch(side: Side, t: number, ang: number, size: THREE.Vector3, paint: Paint, fore = false) {
    const p = this.p;
    const j = p.j;
    let x: number;
    let r: number;
    let y: number;
    let w: Weights;
    if (!fore) {
      x = lerp(j.shoulder - 0.07, j.elbow, t);
      r = lerp(p.s.upperArm[0], p.s.upperArm[1], t) + this.d + 0.002 + (0.004 + (this.spec.armFlare ?? 0)) * t + ELBOW * bell(t, 1, 0.2) + 0.004;
      y = j.armY - 0.012 * (1 - t);
      w = p.upperArmWeights(side, t);
    } else {
      x = lerp(j.elbow - 0.02, j.wrist + 0.012, t);
      r = lerp(p.s.forearm[0], p.s.forearm[1], Math.pow(t, 0.8)) + 0.005 * bell(t, 0.22, 0.25) + this.d + 0.004 + 0.004 - 0.008 * smooth(t, 0.4, 0.84) + ELBOW * bell(t, 0, 0.2);
      y = j.armY;
      w = segment(sideName('forearm', side), sideName('upperArm', side), sideName('hand', side), 0.25)(t);
    }
    const dir = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang) * 0.94);
    const rr = r * Math.hypot(Math.cos(ang), Math.sin(ang) * 0.92);
    const c = new THREE.Vector3(side * x, y, 0).addScaledVector(dir.normalize(), rr + size.z / 2 - 0.003);
    const ax = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(dir, ax).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, up, dir));
    const lift = rr * 0.16;
    const at = (k: number) => new THREE.Matrix4().compose(c.clone().addScaledVector(dir, k), q, size);
    const region: RegionName = fore ? sideName('forearm', side) : sideName('upperArm', side);
    this.b.append(new THREE.BoxGeometry(1, 1, 1), at(0), w, region, paint, { morphs: { gordo: at(lift), magro: at(-lift * 0.45) } });
  }

  // --- Collars ----------------------------------------------------------------------------------------------

  /** Weights around the neck: the chest below, the neck taking over toward the top. */
  collarW(y: number): Weights {
    const k = smooth(y, 1.44, 1.54) * 0.65;
    return [
      ['chest', 1 - k],
      ['neck', k],
    ];
  }

  /**
   * A tube around the neck from y0 to y1 (either way: a fall collar goes down), from the jacket's neckline
   * (`base` = the torso's top ring) to a radius `r` over the neck, open at the front by `gap`.
   */
  collarTube(y0: number, y1: number, o: { r0: number; r1: number; paint: Paint | ((t: number, a: number) => Paint); gap?: number; rim?: Rim; ts?: number[]; segments?: number; drop?: number }) {
    const neck = this.p.s.neck;
    // r = 0 hugs the neck, 1 lies on the jacket's own section at that height (over 1 it stands off it).
    const ring = (r: number, y: number) => {
      const t = this.p.torsoAt(Math.min(y, TOP));
      const off = this.prof(Math.min(y, TOP)) + 0.004;
      return { x: lerp(neck + 0.03, t.w + off, r), z: lerp((neck + 0.03) * 0.94, t.d + off, r) };
    };
    const yAt = (u: number) => lerp(y0, y1, u);
    this.b.tube({
      from: new THREE.Vector3(0, y0, 0.004),
      to: new THREE.Vector3(0, y1, -0.004),
      radius: () => 1,
      sx: (u) => ring(lerp(o.r0, o.r1, u), yAt(u)).x,
      sz: (u) => ring(lerp(o.r0, o.r1, u), yAt(u)).z,
      section: (a) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 2.4) + Math.pow(Math.abs(Math.sin(a)), 2.4), 1 / 2.4),
      ts: o.ts ?? [0, 0.5, 1],
      segments: o.segments ?? 10,
      a0: FRONT + (o.gap ?? 0) / 2,
      arc: o.gap ? TAU - o.gap : undefined,
      region: 'neck',
      // Lower in front (`drop` at the top edge): collars dip toward the opening.
      along: o.drop ? (u, a) => (y1 > y0 ? -u : 1 - u) * o.drop! * bell(angDist(a, FRONT), 0, deg(100)) : undefined,
      weights: (u) => this.collarW(lerp(y0, y1, u)),
      paint: o.paint,
      build: () => 0.08,
      rimEnd: o.rim,
    });
  }

  /**
   * A flat piece with thickness lying on the jacket: rows (y, X from, X to) on one side, `h` thick (or [at X
   * from, at X to]: a lapel rolls up along its fold, so it catches the light differently from the cloth).
   */
  slab(side: Side, rows: readonly (readonly [number, number, number])[], h: number | readonly [number, number], paint: Paint, base = 0, wall: Paint = darker(paint, 1)) {
    const pt = (y: number, X: number, off: number) => this.surf(y, this.angX(side * X, y), off);
    const [h0, h1] = typeof h === 'number' ? [h, h] : h;
    const top = rows.map(([y, x0, x1]) => [this.v(pt(y, x0, base + h0)), this.v(pt(y, x1, base + h1))]);
    const bot = rows.map(([y, x0, x1]) => [this.v(pt(y, x0, base)), this.v(pt(y, x1, base))]);
    for (let r = 0; r < rows.length - 1; r++) {
      const [y0, a0, b0] = rows[r];
      const [y1, a1, b1] = rows[r + 1];
      const yM = (y0 + y1) / 2;
      const m = pt(yM, (a0 + a1 + b0 + b1) / 4, base + (h0 + h1) / 2);
      this.quadOut(top[r][0], top[r][1], top[r + 1][1], top[r + 1][0], m.n, paint, m.region);
      // Outer and inner walls (outward = from the other edge toward this one).
      const pa = pt(yM, (a0 + a1) / 2, base).p;
      const pb = pt(yM, (b0 + b1) / 2, base).p;
      this.quadOut(bot[r][1], top[r][1], top[r + 1][1], bot[r + 1][1], pb.clone().sub(pa), wall, m.region);
      this.quadOut(bot[r][0], top[r][0], top[r + 1][0], bot[r + 1][0], pa.clone().sub(pb), wall, m.region);
    }
    // End walls (skipped where the slab comes to a point).
    for (const [r, nb] of [
      [0, 1],
      [rows.length - 1, rows.length - 2],
    ] as const) {
      if (Math.abs(rows[r][2] - rows[r][1]) < 1e-4) continue;
      const m = pt(rows[r][0], (rows[r][1] + rows[r][2]) / 2, base);
      const out = m.p.clone().sub(pt(rows[nb][0], (rows[nb][1] + rows[nb][2]) / 2, base).p);
      this.quadOut(bot[r][0], bot[r][1], top[r][1], top[r][0], out, wall, m.region);
    }
  }

  /** Notch lapels: from the top button up along the opening, with the notch under the collar. */
  notchLapels(o: NonNullable<JacketSpec['lapel']>) {
    const E = this.spec.open ?? (() => 0);
    const w = o.w;
    const paint = o.paint ?? PRIMARY;
    const yb = o.y;
    const yN = Math.max(yb + 0.06, 1.37);
    const rows = (): [number, number, number][] => {
      const r: [number, number, number][] = [];
      const e = (y: number) => Math.max(0, E(y)) - 0.006;
      r.push([yb, e(yb), e(yb) + 0.008]);
      for (const k of [0.4, 0.75]) {
        const y = lerp(yb, yN, k);
        r.push([y, e(y), e(y) + w * lerp(0.35, 0.9, k)]);
      }
      r.push([yN, e(yN), e(yN) + w]);
      // The notch, then the collar's leaf going round to the back.
      r.push([yN + 0.014, e(yN + 0.014), e(yN + 0.014) + w * 0.5]);
      r.push([yN + 0.026, e(yN + 0.026), e(yN + 0.026) + w * 0.85]);
      r.push([1.445, e(1.445), e(1.445) + w * 0.62]);
      return r;
    };
    const h = o.h ?? 0.007;
    for (const s of [-1, 1] as Side[]) this.slab(s, rows(), [h * 2.2, h], paint);
  }

  /** A fall collar: up the back of the neck and folded down over the shoulders, open at the front. */
  fallCollar(paint: Paint, gap = deg(80), height = 1.515, spread = 1.1, drop = 0.03) {
    // Stand (inside), then the fall going down and out; both lower toward the front.
    this.collarTube(1.45, height - 0.008, { r0: 0.8, r1: 0.12, paint: darker(paint, 1), gap, ts: [0, 1], segments: 9, drop: drop * 2 });
    this.collarTube(height, 1.448, { r0: 0.3, r1: spread, paint, gap: gap * 0.9, rim: { h: 0.01, out: 0.004, paint: darker(paint, 1) }, ts: [0, 1], segments: 9, drop });
  }

  collar() {
    const s = this.spec;
    const c = s.collarPaint ?? PRIMARY;
    const zipGap = s.open ? deg(70) : deg(8);
    switch (s.collar) {
      case 'stand':
        this.collarTube(1.44, 1.53, { r0: 0.8, r1: 0.1, paint: c, gap: zipGap, rim: { h: 0.012, out: 0.004, paint: darker(c, 1) }, ts: [0, 0.35, 1], drop: s.open ? 0.03 : 0 });
        break;
      case 'tall':
        // A padded funnel collar up the neck.
        this.collarTube(1.44, 1.57, { r0: 0.8, r1: 0.25, paint: c, gap: zipGap, rim: { h: 0.016, out: 0.006, paint: darker(c, 1) }, ts: [0, 0.45, 1] });
        break;
      case 'mandarin':
        this.collarTube(1.44, 1.51, { r0: 0.8, r1: 0.05, paint: c, gap: deg(14), rim: { h: 0.008, out: 0.003, paint: DETAIL }, ts: [0, 0.4, 1] });
        break;
      case 'rib':
        // Ribbed knit: columns of light and dark.
        this.collarTube(1.44, 1.515, {
          r0: 0.8,
          r1: 0.06,
          paint: (_t, a) => (column(a, 16) % 2 ? c : darker(c, 1)),
          gap: zipGap,
          rim: { h: 0.008, out: 0.003, paint: darker(c, 1) },
          ts: [0, 0.4, 1],
          segments: 16,
        });
        break;
      case 'shirt':
        this.fallCollar(c, s.open ? deg(70) : deg(40));
        for (const sd of [-1, 1] as Side[]) {
          const x = Math.max(0.012, s.open ? s.open(1.44) : 0.012);
          this.slab(sd, [
            [1.375, x + 0.04, x + 0.04],
            [1.41, x + 0.022, x + 0.075],
            [1.45, x + 0.006, x + 0.1],
            [1.462, x, x + 0.092],
          ], 0.008, c);
        }
        break;
      case 'notch':
        this.fallCollar(c, deg(110), 1.505, 1.06);
        if (s.lapel) this.notchLapels(s.lapel);
        break;
      case 'fur':
        // Shearling: a thick fall collar and wide lapels of fur.
        this.collarTube(1.45, 1.53, { r0: 0.8, r1: 0.25, paint: darker(c, 1), gap: deg(70), ts: [0, 1], segments: 9, drop: 0.07 });
        this.collarTube(1.535, 1.44, { r0: 0.45, r1: 1.2, paint: c, gap: deg(64), rim: { h: 0.016, out: 0.008, paint: darker(c, 1) }, ts: [0, 1], segments: 10, drop: 0.035 });
        if (s.lapel) this.notchLapels({ ...s.lapel, paint: c, h: s.lapel.h ?? 0.016 });
        break;
      case 'none':
        // The neckline's edge: a band with thickness.
        this.collarTube(1.448, 1.47, { r0: 1.03, r1: 0.9, paint: darker(c, 1), gap: s.open ? deg(70) : undefined, ts: [0, 1] });
        break;
    }
  }

  /** A hood lying down on the back, its lining showing at the top. */
  hoodDown(paint: Paint, lining: Paint, backAt?: (y: number) => number) {
    const back = backAt ?? ((y: number) => this.p.torsoAt(y).d - this.p.torsoAt(y).fwd + this.prof(y));
    // Lying flat on the back (long hair falls over it rather than through it).
    const from = new THREE.Vector3(0, 1.515, back(1.45) + 0.012);
    const to = new THREE.Vector3(0, 1.28, back(1.28) + 0.03);
    this.b.tube({
      from,
      to,
      radius: (t) => lerp(0.1, 0.075, t),
      sx: (t) => lerp(1.25, 1.45, Math.sin(t * Math.PI * 0.8)),
      sz: () => 0.36,
      side: new THREE.Vector3(1, 0, 0),
      ts: [0, 0.5, 1],
      segments: 8,
      region: 'chest',
      weights: (t) => (t < 0.35 ? this.collarW(lerp(1.515, 1.28, t)) : [['chest', 1]]),
      paint: (t) => (t < 0.06 ? lining : paint),
      shade: (t, a) => 0.6 * Math.sin(a * 3 + t * 9),
      capStart: 0.55,
      capEnd: 0.7,
      build: () => 0.1,
    });
  }

  // --- Details ----------------------------------------------------------------------------------------------

  /** A zipper down the front: the tape and teeth, and the pull at the top. */
  zip(y0: number, y1: number, paint: Paint = METAL, X = 0, tape?: Paint) {
    if (tape !== undefined) this.rect(X - 0.011, X + 0.011, y0, y1, tape, false, 0.003, 0.08);
    this.rect(X - 0.0045, X + 0.0045, y0, y1, paint, false, 0.0045, 0.08);
    this.box(y1 - 0.025, this.angX(X + 0.006, y1 - 0.025), new THREE.Vector3(0.012, 0.03, 0.006), paint, 0.006);
  }

  /** Big buttons (coats) down a column at X. */
  bigButtons(y0: number, y1: number, n: number, paint: Paint, X = 0, size = 0.016) {
    for (let i = 0; i < n; i++) {
      const y = lerp(y0, y1, n > 1 ? i / (n - 1) : 0.5);
      this.box(y, this.angX(X, y), new THREE.Vector3(size, size, 0.006), paint, 0.003);
    }
  }

  /** A patch pocket at (X, y) with an optional flap and button. */
  hipPocket(X: number, y: number, w: number, h: number, paint: Paint, flap?: Paint, button?: Paint) {
    this.box(y, this.angX(X, y), new THREE.Vector3(w, h, 0.007), paint);
    if (flap !== undefined) {
      const fy = y + h / 2 - 0.012;
      this.box(fy, this.angX(X, fy), new THREE.Vector3(w + 0.008, 0.034, 0.01), flap);
      if (button !== undefined) this.box(fy - 0.006, this.angX(X, fy), new THREE.Vector3(0.012, 0.012, 0.004), button, 0.008);
    }
  }

  /** A welt (or flap) pocket: just the flap, slanted by `tilt`. */
  welt(X: number, y: number, w: number, paint: Paint, h = 0.022) {
    this.box(y, this.angX(X, y), new THREE.Vector3(w, h, 0.008), paint);
  }

  /** A straight strip `w` wide from (X0, y0) to (X1, y1) on the front: slanted zippers, piping. */
  diag(X0: number, y0: number, X1: number, y1: number, w: number, paint: Paint, off = 0.004) {
    const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.08));
    const rows = Array.from({ length: n + 1 }, (_, i): [number, number, number] => {
      const y = lerp(y0, y1, i / n);
      const X = lerp(X0, X1, i / n);
      const a = this.angX(X - w / 2, y);
      const b = this.angX(X + w / 2, y);
      return [y, Math.min(a, b), Math.max(a, b)];
    });
    this.patch(y1 > y0 ? rows : rows.reverse(), paint, { off });
  }

  /** A letter or digits of segments on the chest (varsity letters). */
  letter(segs: string, X: number, cy: number, h: number, paint: Paint) {
    const w = h * 0.62;
    const t = h * 0.2;
    for (const sg of segs) {
      const [x0, x1, y0, y1] = segmentRect(sg, w, h, t);
      this.rect(X - x1, X - x0, cy + y0, cy + y1, paint, false, 0.0045);
    }
  }
}

// --- Capes and ponchos ----------------------------------------------------------------------------------------

/** Profile of a cone over the shoulders: y, half width, half depth (sampled linearly). */
type Profile = readonly (readonly [number, number, number])[];
const sampleProfile = (pr: Profile, y: number) => {
  if (y >= pr[0][0]) return [pr[0][1], pr[0][2]];
  for (let i = 1; i < pr.length; i++) {
    if (y >= pr[i][0]) {
      const k = (y - pr[i][0]) / (pr[i - 1][0] - pr[i][0]);
      return [lerp(pr[i][1], pr[i - 1][1], k), lerp(pr[i][2], pr[i - 1][2], k)];
    }
  }
  return [pr[pr.length - 1][1], pr[pr.length - 1][2]];
};

/**
 * A cone over the shoulders (capes, ponchos): an oval section per height. Weights: the chest up top (the neck at
 * the collar), the spine lower down. No share of the upper arms: the cloth is built around the hanging arms but
 * skinned from the T pose, so any arm weight would fold the sides in under the arms at rest; the arms come out of
 * the front opening (capes) or through the cloth with the upper arms hidden (the closed poncho, see the items).
 */
function cone(j: Jacket, pr: Profile): SurfFn {
  return (y, a, off) => {
    const [rx, rz] = sampleProfile(pr, y);
    const fwd = j.p.torsoAt(clamp(y, 0.95, 1.46)).fwd;
    const offV = new THREE.Vector3(-Math.cos(a) * (rx + off), 0, -Math.sin(a) * (rz + off));
    const p = new THREE.Vector3(0, y, -fwd).add(offV);
    const n = new THREE.Vector3(-Math.cos(a) / rx, 0, -Math.sin(a) / rz).normalize();
    let w = y > 1.47 ? j.collarW(y) : j.p.torsoSurface(clamp(y, 0.97, 1.44), a, 0).w;
    // Below the hips the front follows the thighs (each side its own, both at the middle), so a knee coming up
    // carries the hem instead of coming through it; the back hangs.
    const k = 0.85 * below(y, 0.97, 0.84) * smooth(Math.sin(a), -0.6, 0.3);
    if (k > 0) {
      const right = smooth(-Math.cos(a), -0.6, 0.6);
      w = [...w.map(([bn, x]): [BoneName, number] => [bn, x * (1 - k)]), ['thigh_L', k * (1 - right)], ['thigh_R', k * right]];
    }
    const gordo = offV.clone().multiplyScalar(0.1);
    return { p, n, w, region: 'chest', gordo, magro: gordo.clone().multiplyScalar(-0.45) };
  };
}

/** A cape or poncho: the cone (open in front by `open(y)` radians each side, or closed), and a hood. */
function capeOrPoncho(j: Jacket, o: { pr: Profile; hem: number; open?: (y: number) => number; cols: number; rows: number[]; paint?: (y: number, a: number) => Paint; lining?: Paint; thinLining?: boolean }) {
  const f = cone(j, o.pr);
  const ys = o.rows;
  // The lining only needs the shoulder line and the hem.
  const liningYs = o.thinLining ? [ys[0], ys[ys.length - 1]] : [ys[0], ys[Math.min(2, ys.length - 2)], ys[ys.length - 1]];
  if (o.open) {
    j.panel(f, ys, (y) => [FRONT + o.open!(y), FRONT + TAU - o.open!(y)], o.cols, { paint: o.paint, lining: o.lining, liningYs });
  } else {
    // Closed: two halves meeting at the front and the back (no seam shows; the cone is one piece).
    for (const sd of [-1, 1] as Side[]) {
      const range = (): readonly [number, number] => (sd > 0 ? [FRONT, BACK] : [BACK, FRONT + TAU]);
      j.panel(f, ys, range, o.cols / 2, { paint: o.paint, lining: o.lining, liningYs });
    }
  }
}

// --- The catalog ----------------------------------------------------------------------------------------------

/** A front opening that is `x0` wide at the hem and `x1` at the neck (straight or V). */
const gap = (x0: number, x1: number, y0 = 0.86, y1 = TOP) => (y: number) => lerp(x0, x1, clamp((y - y0) / (y1 - y0), 0, 1));
/** A V from the top button at `yb` (closed below, or cut away below by `cut`). */
const vee = (yb: number, top: number, cut = 0) => (y: number) => (y >= yb ? lerp(0.004, top, Math.pow((y - yb) / (TOP - yb), 0.9)) : 0.004 + cut * Math.pow((yb - y) / 0.3, 1.2));

/** Camo: blotches per face in four values of the primary and detail colors. */
const camo = (i: number) => [PRIMARY, darker(PRIMARY, 3), DETAIL, darker(DETAIL, 2)][Math.floor(hash(i) * 4)];

/** Fur trim along both edges of an open front (shearling, flight jacket). */
function furEdges(j: Jacket, y0: number, y1: number, w: number, paint: Paint) {
  const E = j.spec.open ?? (() => 0);
  for (const sd of [-1, 1] as Side[]) {
    const n = Math.max(2, Math.round((y1 - y0) / 0.16));
    // On a coat, also the skirt's rows at the groin (where it turns from the hips to the thigh).
    const ys = [...Array.from({ length: n + 1 }, (_, i) => lerp(y0, y1, i / n)), ...(j.coat ? [YJ, 0.885, 0.8].filter((y) => y > y0 && y < y1) : [])];
    const rows = [...new Set(ys)].sort((a, b) => a - b).map((y): [number, number, number] => [y, Math.max(0, E(y)) - 0.004, Math.max(0, E(y)) + w]);
    j.slab(sd, rows, 0.012, paint);
  }
}

const SPECS: Record<string, JacketSpec> = {
  jaquetaJeans: {
    hem: 0.9,
    band: { h: 0.05, out: 0.006, paint: PRIMARY },
    open: gap(0.035, 0.05),
    collar: 'shirt',
    cuff: { h: 0.04, out: 0.004, paint: PRIMARY },
    ts: [1.36, 1.4],
    extra: (j) => {
      // Yoke seams (stitching in the secondary color), chest pockets with pointed flaps, copper buttons.
      for (const sd of [-1, 1] as Side[]) {
        const X = sd * 0.085;
        j.hipPocket(X, 1.28, 0.08, 0.085, darker(PRIMARY, 1), PRIMARY, BRASS);
        j.rect(sd > 0 ? 0.05 : -0.16, sd > 0 ? 0.16 : -0.05, 1.37, 1.375, SECONDARY, false, 0.0035);
        j.rect(sd * 0.065 - 0.003, sd * 0.065 + 0.003, j.hem + 0.06, 1.2, SECONDARY, false, 0.0035);
        j.bigButtons(j.hem + 0.025, j.hem + 0.025, 1, BRASS, sd * 0.11, 0.012);
      }
      j.rect(-0.17, 0.17, 1.36, 1.365, SECONDARY, true, 0.0035);
      j.bigButtons(j.hem + 0.1, 1.38, 4, BRASS, 0.062, 0.012);
    },
  },
  coleteJeans: {
    hem: 0.9,
    vest: true,
    band: { h: 0.05, out: 0.006, paint: PRIMARY },
    open: gap(0.04, 0.06),
    collar: 'shirt',
    extra: (j) => {
      for (const sd of [-1, 1] as Side[]) {
        j.hipPocket(sd * 0.09, 1.28, 0.08, 0.085, darker(PRIMARY, 1), PRIMARY, BRASS);
        j.rect(sd > 0 ? 0.06 : -0.17, sd > 0 ? 0.17 : -0.06, 1.37, 1.375, darker(PRIMARY, 2), false, 0.0035);
      }
      j.bigButtons(j.hem + 0.1, 1.38, 4, BRASS, 0.072, 0.012);
      // Patches (the detail color) on the chest and a big one on the back.
      j.box(1.15, j.angX(-0.1, 1.15), new THREE.Vector3(0.06, 0.06, 0.005), DETAIL);
      j.box(1.12, j.angX(0.1, 1.12), new THREE.Vector3(0.05, 0.035, 0.005), darker(DETAIL, 2));
      j.box(1.2, BACK, new THREE.Vector3(0.2, 0.13, 0.005), DETAIL);
      // Armhole binding.
    },
  },
  couroMoto: {
    hem: 0.92,
    band: { h: 0.045, out: 0.006, paint: PRIMARY },
    open: (y) => (y > 1.27 ? lerp(0.004, 0.07, Math.pow((y - 1.27) / (TOP - 1.27), 0.8)) : 0),
    collar: 'notch',
    lapel: { y: 1.27, w: 0.085, h: 0.008 },
    cuff: null,
    extra: (j) => {
      // Asymmetric zipper from the right hip to the lapels; a zipped chest pocket; snaps on the lapels; the belt.
      j.diag(0.07, j.hem + 0.045, 0.0, 1.27, 0.009, DETAIL, 0.0045);
      j.box(1.24, j.angX(0.006, 1.24), new THREE.Vector3(0.012, 0.03, 0.006), DETAIL, 0.006);
      j.diag(-0.15, 1.2, -0.07, 1.27, 0.006, DETAIL);
      j.rect(0.07, 0.15, 1.04, 1.046, DETAIL, false, 0.004);
      for (const sd of [-1, 1]) j.box(1.35, j.angX(sd * 0.105, 1.35), new THREE.Vector3(0.01, 0.01, 0.006), DETAIL, 0.012);
      j.box(j.hem + 0.022, j.angX(0.12, j.hem + 0.022), new THREE.Vector3(0.03, 0.03, 0.006), DETAIL, 0.006);
      for (const sd of [-1, 1] as Side[]) {
        // Zips at the cuffs; epaulettes.
        j.armPatch(sd, 0.78, deg(90), new THREE.Vector3(0.06, 0.006, 0.004), DETAIL, true);
      }
    },
  },
  jaquetaAviador: {
    hem: 0.9,
    band: { h: 0.06, out: 0.008, paint: darker(PRIMARY, 1) },
    open: (y) => (y > 1.33 ? lerp(0.004, 0.06, (y - 1.33) / (TOP - 1.33)) : 0),
    collar: 'fur',
    collarPaint: SECONDARY,
    lapel: { y: 1.33, w: 0.08 },
    fit: 0.004,
    cuff: { h: 0.04, out: 0.008, paint: SECONDARY },
    extra: (j) => {
      furEdges(j, j.hem + 0.06, 1.33, 0.022, SECONDARY);
      j.zip(j.hem + 0.06, 1.32, METAL);
      for (const sd of [-1, 1] as Side[]) {
        j.welt(sd * 0.11, 1.02, 0.1, darker(PRIMARY, 1), 0.03);
        // Strap tabs on the hem band.
        j.box(j.hem + 0.03, j.angX(sd * 0.14, j.hem + 0.03), new THREE.Vector3(0.04, 0.03, 0.006), darker(PRIMARY, 2), 0.008);
      }
    },
  },
  bomber: {
    hem: 0.9,
    band: { h: 0.065, out: 0.004, paint: SECONDARY },
    hip: 0.012,
    fit: 0.004,
    collar: 'rib',
    collarPaint: SECONDARY,
    cuff: { h: 0.06, out: 0.002, paint: SECONDARY },
    armFlare: 0.008,
    extra: (j) => {
      j.zip(j.hem + 0.01, 1.46, METAL);
      // Stripes in the knit hem; welt pockets; the zipped sleeve pocket.
      j.band(j.hem + 0.022, j.hem + 0.03, 0.0055, DETAIL, false);
      for (const sd of [-1, 1] as Side[]) j.welt(sd * 0.1, 1.02, 0.025, darker(PRIMARY, 1), 0.11);
      j.armPatch(-1, 0.4, 0, new THREE.Vector3(0.09, 0.048, 0.007), PRIMARY);
      j.armPatch(-1, 0.4, 0, new THREE.Vector3(0.07, 0.005, 0.009), DETAIL);
    },
  },
  cortaVento: {
    hem: 0.88,
    band: { h: 0.025, out: 0.004, paint: SECONDARY },
    fit: 0.004,
    collar: 'stand',
    collarPaint: SECONDARY,
    cuff: { h: 0.03, out: 0.002, paint: SECONDARY },
    armFlare: 0.01,
    ts: [1.27],
    body: (y) => (y > 1.27 ? SECONDARY : PRIMARY),
    arm: (t) => (t < 0.5 ? SECONDARY : PRIMARY),
    extra: (j) => {
      // A pullover: quarter zip, kangaroo pocket.
      j.zip(1.3, 1.46, DETAIL, 0, darker(SECONDARY, 1));
      j.box(1.0, FRONT, new THREE.Vector3(0.22, 0.13, 0.008), darker(PRIMARY, 1));
      j.band(j.hem + 0.006, j.hem + 0.014, 0.0055, DETAIL, false);
    },
  },
  pufferCurta: {
    hem: 0.88,
    band: { h: 0.025, out: 0.004, paint: SECONDARY },
    fit: 0.006,
    puff: { step: 0.1, amp: 0.014 },
    collar: 'tall',
    cuff: { h: 0.03, out: 0.002, paint: SECONDARY },
    extra: (j) => j.zip(j.hem, 1.47, SECONDARY),
  },
  pufferLonga: {
    hem: 0.42,
    coat: { flare: 0.045, vent: 0.62, lining: darker(SECONDARY, 1) },
    fit: 0.006,
    puff: { step: 0.18, amp: 0.014 },
    collar: 'tall',
    cuff: { h: 0.03, out: 0.002, paint: SECONDARY },
    extra: (j) => j.zip(0.6, 1.47, SECONDARY),
  },
  coletePuffer: {
    hem: 0.88,
    vest: true,
    band: { h: 0.025, out: 0.004, paint: SECONDARY },
    fit: 0.006,
    puff: { step: 0.1, amp: 0.014 },
    collar: 'stand',
    extra: (j) => j.zip(j.hem, 1.47, SECONDARY),
  },
  parka: {
    hem: 0.6,
    coat: { flare: 0.04, vent: 0.75, wrap: true },
    fit: 0.004,
    collar: 'stand',
    hood: SECONDARY,
    cuff: { h: 0.035, out: 0.004, paint: BAND },
    extra: (j) => {
      // Storm flap with snaps over the zipper; big hip pockets; slanted chest pockets; drawcord at the waist.
      j.rect(-0.005, 0.035, 0.66, 1.43, darker(PRIMARY, 1), false, 0.004, 0.08);
      j.bigButtons(0.74, 1.38, 3, darker(PRIMARY, 3), 0.018, 0.012);
      for (const sd of [-1, 1] as Side[]) {
        j.hipPocket(sd * 0.11, 0.72, 0.12, 0.14, PRIMARY, darker(PRIMARY, 1));
        j.welt(sd * 0.1, 1.29, 0.09, darker(PRIMARY, 1), 0.03);
      }
      // The drawcord channel at the waist.
      j.rect(-0.2, 0.2, 1.04, 1.055, darker(PRIMARY, 1), false, 0.004);
    },
  },
  m65: {
    hem: 0.84,
    band: null,
    fit: 0.002,
    collar: 'stand',
    cuff: { h: 0.03, out: 0.004, paint: BAND },
    extra: (j) => {
      j.rect(-0.005, 0.035, j.hem + 0.01, 1.43, darker(PRIMARY, 1), false, 0.004, 0.08);
      j.bigButtons(j.hem + 0.06, 1.4, 6, SECONDARY, 0.018, 0.011);
      for (const sd of [-1, 1] as Side[]) {
        j.hipPocket(sd * 0.1, 1.27, 0.09, 0.1, PRIMARY, darker(PRIMARY, 1), SECONDARY);
        j.hipPocket(sd * 0.105, 0.96, 0.11, 0.12, PRIMARY, darker(PRIMARY, 1), SECONDARY);
        j.armPatch(sd, 0.82, deg(90), new THREE.Vector3(0.04, 0.03, 0.006), darker(PRIMARY, 1), true);
      }
    },
  },
  softshell: {
    hem: 0.87,
    band: { h: 0.02, out: 0.003, paint: SECONDARY },
    fit: 0.002,
    collar: 'stand',
    cuff: { h: 0.03, out: 0.002, paint: SECONDARY },
    ts: [1.32],
    body: (y, a) => (sideness(a) > 0.82 || (y > 1.32 && angDist(a, FRONT) > deg(50) && angDist(a, BACK) > deg(50)) ? SECONDARY : PRIMARY),
    arm: (t, a, s) => (t < 0.3 || angDist(a, s < 0 ? deg(90) : deg(270)) < deg(45) ? SECONDARY : PRIMARY),
    extra: (j) => {
      j.zip(j.hem + 0.01, 1.47, DETAIL);
      // Slanted zipped chest pockets; velcro panels on the sleeves (one with a flag patch).
      for (const sd of [-1, 1]) j.diag(sd * 0.05, 1.33, sd * 0.13, 1.21, 0.008, DETAIL);
      for (const sd of [-1, 1] as Side[]) j.armPatch(sd, 0.45, 0, new THREE.Vector3(0.09, 0.048, 0.006), SECONDARY);
      j.armPatch(-1, 0.45, 0, new THREE.Vector3(0.06, 0.034, 0.008), DETAIL);
    },
  },
  jaquetaCamuflada: {
    hem: 0.84,
    band: null,
    fit: 0.002,
    collar: 'shirt',
    cuff: { h: 0.03, out: 0.004, paint: PRIMARY },
    cols: 12,
    body: (y, a) => camo(Math.floor((y - 0.8) / 0.07) * 31 + column(a, 12)),
    arm: (t, a) => camo(Math.floor(t * 4) * 17 + Math.floor((((a % TAU) + TAU) % TAU) / (Math.PI / 4)) + 400),
    extra: (j) => {
      j.rect(-0.016, 0.016, j.hem + 0.01, 1.44, PRIMARY, false, 0.003, 0.08);
      j.bigButtons(j.hem + 0.05, 1.4, 6, darker(PRIMARY, 4), 0, 0.011);
      for (const sd of [-1, 1] as Side[]) {
        j.hipPocket(sd * 0.1, 1.27, 0.09, 0.1, darker(PRIMARY, 1), PRIMARY, darker(PRIMARY, 4));
        j.hipPocket(sd * 0.105, 0.96, 0.11, 0.12, darker(PRIMARY, 1), PRIMARY, darker(PRIMARY, 4));
      }
    },
  },
  blazer: {
    hem: 0.78,
    coat: { flare: 0.012 },
    hip: 0.016,
    open: vee(1.08, 0.075, 0.06),
    collar: 'notch',
    lapel: { y: 1.08, w: 0.07 },
    cuff: null,
    extra: (j) => {
      j.bigButtons(1.06, 1.06, 1, SECONDARY, 0.02, 0.014);
      j.welt(-0.09, 1.3, 0.07, darker(PRIMARY, 1), 0.012);
      for (const sd of [-1, 1] as Side[]) {
        j.welt(sd * 0.11, 0.98, 0.11, PRIMARY, 0.035);
        // Elbow patches (secondary) and cuff buttons.
        j.armPatch(sd, 0.92, deg(90), new THREE.Vector3(0.09, 0.045, 0.006), SECONDARY);
        for (const k of [0, 1]) j.armPatch(sd, 0.76 + k * 0.035, deg(60), new THREE.Vector3(0.011, 0.011, 0.005), SECONDARY, true);
      }
    },
  },
  paleto: {
    hem: 0.78,
    coat: { flare: 0.01 },
    hip: 0.016,
    open: vee(1.02, 0.075, 0.05),
    collar: 'notch',
    collarPaint: SECONDARY,
    lapel: { y: 1.02, w: 0.07, paint: SECONDARY },
    cuff: null,
    extra: (j) => {
      j.bigButtons(1.0, 0.92, 2, darker(PRIMARY, 3), 0.02, 0.014);
      // The pocket square (detail) in the chest welt.
      j.welt(-0.09, 1.3, 0.07, darker(PRIMARY, 1), 0.012);
      j.box(1.315, j.angX(-0.09, 1.315), new THREE.Vector3(0.05, 0.026, 0.01), DETAIL, 0.002);
      for (const sd of [-1, 1] as Side[]) {
        j.welt(sd * 0.11, 0.98, 0.11, PRIMARY, 0.035);
        for (const k of [0, 1, 2]) j.armPatch(sd, 0.74 + k * 0.03, deg(60), new THREE.Vector3(0.01, 0.01, 0.005), darker(PRIMARY, 3), true);
      }
    },
  },
  trench: {
    hem: 0.5,
    coat: { flare: 0.06, vent: 0.75, wrap: true },
    fit: 0.004,
    open: (y) => (y > 1.27 ? lerp(0.004, 0.08, Math.pow((y - 1.27) / (TOP - 1.27), 0.8)) : 0),
    collar: 'notch',
    lapel: { y: 1.27, w: 0.09, h: 0.008 },
    cuff: null,
    extra: (j) => {
      // Double-breasted: two rows of buttons; the belt with its buckle; the storm flap on the right shoulder.
      for (const X of [-0.07, 0.07]) j.bigButtons(1.1, 1.22, 2, SECONDARY, X, 0.016);
      j.band(1.0, 1.045, 0.007, PRIMARY);
      j.box(1.0225, j.angX(0.06, 1.0225), new THREE.Vector3(0.05, 0.05, 0.008), SECONDARY, 0.006);
      j.slab(1, [
        [1.26, 0.03, 0.17],
        [1.36, 0.03, 0.17],
        [1.44, 0.06, 0.13],
      ], 0.005, PRIMARY);
      for (const sd of [-1, 1] as Side[]) {
        j.welt(sd * 0.13, 0.74, 0.04, darker(PRIMARY, 1), 0.12);
        j.armPatch(sd, 0.8, 0, new THREE.Vector3(0.025, 0.035, 0.006), darker(PRIMARY, 1), true);
      }
    },
  },
  sobretudo: {
    hem: 0.48,
    coat: { flare: 0.05, vent: 0.72, wrap: true },
    fit: 0.004,
    open: vee(1.2, 0.075),
    collar: 'notch',
    lapel: { y: 1.2, w: 0.08, h: 0.008 },
    cuff: null,
    extra: (j) => {
      j.bigButtons(0.98, 1.18, 3, darker(PRIMARY, 3), 0.02, 0.018);
      j.welt(-0.1, 1.3, 0.08, darker(PRIMARY, 1), 0.014);
      for (const sd of [-1, 1] as Side[]) j.welt(sd * 0.12, 0.74, 0.13, PRIMARY, 0.04);
    },
  },
  shearling: {
    hem: 0.62,
    coat: { flare: 0.04, vent: 0.75, lining: SECONDARY },
    fit: 0.008,
    open: (y) => (y > 1.25 ? lerp(0.012, 0.06, (y - 1.25) / (TOP - 1.25)) : lerp(0.035, 0.012, smooth(y, 0.7, 1.2))),
    collar: 'fur',
    collarPaint: SECONDARY,
    lapel: { y: 1.25, w: 0.1 },
    cuff: { h: 0.05, out: 0.012, paint: SECONDARY },
    extra: (j) => {
      furEdges(j, 0.62, 1.25, 0.03, SECONDARY);
      for (const sd of [-1, 1] as Side[]) j.welt(sd * 0.13, 0.74, 0.035, darker(PRIMARY, 1), 0.12);
      // A toggle.
      for (const y of [1.06]) j.box(y, j.angX(0.045, y), new THREE.Vector3(0.03, 0.01, 0.008), darker(PRIMARY, 3), 0.01);
    },
  },
  brim: {
    hem: 0.88,
    band: { h: 0.045, out: 0.006, paint: PRIMARY },
    fit: 0.004,
    collar: 'shirt',
    collarPaint: SECONDARY,
    cuff: { h: 0.035, out: 0.004, paint: PRIMARY },
    extra: (j) => {
      j.rect(-0.016, 0.016, j.hem + 0.045, 1.45, darker(PRIMARY, 1), false, 0.003, 0.08);
      j.bigButtons(j.hem + 0.09, 1.4, 5, BRASS, 0, 0.012);
      j.hipPocket(-0.1, 1.27, 0.085, 0.1, PRIMARY, darker(PRIMARY, 1));
      for (const sd of [-1, 1] as Side[]) {
        // Hand warmer pockets (slanted welts), tabs on the hem band.
        for (let i = 0; i < 3; i++) j.box(1.0 + i * 0.04, j.angX(sd * (0.13 - i * 0.012), 1.0 + i * 0.04), new THREE.Vector3(0.02, 0.045, 0.009), darker(PRIMARY, 1));
        j.bigButtons(j.hem + 0.022, j.hem + 0.022, 1, BRASS, sd * 0.12, 0.011);
      }
    },
  },
  varsity: {
    hem: 0.89,
    band: { h: 0.06, out: 0.004, paint: darker(PRIMARY, 1) },
    hip: 0.012,
    fit: 0.002,
    collar: 'rib',
    collarPaint: darker(PRIMARY, 1),
    cuff: { h: 0.06, out: 0.002, paint: darker(PRIMARY, 1) },
    arm: () => SECONDARY,
    armFlare: 0.004,
    extra: (j) => {
      // Stripes in the knit (detail), snaps, the chenille letter, welt pockets.
      for (const y of [j.hem + 0.018, j.hem + 0.032]) j.band(y, y + 0.007, 0.0055, DETAIL, false);
      j.bigButtons(j.hem + 0.08, 1.4, 5, DETAIL, 0.004, 0.012);
      j.letter('abcefg', -0.09, 1.28, 0.1, DETAIL);
      for (const sd of [-1, 1]) j.welt(sd * 0.11, 1.02, 0.025, SECONDARY, 0.1);
    },
  },
  jaquetaCorrida: {
    hem: 0.86,
    band: { h: 0.02, out: 0.003, paint: SECONDARY },
    fit: 0.002,
    hip: 0.016,
    collar: 'stand',
    collarPaint: SECONDARY,
    cuff: { h: 0.03, out: 0.002, paint: SECONDARY },
    body: (_y, a) => (sideness(a) > 0.85 ? SECONDARY : PRIMARY),
    arm: (t, a, s) => (t > 1.6 && t < 1.66 ? DETAIL : angDist(a, s < 0 ? deg(90) : deg(270)) < deg(40) ? SECONDARY : PRIMARY),
    foreRings: [0.6, 0.66],
    extra: (j) => {
      j.zip(j.hem, 1.47, DETAIL);
      // Reflective stripes (detail): across the back, down the chest, round the forearms.
      j.rect(-0.16, 0.16, 1.26, 1.272, DETAIL, true, 0.004);
      j.rect(-0.16, 0.16, 1.0, 1.012, DETAIL, true, 0.004);
      for (const sd of [-1, 1]) j.rect(sd * 0.11 - 0.006, sd * 0.11 + 0.006, 1.05, 1.3, DETAIL, false, 0.004);
    },
  },
  jaquetaChuva: {
    hem: 0.84,
    band: { h: 0.02, out: 0.003, paint: darker(PRIMARY, 1) },
    fit: 0.004,
    hip: 0.024,
    collar: 'tall',
    hood: SECONDARY,
    cuff: { h: 0.03, out: 0.002, paint: darker(PRIMARY, 1) },
    armFlare: 0.008,
    extra: (j) => {
      j.rect(-0.006, 0.034, j.hem + 0.01, 1.47, darker(PRIMARY, 1), false, 0.004, 0.08);
      j.bigButtons(j.hem + 0.05, 1.42, 5, SECONDARY, 0.024, 0.012);
      for (const sd of [-1, 1] as Side[]) {
        j.welt(sd * 0.12, 1.0, 0.12, darker(PRIMARY, 1), 0.03);
        j.armPatch(sd, 0.8, deg(90), new THREE.Vector3(0.04, 0.025, 0.006), SECONDARY, true);
      }
    },
  },
  jaquetaEsqui: {
    hem: 0.84,
    band: { h: 0.03, out: 0.004, paint: SECONDARY },
    fit: 0.008,
    puff: { step: 0.16, amp: 0.008 },
    collar: 'tall',
    collarPaint: SECONDARY,
    cuff: { h: 0.04, out: 0.004, paint: SECONDARY },
    ts: [1.13, 1.22],
    body: (y) => (y > 1.13 && y < 1.22 ? SECONDARY : PRIMARY),
    arm: (t) => (t > 0.3 && t < 0.5 ? SECONDARY : PRIMARY),
    extra: (j) => {
      j.zip(j.hem, 1.47, DETAIL);
      for (const sd of [-1, 1]) j.rect(sd * 0.13 - 0.005, sd * 0.13 + 0.005, 0.95, 1.08, DETAIL, false, 0.005);
      j.rect(-0.14, -0.05, 1.33, 1.338, DETAIL, false, 0.005);
      // The ski pass pocket on the left forearm; drawcord toggles at the hem.
      j.armPatch(-1, 0.55, 0, new THREE.Vector3(0.07, 0.04, 0.007), SECONDARY, true);
      for (const sd of [-1, 1]) j.box(j.hem + 0.01, j.angX(sd * 0.16, j.hem + 0.01), new THREE.Vector3(0.012, 0.02, 0.012), DETAIL, 0.008);
    },
  },
  macacaoVoo: {
    hem: 0.86,
    band: null,
    fit: 0.002,
    hip: 0.024,
    collar: 'shirt',
    cuff: { h: 0.04, out: 0.003, paint: PRIMARY },
    extra: (j) => {
      j.zip(j.hem, 1.44, SECONDARY);
      // Diagonal zipped chest pockets, the name tag (detail), the pen pocket on the left sleeve.
      for (const sd of [-1, 1]) j.diag(sd * 0.15, 1.17, sd * 0.07, 1.31, 0.008, SECONDARY);
      j.box(1.33, j.angX(-0.1, 1.33), new THREE.Vector3(0.09, 0.03, 0.005), DETAIL);
      j.box(1.33, j.angX(0.1, 1.33), new THREE.Vector3(0.06, 0.035, 0.005), darker(DETAIL, 3));
      j.armPatch(-1, 0.45, 0, new THREE.Vector3(0.09, 0.048, 0.007), PRIMARY);
      for (const k of [0, 1, 2]) j.armPatch(-1, 0.31, deg(k * 12 - 12), new THREE.Vector3(0.028, 0.006, 0.006), k === 1 ? DETAIL : SECONDARY);
      j.band(1.0, 1.03, 0.005, darker(PRIMARY, 1));
    },
  },
  guardaPo: {
    hem: 0.26,
    coat: { flare: 0.1, vent: 0.75 },
    fit: 0.006,
    open: gap(0.06, 0.07, 0.26, 1.2),
    collar: 'shirt',
    cuff: { h: 0.04, out: 0.006, paint: BAND },
    extra: (j) => {
      // The shoulder cape, open in front.
      capeOrPoncho(j, {
        pr: [
          [1.5, 0.12, 0.1],
          [1.48, 0.22, 0.15],
          [1.43, 0.31, 0.19],
          [1.36, 0.33, 0.2],
          [1.18, 0.36, 0.23],
        ],
        hem: 1.18,
        open: (y) => deg(lerp(30, 40, (1.5 - y) / 0.32)),
        cols: 8,
        rows: [1.5, 1.46, 1.38, 1.18],
        // Only seen from below, over the coat's own shoulders: the shoulder line and the hem are enough.
        thinLining: true,
      });
      for (const sd of [-1, 1] as Side[]) j.hipPocket(sd * 0.15, 0.71, 0.13, 0.15, darker(PRIMARY, 1));
    },
  },
  chef: {
    hem: 0.84,
    band: null,
    collar: 'mandarin',
    cuff: { h: 0.07, out: 0.006, paint: PRIMARY },
    extra: (j) => {
      // Double-breasted: the right front over the left (its edge), two rows of knotted buttons.
      j.slab(1, [
        [j.hem, 0.08, 0.1],
        [1.42, 0.08, 0.1],
        [1.45, 0.02, 0.04],
      ], 0.004, PRIMARY);
      for (const X of [-0.055, 0.055]) j.bigButtons(1.0, 1.36, 5, DETAIL, X, 0.015);
      j.box(1.3, j.angX(-0.1, 1.3), new THREE.Vector3(0.05, 0.012, 0.006), DETAIL);
    },
  },
  jaleco: {
    hem: 0.56,
    coat: { flare: 0.04, vent: 0.72, wrap: true },
    hip: 0.016,
    open: vee(1.08, 0.075),
    collar: 'notch',
    lapel: { y: 1.08, w: 0.065 },
    cuff: null,
    extra: (j) => {
      j.bigButtons(0.72, 1.06, 4, darker(PRIMARY, 3), 0.02, 0.013);
      for (const sd of [-1, 1] as Side[]) j.hipPocket(sd * 0.12, 0.71, 0.13, 0.14, PRIMARY, darker(PRIMARY, 1));
      j.hipPocket(-0.1, 1.27, 0.085, 0.095, PRIMARY);
      // Pens in the chest pocket and a badge.
      for (const k of [0, 1]) j.box(1.33, j.angX(-0.115 + k * 0.022, 1.33), new THREE.Vector3(0.008, 0.04, 0.008), k ? DETAIL : darker(DETAIL, 3), 0.008);
      j.box(1.27, j.angX(0.1, 1.27), new THREE.Vector3(0.05, 0.065, 0.004), DETAIL);
    },
  },
  coletePesca: {
    hem: 0.9,
    vest: true,
    band: { h: 0.025, out: 0.004, paint: SECONDARY },
    fit: 0.004,
    open: gap(0.045, 0.06),
    collar: 'stand',
    collarPaint: SECONDARY,
    extra: (j) => {
      // Rows of pockets with flaps on both fronts; a ring on the chest; the mesh yoke on the back.
      for (const sd of [-1, 1] as Side[]) {
        j.hipPocket(sd * 0.115, 1.31, 0.07, 0.07, PRIMARY, SECONDARY);
        j.hipPocket(sd * 0.115, 1.19, 0.08, 0.08, PRIMARY, SECONDARY);
        j.hipPocket(sd * 0.1, 1.0, 0.11, 0.12, PRIMARY, SECONDARY);
        j.hipPocket(sd * 0.165, 1.2, 0.04, 0.09, darker(PRIMARY, 1));
      }
      j.box(1.39, j.angX(-0.085, 1.39), new THREE.Vector3(0.02, 0.02, 0.008), METAL, 0.004);
      j.rect(-0.17, 0.17, 1.24, 1.44, SECONDARY, true, 0.003);
      j.box(1.06, BACK, new THREE.Vector3(0.26, 0.16, 0.012), PRIMARY);
    },
  },
};

const PONCHO: Profile = [
  [1.52, 0.11, 0.1],
  [1.49, 0.22, 0.15],
  [1.43, 0.33, 0.2],
  [1.3, 0.37, 0.23],
  [0.84, 0.42, 0.3],
];

/** Hooded cape and rain poncho: cones over the shoulders, no sleeves. */
function capeItem(j: Jacket, id: string) {
  if (id === 'capaPoncho') {
    // A wide diamond hanging to the hands, the hood down on the back, snaps down the sides.
    capeOrPoncho(j, {
      pr: PONCHO,
      hem: 0.84,
      cols: 12,
      rows: [1.52, 1.48, 1.4, 1.2, 0.98, 0.84],
      paint: (y, a) => (Math.abs(Math.cos(a)) > 0.97 && y < 1.4 ? darker(PRIMARY, 1) : PRIMARY),
    });
    j.collarTube(1.5, 1.545, { r0: 0.4, r1: 0.12, paint: PRIMARY, ts: [0, 1], rim: { h: 0.01, out: 0.004, paint: darker(PRIMARY, 1) } });
    j.hoodDown(PRIMARY, darker(PRIMARY, 2), (y) => sampleProfile(PONCHO, y)[1] - 0.012);
    return;
  }
  // Hooded cape: open in front, a clasp at the neck, the hood up.
  capeOrPoncho(j, {
    pr: [
      [1.53, 0.11, 0.1],
      [1.49, 0.22, 0.15],
      [1.43, 0.32, 0.2],
      [1.3, 0.35, 0.22],
      [0.6, 0.4, 0.3],
    ],
    hem: 0.6,
    open: (y) => deg(lerp(14, 50, clamp((1.53 - y) / 0.6, 0, 1))),
    cols: 10,
    rows: [1.53, 1.48, 1.4, 1.15, 0.85, 0.6],
    lining: SECONDARY,
  });
  // Cowl round the neck under the hood.
  j.collarTube(1.44, 1.6, { r0: 1.2, r1: 0.6, paint: PRIMARY, gap: deg(70), ts: [0, 0.5, 1] });
  for (const sd of [-1, 1]) j.box(1.47, FRONT + sd * deg(12), new THREE.Vector3(0.022, 0.022, 0.008), BRASS, 0.06);
  const head = j.p.head;
  // The hood: a shell over the head whose lower edge rises over the forehead (the face opening).
  const edge = (a: number) => 1.545 + 0.165 * Math.pow(bell(angDist(a, FRONT), 0, deg(75)), 0.7);
  headShell(j.b, head, {
    y0: 1.545,
    y1: head.y1,
    rows: 5,
    cols: 12,
    d: (y, a) => 0.032 + 0.018 * smooth(y, 1.6, 1.78) * (1 - 0.5 * Math.max(0, Math.sin(a))),
    edge,
    rim: 0.012,
    paint: (y, a) => (y < edge(a) + 0.012 && angDist(a, FRONT) < deg(80) ? SECONDARY : PRIMARY),
    region: 'head',
    closeTop: true,
  });
}

export function jacket(id: string, sex: Sex): PieceGeometry {
  const { b, p } = start(sex, id.length * 19 + 11);
  if (id === 'capaPoncho' || id === 'capaCapuz') {
    const j = new Jacket(b, p, { hem: 0.6, vest: true, collar: 'none' });
    capeItem(j, id);
    return { skinned: b.build() };
  }
  const spec = SPECS[id] ?? SPECS.jaquetaJeans;
  const j = new Jacket(b, p, spec);
  j.torso();
  if (j.coat) j.skirt();
  j.sleeves();
  j.collar();
  if (spec.hood !== undefined) j.hoodDown(PRIMARY, spec.hood);
  spec.extra?.(j);
  return { skinned: b.build() };
}

export const JACKET_GENERATORS: Record<string, Generator> = {
  jacket: (id, sex) => jacket(id, sex),
};
