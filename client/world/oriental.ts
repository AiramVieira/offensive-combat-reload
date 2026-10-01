// Building blocks for oriental maps ("Jardim do Dragão"): curved roofs with swept-up corners, multi-story
// pavilions with balconies and shoji (paper) walls, moon gates, rocks, cloud pines, bonsai and bamboo,
// dragons, paper lanterns that swing when shot, a gong, the fountain dragon's fire breath and koi.
// Everything static goes through the MapBuilder batches; only animated props are separate meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeColoredParts, toonGradient, type ColoredPart } from '../render/materials';
import { MapBuilder, stairRun, worldUVs, type Opening } from './mapBuilder';
import { surfaceMaterial, type SurfaceKey } from './surfaces';
import type { PropBus } from './props';

export const ORIENTAL = {
  plaster: 0xf3eee2,
  lacquer: 0xc0352b,
  lacquerDark: 0x8a2a22,
  wood: 0x8a5432,
  woodDark: 0x5a3420,
  /** Painted beams under the eaves. */
  beam: 0x2f7f78,
  gold: 0xe7b847,
  roof: 0x5d6575,
  roofDark: 0x3a3f4b,
  stone: 0xc9c3b6,
  stoneDark: 0x8f8a80,
  rock: 0xa6a69e,
  floor: 0xc49a6c,
  paper: 0xffffff,
} as const;

export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Side = 'n' | 's' | 'e' | 'w';

/** Deterministic PRNG: rocks and trees must collide the same way on every client. */
export function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const corners = (r: Rect): [number, number][] => [
  [r.x0, r.z0],
  [r.x1, r.z0],
  [r.x1, r.z1],
  [r.x0, r.z1],
];

export const expand = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, z0: r.z0 - d, x1: r.x1 + d, z1: r.z1 + d });

/** Quaternion turning +Y toward `dir`, as the Euler tuple ColoredPart takes. */
function aim(dir: THREE.Vector3): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  return [e.x, e.y, e.z];
}

// --- Curved roof ------------------------------------------------------------------------------------

export interface RoofOpts {
  /** Eave rectangle. */
  outer: Rect;
  /** Top: a ridge line when it has no depth (hip roof), a point (pyramid), or a rectangle (eave skirt). */
  top: Rect;
  eaveY: number;
  topY: number;
  /** How much the corners sweep up (m). */
  curl?: number;
  tint?: number;
  underTint?: number;
  collide?: boolean;
  /** Ridge beam with curled ends, raised hip ridges and, on a pyramid, a golden finial. */
  ridges?: boolean;
  thickness?: number;
}

/**
 * Four curved faces from the eave rectangle up to the top: concave like a tent (shallow at the eaves, steep
 * near the top), with every corner swept up and out. Tiles on top, lacquered wood underneath. Collides as
 * the convex hull of its eaves and top, which always sits just above the curved surface.
 * Returns the swept-up corner tips (where lanterns hang).
 */
export function curvedRoof(b: MapBuilder, o: RoofOpts): THREE.Vector3[] {
  const NS = 10;
  const NT = 6;
  const curl = o.curl ?? 0.6;
  const th = o.thickness ?? 0.18;
  const E = corners(o.outer);
  const T = corners(o.top);
  const cx = (o.outer.x0 + o.outer.x1) / 2;
  const cz = (o.outer.z0 + o.outer.z1) / 2;
  const diag = E.map(([x, z]) => {
    const l = Math.hypot(x - cx, z - cz) || 1;
    return [(x - cx) / l, (z - cz) / l];
  });
  const profile = (t: number) => 0.25 * t + 0.75 * t * t;
  const point = (k: number, s: number, t: number) => {
    const k1 = (k + 1) % 4;
    const ex = E[k][0] + (E[k1][0] - E[k][0]) * s;
    const ez = E[k][1] + (E[k1][1] - E[k][1]) * s;
    const tx = T[k][0] + (T[k1][0] - T[k][0]) * s;
    const tz = T[k][1] + (T[k1][1] - T[k][1]) * s;
    // Corner sweep: strongest at the eave corners, gone by mid-edge and toward the top. Faces meeting at
    // a hip compute the same offset there (same corner, same t), so the surface stays closed.
    const w = (1 - t) * (1 - t) * Math.abs(2 * s - 1) ** 4;
    let dx = diag[k][0] * (1 - s) + diag[k1][0] * s;
    let dz = diag[k][1] * (1 - s) + diag[k1][1] * s;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    return new THREE.Vector3(ex + (tx - ex) * t + dx * curl * 0.5 * w, o.eaveY + (o.topY - o.eaveY) * profile(t) + curl * w, ez + (tz - ez) * t + dz * curl * 0.5 * w);
  };

  const tiles = surfaceMaterial('telhado');
  const wood = surfaceMaterial('madeira');
  const paint = surfaceMaterial('pintura');
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const fascia: number[] = [];
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const edge = Math.hypot(E[k1][0] - E[k][0], E[k1][1] - E[k][1]);
    if (edge < 0.01) continue;
    const slope = point(k, 0.5, 0).distanceTo(point(k, 0.5, 1));
    const grid: THREE.Vector3[] = [];
    const uv: number[] = [];
    for (let j = 0; j <= NT; j++) {
      for (let i = 0; i <= NS; i++) {
        grid.push(point(k, i / NS, j / NT));
        uv.push((i / NS) * edge, (j / NT) * slope);
      }
    }
    // One winding for the whole face, picked so the top's normals point up.
    const at = (i: number, j: number) => j * (NS + 1) + i;
    const mid = Math.floor(NS / 2);
    const n = tmpA.subVectors(grid[at(mid + 1, 0)], grid[at(mid, 0)]).cross(tmpB.subVectors(grid[at(mid, 1)], grid[at(mid, 0)]));
    const flip = n.y < 0;
    const idx: number[] = [];
    for (let j = 0; j < NT; j++) {
      for (let i = 0; i < NS; i++) {
        const a = at(i, j);
        const bq = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        if (flip) idx.push(a, c, bq, a, d, c);
        else idx.push(a, bq, c, a, c, d);
      }
    }
    const face = (dy: number, reverse: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(grid.flatMap((p) => [p.x, p.y + dy, p.z]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const ix = reverse ? idx.map((_, q) => idx[q - (q % 3) + (2 - (q % 3))]) : idx;
      g.setIndex(ix);
      g.computeVertexNormals();
      return g;
    };
    const topGeo = face(0, false);
    const underGeo = face(-th, true);
    b.addGeometry(topGeo, tiles, o.tint ?? ORIENTAL.roof);
    b.addGeometry(underGeo, wood, o.underTint ?? ORIENTAL.lacquerDark, false);
    topGeo.dispose();
    underGeo.dispose();
    // Fascia: the thick front edge of the eaves.
    for (let i = 0; i < NS; i++) {
      const p = grid[at(i, 0)];
      const q = grid[at(i + 1, 0)];
      fascia.push(p.x, p.y, p.z, q.x, q.y - th, q.z, q.x, q.y, q.z, p.x, p.y, p.z, p.x, p.y - th, p.z, q.x, q.y - th, q.z);
    }
  }
  const fasciaGeo = new THREE.BufferGeometry();
  fasciaGeo.setAttribute('position', new THREE.Float32BufferAttribute(fascia, 3));
  fasciaGeo.computeVertexNormals();
  // Both windings: whatever the edge's direction, it shows from outside.
  const fasciaBack = fasciaGeo.clone();
  const pos = fasciaBack.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
    pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    pos.setXYZ(i + 2, x, y, z);
  }
  fasciaBack.computeVertexNormals();
  b.addGeometry(fasciaGeo, paint, o.underTint ?? ORIENTAL.lacquerDark, false);
  b.addGeometry(fasciaBack, paint, o.underTint ?? ORIENTAL.lacquerDark, false);
  fasciaGeo.dispose();
  fasciaBack.dispose();

  if (o.ridges) {
    const ridgeTint = ORIENTAL.roofDark;
    for (let k = 0; k < 4; k++) {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= NT; j++) pts.push(point(k, 0, j / NT).add(new THREE.Vector3(0, 0.07, 0)));
      if (pts[0].distanceTo(pts[NT]) < 0.2) continue;
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.11, 6);
      b.addGeometry(tube, paint, ridgeTint);
      tube.dispose();
    }
    const lx = o.top.x1 - o.top.x0;
    const lz = o.top.z1 - o.top.z0;
    const tcx = (o.top.x0 + o.top.x1) / 2;
    const tcz = (o.top.z0 + o.top.z1) / 2;
    const ridgeOpts = { tint: ridgeTint, collide: false };
    if (Math.max(lx, lz) > 0.1 && Math.min(lx, lz) < 0.01) {
      const alongX = lx >= lz;
      const len = Math.max(lx, lz);
      b.box(tcx, o.topY + 0.12, tcz, alongX ? len + 0.6 : 0.34, 0.42, alongX ? 0.34 : len + 0.6, 'pintura', ridgeOpts);
      // Curled ridge ends (the "owl tails" of classical roofs).
      for (const side of [-1, 1]) {
        const ex = alongX ? tcx + side * (len / 2 + 0.25) : tcx;
        const ez = alongX ? tcz : tcz + side * (len / 2 + 0.25);
        const rot = alongX ? new THREE.Euler(0, 0, -side * 0.45) : new THREE.Euler(side * 0.45, 0, 0);
        b.box(ex, o.topY + 0.6, ez, 0.3, 0.8, 0.3, 'pintura', { ...ridgeOpts, rot });
        b.box(alongX ? ex + side * 0.28 : ex, o.topY + 1.0, alongX ? ez : ez + side * 0.28, 0.22, 0.36, 0.22, 'pintura', { tint: ORIENTAL.gold, collide: false });
      }
    } else if (Math.max(lx, lz) <= 0.1) {
      // Pyramid: golden finial on the apex.
      b.cylinder(tcx, o.topY - 0.1, tcz, 0.16, 0.5, 'pintura', { tint: ridgeTint, collide: false, segments: 8 });
      b.cylinder(tcx, o.topY + 0.4, tcz, 0.06, 1.6, 'pintura', { tint: ORIENTAL.gold, collide: false, segments: 6 });
      for (const [y, r] of [[0.7, 0.22], [1.05, 0.18], [1.4, 0.14], [2.05, 0.16]]) {
        b.addGeometry(new THREE.SphereGeometry(r, 10, 6).translate(tcx, o.topY + y, tcz), paint, ORIENTAL.gold);
      }
    }
  }

  if (o.collide !== false) {
    const hull = [...E.map(([x, z]) => [x, o.eaveY, z]), ...T.map(([x, z]) => [x, o.topY, z])].flat();
    b.convexCollider(new Float32Array(hull), 'wood');
  }
  return E.map((_, k) => point(k, 0, 0).add(new THREE.Vector3(-diag[k][0] * 0.2, -0.12, -diag[k][1] * 0.2)));
}

