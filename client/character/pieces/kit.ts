// Helpers to build details stuck to clothes over the torso (patches that follow the chest, openings in the
// skin color, pockets, buttons, flat collars, printed flowers, jersey numbers, boxes on the sleeves). Everything
// is placed on the body's own surface (body.ts `torsoSurface`) at the garment's offset, so it fits every body
// and follows the build morphs. Shared by every torso piece (tees, sweaters, jackets, vests).
import * as THREE from 'three';
import type { BodyParts, Side } from '../body';
import type { FacetBuilder } from '../builder';
import type { Paint } from '../palette';
import type { RegionName } from '../rig';

export const deg = (d: number) => (d * Math.PI) / 180;
export const lerp = THREE.MathUtils.lerp;
/** Torso angles: a = 90° is the front (-Z), 270° the back, 0 the wearer's left (-X). */
export const FRONT = Math.PI / 2;
export const BACK = (3 * Math.PI) / 2;
export const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** 0 at the front and back, 1 at the sides. */
export const sideness = (a: number) => Math.abs(Math.cos(a));
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Index of a torso face column for `segments` columns starting at the front. */
export const column = (a: number, segments: number) => Math.floor((((a - FRONT) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / ((2 * Math.PI) / segments));
/** Index of the band of the torso's own rows (every 6 cm). */
export const rowBand = (y: number) => Math.floor((y - 0.81) / 0.06);

/** A row of a patch: height, angle from, angle to (increasing). */
export type Row = readonly [number, number, number];

/** Helpers to stick details to a garment over the torso (offset `d`). */
export class Kit {
  constructor(
    readonly b: FacetBuilder,
    readonly p: BodyParts,
    readonly d: number,
    readonly hem: number,
  ) {}

  surf(y: number, a: number, off = 0) {
    return this.p.torsoSurface(y, a, this.d + off);
  }

  /** Torso angle at sideways position X (m, the wearer's right is +X) on the front or the back. */
  angX(X: number, y: number, back = false) {
    const t = this.p.torsoAt(y);
    const k = Math.asin(THREE.MathUtils.clamp(X / (t.w + this.d), -0.95, 0.95));
    return back ? BACK - k : FRONT + k;
  }

  /** A patch over the cloth between rows going up, split so it follows the curve of the torso. */
  patch(rows: readonly Row[], paint: Paint, o: { off?: number; region?: RegionName; shade?: number; cols?: number } = {}) {
    // Far LOD: no patches (prints, plackets, openings read as the cloth's color from far away).
    if (this.b.lod >= 2) return;
    const off = o.off ?? 0.003;
    const span = Math.max(...rows.map(([, a0, a1]) => a1 - a0));
    // Columns every 0.2 rad (`cols` for fewer, bigger faces on wide patches).
    const cols = o.cols ?? Math.max(1, Math.ceil(span / 0.2));
    const grid = rows.map(([y, a0, a1]) =>
      Array.from({ length: cols + 1 }, (_, i) => {
        const s = this.surf(y, lerp(a0, a1, i / cols), off);
        return this.b.vertex(s.p, s.w, 0, { gordo: s.gordo, magro: s.magro });
      }),
    );
    for (let r = 0; r < rows.length - 1; r++) {
      const region = o.region ?? this.surf((rows[r][0] + rows[r + 1][0]) / 2, FRONT).region;
      for (let i = 0; i < cols; i++) this.b.quad(grid[r][i], grid[r + 1][i], grid[r + 1][i + 1], grid[r][i + 1], paint, region, o.shade ?? 0);
    }
  }

  /** A rectangle from X0 to X1 and y0 to y1 on the front or the back. */
  rect(X0: number, X1: number, y0: number, y1: number, paint: Paint, back = false, off?: number, step = 0.04) {
    const n = Math.max(1, Math.ceil((y1 - y0) / step));
    const rows: Row[] = Array.from({ length: n + 1 }, (_, i) => {
      const y = lerp(y0, y1, i / n);
      const a = this.angX(X0, y, back);
      const c = this.angX(X1, y, back);
      return [y, Math.min(a, c), Math.max(a, c)];
    });
    this.patch(rows, paint, { off });
  }

  /** A V (or U) opening: `half(y)` is its half angle at each height; a trim around it and the fill inside. */
  opening(y0: number, y1: number, center: number, half: (y: number) => number, fill: Paint, trim: Paint | null, steps = 4, cols?: number) {
    const rows = (grow: number, drop: number): Row[] =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const y = lerp(y0 - drop, y1, i / steps);
        const h = half(Math.max(y0, y)) + grow / (this.p.torsoAt(y).w + this.d);
        return [y, center - h, center + h];
      });
    if (trim !== null) this.patch(rows(0.012, 0.012), trim, { off: 0.0025, cols });
    this.patch(rows(0, 0), fill, { off: 0.0045, cols });
  }

  /** A box on the torso at (y, a): size = width, height, thickness. It follows the build morphs. */
  box(y: number, a: number, size: THREE.Vector3, paint: Paint, off = 0) {
    const s = this.surf(y, a);
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.n).normalize();
    const up = new THREE.Vector3().crossVectors(s.n, x).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, s.n));
    // Sunk a little: the flat back stays on the curved cloth at the edges.
    const c = s.p.clone().addScaledVector(s.n, off + size.z / 2 - 0.003);
    const at = (dp: THREE.Vector3) => new THREE.Matrix4().compose(c.clone().add(dp), q, size);
    this.b.append(new THREE.BoxGeometry(1, 1, 1), at(new THREE.Vector3()), s.w, s.region, paint, { morphs: { gordo: at(s.gordo), magro: at(s.magro) } });
  }

  /** Buttons down the front at X = 0 (`flat`: a raised square, 2 triangles instead of a box's 12). */
  buttons(y0: number, y1: number, n: number, paint: Paint, a = FRONT, flat = false) {
    for (let i = 0; i < n; i++) {
      const y = lerp(y0, y1, n > 1 ? i / (n - 1) : 0.5);
      if (flat) this.stud(y, a, 0.0055, paint, 0.004);
      else this.box(y, a, new THREE.Vector3(0.009, 0.009, 0.0045), paint, 0.002);
    }
  }

  /**
   * A small flat square (half size `h`, or `h` × `hy` tall) raised `off` over the cloth at (y, a), following the
   * build morphs: buttons, zip pulls, cord ends (2 triangles).
   */
  stud(y: number, a: number, h: number, paint: Paint, off: number, hy = h) {
    const s = this.surf(y, a, off);
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.n).normalize();
    const up = new THREE.Vector3().crossVectors(s.n, x).normalize();
    const morphs = { gordo: s.gordo, magro: s.magro };
    const v = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => this.b.vertex(s.p.clone().addScaledVector(x, i * h).addScaledVector(up, j * hy), s.w, 0, morphs));
    const inside = s.p.clone().addScaledVector(s.n, -0.05);
    this.b.triAway(v[0], v[1], v[2], inside, paint, s.region);
    this.b.triAway(v[0], v[2], v[3], inside, paint, s.region);
  }

  /** A chest pocket at X (wearer's left is −X), with an optional flap and button. */
  pocket(X: number, y: number, paint: Paint, flap?: Paint, button?: Paint) {
    const a = this.angX(X, y);
    this.box(y, a, new THREE.Vector3(0.072, 0.082, 0.008), paint);
    if (flap !== undefined) {
      const fy = y + 0.036;
      this.box(fy, this.angX(X, fy), new THREE.Vector3(0.078, 0.026, 0.011), flap);
      if (button !== undefined) this.box(fy - 0.004, this.angX(X, fy), new THREE.Vector3(0.008, 0.008, 0.004), button, 0.009);
    }
  }

  /** A flat piece lying on the chest (collar points, lapels): points (X, y, height over the cloth). */
  flat(pts: readonly (readonly [number, number, number])[], paint: Paint) {
    const s = pts.map(([X, y, off]) => this.surf(y, this.angX(X, y), off));
    const n = s.reduce((acc, x) => acc.add(x.n), new THREE.Vector3()).normalize();
    // Newell normal: counter-clockwise seen from outside.
    const nn = new THREE.Vector3();
    s.forEach((x, i) => {
      const a = x.p;
      const c = s[(i + 1) % s.length].p;
      nn.x += (a.y - c.y) * (a.z + c.z);
      nn.y += (a.z - c.z) * (a.x + c.x);
      nn.z += (a.x - c.x) * (a.y + c.y);
    });
    const list = nn.dot(n) < 0 ? [...s].reverse() : s;
    this.b.poly(
      list.map((x) => x.p),
      list[0].w,
      'chest',
      paint,
      { morphs: { gordo: list.map((x) => x.gordo), magro: list.map((x) => x.magro) } },
    );
  }

  /** Shirt collar points, one each side. */
  collarPoints(paint: Paint, spread: number, tip: number) {
    for (const s of [-1, 1] as Side[]) {
      this.flat(
        [
          [s * 0.012, 1.468, 0.012],
          [s * spread, 1.446, 0.007],
          [s * spread * 0.62, tip, 0.004],
        ],
        paint,
      );
    }
  }

  /** Open collar: lapels lying on the chest. */
  lapels(paint: Paint, bottom: number) {
    for (const s of [-1, 1] as Side[]) {
      this.flat(
        [
          [s * 0.045, 1.466, 0.01],
          [s * 0.088, 1.446, 0.007],
          [s * 0.042, bottom - 0.01, 0.005],
          [s * 0.014, bottom + 0.004, 0.005],
        ],
        paint,
      );
    }
  }

  /** A 5-petal flower lying on the cloth (prints). */
  flower(y: number, a: number, r: number, paint: Paint) {
    const s = this.surf(y, a, 0.003);
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.n).normalize();
    const up = new THREE.Vector3().crossVectors(s.n, x).normalize();
    const morphs = { gordo: s.gordo, magro: s.magro };
    const c = this.b.vertex(s.p.clone().addScaledVector(s.n, 0.001), s.w, 0, morphs);
    const turn = hash(y * 31 + a) * Math.PI;
    const ring = Array.from({ length: 10 }, (_, k) => {
      const ang = turn + (k * Math.PI) / 5;
      const rr = k % 2 ? r * 0.42 : r;
      return this.b.vertex(s.p.clone().addScaledVector(x, Math.cos(ang) * rr).addScaledVector(up, Math.sin(ang) * rr), s.w, 0, morphs);
    });
    const inside = s.p.clone().addScaledVector(s.n, -0.05);
    for (let k = 0; k < 10; k++) this.b.triAway(c, ring[k], ring[(k + 1) % 10], inside, paint, s.region);
  }

  /** Digits made of segments (jersey numbers), centered at height cy, `h` tall, read from the front or back. */
  number(text: string, cy: number, h: number, back: boolean, paint: Paint) {
    const w = h * 0.56;
    const t = h * 0.17;
    const gap = w * 0.3;
    const total = text.length * w + (text.length - 1) * gap;
    // The viewer's right is −X in front of the wearer and +X behind.
    const X = (vx: number) => (back ? vx : -vx);
    [...text].forEach((ch, i) => {
      const cx = -total / 2 + w / 2 + i * (w + gap);
      for (const seg of SEGMENTS[ch] ?? '') {
        const [x0, x1, y0, y1] = segmentRect(seg, w, h, t);
        this.rect(X(cx + x0), X(cx + x1), cy + y0, cy + y1, paint, back, 0.004);
      }
    });
  }

  /** A box on top of the upper arm at t (T pose: +Y, the outside when the arm hangs): sleeve patches. */
  armBox(side: Side, t: number, size: THREE.Vector3, paint: Paint) {
    const p = this.p;
    const [r0, r1] = p.s.upperArm;
    const x = lerp(p.j.shoulder - 0.07, p.j.elbow, t);
    const r = (lerp(r0, r1, t) + this.d + 0.002 + 0.006) * 0.92;
    const c = new THREE.Vector3(side * x, p.j.armY - 0.012 * (1 - t) + r + size.y / 2 - 0.002, 0);
    const lift = r * 0.16;
    const at = (dy: number) => new THREE.Matrix4().compose(c.clone().add(new THREE.Vector3(0, dy, 0)), new THREE.Quaternion(), size);
    const region: RegionName = side < 0 ? 'upperArm_L' : 'upperArm_R';
    this.b.append(new THREE.BoxGeometry(1, 1, 1), at(0), p.upperArmWeights(side, t), region, paint, { morphs: { gordo: at(lift), magro: at(-lift * 0.45) } });
  }
}

/** Seven-segment digits. */
export const SEGMENTS: Record<string, string> = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcfgd' };
export function segmentRect(seg: string, w: number, h: number, t: number): [number, number, number, number] {
  const L = -w / 2;
  const R = w / 2;
  const T = h / 2;
  const B = -h / 2;
  switch (seg) {
    case 'a':
      return [L, R, T - t, T];
    case 'd':
      return [L, R, B, B + t];
    case 'g':
      return [L, R, -t / 2, t / 2];
    case 'f':
      return [L, L + t, 0, T];
    case 'e':
      return [L, L + t, B, 0];
    case 'b':
      return [R - t, R, 0, T];
    default:
      return [R - t, R, B, 0];
  }
}
