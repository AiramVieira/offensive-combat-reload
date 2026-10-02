// Builds faceted, skinned geometry in the format the character system expects from a GLB, so procedural
// pieces and Blender pieces are interchangeable. Every triangle is its own set of 3 vertices (flat shading,
// the style guide's "facets as a signature"), with:
// - uv: collapsed to one point inside a palette atlas cell (palette.ts): up-facing faces sample the top of
//   the cell, down-facing ones the bottom, and some faces are nudged a little so big areas never look flat;
// - `_tint`: which player color tints the face (0 = the cell's own color);
// - `_region`: the body region (hidden under clothes or in PCD mode);
// - color: ambient occlusion (a multiplier, at most 25% darker);
// - skinIndex/skinWeight in the canonical bone order, and morph targets: "gordo" and "magro" (build,
//   applied with the same strength to the body and every piece so clothes keep fitting) plus any extra
//   ones a piece declares (the closed hands: "punho_L", "punho_R").
import * as THREE from 'three';
import { cellUv, PRIMARY, type Paint } from './palette';
import { boneIndex, REGION, type BoneName, type RegionName } from './rig';

export type Weights = readonly (readonly [BoneName, number])[];

/** At most 25% darker (style guide: more than that dirties the look). */
const AO_MAX = 0.25;

/** A ring of a tube: where it is along the axis and how it deviates from the profile. */
interface Ring {
  t: number;
  /** Radius multiplier (domes). */
  scale: number;
  /** Extra radius (rims). */
  add: number;
  /** Offset along the axis (domes, rims). */
  along: number;
  /** Faces reaching this ring take this paint (rims). */
  paint?: Paint;
}

/** A raised band at an open end: fabric thickness (style guide: 1–2 cm, never a single face). */
export interface Rim {
  /** Band height along the axis (m). */
  h: number;
  /** How far it stands out (m). */
  out: number;
  paint?: Paint;
}

export interface TubeOptions {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Radius along the tube: (t 0..1) → meters. */
  radius: (t: number) => number;
  /** Section scale on the width axis and on the depth axis (oval sections), per t. */
  sx?: (t: number) => number;
  sz?: (t: number) => number;
  /** Radius multiplier around the ring (e.g. a superellipse for boxy sections). */
  section?: (a: number) => number;
  /** Width axis of the section (default: X for vertical tubes, Z otherwise). */
  side?: THREE.Vector3;
  /** Center shift along the depth axis, per t (e.g. a chin a little forward). */
  shift?: (t: number) => number;
  /** Center shift along the width axis, per t. */
  shiftX?: (t: number) => number;
  /** Extra radius per ring and angle (pleats, folds, muscles). */
  bump?: (t: number, a: number) => number;
  /** Extra offset along the axis per ring and angle (a jagged edge, e.g. the points of bangs). */
  along?: (t: number, a: number) => number;
  /** Uniform rings... */
  rings?: number;
  /** ...or explicit ring positions (0..1, sorted). */
  ts?: readonly number[];
  segments?: number;
  /** First vertex angle; with `arc`, an open strip from `a0` over `arc` radians. a = 0 on the width axis. */
  a0?: number;
  arc?: number;
  region: RegionName | ((t: number, a: number) => RegionName);
  weights: (t: number, a: number) => Weights;
  paint?: Paint | ((t: number, a: number) => Paint);
  /** Build morph strength per t (fraction of the radius pushed out for "gordo"). */
  build?: (t: number) => number;
  /** Extra forward push for "gordo" (a belly), per t. */
  belly?: (t: number) => number;
  /** Close the ends with a low dome (height as a fraction of the end radius). */
  capStart?: number;
  capEnd?: number;
  /** Raised bands at the open ends (hems, cuffs, collars). */
  rimStart?: Rim;
  rimEnd?: Rim;
  /** Occlusion (0..1 darkening) per vertex. */
  ao?: (t: number, a: number) => number;
  /** Gradient offset per face: −1 darker … +1 lighter (inside and outside of a fold). */
  shade?: (t: number, a: number) => number;
}

export interface AppendOptions {
  /** Build morph strength (fraction of the offset from the part's center pushed out for "gordo"). */
  build?: number;
  /** Extra morph targets: the same geometry placed by another matrix (e.g. a curled finger). */
  morphs?: Record<string, THREE.Matrix4>;
  ao?: number | ((p: THREE.Vector3) => number);
  shade?: number;
}