// --- Railings, columns, paper walls -----------------------------------------------------------------

/** Lacquered balustrade: posts, rails and balusters (visual), one thin collider (bullets go through). */
export function railing(b: MapBuilder, axis: 'x' | 'z', fixed: number, a: number, end: number, y: number, o: { h?: number; tint?: number; collide?: boolean } = {}) {
  const h = o.h ?? 1.0;
  const len = end - a;
  if (len < 0.05) return;
  const tint = o.tint ?? ORIENTAL.lacquer;
  const piece = (s0: number, s1: number, y0: number, y1: number, d: number) => {
    if (axis === 'x') b.span(s0, y0, fixed - d / 2, s1, y1, fixed + d / 2, 'pintura', { tint, collide: false });
    else b.span(fixed - d / 2, y0, s0, fixed + d / 2, y1, s1, 'pintura', { tint, collide: false });
  };
  piece(a, end, y + h - 0.08, y + h, 0.12);
  piece(a, end, y + 0.08, y + 0.16, 0.08);
  const posts = Math.max(1, Math.ceil(len / 1.6));
  for (let k = 0; k <= posts; k++) {
    const p = a + (len * k) / posts;
    piece(p - 0.06, p + 0.06, y, y + h + 0.06, 0.12);
  }
  for (let p = a + 0.26; p < end - 0.12; p += 0.26) piece(p - 0.02, p + 0.02, y + 0.16, y + h - 0.08, 0.04);
  if (o.collide === false) return;
  const c = (a + end) / 2;
  b.cuboidCollider(
    axis === 'x' ? new THREE.Vector3(c, y + h / 2, fixed) : new THREE.Vector3(fixed, y + h / 2, c),
    axis === 'x' ? new THREE.Vector3(len / 2, h / 2, 0.05) : new THREE.Vector3(0.05, h / 2, len / 2),
    new THREE.Quaternion(),
    'wood',
  );
}

/** Red lacquered column on a small stone base. */
export function column(b: MapBuilder, x: number, z: number, y0: number, y1: number, r = 0.17) {
  b.cylinder(x, y0, z, r + 0.1, 0.18, 'pedra', { tint: ORIENTAL.stone, collide: false, segments: 8 });
  b.cylinder(x, y0, z, r, y1 - y0, 'pintura', { tint: ORIENTAL.lacquer, segments: 10, physics: 'wood' });
}

/** Solid intervals of [a, b] once `holes` are taken out. */
export function solidIntervals(a: number, end: number, holes: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cursor = a;
  for (const [h0, h1] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (h0 > cursor + 0.01) out.push([cursor, Math.min(h0, end)]);
    cursor = Math.max(cursor, h1);
  }
  if (end > cursor + 0.01) out.push([cursor, end]);
  return out;
}

/**
 * Shoji wall: rice paper on a lattice (shot through, physics "paper"), a wooden dado and a top rail
 * (visual only, so they never stop the bullet the paper lets through). `doors` are centers along the wall.
 */
export function paperWall(b: MapBuilder, axis: 'x' | 'z', fixed: number, a: number, end: number, h: number, y0: number, doors: number[] = [], doorW = 1.8) {
  const t = 0.06;
  const ops: Opening[] = doors.map((c) => [c - doorW / 2, c + doorW / 2, 0, 2.4]);
  b.wall(axis, fixed, a, end, t, h, 'papel', ops, y0, { tint: ORIENTAL.paper, frame: { surface: 'madeira', tint: ORIENTAL.woodDark, width: 0.1 } });
  const trim = { tint: ORIENTAL.woodDark, collide: false, castShadow: false };
  const piece = (s0: number, s1: number, v0: number, v1: number) => {
    if (axis === 'x') b.span(s0, y0 + v0, fixed - 0.05, s1, y0 + v1, fixed + 0.05, 'madeira', trim);
    else b.span(fixed - 0.05, y0 + v0, s0, fixed + 0.05, y0 + v1, s1, 'madeira', trim);
  };
  for (const [s0, s1] of solidIntervals(a, end, ops.map(([s0, s1]) => [s0, s1]))) piece(s0, s1, 0, 0.9);
  piece(a, end, h - 0.12, h);
}

