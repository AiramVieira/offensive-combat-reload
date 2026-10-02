// Tops (torso slot): the 30 tees, tanks and shirts of the catalog, built over the body's torso and arms a
// little out, with modeled thickness on every edge (hem, sleeve, collar) and folds where cloth bunches (armpit
// tension, elbow compression). Details follow the style guide (no textures): stripes, plaid, panels and
// waffle knit are faces in other colors or shades; prints, numbers and plackets are patches that follow the
// chest; pockets, buttons and patches are volumes; openings (V necks, tears, deep armholes) are patches in the
// skin color. Everything stuck to the torso follows the build morphs (body.ts `torsoSurface`). The sweaters
// (catalog "blusa") use the same engine with the blocks of sweaters.ts (hoods, blousing, skirts, capes).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { PieceGeometry } from '.';
import type { BodyParts, PartOptions, Side } from '../body';
import { segment } from '../builder';
import { darker, DETAIL, PRIMARY, SECONDARY, SKIN, type Paint } from '../palette';
import { FIT, foldShade, folds, start } from './common';
import { angDist, BACK, column, deg, FRONT, hash, lerp, rowBand, sideness, type Row } from './kit';
import { armLining, blouseAt, capes, collarZip, hoodDown, hoodUp, Knit, skirt, SWEATERS } from './sweaters';

/**
 * Necklines (`tee`: the crew band of a tee worn under an open top, flat); sweaters add: `hood` (a low band under the hood's roll), `none` (the hood up covers it), `turtle`
 * (tall, folded over), `roll` (thick rolled crew), `stand` (zip collar), `boat` (off the shoulders: the torso's
 * top edge), `cowl` (wide funnel).
 */
type Neck = 'crew' | 'tee' | 'mock' | 'v' | 'henley' | 'polo' | 'tank' | 'racer' | 'shirt' | 'open' | 'camp' | 'scoop' | 'hood' | 'none' | 'turtle' | 'roll' | 'stand' | 'boat' | 'cowl';
type Cuff = 'band' | 'roll' | 'rib' | 'shirt' | 'elastic' | 'raw';

export interface TopSpec {
  hem: number;
  /** Top of the torso part (lower for tanks). */
  top?: number;
  /** 0 = sleeveless; up to 1 = along the upper arm to the elbow; 2 = long, to the wrist. */
  sleeve: number;
  fit: number;
  neck: Neck;
  /** Collar / neck band / strap paint. */
  collar?: Paint;
  /** Hem band (null = raw edge) and its height. */
  band?: Paint | null;
  bandH?: number;
  cuff?: Cuff;
  cuffPaint?: Paint;
  /** Torso paint per (y, a): stripes, plaid, panels. */
  body?: (y: number, a: number) => Paint;
  /** Sleeve paint per t (0..1 upper arm, 1..2 forearm) and angle; `s` is the side. */
  arm?: (t: number, a: number, s: Side) => Paint;
  shade?: (y: number, a: number) => number;
  /** Extra rings: torso (y), upper arm and forearm (t). */
  ts?: number[];
  armTs?: number[];
  foreTs?: number[];
  segments?: number;
  /** Wider sleeves (m at the end). */
  flare?: number;
  /** Tank straps: half width (m) and how far from the middle they sit on the shoulders. */
  strap?: { w: number; x: number };
  /** V neck: bottom height, half angle at the top, fill and trim. */
  v?: { y: number; half: number; fill: Paint; trim: Paint | null };
  extra?: (k: Knit) => void;

  // --- Sweaters (sweaters.ts) ---
  /** The hem band standing out (unitless on the torso tube: 0.005 ≈ 1 mm, 0.03 ≈ 6 mm). */
  bandOut?: number;
  /** The body hangs over the pants' waistband (blouses near the hem): at least what clears it, or this (m). */
  blouse?: number;
  /** Extra radius per height (m), instead of `blouse` (a poncho widening down). */
  drape?: (y: number) => number;
  /** Extra torso bump per (y, a), unitless (knit ridges, cables). */
  bump?: (y: number, a: number) => number;
  /** Where the sleeves start along the upper arm (off-shoulder tops: with a band there). */
  sleeveFrom?: number;
  armSegments?: number;
  /** Sleeve flare (m) per t (0..1 upper arm, 1..2 forearm), instead of the default. */
  armFlare?: (t: number) => number;
  armBump?: (t: number, a: number, s: Side) => number;
  armShade?: (t: number, a: number, s: Side) => number;
  /** Long sleeves bunch up before the cuff (hoodies, sweaters). */
  bunch?: boolean;
  /** Zipper teeth on a stand collar. */
  zip?: Paint;
  hood?: { kind: 'down' | 'up'; lining?: Paint; size?: number; mask?: Paint };
  /** A skirt below the hips (tunics, long cardigans); `gap` opens the front. */
  skirt?: { top: number; bottom: number; flare: number; gap?: number; segments?: number };
  skirtPaint?: (t: number, a: number) => Paint;
  /** Cape sleeves over the upper arms (poncho), `t1` along the arm. */
  cape?: { t1: number; flare: number };
}

const BAND = darker(PRIMARY, 1);
/**
 * Tucked tees end here, inside every waistband (pants' waists start at 1.0 m), and hug the body under it: the
 * waistband is faceted in 10 (its flat faces up to ~8 mm inside the curve), so a tee with more sides must be
 * almost on the skin there (the skin under it is hidden: the tee hides the belly, the pants the pelvis).
 */
const TUCK = 0.96;
const TUCK_D = 0.002;
/** Lowest height for details standing out of a tucked tee (buttons, pockets): over the highest waistband. */
const OVER_WAIST = 1.1;
/** Sweaters' offset over the pants' waistband (m). */
const BLOUSE = 0.045;
/** The body's top ring (its shoulders' shelf around the neck) and the top of a closed neckline. */
const SHELF_Y = 1.47;
const CLOSE_Y = 1.476;