/** Deterministic noise per face (which faces get nudged up or down in their cell). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const tmp = new THREE.Vector3();

/** Level of detail of the pieces being built: 0 full, 1 and 2 the far versions (see `withLod`). */
let currentLod = 0;

/**
 * Builds with a level of detail: every FacetBuilder created inside `fn` has `lod` set. Tubes lose sides
 * (¾ at 1, ½ at 2, never under 4) and every other inner ring, and lose their rims at 2; appended parts smaller than a button (1)
 * or a pocket (2) are dropped; `detail()` blocks run only up to their level.
 */
export function withLod<T>(lod: number, fn: () => T): T {
  const prev = currentLod;
  currentLod = lod;
  try {
    return fn();
  } finally {
    currentLod = prev;
  }
}

/** Sides of a tube at a level of detail. */
export const lodSegments = (segments: number, lod: number) => (lod <= 0 ? segments : Math.max(4, Math.round(segments * (lod === 1 ? 0.75 : 0.5))));

export class FacetBuilder {
  /** Level of detail this builder was created at (0 full; 1, 2 the far versions). */
  readonly lod = currentLod;
  private pos: number[] = [];
  private skinIndex: number[] = [];
  private skinWeight: number[] = [];
  private ao: number[] = [];
  private morphs = new Map<string, number[]>();
  /** Faces: 3 vertex indices each, with a paint, region and shade offset. */
  private faces: number[] = [];
  private facePaint: number[] = [];
  private faceRegion: number[] = [];
  private faceShade: number[] = [];

  /** Seed of the per-face nudges (different pieces nudge different faces). */
  constructor(private seed = 0) {}

  get vertexCount() {
    return this.pos.length / 3;
  }

  get triangleCount() {
    return this.faces.length / 3;
  }

  /** Position of a vertex added before. */
  position(id: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.fromArray(this.pos, id * 3);
  }