// --- Pavilion ---------------------------------------------------------------------------------------

export type WallStyle = 'estuque' | 'papel' | 'madeira';
const SIDES: Side[] = ['n', 's', 'e', 'w'];
const WALL_T: Record<WallStyle, number> = { estuque: 0.3, madeira: 0.15, papel: 0.06 };
const DOOR_W = 1.8;
const DOOR_H = 2.4;
const WIN_W = 1.5;
const SLAB = 0.25;
const STAIR_W = 1.3;

export interface StairSpec {
  /** Along the inside of the north or south wall, climbing along X. */
  side: 'n' | 's';
  dir: 1 | -1;
  /** X of the first step, relative to the pavilion's center. */
  from: number;
  /** Gap between the wall and the stairs (a smaller story above must still contain the stairwell). */
  inset?: number;
}

export interface Story {
  /** Half extents of this floor's walls (wall center lines). */
  hw: number;
  hd: number;
  /** Floor to next floor (the top story: floor to eaves). */
  h: number;
  style: WallStyle;
  sideStyle?: Partial<Record<Side, WallStyle>>;
  /** Door and window centers per side: along X on n/s, along Z on e/w, relative to the center. */
  doors?: Partial<Record<Side, number[]>>;
  /** Windows have a 0.9 m sill and a 2.3 m top: crouch-jumpable. */
  windows?: Partial<Record<Side, number[]>>;
  /** This floor's slab reaches out as a railed balcony on these sides. */
  balcony?: { depth: number; sides: Side[] };
  /** Tiled eave skirt hanging off this floor's slab edge (pagoda tiers, the eaves over a porch). */
  skirt?: number;
  stairs?: StairSpec[];
}

export interface PavilionSpec {
  cx: number;
  cz: number;
  /** Stone platform under the building, with steps centered on the given sides. */
  plinth?: { h: number; margin: number; steps: Side[] };
  stories: Story[];
  roof: { overhang: number; rise: number; curl?: number };
}

export interface Pavilion {
  /** Floor height of each story. */
  floors: number[];
  eaveY: number;
  /** Swept-up corners of the roof and the skirts: where lanterns hang. */
  hooks: THREE.Vector3[];
}

/**
 * Multi-story pavilion: lacquered columns, plaster / paper / wooden walls with doors and windows, inner
 * stairs under a stairwell in the slab above, balconies with railings (held up by columns when they
 * reach out over the ground), eave skirts and a curved hip roof (a pyramid when the top story is square).
 */