/** Radius (m) of the collar where the body's cloth closes into it, or null: open necklines (straps, scoop, boat). */
function collarRadius(spec: TopSpec, p: BodyParts): number | null {
  const off: Partial<Record<Neck, number>> = {
    crew: 0.015,
    tee: 0.015,
    v: 0.015,
    henley: 0.015,
    mock: 0.008,
    polo: 0.016,
    shirt: 0.014,
    camp: 0.014,
    open: 0.017,
    hood: 0.01,
    none: 0.02,
    turtle: 0.019,
    roll: 0.019,
    stand: 0.016,
    cowl: 0.036,
  };
  const o = off[spec.neck];
  return o === undefined ? null : p.s.neck + o;
}

/**
 * The body's neck tube (body.ts `neck`) from y0 to y1 at offset d: the same axis, muscles and skin weights by
 * height as the skin under it (`BodyParts.neck` weighs a part by its own length, so a short collar would follow
 * the head halfway and cut into the neck when it nods).
 */
function neckTube(p: BodyParts, y0: number, y1: number, d: number, o: PartOptions = {}) {
  const N0 = 1.43;
  const N1 = 1.575;
  const tOf = (y: number) => (y - N0) / (N1 - N0);
  const z = (y: number) => 0.004 - 0.008 * tOf(y);
  const bell = (x: number, w: number) => Math.max(0, 1 - (x / w) ** 2);
  const weights = segment('neck', 'chest', 'head', 0.35);
  p.b.tube({
    from: new THREE.Vector3(0, y0, z(y0)),
    to: new THREE.Vector3(0, y1, z(y1)),
    radius: (u) => p.s.neck + d + (o.flare ? o.flare(u) : 0),
    sz: () => 0.94,
    bump: (u, a) => {
      const t = tOf(lerp(y0, y1, u));
      return 0.005 * bell(angDist(a, deg(90 + 50 - t * 35)), deg(20)) + 0.005 * bell(angDist(a, deg(90 - 50 + t * 35)), deg(20)) + (o.bump ? o.bump(u, a) : 0);
    },
    ts: o.ts ?? [0, 0.35, 0.7, 1],
    segments: o.segments ?? 8,
    a0: Math.PI / 2 + (o.gap ?? 0) / 2,
    arc: o.gap ? Math.PI * 2 - o.gap : undefined,
    region: o.region ?? 'neck',
    weights: (u) => weights(THREE.MathUtils.clamp(tOf(lerp(y0, y1, u)), 0, 1)),
    paint: o.paint,
    ao: o.ao,
    build: () => 0.08,
    rimStart: o.rimStart,
    rimEnd: o.rimEnd,
  });
}

/** Plaid: bands of `band` over `base` every 3 rows and 3 columns, `cross` where they meet. */
const plaid =
  (base: Paint, band: Paint, cross: Paint, segments = 12) =>
  (y: number, a: number) => {
    const r = rowBand(y) % 3 === 0;
    const c = column(a, segments) % 3 === 0;
    return r && c ? cross : r || c ? band : base;
  };