  /** Adds a vertex; `morphs` holds its deltas for named morph targets. */
  vertex(p: THREE.Vector3, w: Weights, ao = 0, morphs?: Record<string, THREE.Vector3>): number {
    const index = this.vertexCount;
    this.pos.push(p.x, p.y, p.z);
    this.ao.push(ao);
    // Up to 4 influences, normalized.
    const list = [...w].filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, [, x]) => s + x, 0) || 1;
    for (let i = 0; i < 4; i++) {
      const e = list[i];
      this.skinIndex.push(e ? boneIndex(e[0]) : 0);
      this.skinWeight.push(e ? e[1] / sum : 0);
    }
    for (const [name, arr] of this.morphs) {
      const d = morphs?.[name];
      arr.push(d?.x ?? 0, d?.y ?? 0, d?.z ?? 0);
    }
    if (morphs) {
      for (const [name, d] of Object.entries(morphs)) {
        if (this.morphs.has(name)) continue;
        // A new morph target: zeros for every vertex before this one.
        const arr = new Array(index * 3).fill(0);
        arr.push(d.x, d.y, d.z);
        this.morphs.set(name, arr);
      }
    }
    return index;
  }

  tri(a: number, b: number, c: number, paint: Paint, region: RegionName | number, shade = 0) {
    this.faces.push(a, b, c);
    this.facePaint.push(paint);
    this.faceRegion.push(typeof region === 'number' ? region : REGION[region]);
    this.faceShade.push(shade);
  }

  /** A quad a-b-c-d, counter-clockwise seen from outside. */
  quad(a: number, b: number, c: number, d: number, paint: Paint, region: RegionName | number, shade = 0) {
    this.tri(a, b, c, paint, region, shade);
    this.tri(a, c, d, paint, region, shade);
  }

  /**
   * A flat polygon (fan), all on one bone set: counter-clockwise seen from outside, or in any order with
   * `facing` (the side it must face; the order is flipped when needed).
   */
  poly(points: readonly THREE.Vector3[], w: Weights, region: RegionName, paint: Paint, o: { shade?: number; ao?: number; morphs?: Record<string, THREE.Vector3[]>; facing?: THREE.Vector3 } = {}) {
    let pts = points;
    if (o.facing) {
      // Newell normal of the polygon.
      const n = new THREE.Vector3();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const c = pts[(i + 1) % pts.length];
        n.x += (a.y - c.y) * (a.z + c.z);
        n.y += (a.z - c.z) * (a.x + c.x);
        n.z += (a.x - c.x) * (a.y + c.y);
      }
      if (n.dot(o.facing) < 0) pts = [...pts].reverse();
    }
    const idx = pts.map((p, i) => this.vertex(p, w, o.ao ?? 0, o.morphs ? Object.fromEntries(Object.entries(o.morphs).map(([k, v]) => [k, v[i]])) : undefined));
    for (let i = 1; i < idx.length - 1; i++) this.tri(idx[0], idx[i], idx[i + 1], paint, region, o.shade ?? 0);
    return idx;
  }

  /** A triangle of vertices added before, flipped if needed so it faces away from `inside`. */
  triAway(a: number, b: number, c: number, inside: THREE.Vector3, paint: Paint, region: RegionName | number, shade = 0) {
    const pa = this.position(a);
    const pb = this.position(b);
    const pc = this.position(c);
    const n = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    const out = pa.add(pb).add(pc).divideScalar(3).sub(inside);
    if (n.dot(out) < 0) this.tri(a, c, b, paint, region, shade);
    else this.tri(a, b, c, paint, region, shade);
  }

  /** A lathed surface along a segment: rings of vertices around the axis. */
  /** Runs `fn` only at levels of detail up to `upTo` (small decorations: buttons, stitches, prints). */
  detail(fn: () => void, upTo = 0) {
    if (this.lod <= upTo) fn();
  }

  tube(o: TubeOptions) {
    const seg = lodSegments(o.segments ?? 8, this.lod);
    const closed = o.arc === undefined;
    const arc = o.arc ?? Math.PI * 2;
    const a0 = o.a0 ?? 0;
    const cols = closed ? seg : seg + 1;
    const axis = new THREE.Vector3().subVectors(o.to, o.from);
    const len = axis.length();
    axis.normalize();
    const side = (o.side ?? (Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1))).clone();
    side.addScaledVector(axis, -side.dot(axis)).normalize();
    let depth = new THREE.Vector3().crossVectors(side, axis).normalize();
    // Vertical tubes: a = 90° must face the front (-Z). Flipping the width axis (not the depth one) keeps
    // the winding outward; a = 0 is then the character's left (-X) on upward tubes.
    if (Math.abs(axis.y) > 0.9 && depth.z > 0) {
      side.negate();
      depth = new THREE.Vector3().crossVectors(side, axis).normalize();
    }
    const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
    const sx = o.sx ?? (() => 1);
    const sz = o.sz ?? (() => 1);
    const section = o.section ?? (() => 1);
    const regionOf = typeof o.region === 'function' ? o.region : () => o.region as RegionName;
    const paintOf = typeof o.paint === 'function' ? o.paint : () => (o.paint as Paint | undefined) ?? PRIMARY;
    const buildOf = o.build ?? (() => 0.1);
    const aoOf = o.ao ?? (() => 0);
    const shadeOf = o.shade ?? (() => 0);

    const angle = (i: number) => a0 + (i / seg) * arc;
    const g = new THREE.Vector3();
    const m = new THREE.Vector3();
    const place = (r: Ring, a: number) => {
      const t = clamp01(r.t);
      const rad = (o.radius(t) * r.scale + r.add) * section(a) + (o.bump ? o.bump(r.t, a) : 0);
      const c = new THREE.Vector3().copy(o.from).addScaledVector(axis, r.t * len + r.along + (o.along ? o.along(r.t, a) : 0));
      if (o.shift) c.addScaledVector(depth, o.shift(t));
      if (o.shiftX) c.addScaledVector(side, o.shiftX(t));
      const off = tmp.copy(side).multiplyScalar(Math.cos(a) * rad * sx(t)).addScaledVector(depth, Math.sin(a) * rad * sz(t));
      const p = c.add(off);
      // Build morphs: the section grows (gordo) or shrinks (magro); a belly pushes the front forward.
      const k = buildOf(t);
      g.copy(off).multiplyScalar(k);
      // The belly is a fraction of the section's real depth (m), not of the profile radius.
      if (o.belly && Math.sin(a) > 0) g.addScaledVector(depth, o.belly(t) * Math.sin(a) * rad * sz(t));
      m.copy(off).multiplyScalar(-k * 0.45);
      return p;
    };

    // Ring list: domes, the body of the tube, rims.
    const ts0 = o.ts ?? Array.from({ length: (o.rings ?? 4) + 1 }, (_, j) => j / (o.rings ?? 4));
    // Far LODs: every other inner ring.
    const ts = this.lod >= 1 && ts0.length > 3 ? ts0.filter((_, j) => j === 0 || j === ts0.length - 1 || j % 2 === 0) : ts0;
    const rings: Ring[] = [];
    // Dome heights follow the real end size (radius times the section scales).
    const r0 = o.radius(0) * Math.max(sx(0), sz(0));
    const r1 = o.radius(1) * Math.max(sx(1), sz(1));
    if (o.capStart) rings.push({ t: 0, scale: 0.62, add: 0, along: -Math.sqrt(1 - 0.62 * 0.62) * r0 * o.capStart });
    // Farthest LOD: no thickness bands (hems, cuffs, collars) — a pixel or two at that distance.
    const rimStart = this.lod >= 2 ? undefined : o.rimStart;
    const rimEnd = this.lod >= 2 ? undefined : o.rimEnd;
    if (rimStart) {
      const h = rimStart.h / len;
      rings.push({ t: 0, scale: 1, add: -0.004, along: 0, paint: rimStart.paint });
      rings.push({ t: 0, scale: 1, add: rimStart.out, along: 0, paint: rimStart.paint });
      rings.push({ t: h, scale: 1, add: rimStart.out, along: 0, paint: rimStart.paint });
      rings.push({ t: h, scale: 1, add: 0, along: 0 });
      for (const t of ts) if (t > h + 1e-4) rings.push({ t, scale: 1, add: 0, along: 0 });
    } else for (const t of ts) rings.push({ t, scale: 1, add: 0, along: 0 });
    if (rimEnd) {
      const h = rimEnd.h / len;
      while (rings.length && rings[rings.length - 1].t > 1 - h - 1e-4) rings.pop();
      rings.push({ t: 1 - h, scale: 1, add: 0, along: 0 });
      rings.push({ t: 1 - h, scale: 1, add: rimEnd.out, along: 0, paint: rimEnd.paint });
      rings.push({ t: 1, scale: 1, add: rimEnd.out, along: 0, paint: rimEnd.paint });
      rings.push({ t: 1, scale: 1, add: -0.004, along: 0, paint: rimEnd.paint });
    }
    if (o.capEnd) rings.push({ t: 1, scale: 0.62, add: 0, along: Math.sqrt(1 - 0.62 * 0.62) * r1 * o.capEnd });

    const start: number[] = [];
    for (const r of rings) {
      start.push(this.vertexCount);
      for (let i = 0; i < cols; i++) {
        const a = angle(i);
        const p = place(r, a);
        this.vertex(p, o.weights(clamp01(r.t), a), aoOf(clamp01(r.t), a), { gordo: g, magro: m });
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const ra = rings[j];
      const rb = rings[j + 1];
      const tMid = clamp01((ra.t + rb.t) / 2);
      for (let i = 0; i < seg; i++) {
        const i1 = closed ? (i + 1) % seg : i + 1;
        const aMid = a0 + ((i + 0.5) / seg) * arc;
        const paint = rb.paint ?? ra.paint ?? paintOf(tMid, aMid);
        const region = regionOf(tMid, aMid);
        const s0 = start[j];
        const s1 = start[j + 1];
        this.quad(s0 + i, s1 + i, s1 + i1, s0 + i1, paint, region, shadeOf(tMid, aMid));
      }
    }
    // Poles close the domes.
    const zero = new THREE.Vector3();
    const pole = (ringIdx: number, t: number, along: number, atStart: boolean) => {
      const c = new THREE.Vector3().copy(o.from).addScaledVector(axis, t * len + along);
      if (o.shift) c.addScaledVector(depth, o.shift(t));
      if (o.shiftX) c.addScaledVector(side, o.shiftX(t));
      const p = this.vertex(c, o.weights(t, 0), aoOf(t, 0), { gordo: zero, magro: zero });
      const s = start[ringIdx];
      for (let i = 0; i < seg; i++) {
        const i1 = closed ? (i + 1) % seg : i + 1;
        if (i1 >= cols) continue;
        const aMid = a0 + ((i + 0.5) / seg) * arc;
        if (atStart) this.tri(p, s + i, s + i1, paintOf(t, aMid), regionOf(t, aMid));
        else this.tri(p, s + i1, s + i, paintOf(t, aMid), regionOf(t, aMid));
      }
    };
    if (o.capStart) pole(0, 0, -r0 * o.capStart, true);
    if (o.capEnd) pole(rings.length - 1, 1, r1 * o.capEnd, false);
  }

  /**
   * Appends any three.js geometry as a rigid part of one or more bones (a knuckle, a pocket, a bun...).
   * `matrix` places it in character space.
   */
  append(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, w: Weights, region: RegionName, paint: Paint | ((centroid: THREE.Vector3, normal: THREE.Vector3) => Paint) = PRIMARY, o: AppendOptions = {}) {
    if (this.lod > 0) {
      // Far LOD: parts smaller than a button (1) or a pocket (2) are dropped.
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const r = geo.boundingSphere!.radius * matrix.getMaxScaleOnAxis();
      if (r < (this.lod === 1 ? 0.008 : 0.02)) {
        geo.dispose();
        return;
      }
    }
    const src = geo.index ? geo.toNonIndexed() : geo;
    const posAttr = src.getAttribute('position') as THREE.BufferAttribute;
    const center = new THREE.Vector3().setFromMatrixPosition(matrix);
    const build = o.build ?? 0;
    const morphMats = Object.entries(o.morphs ?? {});
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const local = new THREE.Vector3();
    const base = this.vertexCount;
    for (let i = 0; i < posAttr.count; i++) {
      local.fromBufferAttribute(posAttr, i);
      p.copy(local).applyMatrix4(matrix);
      const gordo = new THREE.Vector3().subVectors(p, center).multiplyScalar(build);
      const morphs: Record<string, THREE.Vector3> = { gordo, magro: gordo.clone().multiplyScalar(-0.45) };
      for (const [name, mm] of morphMats) morphs[name] = q.copy(local).applyMatrix4(mm).sub(p).clone();
      const ao = typeof o.ao === 'function' ? o.ao(p) : (o.ao ?? 0);
      this.vertex(p, w, ao, morphs);
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i += 3) {
      if (typeof paint === 'function') {
        a.fromArray(this.pos, (base + i) * 3);
        b.fromArray(this.pos, (base + i + 1) * 3);
        c.fromArray(this.pos, (base + i + 2) * 3);
        n.crossVectors(q.subVectors(c, b), p.subVectors(a, b)).normalize();
        this.tri(base + i, base + i + 1, base + i + 2, paint(a.add(b).add(c).divideScalar(3), n), region, o.shade ?? 0);
      } else this.tri(base + i, base + i + 1, base + i + 2, paint, region, o.shade ?? 0);
    }
    if (src !== geo) src.dispose();
    geo.dispose();
  }

  /** Adds occlusion to every vertex so far from a field in character space (crevices of the body). */
  occlude(field: (p: THREE.Vector3) => number) {
    const p = new THREE.Vector3();
    for (let i = 0; i < this.vertexCount; i++) {
      p.fromArray(this.pos, i * 3);
      this.ao[i] += field(p);
    }
  }

  /** The finished faceted geometry. */
  build(): THREE.BufferGeometry {
    const nf = this.faces.length / 3;
    const nv = nf * 3;
    const position = new Float32Array(nv * 3);
    const normal = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const color = new Float32Array(nv * 3);
    const tint = new Float32Array(nv);
    const region = new Float32Array(nv);
    const skinIndex = new Uint16Array(nv * 4);
    const skinWeight = new Float32Array(nv * 4);
    const morphOut = [...this.morphs].map(([name, src]) => ({ name, src, out: new Float32Array(nv * 3) }));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cuv: [number, number] = [0, 0];
    for (let f = 0; f < nf; f++) {
      const ids = [this.faces[f * 3], this.faces[f * 3 + 1], this.faces[f * 3 + 2]];
      a.fromArray(this.pos, ids[0] * 3);
      b.fromArray(this.pos, ids[1] * 3);
      c.fromArray(this.pos, ids[2] * 3);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      if (n.lengthSq() > 0) n.normalize();
      // Gradient position: up-facing faces at the top of the cell, down-facing at the bottom; some faces
      // nudged up or down (3–5% of value) so big areas never look flat.
      const h = hash(f + this.seed * 7919);
      const nudge = h < 0.1 ? -0.14 : h > 0.88 ? 0.12 : 0;
      const gpos = 0.5 + 0.42 * n.y + this.faceShade[f] * 0.3 + nudge;
      const paint = this.facePaint[f];
      cellUv(paint, gpos, cuv);
      for (let k = 0; k < 3; k++) {
        const v = f * 3 + k;
        const id = ids[k];
        position.set([this.pos[id * 3], this.pos[id * 3 + 1], this.pos[id * 3 + 2]], v * 3);
        normal.set([n.x, n.y, n.z], v * 3);
        uv.set(cuv, v * 2);
        const occ = 1 - Math.min(AO_MAX, Math.max(0, this.ao[id]));
        color.set([occ, occ, occ], v * 3);
        tint[v] = paint >> 8;
        region[v] = this.faceRegion[f];
        for (let j = 0; j < 4; j++) {
          skinIndex[v * 4 + j] = this.skinIndex[id * 4 + j];
          skinWeight[v * 4 + j] = this.skinWeight[id * 4 + j];
        }
        for (const m of morphOut) m.out.set([m.src[id * 3], m.src[id * 3 + 1], m.src[id * 3 + 2]], v * 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('_tint', new THREE.BufferAttribute(tint, 1));
    geo.setAttribute('_region', new THREE.BufferAttribute(region, 1));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    if (morphOut.length) {
      geo.morphAttributes.position = morphOut.map((m) => {
        const attr = new THREE.BufferAttribute(m.out, 3);
        // Named like glTF morph targets, so the mesh's morphTargetDictionary has them.
        attr.name = m.name;
        return attr;
      });
      geo.morphTargetsRelative = true;
    }
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Rigid (non-skinned) item geometry: the same attributes, every vertex on one bone (ignored by a Mesh). */
export class RigidBuilder {
  readonly b: FacetBuilder;
  constructor(seed = 0) {
    this.b = new FacetBuilder(seed);
  }

  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, paint: Paint | ((centroid: THREE.Vector3, normal: THREE.Vector3) => Paint) = PRIMARY, shade = 0) {
    this.b.append(geo, matrix, [['root', 1]], 'none', paint, { shade });
  }

  build(): THREE.BufferGeometry {
    const g = this.b.build();
    // Rigid items never morph.
    g.morphAttributes = {};
    return g;
  }
}

/** Merges non-indexed geometries that share the same attributes (morph targets dropped). */
export function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(parts[0].attributes);
  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    const total = parts.reduce((s, p) => s + p.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const p of parts) {
      const a = p.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as ArrayLike<number>, off);
      off += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const p of parts) p.dispose();
  return out;
}

/** Low poly primitives (few segments, on purpose). */
export const prim = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  /** A faceted ellipsoid (unit sphere with few segments; scale it with the matrix). */
  blob: (w = 6, h = 4) => new THREE.SphereGeometry(1, w, h),
  cyl: (r0: number, r1: number, h: number, seg = 6) => new THREE.CylinderGeometry(r0, r1, h, seg),
  cone: (r: number, h: number, seg = 4) => new THREE.ConeGeometry(r, h, seg),
  ring: (r: number, tube: number, seg = 8, tubeSeg = 4) => new THREE.TorusGeometry(r, tube, tubeSeg, seg),
};