export function pavilion(b: MapBuilder, spec: PavilionSpec): Pavilion {
  const { cx, cz } = spec;
  const C = ORIENTAL;
  const hooks: THREE.Vector3[] = [];
  const floors: number[] = [];
  const styleOf = (st: Story, sd: Side) => st.sideStyle?.[sd] ?? st.style;
  const half = (st: Story, sd: Side) => (sd === 'n' || sd === 's' ? st.hd : st.hw);
  /** From the center to the outer face of a story's wall. */
  const outerExt = (st: Story, sd: Side) => half(st, sd) + WALL_T[styleOf(st, sd)] / 2;
  const s0 = spec.stories[0];
  const plinth = spec.plinth ? { x0: cx - s0.hw - spec.plinth.margin, x1: cx + s0.hw + spec.plinth.margin, z0: cz - s0.hd - spec.plinth.margin, z1: cz + s0.hd + spec.plinth.margin } : null;
  const inPlinth = (x: number, z: number) => !!plinth && x > plinth.x0 && x < plinth.x1 && z > plinth.z0 && z < plinth.z1;

  if (spec.plinth && plinth) {
    const h = spec.plinth.h;
    b.span(plinth.x0, 0, plinth.z0, plinth.x1, h, plinth.z1, 'pedra', { tint: C.stone });
    // Darker band around the top edge; its top sits just under the platform's (coplanar faces flicker).
    b.span(plinth.x0 - 0.05, h - 0.14, plinth.z0 - 0.05, plinth.x1 + 0.05, h - 0.02, plinth.z1 + 0.05, 'pintura', { tint: C.stoneDark, collide: false, castShadow: false });
    const run = stairRun(h);
    for (const sd of spec.plinth.steps) {
      const w = 2;
      if (sd === 's') b.stairs('z', -1, plinth.z1 + run, cx - w, cx + w, 0, h, 'pedra', { tint: C.stone });
      if (sd === 'n') b.stairs('z', 1, plinth.z0 - run, cx - w, cx + w, 0, h, 'pedra', { tint: C.stone });
      if (sd === 'e') b.stairs('x', -1, plinth.x1 + run, cz - w, cz + w, 0, h, 'pedra', { tint: C.stone });
      if (sd === 'w') b.stairs('x', 1, plinth.x0 - run, cz - w, cz + w, 0, h, 'pedra', { tint: C.stone });
    }
  }

  const stairRect = (st: Story, s: StairSpec) => {
    const t = WALL_T[styleOf(st, s.side)];
    const inset = s.inset ?? 0;
    const wallIn = s.side === 'n' ? cz - st.hd + t / 2 + inset : cz + st.hd - t / 2 - inset;
    const [z0, z1] = s.side === 'n' ? [wallIn, wallIn + STAIR_W] : [wallIn - STAIR_W, wallIn];
    const start = cx + s.from;
    const end = start + s.dir * stairRun(st.h);
    return { x0: Math.min(start, end), x1: Math.max(start, end), z0, z1, start, end };
  };

  const walls = (st: Story, fy: number, wh: number) => {
    for (const sd of SIDES) {
      const style = styleOf(st, sd);
      const t = WALL_T[style];
      const alongX = sd === 'n' || sd === 's';
      const fixed = sd === 'n' ? cz - st.hd : sd === 's' ? cz + st.hd : sd === 'w' ? cx - st.hw : cx + st.hw;
      const c0 = alongX ? cx : cz;
      // n/s walls own the corners; e/w walls run between them.
      const a = alongX ? cx - st.hw - WALL_T[styleOf(st, 'w')] / 2 : cz - st.hd + WALL_T[styleOf(st, 'n')] / 2;
      const end = alongX ? cx + st.hw + WALL_T[styleOf(st, 'e')] / 2 : cz + st.hd - WALL_T[styleOf(st, 's')] / 2;
      const doors = (st.doors?.[sd] ?? []).map((c): Opening => [c0 + c - DOOR_W / 2, c0 + c + DOOR_W / 2, 0, DOOR_H]);
      const wins = (st.windows?.[sd] ?? []).map((c): Opening => [c0 + c - WIN_W / 2, c0 + c + WIN_W / 2, 0.9, 2.3]);
      if (style === 'papel') {
        paperWall(b, alongX ? 'x' : 'z', fixed, a, end, wh, fy, (st.doors?.[sd] ?? []).map((c) => c0 + c));
      } else {
        const surf: SurfaceKey = style === 'estuque' ? 'concreto' : 'madeira';
        const tint = style === 'estuque' ? C.plaster : C.lacquerDark;
        const frame = style === 'estuque' ? { surface: 'pintura' as const, tint: C.lacquer, width: 0.12 } : { surface: 'pintura' as const, tint: C.gold, width: 0.08 };
        b.wall(alongX ? 'x' : 'z', fixed, a, end, t, wh, surf, [...doors, ...wins], fy, { tint, frame });
      }
      // Painted beam along the top of the wall.
      const d = t + 0.14;
      if (alongX) b.span(a, fy + wh - 0.42, fixed - d / 2, end, fy + wh, fixed + d / 2, 'pintura', { tint: C.beam, collide: false });
      else b.span(fixed - d / 2, fy + wh - 0.42, a, fixed + d / 2, fy + wh, end, 'pintura', { tint: C.beam, collide: false });
      // Columns between the panels of paper and wooden walls (plaster walls only get the corners).
      if (style !== 'estuque') {
        const s0 = alongX ? cx - st.hw : cz - st.hd;
        const len = 2 * (alongX ? st.hw : st.hd);
        const n = Math.ceil(len / 3.6);
        const holes = [...doors, ...wins];
        for (let k = 1; k < n; k++) {
          const p = s0 + (len * k) / n;
          if (holes.some(([o0, o1]) => p > o0 - 0.3 && p < o1 + 0.3)) continue;
          if (alongX) column(b, p, fixed, fy, fy + wh, 0.14);
          else column(b, fixed, p, fy, fy + wh, 0.14);
        }
      }
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) column(b, cx + sx * st.hw, cz + sz * st.hd, fy, fy + wh, 0.2);
  };

  /** Rectangle minus holes, as few boxes as possible. */
  const slabWithHoles = (r: Rect, holes: Rect[], y0: number, y1: number) => {
    const xs = [...new Set([r.x0, r.x1, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((p, q) => p - q);
    const zs = [...new Set([r.z0, r.z1, ...holes.flatMap((h) => [h.z0, h.z1])])].sort((p, q) => p - q);
    for (let j = 0; j < zs.length - 1; j++) {
      const zm = (zs[j] + zs[j + 1]) / 2;
      let run: number | null = null;
      for (let i = 0; i < xs.length - 1; i++) {
        const xm = (xs[i] + xs[i + 1]) / 2;
        const solid = !holes.some((h) => xm > h.x0 && xm < h.x1 && zm > h.z0 && zm < h.z1);
        if (solid && run === null) run = xs[i];
        if (!solid && run !== null) {
          b.span(run, y0, zs[j], xs[i], y1, zs[j + 1], 'piso', { tint: C.floor });
          run = null;
        }
      }
      if (run !== null) b.span(run, y0, zs[j], xs[xs.length - 1], y1, zs[j + 1], 'piso', { tint: C.floor });
    }
  };

  let y = spec.plinth?.h ?? 0;
  spec.stories.forEach((st, i) => {
    floors.push(y);
    const top = i === spec.stories.length - 1;
    if (i === 0) {
      b.span(cx - st.hw, y, cz - st.hd, cx + st.hw, y + 0.02, cz + st.hd, 'piso', { tint: C.floor, collide: false, castShadow: false });
    } else {
      const prev = spec.stories[i - 1];
      const ext = {} as Record<Side, number>;
      for (const sd of SIDES) {
        const balcony = st.balcony?.sides.includes(sd) ? st.balcony.depth : 0;
        ext[sd] = Math.max(outerExt(st, sd) + balcony, outerExt(prev, sd));
      }
      const r: Rect = { x0: cx - ext.w, x1: cx + ext.e, z0: cz - ext.n, z1: cz + ext.s };
      const wells = (prev.stairs ?? []).map((s) => stairRect(prev, s));
      slabWithHoles(r, wells, y - SLAB, y);
      // Railings around every edge that reaches out past this story's walls.
      for (const sd of SIDES) {
        if (ext[sd] - outerExt(st, sd) < 0.3) continue;
        if (sd === 'n') railing(b, 'x', r.z0 + 0.06, r.x0, r.x1, y);
        if (sd === 's') railing(b, 'x', r.z1 - 0.06, r.x0, r.x1, y);
        if (sd === 'w') railing(b, 'z', r.x0 + 0.06, r.z0, r.z1, y);
        if (sd === 'e') railing(b, 'z', r.x1 - 0.06, r.z0, r.z1, y);
      }
      // Stairwell railings: along the room side, leaving the top of the flight open, and across the bottom.
      for (const w of wells) {
        const s = (prev.stairs ?? [])[wells.indexOf(w)];
        const zEdge = s.side === 'n' ? w.z1 + 0.05 : w.z0 - 0.05;
        const stop = w.end - s.dir * 1.2;
        railing(b, 'x', zEdge, Math.min(w.start, stop), Math.max(w.start, stop), y);
        railing(b, 'z', w.start - s.dir * 0.05, w.z0, w.z1, y);
      }
      // Balcony over the ground: columns along its edge.
      if (i === 1) {
        const placed = new Set<string>();
        for (const sd of SIDES) {
          if (ext[sd] - outerExt(prev, sd) < 0.9) continue;
          const alongX = sd === 'n' || sd === 's';
          const fixed = sd === 'n' ? r.z0 + 0.3 : sd === 's' ? r.z1 - 0.3 : sd === 'w' ? r.x0 + 0.3 : r.x1 - 0.3;
          const a = alongX ? r.x0 + 0.3 : r.z0 + 0.3;
          const end = alongX ? r.x1 - 0.3 : r.z1 - 0.3;
          const n = Math.max(1, Math.ceil((end - a) / 4));
          for (let k = 0; k <= n; k++) {
            const p = a + ((end - a) * k) / n;
            const [x, z] = alongX ? [p, fixed] : [fixed, p];
            const key = `${x.toFixed(2)},${z.toFixed(2)}`;
            if (placed.has(key)) continue;
            placed.add(key);
            column(b, x, z, inPlinth(x, z) ? (spec.plinth?.h ?? 0) : 0, y - SLAB);
          }
        }
      }
      if (st.skirt) {
        const sy = y - SLAB;
        hooks.push(...curvedRoof(b, { outer: expand(r, st.skirt), top: r, eaveY: sy - st.skirt * 0.5, topY: sy, curl: 0.4, thickness: 0.12, collide: false }));
      }
    }
    walls(st, y, top ? st.h : st.h - SLAB);
    for (const s of st.stairs ?? []) {
      const w = stairRect(st, s);
      b.stairs('x', s.dir, w.start, w.z0, w.z1, y, st.h, 'madeira', { tint: C.wood });
    }
    if (top) {
      const eaveY = y + st.h;
      const ox0 = cx - outerExt(st, 'w');
      const ox1 = cx + outerExt(st, 'e');
      const oz0 = cz - outerExt(st, 'n');
      const oz1 = cz + outerExt(st, 's');
      b.span(ox0, eaveY - 0.2, oz0, ox1, eaveY, oz1, 'madeira', { tint: C.woodDark });
      const ov = Math.max(spec.roof.overhang, (st.balcony?.depth ?? 0) + 0.6);
      const outer = { x0: ox0 - ov, x1: ox1 + ov, z0: oz0 - ov, z1: oz1 + ov };
      const OW = (outer.x1 - outer.x0) / 2;
      const OD = (outer.z1 - outer.z0) / 2;
      const rcx = (outer.x0 + outer.x1) / 2;
      const rcz = (outer.z0 + outer.z1) / 2;
      const ridge = OW >= OD ? { x0: rcx - (OW - OD), x1: rcx + (OW - OD), z0: rcz, z1: rcz } : { x0: rcx, x1: rcx, z0: rcz - (OD - OW), z1: rcz + (OD - OW) };
      hooks.push(...curvedRoof(b, { outer, top: ridge, eaveY, topY: eaveY + spec.roof.rise, curl: spec.roof.curl ?? 0.75, ridges: true }));
    }
    y += st.h;
  });
  return { floors, eaveY: y, hooks };
}

// --- Walls and gates --------------------------------------------------------------------------------

/** Garden wall cap: a small tiled gable roof running along the wall's top. */
export function wallCap(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, topY: number) {
  b.gableRoof(x0, z0, x1, z1, topY, 0.32, 'telhado', { tint: ORIENTAL.roofDark, ridgeAxis: x1 - x0 >= z1 - z0 ? 'x' : 'z', overhang: 0.22, collide: false, gableSurface: 'pintura', gableTint: ORIENTAL.plaster });
}

/**
 * Plaster garden wall with a moon gate: a round opening (radius `r`, its bottom flattened into a walkway)
 * cut as thin vertical slices, framed by a stone ring on both faces. `extra` adds more openings.
 */
export function moonGateWall(b: MapBuilder, axis: 'x' | 'z', fixed: number, a: number, end: number, t: number, h: number, center: number, r: number, extra: Opening[] = []) {
  const K = 28;
  const walk = 0.9;
  const ops: Opening[] = [...extra];
  for (let k = 0; k < K; k++) {
    const s0 = center - r + (2 * r * k) / K;
    const s1 = s0 + (2 * r) / K;
    const outer = Math.max(Math.abs(s0 - center), Math.abs(s1 - center));
    const hc = Math.sqrt(Math.max(0, r * r - outer * outer));
    if (hc < 0.05) continue;
    const mid = Math.abs((s0 + s1) / 2 - center);
    ops.push([s0, s1, mid < walk ? 0 : r - hc, r + hc]);
  }
  b.wall(axis, fixed, a, end, t, h, 'concreto', ops, 0, { tint: ORIENTAL.plaster });
  // Ring trim, open at the bottom where the walkway is.
  const gap = Math.asin(Math.min(1, walk / r));
  for (const side of [-1, 1]) {
    const ring = new THREE.TorusGeometry(r, 0.11, 6, 40, Math.PI * 2 - 2 * gap).rotateZ(-Math.PI / 2 + gap);
    if (axis === 'z') ring.rotateY(Math.PI / 2);
    const off = side * (t / 2 + 0.02);
    ring.translate(axis === 'x' ? center : fixed + off, r, axis === 'x' ? fixed + off : center);
    b.addGeometry(ring, surfaceMaterial('pintura'), ORIENTAL.stoneDark, false);
    ring.dispose();
  }
}

// --- Nature -----------------------------------------------------------------------------------------

/** Scholar's rock: a lumpy low-poly boulder that collides as its convex hull. */
export function rock(b: MapBuilder, x: number, y: number, z: number, sx: number, sy: number, sz: number, rand: () => number, tint: number = ORIENTAL.rock, collide = true) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p1 = rand() * 6;
  const p2 = rand() * 6;
  const p3 = rand() * 6;
  const yaw = rand() * Math.PI * 2;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // A function of the direction only: copies of a shared vertex move together (no cracks).
    const f = 1 + 0.22 * Math.sin(v.x * 4.1 + p1) * Math.sin(v.y * 3.7 + p2) + 0.14 * Math.sin(v.z * 5.3 + p3);
    pos.setXYZ(i, v.x * f * sx, v.y * f * sy, v.z * f * sz);
  }
  geo.rotateY(yaw);
  geo.translate(x, y + sy * 0.55, z);
  geo.computeVertexNormals();
  worldUVs(geo);
  b.addGeometry(geo, surfaceMaterial('concreto'), tint);
  if (collide) b.convexCollider(new Float32Array(pos.array), 'concrete');
  geo.dispose();
}

/**
 * Cloud pine: a crooked trunk with branches ending in flat foliage pads (the trees of the reference
 * gardens). `scale` 1 ≈ 4 m tall; at 0.25 it is a bonsai's shape. Only the trunk's base collides.
 */
export function pine(b: MapBuilder, x: number, y: number, z: number, scale: number, rand: () => number, o: { greens?: number[]; trunk?: number; collide?: boolean } = {}) {
  const s = scale;
  const paint = surfaceMaterial('pintura');
  const greens = o.greens ?? [0x4f8f3a, 0x5c9e44, 0x467f33];
  const lean = rand() * Math.PI * 2;
  const lx = Math.cos(lean);
  const lz = Math.sin(lean);
  const trunkPts = [0, 0.9, 1.8, 2.7, 3.5].map((h, i) => new THREE.Vector3(x + lx * Math.sin(i * 1.3) * 0.45 * s + (rand() - 0.5) * 0.2 * s, y + h * s, z + lz * Math.sin(i * 1.3) * 0.45 * s + (rand() - 0.5) * 0.2 * s));
  const trunk = new THREE.CatmullRomCurve3(trunkPts);
  const trunkGeo = new THREE.TubeGeometry(trunk, 14, 0.2 * s, 7);
  b.addGeometry(trunkGeo, paint, o.trunk ?? 0x6b4a32);
  trunkGeo.dispose();
  const pads: [THREE.Vector3, number][] = [[trunkPts[4].clone().add(new THREE.Vector3(0, 0.35 * s, 0)), 1.25]];
  const branches = 3 + Math.floor(rand() * 2);
  for (let k = 0; k < branches; k++) {
    const t = 0.38 + (k / branches) * 0.5;
    const from = trunk.getPoint(t);
    const a = lean + Math.PI + k * 2.2 + rand() * 0.6;
    const reach = (1.3 + rand() * 0.8) * s;
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * reach, (0.3 + rand() * 0.4) * s, Math.sin(a) * reach));
    const midP = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.25 * s, 0));
    const br = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, midP, to]), 6, 0.08 * s, 5);
    b.addGeometry(br, paint, o.trunk ?? 0x6b4a32);
    br.dispose();
    pads.push([to.add(new THREE.Vector3(0, 0.15 * s, 0)), 0.85 + rand() * 0.35]);
  }
  pads.forEach(([p, r], i) => {
    const pad = new THREE.IcosahedronGeometry(r * s, 1).scale(1.15, 0.42, 1).translate(p.x, p.y, p.z);
    b.addGeometry(pad, paint, greens[i % greens.length]);
    pad.dispose();
  });
  if (o.collide !== false) b.cuboidCollider(new THREE.Vector3(x, y + s, z), new THREE.Vector3(0.22 * s, s, 0.22 * s), new THREE.Quaternion(), 'wood');
}