const armPlaid = (base: Paint, band: Paint, cross: Paint) => (t: number, a: number) => {
  const r = Math.floor(t / 0.25) % 2 === 0;
  const c = Math.floor((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 3 === 0;
  return r && c ? cross : r || c ? band : base;
};

/** Stripes on the torso's own rows (every 6 cm): no rings of their own. */
const stripes = (a: Paint, b: Paint) => (y: number) => (rowBand(y) % 2 ? b : a);

/** Raglan seam: from the neck down to the armpit; above it is the sleeve's color. */
const raglanSeam = (y: number, a: number) => {
  const fromSide = Math.min(angDist(a, 0), angDist(a, Math.PI));
  return fromSide < deg(68) && y > 1.33 + 0.13 * (fromSide / deg(68));
};

/** Bottom of the arm tube (T pose: −Y) in its angles. */
const armBottom = (s: Side) => (s < 0 ? deg(90) : deg(270));

const SPECS: Record<string, TopSpec> = {
  basica: { hem: 0.93, sleeve: 0.46, fit: FIT.regular, neck: 'crew', collar: SECONDARY },
  golaV: { hem: 0.93, sleeve: 0.46, fit: FIT.regular, neck: 'v', collar: SECONDARY, v: { y: 1.37, half: deg(26), fill: SKIN, trim: SECONDARY } },
  polo: { hem: 0.92, sleeve: 0.44, fit: FIT.regular, neck: 'polo', collar: SECONDARY, band: SECONDARY, cuffPaint: SECONDARY },
  henley: { hem: 0.93, sleeve: 0.46, fit: FIT.regular, neck: 'henley', collar: BAND },
  oversized: { hem: 0.85, sleeve: 0.72, fit: FIT.loose, neck: 'crew', collar: SECONDARY, flare: 0.014, bandH: 0.03 },
  mangaDobrada: { hem: 0.93, sleeve: 0.36, fit: FIT.regular, neck: 'crew', collar: BAND, cuff: 'roll', cuffPaint: SECONDARY },
  raglan: {
    hem: 0.93,
    sleeve: 0.5,
    fit: FIT.regular,
    neck: 'crew',
    collar: SECONDARY,
    segments: 12,
    body: (y, a) => (raglanSeam(y, a) ? SECONDARY : PRIMARY),
    arm: () => SECONDARY,
    cuffPaint: SECONDARY,
  },
  listrada: {
    hem: 0.93,
    sleeve: 0.46,
    fit: FIT.regular,
    neck: 'crew',
    collar: SECONDARY,
    band: SECONDARY,
    body: stripes(PRIMARY, SECONDARY),
    arm: (t) => (Math.floor(t / 0.15) % 2 ? SECONDARY : PRIMARY),
    armTs: [0.15, 0.3],
  },
  estampa: {
    hem: 0.93,
    sleeve: 0.46,
    fit: FIT.regular,
    neck: 'crew',
    collar: BAND,
    extra: (k) => {
      // A round emblem with a mountain on the chest.
      const cy = 1.29;
      const r = 0.065;
      const n = 6;
      const circle: Row[] = Array.from({ length: n + 1 }, (_, i) => {
        const y = cy - r + (2 * r * i) / n;
        const hw = Math.sqrt(Math.max(r * r - (y - cy) ** 2, (r * 0.2) ** 2));
        return [y, k.angX(-hw, y), k.angX(hw, y)];
      });
      k.patch(circle, DETAIL, { off: 0.003 });
      const tri = (y0: number, y1: number, w: number, paint: Paint, off: number) =>
        k.patch(
          [
            [y0, k.angX(-w, y0), k.angX(w, y0)],
            [y1, k.angX(-0.004, y1), k.angX(0.004, y1)],
          ],
          paint,
          { off },
        );
      tri(cy - r * 0.55, cy + r * 0.5, r * 0.72, PRIMARY, 0.005);
      tri(cy + r * 0.12, cy + r * 0.5, r * 0.26, DETAIL, 0.0065);
    },
  },
  timeEsportivo: {
    hem: 0.9,
    sleeve: 0.5,
    fit: FIT.loose,
    neck: 'v',
    collar: SECONDARY,
    v: { y: 1.38, half: deg(24), fill: SKIN, trim: SECONDARY },
    band: SECONDARY,
    cuffPaint: SECONDARY,
    body: (_y, a) => (sideness(a) > 0.9 ? SECONDARY : PRIMARY),
    extra: (k) => {
      k.number('10', 1.29, 0.075, false, DETAIL);
      k.number('10', 1.22, 0.16, true, DETAIL);
    },
  },
  mangaLonga: { hem: 0.92, sleeve: 2, fit: FIT.regular, neck: 'crew', collar: SECONDARY, cuff: 'rib', cuffPaint: SECONDARY },
  termica: {
    hem: 0.92,
    sleeve: 2,
    fit: FIT.tight,
    neck: 'henley',
    collar: SECONDARY,
    band: SECONDARY,
    bandH: 0.04,
    cuff: 'rib',
    cuffPaint: SECONDARY,
    segments: 12,
    // Waffle knit: a checker of lighter and darker faces.
    shade: (y, a) => ((rowBand(y) + column(a, 12)) % 2 ? 0.45 : -0.45),
  },
  segundaPele: {
    hem: 0.92,
    sleeve: 2,
    fit: FIT.tight,
    neck: 'mock',
    collar: PRIMARY,
    cuff: 'rib',
    segments: 12,
    body: (_y, a) => (sideness(a) > 0.9 ? SECONDARY : PRIMARY),
    arm: (_t, a, s) => (angDist(a, armBottom(s)) < deg(50) ? SECONDARY : PRIMARY),
  },
  camisetaTatica: {
    hem: 0.92,
    sleeve: 0.5,
    fit: FIT.regular,
    neck: 'crew',
    collar: SECONDARY,
    segments: 12,
    body: (y, a) => (raglanSeam(y, a) ? SECONDARY : PRIMARY),
    arm: () => SECONDARY,
    cuffPaint: SECONDARY,
    extra: (k) => {
      for (const s of [-1, 1] as Side[]) k.armBox(s, 0.3, new THREE.Vector3(0.055, 0.006, 0.042), DETAIL);
      k.pocket(-0.075, 1.29, PRIMARY, darker(PRIMARY, 1));
    },
  },
  rasgada: {
    hem: 0.93,
    sleeve: 0.4,
    fit: FIT.regular,
    neck: 'crew',
    collar: BAND,
    band: null,
    cuff: 'raw',
    extra: (k) => {
      // Tears: skin through ragged holes.
      const holes: [number, number, number][] = [
        // Over the waistband (the tee is tucked in).
        [1.11, FRONT - 0.34, 0.24],
        [1.22, FRONT + 0.4, 0.2],
        [1.13, FRONT + 0.2, 0.13],
        [1.34, FRONT - 0.55, 0.13],
        [1.12, BACK + 0.25, 0.24],
        [1.3, BACK - 0.45, 0.17],
      ];
      for (const [y, a, w] of holes) {
        k.patch(
          [
            [y - 0.034, a - w * 0.3, a + w * 0.12],
            [y - 0.01, a - w, a + w * 0.55],
            [y + 0.012, a - w * 0.65, a + w],
            [y + 0.03, a - w * 0.15, a + w * 0.3],
          ],
          SKIN,
          { off: 0.0025 },
        );
      }
    },
  },
  regataCavada: {
    hem: 0.93,
    sleeve: 0,
    fit: FIT.regular,
    neck: 'tank',
    strap: { w: 0.014, x: 0.085 },
    extra: (k) => {
      // Deep armholes: the sides open down to the ribs.
      for (const c of [0, Math.PI]) {
        k.patch(
          [1.23, 1.3, 1.36, 1.415].map((y): Row => {
            const h = lerp(0.12, 0.62, Math.sqrt((y - 1.23) / 0.185));
            return [y, c - h, c + h];
          }),
          SKIN,
          { off: 0.0025 },
        );
      }
    },
  },
  regata: { hem: 0.93, sleeve: 0, fit: FIT.regular, neck: 'tank' },
  regataCanelada: {
    hem: 0.93,
    sleeve: 0,
    fit: FIT.tight,
    neck: 'tank',
    segments: 16,
    // Ribbed knit: vertical lines of light and dark faces.
    shade: (_y, a) => (column(a, 16) % 2 ? 0.55 : -0.55),
  },
  cropped: { hem: 1.13, sleeve: 0.38, fit: FIT.tight, neck: 'crew', collar: SECONDARY, band: SECONDARY, cuffPaint: SECONDARY },
  topEsportivo: { hem: 1.19, top: 1.405, sleeve: 0, fit: FIT.tight, neck: 'racer', collar: SECONDARY, band: SECONDARY, bandH: 0.045 },
  socialCurta: {
    hem: 0.9,
    sleeve: 0.44,
    fit: FIT.regular,
    neck: 'shirt',
    collar: SECONDARY,
    extra: (k) => k.pocket(-0.075, 1.29, PRIMARY),
  },
  socialLonga: {
    hem: 0.9,
    sleeve: 2,
    fit: FIT.regular,
    neck: 'shirt',
    collar: SECONDARY,
    cuff: 'shirt',
    cuffPaint: SECONDARY,
    extra: (k) => k.pocket(-0.075, 1.29, PRIMARY),
  },
  xadrezAberta: {
    hem: 0.9,
    sleeve: 2,
    fit: FIT.loose,
    neck: 'open',
    collar: PRIMARY,
    cuff: 'shirt',
    segments: 12,
    // Open over a tee (secondary) in the middle.
    body: (y, a) => (angDist(a, FRONT) < deg(30) ? SECONDARY : plaid(PRIMARY, DETAIL, darker(DETAIL, 2))(y, a)),
    arm: armPlaid(PRIMARY, DETAIL, darker(DETAIL, 2)),
    extra: (k) => {
      // Button bands along the open edges.
      for (const s of [-1, 1]) {
        const e = FRONT + s * deg(30);
        const rows = [k.hem + 0.022, 1.0, 1.1, 1.2, 1.3, 1.4, 1.445].map((y): Row => [y, Math.min(e, e + s * deg(9)), Math.max(e, e + s * deg(9))]);
        k.patch(rows, darker(PRIMARY, 1), { off: 0.004 });
      }
      k.buttons(OVER_WAIST, 1.36, 4, darker(PRIMARY, 3), FRONT + deg(34.5), true);
    },
  },
  havaiana: {
    hem: 0.89,
    sleeve: 0.5,
    fit: FIT.loose,
    neck: 'camp',
    collar: PRIMARY,
    flare: 0.012,
    extra: (k) => {
      for (let i = 0; i < 14; i++) {
        const back = i % 2 === 1;
        const a = (back ? BACK : FRONT) + (hash(i) * 2 - 1) * 1.25;
        const y = 0.98 + hash(i + 7) * 0.4;
        if (!back && (angDist(a, FRONT) < 0.16 || (y > 1.36 && angDist(a, FRONT) < 0.6))) continue;
        k.flower(y, a, 0.022 + hash(i + 3) * 0.01, DETAIL);
      }
    },
  },
  camisaJeans: {
    hem: 0.9,
    sleeve: 2,
    fit: FIT.regular,
    neck: 'shirt',
    collar: PRIMARY,
    cuff: 'shirt',
    extra: (k) => {
      for (const X of [-0.075, 0.075]) k.pocket(X, 1.29, PRIMARY, darker(PRIMARY, 1));
    },
  },
  flanela: {
    hem: 0.9,
    sleeve: 0.44,
    fit: FIT.regular,
    neck: 'shirt',
    collar: PRIMARY,
    segments: 12,
    body: plaid(PRIMARY, SECONDARY, darker(SECONDARY, 2)),
    arm: armPlaid(PRIMARY, SECONDARY, darker(SECONDARY, 2)),
    extra: (k) => k.pocket(-0.075, 1.29, PRIMARY, darker(PRIMARY, 1), DETAIL),
  },
  bata: {
    hem: 0.88,
    sleeve: 2,
    fit: FIT.loose,
    neck: 'scoop',
    collar: SECONDARY,
    cuff: 'elastic',
    cuffPaint: SECONDARY,
    flare: 0.03,
    band: null,
  },
  mecanico: {
    hem: 0.9,
    sleeve: 0.44,
    fit: FIT.loose,
    neck: 'shirt',
    collar: SECONDARY,
    extra: (k) => {
      for (const X of [-0.075, 0.075]) k.pocket(X, 1.27, PRIMARY, SECONDARY);
      // Name patch over the right pocket.
      k.rect(0.035, 0.112, 1.355, 1.384, DETAIL, false, 0.004);
    },
  },
  hoquei: {
    hem: 0.86,
    sleeve: 2,
    fit: FIT.loose,
    neck: 'v',
    collar: SECONDARY,
    v: { y: 1.39, half: deg(22), fill: SKIN, trim: SECONDARY },
    band: SECONDARY,
    bandH: 0.03,
    cuff: 'rib',
    cuffPaint: SECONDARY,
    flare: 0.014,
    // The hem stripe just over the waistband (the jersey is tucked in), on the torso's own rows.
    body: (y) => (y > 1.35 || (y > 1.05 && y < 1.11) ? SECONDARY : PRIMARY),
    arm: (t) => (t < 0.5 || (t > 1.3 && t < 1.6) ? SECONDARY : PRIMARY),
    extra: (k) => {
      // Laces across the V.
      for (const y of [1.405, 1.43]) {
        const h = deg(22) * ((y - 1.39) / (1.462 - 1.39));
        k.patch(
          [
            [y, FRONT - h - 0.06, FRONT + h + 0.06],
            [y + 0.006, FRONT - h - 0.06, FRONT + h + 0.06],
          ],
          DETAIL,
          { off: 0.006 },
        );
      }
      k.number('23', 1.2, 0.15, true, DETAIL);
    },
  },
  coleteLa: {
    hem: 0.92,
    sleeve: 2,
    fit: FIT.loose,
    neck: 'v',
    collar: SECONDARY,
    v: { y: 1.33, half: deg(30), fill: SECONDARY, trim: darker(PRIMARY, 1) },
    band: darker(PRIMARY, 1),
    bandH: 0.045,
    cuff: 'shirt',
    cuffPaint: SECONDARY,
    // Sweater vest over a shirt: the shirt shows at the armholes and on the sleeves.
    body: (y, a) => (sideness(a) > 0.9 && y > 1.3 ? SECONDARY : PRIMARY),
    shade: (_y, a) => (Math.floor(((a % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 5)) % 2 ? 0.25 : -0.25),
    arm: () => SECONDARY,
    extra: (k) => {
      k.collarPoints(SECONDARY, 0.056, 1.4);
      k.buttons(1.35, 1.43, 2, DETAIL);
    },
  },
};

const CUFFS: Record<Exclude<Cuff, 'raw'>, { h: number; out: number }> = {
  band: { h: 0.02, out: 0.005 },
  roll: { h: 0.032, out: 0.011 },
  rib: { h: 0.045, out: 0.003 },
  shirt: { h: 0.05, out: 0.004 },
  elastic: { h: 0.03, out: 0.002 },
};

export function top(id: string, sex: Sex): PieceGeometry {
  const sweater = SWEATERS[id];
  const spec = SPECS[id] ?? sweater ?? SPECS.basica;
  const { b, p } = start(sex, id.length * 13 + 5);
  const d = spec.fit;
  const strapped = spec.neck === 'tank' || spec.neck === 'racer';
  // Tees are tucked in: the pants' waistband (tops at 1.0 to 1.08 m) goes over them, and under it the waist's
  // front comes in toward the legs. Below TUCK a tee would only poke out through it, so it ends there (no hem
  // band: never seen), and down from the waistband's top it hugs the body (a loose tee gathered into the belt),
  // so even leggings' thin waist (1.6 cm out) covers it.
  // (Sweaters that don't hang over the waistband are tucked in the same way.)
  const tucked = spec.hem < TUCK && spec.blouse === undefined && !spec.drape && !spec.skirt;
  const hem = tucked ? TUCK : spec.hem;
  // The body closes up into the collar: a ring over the body's top shelf (1.47 m, wider than the neck) and the
  // last one drawn in under the collar, so no ring of skin shows between the cloth's edge and the collar.
  const collarR = collarRadius(spec, p);
  const closeTop = collarR !== null && spec.top === undefined;
  const neckTop = spec.top ?? (strapped ? 1.415 : closeTop ? CLOSE_Y : 1.465);
  /** Half width (m) the cloth is drawn in to at the top rings, or null below them. */
  const closeAt = (y: number) => {
    if (!closeTop || y < SHELF_Y - 5e-4) return null;
    const W = Math.max(p.torsoAt(SHELF_Y).w + 0.005, collarR! - 0.002);
    return y > CLOSE_Y - 0.001 ? collarR! - 0.003 : W;
  };
  const band = spec.band === undefined ? BAND : spec.band;
  const bandH = spec.bandH ?? 0.022;
  const bandOut = spec.bandOut ?? 0.005;
  // Sweaters: the body wider than the offset in places (blousing, a thick hem band), the Kit's details on it.
  // Over the waistband: at least BLOUSE out down there (the pants' waist stands up to 3 cm out, its back pockets
  // and loops ~4 cm).
  const blouse = spec.blouse === undefined ? 0 : hem < 1.04 ? Math.max(spec.blouse, BLOUSE - d) : spec.blouse;
  const drape = spec.drape ?? (blouse ? blouseAt(hem, band === null ? 0 : bandH, blouse) : undefined);
  // Tucked: how much the cloth is drawn in at each height (m), for the tube and for the Kit's details on it.
  const gatherAt = (y: number) => (tucked ? (d - Math.min(d, TUCK_D)) * (1 - THREE.MathUtils.smoothstep(y, 1.05, 1.11)) : 0);
  // The Kit's surface follows the same: gathered at the waist, blousing or draping, closing at the top.
  const drapeAt = (y: number) => {
    const c = closeAt(y);
    return c !== null ? c - p.torsoAt(y).w - d : (drape ? drape(y) : 0) - gatherAt(y);
  };
  const k = sweater ? new Knit(b, p, d, hem, drapeAt, band === null ? undefined : { top: hem + bandH, out: bandOut }) : new Knit(b, p, d, hem, drapeAt);
  const torsoBump = spec.bump;
  const tension = (t: number, a: number) => 0.004 * Math.max(0, Math.sin(a * 5 + t * 30)) * (t > 0.55 && t < 0.85 ? 1 : 0);
  const rimStart = band === null || tucked ? undefined : { h: bandH, out: bandOut, paint: band };
  const shade = spec.shade ?? ((y: number, a: number) => (y > 1.25 && y < 1.4 ? 0.6 * Math.sin(a * 5 + y * 40) : 0));

  // Body of the shirt: a hem band at the bottom, tension folds under the arms.
  if (sweater) {
    const tn = (y: number, a: number) => tension((y - hem) / (neckTop - hem), a);
    k.torso(hem, neckTop, {
      rimStart,
      // Off-shoulder tops: an elastic band along the top edge.
      rimEnd: spec.neck === 'boat' ? { h: 0.03, out: 0.03, paint: spec.collar ?? BAND } : undefined,
      paint: spec.body ?? PRIMARY,
      bump: torsoBump ? (y, a) => tn(y, a) + torsoBump(y, a) : tn,
      shade,
      segments: spec.segments,
      ts: closeTop ? [...(spec.ts ?? []), SHELF_Y] : spec.ts,
    });
  } else {
    // Gathered into the waistband: pulled in to TUCK_D (m) under it.
    const yOf = (t: number) => lerp(hem, neckTop, t);
    const gather = (t: number, a: number) => {
      const pull = gatherAt(yOf(t));
      if (!pull) return 0;
      const s = p.torsoAt(yOf(t));
      return -pull / Math.hypot(Math.cos(a) * (s.w + d), Math.sin(a) * (s.d + d));
    };
    p.torso(hem, neckTop, d, {
      rimStart,
      paint: spec.body ?? PRIMARY,
      bump: (t, a) => tension(t, a) + gather(t, a),
      // Radius multiplier (1 + flare / w): the top rings at their drawn-in half width.
      flare: closeTop
        ? (t) => {
            const c = closeAt(yOf(t));
            const w = p.torsoAt(yOf(t)).w;
            return c === null ? 0 : w * (c / (w + d) - 1);
          }
        : undefined,
      shade,
      segments: spec.segments,
      ts: spec.ts,
    });
  }

  // Sleeves (they cover the body's deltoid), long ones down the forearm, with the cuff at the end.
  if (spec.cape) {
    const armPaint = spec.arm;
    capes(k, { ...spec.cape, d: d + 0.004, fringe: DETAIL, paint: armPaint ?? (() => PRIMARY) });
    for (const s of [-1, 1] as Side[]) deltoidCap(p, s, 0.006, armPaint ? armPaint(0.05, 0, s) : PRIMARY);
  } else if (spec.sleeve > 0) {
    const long = spec.sleeve >= 2;
    const cuffKind = spec.cuff ?? 'band';
    const cuff = cuffKind === 'raw' ? undefined : { ...CUFFS[cuffKind], paint: spec.cuffPaint ?? BAND };
    const flare = spec.flare ?? 0;
    const t0 = spec.sleeveFrom ?? 0;
    const { arm: armPaint, armBump, armShade, armFlare } = spec;
    for (const s of [-1, 1] as Side[]) {
      const upperFolds = folds(0.08, 0.12, 0.004, 3);
      const upperShade = foldShade(0.08, 0.12);
      p.upperArm(s, t0, long ? 1 : spec.sleeve, d + 0.002, {
        // Off-shoulder: the sleeve starts down the arm, with a band.
        rimStart: t0 > 0 ? { h: 0.024, out: 0.005, paint: spec.collar ?? BAND } : undefined,
        rimEnd: long ? undefined : cuff,
        flare: armFlare ?? ((t) => (0.006 + flare) * t),
        bump: armBump ? (t, a) => upperFolds(t, a) + armBump(t, a, s) : upperFolds,
        shade: armShade ? (t, a) => upperShade(t, a) + armShade(t, a, s) : upperShade,
        paint: armPaint ? (t, a) => armPaint(t, a, s) : PRIMARY,
        ts: spec.armTs,
        segments: spec.armSegments,
        // Long sleeves: rings where the skin's weights change (body.ts upperArmWeights: the shoulder blend ends
        // near 0.2-0.33; the forearm takes over from 0.7), so a bent arm never comes out between two rings.
        rings: long ? [0, 0.2, 0.45, 0.7, 0.88, 1] : undefined,
      });
      // Short sleeves: the inside of the opening (a raised arm shows it; single-sided cloth would read as a hoop).
      if (!long) {
        const t1 = spec.sleeve;
        const inner = darker(armPaint ? armPaint(t1, 0, s) : PRIMARY, 3);
        b.detail(() => armLining(p, s, t1 - 0.12, t1 - 0.004, inner, { extra: () => 0.006 }));
      }
      // Over the body's deltoid, skinned like it: the sleeve tube follows the arm's own weights, so with the
      // arm down or raised the shoulder ball would come through the cloth.
      if (t0 === 0) deltoidCap(p, s, 0.006, armPaint ? armPaint(0.05, s < 0 ? deg(270) : deg(90), s) : PRIMARY);
      if (long) {
        // Elbow folds (compression), loose sleeves narrowing into an elastic cuff (or bunching before a rib).
        const narrow = cuffKind === 'elastic' || spec.bunch;
        const end = narrow ? (t: number) => flare * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.8) : (t: number) => flare * (1 - 0.4 * t);
        const foreFolds = folds(0.06, 0.1, 0.005, 3, s);
        // Where the cuff band starts along the forearm (the tube runs from the elbow to 0.9).
        const cuffFrom = cuff ? 0.9 * (1 - cuff.h / ((p.j.wrist + 0.012 - (p.j.elbow - 0.02)) * 0.9)) : 0.9;
        const foreShade = foldShade(0.06, 0.1, 3, s);
        p.forearm(s, 0, 0.9, d + 0.004, {
          rimEnd: cuff,
          flare: armFlare ? (t) => armFlare(1 + t) : (t) => 0.006 + end(t),
          bump: armBump ? (t, a) => foreFolds(t, a) + armBump(1 + t, a, s) : foreFolds,
          shade: armShade ? (t, a) => foreShade(t, a) + armShade(1 + t, a, s) : foreShade,
          paint: armPaint ? (t, a) => armPaint(1 + t, a, s) : PRIMARY,
          ts: spec.foreTs,
          segments: spec.armSegments,
          // The skin's own rings (body.ts forearm: the upper arm's share fades by 0.25, the hand's grows from 0.75);
          // a cuff band reaching down to ~0.75 gives that last one.
          rings: cuffFrom < 0.8 ? [0, 0.12, 0.35, 0.9] : [0, 0.12, 0.35, 0.65, 0.9],
        });
      }
    }
  }

  neckline(k, spec);
  if (spec.hood?.kind === 'down') hoodDown(k, { lining: spec.hood.lining, size: spec.hood.size });
  if (spec.hood?.kind === 'up') hoodUp(k, { lining: spec.hood.lining, mask: spec.hood.mask });
  if (spec.skirt) {
    const body = spec.body;
    skirt(k, { ...spec.skirt, paint: spec.skirtPaint ?? (body ? (_t, a) => body(0.9, a) : PRIMARY), hemPaint: spec.cuffPaint ?? BAND });
  }
  spec.extra?.(k);
  // Skirts show their inside (like the bottoms' skirts).
  return { skinned: b.build(), doubleSided: spec.skirt ? true : undefined };
}

function neckline(k: Knit, spec: TopSpec) {
  const p = k.p;
  const collar = spec.collar ?? BAND;
  const band = (o: { gap?: number; high?: boolean } = {}) =>
    neckTube(p, 1.43, o.high ? 1.535 : 1.478, o.high ? 0.006 : 0.009, {
      paint: collar,
      rimEnd: { h: 0.012, out: 0.004, paint: collar },
      flare: () => (o.high ? 0.002 : 0.006),
      segments: 10,
      ts: o.high ? [0, 0.5, 1] : [0, 1],
      gap: o.gap,
    });
  const stand = (gap: number) =>
    neckTube(p, 1.43, 1.495, 0.011, {
      paint: collar,
      rimEnd: { h: 0.014, out: 0.004, paint: collar },
      flare: (t) => 0.005 * t,
      segments: 10,
      ts: [0, 1],
      gap,
    });
  const placket = (y0: number, y1: number, paint: Paint) => k.rect(-0.016, 0.016, y0, y1, paint, false, 0.002, 0.07);
  const vHalf = (v: NonNullable<TopSpec['v']>) => (y: number) => Math.max(0.03, v.half * ((y - v.y) / (1.462 - v.y)));

  switch (spec.neck) {
    case 'crew':
      band();
      break;
    case 'tee':
      neckTube(p, 1.43, 1.478, 0.009, { paint: collar, flare: () => 0.006, segments: 10, ts: [0, 1] });
      break;
    case 'mock':
      band({ high: true });
      break;
    case 'v': {
      const v = spec.v!;
      band({ gap: 2 * v.half });
      k.opening(v.y, CLOSE_Y, FRONT, vHalf(v), v.fill, v.trim, 3, 2);
      break;
    }
    case 'henley':
      band();
      placket(1.335, 1.455, darker(PRIMARY, 1));
      k.buttons(1.355, 1.43, 3, DETAIL, FRONT, true);
      break;
    case 'polo':
      neckTube(p, 1.43, 1.495, 0.012, {
        paint: collar,
        rimEnd: { h: 0.026, out: 0.005, paint: collar },
        flare: (t) => 0.006 * t,
        segments: 10,
        ts: [0, 1],
      });
      k.collarPoints(collar, 0.05, 1.405);
      placket(1.335, 1.455, collar);
      k.buttons(1.36, 1.405, 2, DETAIL, FRONT, true);
      break;
    case 'shirt':
      stand(deg(16));
      k.collarPoints(collar, 0.06, 1.392);
      placket(k.hem + 0.024, 1.455, PRIMARY);
      k.buttons(Math.max(k.hem + 0.08, OVER_WAIST), 1.425, 5, DETAIL, FRONT, true);
      break;
    case 'open':
      // A tee under the open shirt: its crew band; the shirt's collar spread over the shoulders.
      neckTube(p, 1.43, 1.47, 0.011, { paint: SECONDARY, rimEnd: { h: 0.01, out: 0.004, paint: SECONDARY }, flare: () => 0.006, segments: 10, ts: [0, 1] });
      k.lapels(collar, 1.4);
      break;
    case 'camp': {
      const v = { y: 1.38, half: deg(30), fill: SKIN, trim: null };
      stand(2 * v.half);
      k.opening(v.y, CLOSE_Y, FRONT, vHalf(v), SKIN, null);
      k.lapels(collar, v.y);
      placket(k.hem + 0.024, v.y + 0.004, PRIMARY);
      k.buttons(Math.max(k.hem + 0.08, OVER_WAIST), v.y - 0.02, 4, darker(PRIMARY, 3), FRONT, true);
      break;
    }
    case 'scoop':
      // A wide U front and back, with an embroidered band around it.
      for (const [c, y0] of [
        [FRONT, 1.385],
        [BACK, 1.42],
      ] as const) {
        k.opening(y0, 1.466, c, (y) => Math.max(0.12, 0.95 * Math.sqrt((y - y0) / (1.466 - y0))), SKIN, collar, 3, 5);
      }
      break;
    case 'hood':
      // Under the hood's roll: a low band closing the neck hole.
      neckTube(p, 1.43, 1.47, 0.01, { paint: collar, ts: [0, 1], segments: 10 });
      break;
    case 'turtle': {
      // A tall rib collar folded over: the inner tube up under the jaw, the fold outside with its edge.
      const rib = (_t: number, a: number) => (Math.floor((a - Math.PI / 2) / (Math.PI / 5) + 20) % 2 ? collar : darker(collar, 1));
      neckTube(p, 1.43, 1.54, 0.008, { paint: rib, rimEnd: { h: 0.01, out: 0.004, paint: collar }, ts: [0, 1], segments: 10 });
      neckTube(p, 1.452, 1.51, 0.019, { paint: rib, rimStart: { h: 0.012, out: 0.005, paint: darker(collar, 1) }, flare: (t) => 0.004 * (1 - t), ts: [0, 1], segments: 10 });
      break;
    }
    case 'roll':
      neckTube(p, 1.43, 1.49, 0.012, { paint: collar, rimEnd: { h: 0.026, out: 0.011, paint: collar }, flare: () => 0.007, segments: 10, ts: [0, 1] });
      break;
    case 'stand':
      // A zip collar, the zipper teeth up its front.
      // Not as high as the jaw: looking down puts the chin on it.
      neckTube(p, 1.43, 1.515, 0.012, { paint: collar, rimEnd: { h: 0.012, out: 0.004, paint: collar }, flare: (t) => 0.006 * t, segments: 10, ts: [0, 1] });
      collarZip(k, 0.018, 1.515, spec.zip ?? DETAIL);
      break;
    case 'cowl':
      neckTube(p, 1.43, 1.52, 0.03, { paint: collar, rimEnd: { h: 0.016, out: 0.007, paint: collar }, flare: (t) => 0.014 * t, segments: 10, ts: [0, 0.5, 1] });
      break;
    case 'boat':
    case 'none':
      break;
    case 'tank':
    case 'racer': {
      // Straps over the shoulders: wide in front; a tank's go straight back, a racer's meet between the blades.
      const racer = spec.neck === 'racer';
      const strap = spec.strap ?? { w: racer ? 0.017 : 0.019, x: racer ? 0.09 : 0.1 };
      for (const s of [-1, 1] as Side[]) strapOver(k, s, strap.x, strap.w, racer ? 0.045 : strap.x, spec.collar ?? BAND);
      break;
    }
  }
}

/** Torso section (body.ts): a superellipse radius multiplier. */
const section = (a: number) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 2.4) + Math.pow(Math.abs(Math.sin(a)), 2.4), 1 / 2.4);