/** Matrix from position, Euler rotation and scale. */
export const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// --- Weight helpers ---------------------------------------------------------------------------------------

/** One bone. */
export const bone = (b: BoneName): ((t: number) => Weights) => () => [[b, 1]];

/**
 * A segment of `b` that blends into `start` over the first `blend` of it and into `end` over the last
 * `blend` (smooth joints).
 */
export function segment(b: BoneName, start: BoneName | null, end: BoneName | null, blend = 0.2): (t: number) => Weights {
  return (t) => {
    const w: [BoneName, number][] = [[b, 1]];
    if (start && t < blend) {
      const k = 0.5 * (1 - t / blend);
      w[0][1] -= k;
      w.push([start, k]);
    }
    if (end && t > 1 - blend) {
      const k = 0.5 * ((t - (1 - blend)) / blend);
      w[0][1] -= k;
      w.push([end, k]);
    }
    return w;
  };
}

/** Weights along a vertical chain of bones by height, blending `width` meters around each joint. */
export function byHeight(chain: readonly (readonly [BoneName, number])[], width = 0.05): (y: number) => Weights {
  // chain: [bone, y where it starts], sorted bottom to top.
  return (y) => {
    const w: [BoneName, number][] = [];
    for (let i = 0; i < chain.length; i++) {
      const [b, y0] = chain[i];
      const y1 = i + 1 < chain.length ? chain[i + 1][1] : Infinity;
      const lo = i === 0 ? 1 : THREE.MathUtils.smoothstep(y, y0 - width, y0 + width);
      const hi = i + 1 < chain.length ? 1 - THREE.MathUtils.smoothstep(y, y1 - width, y1 + width) : 1;
      const x = lo * hi;
      if (x > 1e-3) w.push([b, x]);
    }
    return w;
  };
}