/** Bonsai in a glazed pot (visual; stand it on something that collides). */
export function bonsai(b: MapBuilder, x: number, y: number, z: number, scale: number, rand: () => number, potTint = 0x2f5d8a) {
  const s = scale;
  b.box(x, y + 0.13 * s, z, 0.75 * s, 0.26 * s, 0.5 * s, 'pintura', { tint: potTint, collide: false });
  b.box(x, y + 0.27 * s, z, 0.82 * s, 0.05 * s, 0.56 * s, 'pintura', { tint: potTint, collide: false });
  b.box(x, y + 0.29 * s, z, 0.7 * s, 0.02 * s, 0.45 * s, 'pintura', { tint: 0x5a4030, collide: false });
  pine(b, x, y + 0.28 * s, z, 0.22 * s, rand, { collide: false, greens: [0x3f8a3a, 0x4f9e44, 0x3a7a30] });
}

/** Clump of bamboo: green stalks with nodes and leafy tops. Each stalk is a thin collider. */
export function bamboo(b: MapBuilder, x: number, z: number, count: number, spread: number, rand: () => number) {
  const paint = surfaceMaterial('pintura');
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * spread;
    const sx = x + Math.cos(a) * d;
    const sz = z + Math.sin(a) * d;
    const h = 4.5 + rand() * 2.5;
    const r = 0.05 + rand() * 0.03;
    const green = rand() < 0.5 ? 0x7cb342 : 0x689f38;
    b.cylinder(sx, 0, sz, r, h, 'pintura', { tint: green, segments: 6, radiusTop: r * 0.8, collide: false });
    for (let y = 0.5 + rand() * 0.3; y < h - 0.3; y += 0.55) b.cylinder(sx, y, sz, r * 1.25, 0.04, 'pintura', { tint: 0x557a2b, segments: 6, collide: false, castShadow: false });
    for (let k = 0; k < 3; k++) {
      const la = rand() * Math.PI * 2;
      const leaves = new THREE.IcosahedronGeometry(0.55 + rand() * 0.3, 0).scale(1.2, 0.45, 1.2).translate(sx + Math.cos(la) * 0.4, h - 0.4 - k * 0.6, sz + Math.sin(la) * 0.4);
      b.addGeometry(leaves, paint, k % 2 ? 0x5b9a35 : 0x6fae3f);
      leaves.dispose();
    }
    b.cuboidCollider(new THREE.Vector3(sx, h / 2, sz), new THREE.Vector3(r, h / 2, r), new THREE.Quaternion(), 'wood');
  }
}