/**
 * A strap over the shoulder on side `s`, lying on the cloth's surface (so it follows the build morphs and the
 * chest's skin weights): up the front at X (m from the middle), over the top of the shoulder and down the back,
 * where it ends at `backX` (a racerback's meet between the blades). `hw` is its half width; it has walls (style
 * guide: thickness on every edge) and its ends sit on the top's edge.
 */
function strapOver(k: Knit, s: Side, X: number, hw: number, backX: number, paint: Paint) {
  const p = k.p;
  const b = k.b;
  const Y0 = 1.398;
  const YTOP = 1.47;
  // Height where the surface reaches |x| = x at the angle θ from the front (or back) center: w(y) is decreasing
  // over the shoulder (1.40 → 1.47), so bisect.
  const yAt = (x: number, th: number) => {
    const need = x / Math.max(1e-3, Math.sin(th) * section(FRONT + th)) - k.d;
    if (need >= p.torsoAt(1.4).w) return Y0;
    if (need <= p.torsoAt(YTOP).w) return YTOP;
    let lo = 1.4;
    let hi = YTOP;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (p.torsoAt(m).w > need) lo = m;
      else hi = m;
    }
    return Math.max(Y0, (lo + hi) / 2);
  };
  // The angle where the strap's middle line comes up out of the top's edge.
  const start = (x: number) => {
    let th = 0.05;
    while (th < Math.PI / 2 - 0.05 && yAt(x, th) <= Y0 + 1e-4) th += 0.01;
    return Math.max(0.05, th - 0.04);
  };
  const n = b.lod >= 1 ? 3 : 4;
  // Samples: up the front (θ from the start to the side), then down the back.
  const pts: { th: number; back: boolean; x: number }[] = [];
  const tf = start(X);
  for (let i = 0; i <= n; i++) pts.push({ th: lerp(tf, Math.PI / 2, i / n), back: false, x: X });
  for (let i = n - 1; i >= 0; i--) {
    const f = i / n;
    // Racerback: the strap swings in toward the middle on its way down.
    const x = lerp(backX, X, f ** 0.7);
    pts.push({ th: lerp(start(x), Math.PI / 2, f), back: true, x });
  }
  const H = 0.003;
  const angle = (th: number, back: boolean) => (back ? BACK - s * th : FRONT + s * th);
  // On the top's cloth at its edge, then down onto the skin over the shoulder (the cloth ends at the edge: at
  // the cloth's offset the strap would stand off the trapezius, more so when the shoulders lift).
  const lift = (y: number) => lerp(0.0005, 0.0015 - k.d, THREE.MathUtils.smoothstep(y, Y0 + 0.015, Y0 + 0.04));
  const edge = (q: (typeof pts)[number], e: -1 | 1, off: number) => {
    const xx = q.x + e * hw;
    const y = yAt(xx, q.th);
    const sf = k.surf(y, angle(q.th, q.back), off + lift(y));
    return b.vertex(sf.p, sf.w, 0, { gordo: sf.gordo, magro: sf.magro });
  };
  const top = pts.map((q) => [edge(q, -1, H), edge(q, 1, H)]);
  const base = pts.map((q) => [edge(q, -1, 0), edge(q, 1, 0)]);
  const wall = darker(paint, 1);
  for (let i = 0; i < pts.length - 1; i++) {
    // The torso's axis at that height is inside.
    const inside = new THREE.Vector3(0, (b.position(base[i][0]).y + b.position(base[i + 1][1]).y) / 2, 0);
    const quad = (a: number, c: number, d: number, e: number, pt: Paint) => {
      b.triAway(a, c, d, inside, pt, 'chest');
      b.triAway(a, d, e, inside, pt, 'chest');
    };
    quad(top[i][0], top[i][1], top[i + 1][1], top[i + 1][0], paint);
    if (b.lod >= 2) continue;
    // Walls along both edges, facing out sideways (away from the strap's middle line).
    for (const j of [0, 1]) {
      const mid = b.position(top[i][0]).add(b.position(top[i][1])).add(b.position(top[i + 1][0])).add(b.position(top[i + 1][1])).multiplyScalar(0.25);
      const w0 = top[i][j];
      const w1 = top[i + 1][j];
      const centroid = b.position(w0).add(b.position(w1)).multiplyScalar(0.5);
      const toward = mid.clone().sub(centroid);
      const ref = centroid.clone().add(toward.multiplyScalar(2));
      b.triAway(base[i][j], base[i + 1][j], w1, ref, wall, 'chest');
      b.triAway(base[i][j], w1, w0, ref, wall, 'chest');
    }
  }
}

/**
 * The body's deltoid (body.ts `deltoid`: same place and skin weights) a little larger, in the sleeve's color:
 * where the arm's own weights move the sleeve differently from the shoulder ball, the ball shows cloth instead
 * of skin. The same facets as the body's (with fewer, their corners come through). Full detail only (the far
 * levels have no deltoid on the body either).
 */
function deltoidCap(p: BodyParts, s: Side, d: number, paint: Paint) {
  if (p.b.lod) return;
  const [dx, dy, dz] = p.s.deltoid;
  p.b.append(
    new THREE.SphereGeometry(1, 7, 4),
    new THREE.Matrix4().compose(
      new THREE.Vector3(s * (p.j.shoulder + 0.008), p.j.armY - 0.012, 0.002),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * -0.45)),
      new THREE.Vector3(dx + d, dy + d, dz + d),
    ),
    [[s < 0 ? 'upperArm_L' : 'upperArm_R', 0.55], [s < 0 ? 'shoulder_L' : 'shoulder_R', 0.25], ['chest', 0.2]],
    s < 0 ? 'upperArm_L' : 'upperArm_R',
    paint,
    { build: 0.18 },
  );
}