/** Stone lantern on a pillar; its glowing core goes to `glow` (merged into one unlit mesh by the map). */
export function stoneLantern(b: MapBuilder, x: number, z: number, y0: number, glow: THREE.BufferGeometry[]) {
  const st = { tint: ORIENTAL.stone, collide: false };
  b.box(x, y0 + 0.12, z, 0.7, 0.24, 0.7, 'pedra', st);
  b.cylinder(x, y0 + 0.24, z, 0.15, 0.8, 'pedra', { ...st, segments: 6 });
  b.box(x, y0 + 1.1, z, 0.62, 0.12, 0.62, 'pedra', st);
  for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + ox * 0.2, y0 + 1.36, z + oz * 0.2, 0.08, 0.4, 0.08, 'pedra', st);
  glow.push(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(x, y0 + 1.36, z));
  const roof = new THREE.ConeGeometry(0.55, 0.36, 4).rotateY(Math.PI / 4).translate(x, y0 + 1.74, z);
  b.addGeometry(roof, surfaceMaterial('pedra'), ORIENTAL.stone);
  roof.dispose();
  b.addGeometry(new THREE.SphereGeometry(0.09, 8, 5).translate(x, y0 + 1.97, z), surfaceMaterial('pedra'), ORIENTAL.stone);
  b.cuboidCollider(new THREE.Vector3(x, y0 + 1, z), new THREE.Vector3(0.33, 1, 0.33), new THREE.Quaternion(), 'concrete');
}

// --- Dragon -----------------------------------------------------------------------------------------

export interface DragonColors {
  body: number;
  bodyDark: number;
  belly: number;
  spikes: number;
  horns: number;
}

/**
 * Serpentine Chinese dragon along `path` (tail first, head last): a tube with banded scales and a pale
 * belly, swept-back spikes, four short legs, and a head with horns, whiskers, mane and an open jaw.
 * One vertex-colored geometry; `mouth`/`forward` tell where its breath (water or fire) comes out.
 */
export function dragonGeometry(path: THREE.Vector3[], radius: number, c: DragonColors) {
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const N = 110;
  const R = 10;
  const pts = curve.getSpacedPoints(N);
  const tangents = pts.map((_, i) => curve.getTangentAt(i / N));
  let prevUp = new THREE.Vector3(0, 1, 0);
  const ups = tangents.map((t) => {
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(t, -t.y);
    if (up.lengthSq() < 1e-4) return prevUp.clone();
    prevUp = up.normalize();
    return prevUp.clone();
  });
  // up × forward: with (side, up, forward) right-handed, the tube's quads and the head face outward.
  const sides = tangents.map((t, i) => new THREE.Vector3().crossVectors(ups[i], t).normalize());
  const rad = (u: number) => radius * (0.28 + 0.72 * Math.sin((Math.min(1, u * 1.7) * Math.PI) / 2)) * (1 - 0.18 * u);

  // Body tube, non-indexed so it merges with the colored parts.
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const ring = (i: number, j: number) => {
    const th = (j / R) * Math.PI * 2;
    const dir = ups[i].clone().multiplyScalar(Math.cos(th)).addScaledVector(sides[i], Math.sin(th));
    return { p: pts[i].clone().addScaledVector(dir, rad(i / N)), n: dir, belly: Math.cos(th) < -0.45 };
  };
  const cBody = new THREE.Color(c.body);
  const cDark = new THREE.Color(c.bodyDark);
  const cBelly = new THREE.Color(c.belly);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < R; j++) {
      const q = [ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j), ring(i + 1, j + 1), ring(i, j + 1)];
      const band = i % 6 < 3 ? cBody : cDark;
      for (const v of q) {
        pos.push(v.p.x, v.p.y, v.p.z);
        nor.push(v.n.x, v.n.y, v.n.z);
        const cc = v.belly ? cBelly : band;
        col.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const tube = new THREE.BufferGeometry();
  tube.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tube.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  tube.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const parts: ColoredPart[] = [];
  // Spikes along the back, swept toward the tail.
  for (let i = 6; i < N - 4; i += 5) {
    const r = rad(i / N);
    const dir = ups[i].clone().multiplyScalar(0.8).addScaledVector(tangents[i], -0.6).normalize();
    const p = pts[i].clone().addScaledVector(ups[i], r * 0.8).addScaledVector(dir, r * 0.35);
    parts.push({ geo: new THREE.ConeGeometry(r * 0.32, r * 0.95, 4), color: c.spikes, pos: [p.x, p.y, p.z], rot: aim(dir) });
  }
  // Tail fin.
  {
    const dir = tangents[0].clone().negate();
    const p = pts[0].clone().addScaledVector(dir, radius * 0.4);
    parts.push({ geo: new THREE.ConeGeometry(radius * 0.45, radius * 1.4, 4), color: c.spikes, pos: [p.x, p.y, p.z], rot: aim(dir), scale: [1, 1, 0.35] });
  }
  // Legs with golden claws.
  [0.3, 0.38, 0.64, 0.72].forEach((u, k) => {
    const i = Math.round(u * N);
    const r = rad(u);
    const side = k % 2 ? 1 : -1;
    const dir = ups[i].clone().multiplyScalar(-0.75).addScaledVector(sides[i], side * 0.65).normalize();
    const mid = pts[i].clone().addScaledVector(dir, r * 1.5);
    parts.push({ geo: new THREE.CylinderGeometry(r * 0.26, r * 0.32, r * 1.4, 6), color: c.body, pos: [mid.x, mid.y, mid.z], rot: aim(dir) });
    const foot = pts[i].clone().addScaledVector(dir, r * 2.3);
    parts.push({ geo: new THREE.ConeGeometry(r * 0.32, r * 0.5, 5), color: c.horns, pos: [foot.x, foot.y, foot.z], rot: aim(dir) });
  });
  const body = mergeColoredParts(parts);

  // Head, built in its own frame (x = side, y = up, z = forward) and moved onto the end of the body.
  const H = radius * 1.9;
  const hp: ColoredPart[] = [
    { geo: new THREE.BoxGeometry(1.1 * H, 0.85 * H, 1.1 * H), color: c.body, pos: [0, 0.15 * H, 0.35 * H] },
    { geo: new THREE.BoxGeometry(0.8 * H, 0.45 * H, 1.0 * H), color: c.body, pos: [0, 0.05 * H, 1.25 * H] },
    { geo: new THREE.SphereGeometry(0.24 * H, 8, 6), color: c.bodyDark, pos: [0, 0.2 * H, 1.75 * H] },
    { geo: new THREE.BoxGeometry(0.7 * H, 0.22 * H, 0.95 * H), color: c.belly, pos: [0, -0.36 * H, 1.1 * H], rot: [0.38, 0, 0] },
    { geo: new THREE.ConeGeometry(0.16 * H, 0.7 * H, 5), color: c.belly, pos: [0, -0.6 * H, 0.5 * H], rot: [Math.PI - 0.5, 0, 0] },
  ];
  for (const sx of [-1, 1]) {
    hp.push(
      { geo: new THREE.SphereGeometry(0.17 * H, 8, 6), color: 0xfff6e0, pos: [sx * 0.45 * H, 0.42 * H, 0.8 * H] },
      { geo: new THREE.SphereGeometry(0.08 * H, 6, 4), color: 0x1b1530, pos: [sx * 0.56 * H, 0.45 * H, 0.88 * H] },
      { geo: new THREE.BoxGeometry(0.4 * H, 0.1 * H, 0.25 * H), color: c.horns, pos: [sx * 0.42 * H, 0.64 * H, 0.75 * H], rot: [0, 0, sx * 0.3] },
      { geo: new THREE.ConeGeometry(0.1 * H, 1.15 * H, 6), color: c.horns, pos: [sx * 0.32 * H, 0.95 * H, -0.2 * H], rot: [-1.1, 0, sx * 0.15] },
      { geo: new THREE.ConeGeometry(0.06 * H, 0.22 * H, 4), color: 0xffffff, pos: [sx * 0.28 * H, -0.24 * H, 1.55 * H], rot: [Math.PI, 0, 0] },
      { geo: new THREE.ConeGeometry(0.06 * H, 0.22 * H, 4), color: 0xffffff, pos: [sx * 0.28 * H, -0.24 * H, 1.15 * H], rot: [Math.PI, 0, 0] },
    );
    const whisker = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.35 * H, 0, 1.6 * H),
      new THREE.Vector3(sx * 0.95 * H, -0.1 * H, 1.4 * H),
      new THREE.Vector3(sx * 1.45 * H, -0.45 * H, 0.9 * H),
      new THREE.Vector3(sx * 1.65 * H, -0.9 * H, 0.35 * H),
    ]);
    hp.push({ geo: new THREE.TubeGeometry(whisker, 10, 0.035 * H, 4), color: c.horns, pos: [0, 0, 0] });
  }
  for (let k = -2; k <= 2; k++) hp.push({ geo: new THREE.ConeGeometry(0.13 * H, 0.75 * H, 4), color: c.spikes, pos: [k * 0.24 * H, 0.35 * H - Math.abs(k) * 0.08 * H, -0.3 * H], rot: [-1.85, 0, k * 0.25] });
  const head = mergeColoredParts(hp);
  const end = pts[N];
  const fwd = tangents[N].clone();
  const up = ups[N].clone();
  const side = sides[N].clone();
  head.applyMatrix4(new THREE.Matrix4().makeBasis(side, up, fwd).setPosition(end));

  const geo = mergeGeometries([tube, body, head], false)!;
  tube.dispose();
  body.dispose();
  head.dispose();
  return { geo, mouth: end.clone().addScaledVector(fwd, 1.8 * H).addScaledVector(up, -0.1 * H), forward: fwd };
}

export function dragonMaterial() {
  return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
}

// --- Animated props ---------------------------------------------------------------------------------

/**
 * Red paper lanterns hanging from hooks: one instanced mesh for the bodies and one for the strings. They
 * sway in the breeze and swing hard when shot (synchronized online as "lanterna:N").
 */
export class Lanterns {
  private specs: { hook: THREE.Vector3; drop: number }[] = [];
  private bodies!: THREE.InstancedMesh;
  private strings!: THREE.InstancedMesh;
  private ang = new Float32Array(0);
  private vel = new Float32Array(0);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private t = 0;

  /** Hangs a lantern from `hook`, its body `drop` meters below. */
  hang(hook: THREE.Vector3, drop = 0.85) {
    this.specs.push({ hook: hook.clone(), drop });
  }

  get count() {
    return this.specs.length;
  }

  finish(scene: THREE.Scene, b: MapBuilder, props: PropBus, onHit: () => void) {
    const n = this.specs.length;
    this.ang = new Float32Array(n * 2);
    this.vel = new Float32Array(n * 2);
    const geo = mergeColoredParts([
      { geo: new THREE.SphereGeometry(0.3, 14, 10), color: 0xff4a32, pos: [0, 0, 0], scale: [1, 1.15, 1] },
      { geo: new THREE.CylinderGeometry(0.308, 0.308, 0.035, 14), color: 0xffd36b, pos: [0, 0.12, 0] },
      { geo: new THREE.CylinderGeometry(0.308, 0.308, 0.035, 14), color: 0xffd36b, pos: [0, -0.12, 0] },
      { geo: new THREE.CylinderGeometry(0.13, 0.17, 0.08, 12), color: 0xf2b84a, pos: [0, 0.37, 0] },
      { geo: new THREE.CylinderGeometry(0.17, 0.13, 0.08, 12), color: 0xf2b84a, pos: [0, -0.37, 0] },
      { geo: new THREE.ConeGeometry(0.06, 0.34, 6), color: 0xc42020, pos: [0, -0.58, 0], rot: [Math.PI, 0, 0] },
    ]);
    // Unlit: they read as glowing in any light.
    this.bodies = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, n));
    this.strings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: 0x2a1a12 }), Math.max(1, n));
    this.bodies.count = this.strings.count = n;
    this.bodies.frustumCulled = this.strings.frustumCulled = false;
    scene.add(this.bodies, this.strings);
    this.specs.forEach(({ hook, drop }, i) => {
      const onShot = props.register(`lanterna:${i}`, () => {
        const a = Math.random() * Math.PI * 2;
        this.vel[i * 2] += Math.cos(a) * 2.6;
        this.vel[i * 2 + 1] += Math.sin(a) * 2.6;
        onHit();
      });
      b.ballCollider(new THREE.Vector3(hook.x, hook.y - drop, hook.z), 0.32, 'paper', onShot);
    });
    this.update(0);
  }

  update(dt: number) {
    this.t += dt;
    const k = 22; // g / L for a ~1 m pendulum
    const damp = Math.exp(-0.9 * dt);
    this.specs.forEach(({ hook, drop }, i) => {
      for (const c of [0, 1]) {
        const j = i * 2 + c;
        this.vel[j] = (this.vel[j] - k * this.ang[j] * dt) * damp;
        this.ang[j] += this.vel[j] * dt;
      }
      const breeze = 0.035 * Math.sin(this.t * 1.1 + i * 1.7);
      this.e.set(this.ang[i * 2] + breeze, 0, this.ang[i * 2 + 1] + breeze * 0.6);
      this.q.setFromEuler(this.e);
      this.v.set(0, -drop, 0).applyQuaternion(this.q).add(hook);
      this.m.compose(this.v, this.q, this.s.set(1, 1, 1));
      this.bodies.setMatrixAt(i, this.m);
      this.m.compose(hook, this.q, this.s.set(1, Math.max(0.05, drop - 0.4), 1));
      this.strings.setMatrixAt(i, this.m);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.strings.instanceMatrix.needsUpdate = true;
  }
}

/** Bronze gong on a lacquered frame, facing ±Z. Shot: it booms and swings (synchronized as "gongo"). */
export class Gong {
  private pivot = new THREE.Group();
  private angle = 0;
  private vel = 0;

  constructor(scene: THREE.Scene, b: MapBuilder, x: number, y: number, z: number, props: PropBus, sound: () => void) {
    const C = ORIENTAL;
    for (const sx of [-1, 1]) {
      b.box(x + sx * 1.05, y + 0.1, z, 0.5, 0.2, 0.5, 'pedra', { tint: C.stone });
      b.box(x + sx * 1.05, y + 1.4, z, 0.16, 2.6, 0.16, 'pintura', { tint: C.lacquer, physics: 'wood' });
      b.box(x + sx * 1.32, y + 2.62, z, 0.3, 0.12, 0.18, 'pintura', { tint: C.gold, collide: false, rot: new THREE.Euler(0, 0, sx * 0.4) });
    }
    b.box(x, y + 2.62, z, 2.5, 0.16, 0.18, 'pintura', { tint: C.lacquer, collide: false });
    const bronze = new THREE.MeshToonMaterial({ color: 0xd49a3a, emissive: 0x3a2208, gradientMap: toonGradient() });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 28).rotateX(Math.PI / 2), bronze);
    disc.position.y = -1.0;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1, 0.45), bronze);
    boss.position.y = -1.0;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 6, 32), new THREE.MeshToonMaterial({ color: 0x8a5a1a, gradientMap: toonGradient() }));
    rim.position.y = -1.0;
    const cordMat = new THREE.MeshBasicMaterial({ color: 0xb02020 });
    for (const sx of [-1, 1]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 4), cordMat);
      cord.position.set(sx * 0.35, -0.12, 0);
      cord.rotation.z = sx * 0.6;
      this.pivot.add(cord);
    }
    this.pivot.add(disc, boss, rim);
    this.pivot.position.set(x, y + 2.55, z);
    this.pivot.traverse((o) => (o.castShadow = true));
    scene.add(this.pivot);
    const onShot = props.register('gongo', () => {
      this.vel += this.vel >= 0 ? 1.4 : -1.4;
      sound();
    });
    b.cuboidCollider(new THREE.Vector3(x, y + 1.55, z), new THREE.Vector3(0.75, 0.75, 0.05), new THREE.Quaternion(), 'metal', onShot);
  }

  update(dt: number) {
    this.vel = (this.vel - 23 * this.angle * dt) * Math.exp(-0.7 * dt);
    this.angle += this.vel * dt;
    this.pivot.rotation.x = this.angle;
  }
}

const MAX_FLAMES = 160;
const FLAME_LIFE = 0.75;

/** The fountain dragon's fire breath: puffs going from yellow to dark red, rising as they slow down. */
export class FireBreath {
  private mesh: THREE.InstancedMesh;
  private pos = new Float32Array(MAX_FLAMES * 3);
  private vel = new Float32Array(MAX_FLAMES * 3);
  private life = new Float32Array(MAX_FLAMES);
  private cursor = 0;
  private emitting = 0;
  private acc = 0;
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      // Normal blending: additive puffs pile up into plain white.
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
      MAX_FLAMES,
    );
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_FLAMES; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(0xffaa33));
    }
    scene.add(this.mesh);
  }

  get active() {
    return this.emitting > 0;
  }

  start(origin: THREE.Vector3, dir: THREE.Vector3, duration = 1.6) {
    this.origin.copy(origin);
    this.dir.copy(dir).normalize();
    this.emitting = Math.max(this.emitting, duration);
  }

  update(dt: number) {
    if (this.emitting > 0) {
      this.emitting -= dt;
      this.acc += dt * 95;
      while (this.acc >= 1) {
        this.acc--;
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % MAX_FLAMES;
        const sp = 8 + Math.random() * 3;
        this.pos.set([this.origin.x, this.origin.y, this.origin.z], i * 3);
        this.vel.set([this.dir.x * sp + (Math.random() - 0.5) * 2, this.dir.y * sp + (Math.random() - 0.5) * 2, this.dir.z * sp + (Math.random() - 0.5) * 2], i * 3);
        this.life[i] = FLAME_LIFE;
      }
    }
    let any = false;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < MAX_FLAMES; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const k = i * 3;
      this.life[i] -= dt;
      for (const a of [0, 1, 2]) this.vel[k + a] *= drag;
      this.vel[k + 1] += 1.2 * dt;
      for (const a of [0, 1, 2]) this.pos[k + a] += this.vel[k + a] * dt;
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
      } else {
        const age = 1 - this.life[i] / FLAME_LIFE;
        const size = 0.1 + Math.sin(age * Math.PI) * 0.38;
        this.m.compose(this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), this.q, this.s.set(size, size, size));
        this.c.setRGB(1, 0.88 - age * 0.7, 0.22 - age * 0.2);
        this.mesh.setColorAt(i, this.c);
      }
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** Koi swimming slow loops under the pond's surface (visual only). */
export class Koi {
  private fish: { mesh: THREE.Mesh; cx: number; cz: number; r: number; speed: number; a: number }[] = [];

  constructor(scene: THREE.Scene, loops: [cx: number, cz: number, r: number][], y: number, rand: () => number) {
    const colors = [[0xff7a1a, 0xffffff], [0xffffff, 0xe0301e], [0xffb52e, 0xff7a1a], [0xf2f2f2, 0x1b1530]];
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    loops.forEach(([cx, cz, r], i) => {
      const [main, spot] = colors[i % colors.length];
      const geo = mergeColoredParts([
        { geo: new THREE.SphereGeometry(0.12, 10, 6), color: main, pos: [0, 0, 0], scale: [1, 0.75, 2.6] },
        { geo: new THREE.SphereGeometry(0.07, 8, 5), color: spot, pos: [0, 0.05, 0.08], scale: [1, 0.6, 1.6] },
        { geo: new THREE.ConeGeometry(0.12, 0.28, 4), color: main, pos: [0, 0, -0.4], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.25] },
      ]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = y;
      scene.add(mesh);
      this.fish.push({ mesh, cx, cz, r, speed: (0.25 + rand() * 0.25) * (i % 2 ? 1 : -1), a: rand() * Math.PI * 2 });
    });
  }

  update(dt: number) {
    for (const f of this.fish) {
      f.a += (f.speed * dt) / Math.max(0.5, f.r) * 2;
      const x = f.cx + Math.cos(f.a) * f.r;
      const z = f.cz + Math.sin(f.a) * f.r * 0.7;
      f.mesh.position.x = x;
      f.mesh.position.z = z;
      // Face along the loop: derivative of the ellipse.
      const dx = -Math.sin(f.a) * f.r * Math.sign(f.speed);
      const dz = Math.cos(f.a) * f.r * 0.7 * Math.sign(f.speed);
      f.mesh.rotation.y = Math.atan2(dx, dz) + Math.sin(f.a * 6) * 0.15;
    }
  }
}
