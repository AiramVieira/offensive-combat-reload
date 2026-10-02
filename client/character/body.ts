// The base body (masculine and feminine), faceted low poly semi-realistic (style guide): adult proportions,
// broad shoulders, an open chest, big readable hands with curled fingers, a face made of painted faces (no
// texture): eyes of 3 faces, thick brows, a nose of distinct planes, a marked jaw, ears of 2 planes. The face
// is customizable (shared/appearance.ts `Face`): its shape below the brows, eyes, brows, nose, mouth, ears, marks.
//
// `BodyParts` exposes the same surfaces offset outward, so clothes are built over the body they dress:
// they fit every body and deform with it (same weights, same build morphs).
import * as THREE from 'three';
import { DEFAULT_FACE, EYE_STYLES, FACE_SHAPES, sanitizeFace, type BrowStyle, type EarStyle, type EyeStyle, type Face, type FaceShape, type MouthStyle, type NoseStyle } from '@shared/appearance';
import type { Sex } from '@shared/protocol';
import { byHeight, FacetBuilder, lodSegments, segment, withLod, type Rim, type TubeOptions, type Weights } from './builder';
import { darker, EYES, fixed, SKIN, tinted, TINT, type Paint } from './palette';
import { REGION, restPosition, type BoneName, type RegionName } from './rig';

export type Side = -1 | 1;
export const sideName = <T extends string>(base: T, s: Side) => `${base}_${s < 0 ? 'L' : 'R'}` as `${T}_L` | `${T}_R`;

const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** A smooth bump of width `w` around `c`. */
const bell = (x: number, c: number, w: number) => Math.max(0, 1 - ((x - c) / w) ** 2);
/** Angle distance on the circle. */
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const deg = (d: number) => (d * Math.PI) / 180;

/** Table of rows: y, then values; linear interpolation by y. */
type Table = readonly (readonly number[])[];
function sampleTable(table: Table, y: number, col: number): number {
  if (y <= table[0][0]) return table[0][col];
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][0]) {
      const k = (y - table[i - 1][0]) / (table[i][0] - table[i - 1][0]);
      return lerp(table[i - 1][col], table[i][col], k);
    }
  }
  return table[table.length - 1][col];
}

/** Boxy sections: a superellipse radius multiplier. */
const superellipse = (n: number) => (a: number) => 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), 1 / n);

// --- Shapes -------------------------------------------------------------------------------------------------

export interface BodyShape {
  sex: Sex;
  /** Torso rows: y, half width, half depth, forward shift. */
  torso: Table;
  /** Pecs (m) or bust (f): extra radius at the front of the chest. */
  chest: number;
  glutes: number;
  neck: number;
  upperArm: [number, number];
  forearm: [number, number];
  thigh: [number, number];
  /** Shin rows: t (knee→ankle), radius. */
  shin: Table;
  deltoid: [number, number, number];
  hand: { palmLen: number; palmW: number; palmT: number; finger: number; fingerW: number };
  foot: { len: number; w: number };
  /** Head rows: y, half width, half depth, forward shift. */
  head: Table;
  jaw: number;
  chin: number;
  brow: number;
  eye: { w: number; h: number; x: number };
}

export const SHAPES: Record<Sex, BodyShape> = {
  m: {
    sex: 'm',
    torso: [
      [0.82, 0.07, 0.06, 0],
      [0.87, 0.15, 0.1, -0.004],
      [0.93, 0.168, 0.108, -0.008],
      [0.99, 0.165, 0.104, -0.004],
      [1.05, 0.152, 0.098, 0.004],
      [1.11, 0.152, 0.1, 0.006],
      [1.17, 0.16, 0.106, 0.007],
      [1.23, 0.17, 0.113, 0.01],
      [1.29, 0.178, 0.116, 0.012],
      [1.35, 0.186, 0.11, 0.01],
      [1.4, 0.19, 0.1, 0.004],
      [1.435, 0.158, 0.082, 0],
      [1.46, 0.092, 0.064, 0],
      [1.47, 0.066, 0.058, 0],
    ],
    chest: 0.012,
    glutes: 0.014,
    neck: 0.056,
    upperArm: [0.052, 0.042],
    forearm: [0.046, 0.032],
    thigh: [0.088, 0.056],
    shin: [
      [0, 0.054],
      [0.25, 0.06],
      [0.6, 0.044],
      [1, 0.034],
    ],
    deltoid: [0.056, 0.04, 0.056],
    hand: { palmLen: 0.1, palmW: 0.086, palmT: 0.03, finger: 0.085, fingerW: 0.02 },
    foot: { len: 0.28, w: 0.05 },
    head: [
      [1.538, 0.028, 0.034, 0.066],
      [1.556, 0.058, 0.074, 0.032],
      [1.578, 0.068, 0.09, 0.014],
      [1.602, 0.074, 0.1, 0.006],
      [1.626, 0.078, 0.104, 0.004],
      [1.65, 0.08, 0.106, 0.002],
      [1.672, 0.08, 0.106, 0],
      [1.695, 0.08, 0.106, -0.002],
      [1.72, 0.078, 0.104, -0.004],
      [1.745, 0.072, 0.098, -0.006],
      [1.768, 0.058, 0.082, -0.008],
      [1.785, 0.034, 0.05, -0.008],
    ],
    jaw: 0.009,
    chin: 0.006,
    brow: 0.006,
    eye: { w: 0.029, h: 0.0125, x: 0.034 },
  },
  f: {
    sex: 'f',
    torso: [
      [0.82, 0.075, 0.062, 0],
      [0.87, 0.162, 0.1, -0.006],
      [0.93, 0.176, 0.108, -0.01],
      [0.99, 0.168, 0.1, -0.006],
      [1.05, 0.138, 0.088, 0.002],
      [1.11, 0.13, 0.086, 0.004],
      [1.17, 0.136, 0.09, 0.006],
      [1.23, 0.146, 0.098, 0.008],
      [1.29, 0.152, 0.1, 0.008],
      [1.35, 0.158, 0.096, 0.006],
      [1.4, 0.16, 0.088, 0.003],
      [1.435, 0.132, 0.072, 0],
      [1.46, 0.078, 0.056, 0],
      [1.47, 0.058, 0.05, 0],
    ],
    chest: 0.034,
    glutes: 0.02,
    neck: 0.047,
    upperArm: [0.044, 0.035],
    forearm: [0.038, 0.027],
    thigh: [0.09, 0.052],
    shin: [
      [0, 0.05],
      [0.25, 0.055],
      [0.6, 0.04],
      [1, 0.031],
    ],
    deltoid: [0.047, 0.034, 0.047],
    hand: { palmLen: 0.092, palmW: 0.076, palmT: 0.026, finger: 0.08, fingerW: 0.017 },
    foot: { len: 0.255, w: 0.045 },
    head: [
      [1.54, 0.022, 0.03, 0.062],
      [1.556, 0.05, 0.07, 0.03],
      [1.578, 0.062, 0.088, 0.014],
      [1.602, 0.07, 0.098, 0.006],
      [1.626, 0.075, 0.102, 0.004],
      [1.65, 0.078, 0.104, 0.002],
      [1.672, 0.078, 0.104, 0],
      [1.695, 0.078, 0.104, -0.002],
      [1.72, 0.076, 0.102, -0.004],
      [1.745, 0.07, 0.096, -0.006],
      [1.768, 0.056, 0.08, -0.008],
      [1.785, 0.032, 0.048, -0.008],
    ],
    jaw: 0.002,
    chin: 0.003,
    brow: 0.003,
    eye: { w: 0.032, h: 0.0145, x: 0.034 },
  },
};

/** Joint positions of a body (rest pose). */
export function joints(sex: Sex) {
  const r = (b: BoneName) => restPosition(b, sex);
  return {
    shoulder: r('upperArm_R').x,
    elbow: r('forearm_R').x,
    wrist: r('hand_R').x,
    armY: r('upperArm_R').y,
    legX: r('thigh_R').x,
    hipY: r('thigh_R').y,
    kneeY: r('shin_R').y,
    ankleY: r('foot_R').y,
  };
}

/** Where the lower shin (ankle region) starts along the shin. */
export const ANKLE_T = 0.68;

const Y_TORSO0 = 0.82;
const Y_TORSO1 = 1.47;
const TORSO_CHAIN = [['hips', 0], ['spine', 1.07], ['chest', 1.25], ['neck', 1.47]] as const;
const torsoByHeight = byHeight(TORSO_CHAIN, 0.05);

/** Torso weights: the spine chain by height; the hips' sides follow the thighs. a = 0 is the left (-X). */
function torsoWeights(y: number, a: number): Weights {
  const w = [...torsoByHeight(y)] as [BoneName, number][];
  if (y < 0.95) {
    const k = clamp01((0.95 - y) / 0.13) * 0.6;
    const left = Math.max(0, Math.cos(a)) * k;
    const right = Math.max(0, -Math.cos(a)) * k;
    if (left) w.push(['thigh_L', left]);
    if (right) w.push(['thigh_R', right]);
  }
  return w;
}

const torsoRegion = (y: number): RegionName => (y < 0.99 ? 'pelvis' : y < 1.15 ? 'belly' : y < 1.44 ? 'chest' : 'neck');
// Build strength by height: blended (not stepped) between the belly and the chest, so nothing stuck to the
// cloth near 1.25 m lands on the wrong side of a jump.
const torsoBuild = (y: number) => (y < 0.99 ? 0.18 : lerp(0.2, 0.12, THREE.MathUtils.smoothstep(y, 1.2, 1.3)));
const torsoBelly = (y: number) => (y > 0.99 && y < 1.25 ? 0.3 * Math.sin(((y - 0.99) / 0.26) * Math.PI) : 0);

// --- Head -----------------------------------------------------------------------------------------------------

/** Head sections are 12-sided, the first vertex at the front (a = 90°): a ridge down the middle of the face. */
export const HEAD_SEGMENTS = 12;
const HEAD_A0 = Math.PI / 2;

// Face shapes change the head only below the brows (hair and hats are built over the skull and cached per sex):
// the jaw, the cheeks, the cheekbones and the chin, pushed out or in along the surface, and the chin lowered or
// raised. Nothing moves at the ears nor above the eyes. Pieces built over the head (hair, beards, hats, masks,
// glasses, helmets, hoods; rigid ones too) get the difference as morph targets "rosto_<shape>"
// (`withFaceMorphs`); the body is built with it. Broad bumps: thin shells (stubble) sit on the smooth surface and
// the head is faceted, so sharp curvature would let facets through them.

/** Face-shape offsets (m, masculine head; the feminine one takes 85%): + out, − in; `drop` lowers the chin. */
const FACE_TERMS: Record<FaceShape, { jaw: number; low: number; cheek: number; cheekbone: number; chin: number; chinSide: number; drop: number }> = {
  oval: { jaw: 0, low: 0, cheek: 0, cheekbone: 0, chin: 0, chinSide: 0, drop: 0 },
  // Wide angular jaw, a flat broad chin.
  quadrado: { jaw: 0.013, low: 0.004, cheek: -0.001, cheekbone: 0, chin: 0.002, chinSide: 0.009, drop: 0.002 },
  // Full cheeks, a soft jaw, a short round chin.
  redondo: { jaw: -0.002, low: 0.007, cheek: 0.011, cheekbone: 0.002, chin: -0.003, chinSide: 0.004, drop: -0.005 },
  // Narrow and long: thin cheeks and jaw, the chin lower and a little forward.
  longo: { jaw: -0.006, low: -0.005, cheek: -0.007, cheekbone: -0.001, chin: 0.004, chinSide: -0.002, drop: 0.015 },
  // Heart: wide cheekbones, a narrow jaw, a small pointed chin.
  coracao: { jaw: -0.011, low: -0.005, cheek: 0.001, cheekbone: 0.008, chin: 0.005, chinSide: -0.006, drop: 0.005 },
};

/** Below this height (and toward the face) a face shape can move the head: pieces touching it get morphs. */
const FACE_TOP = 1.665;
let currentFace: FaceShape = 'oval';
let faceTouched = false;

/** Builds with a face shape: `headShape(sex)` (the body, every shell and item over the head) is that face's head. */
export function withFace<T>(face: FaceShape, fn: () => T): T {
  const prev = currentFace;
  currentFace = face;
  try {
    return fn();
  } finally {
    currentFace = prev;
  }
}

type Built = { skinned?: THREE.BufferGeometry; rigid?: THREE.BufferGeometry };

/**
 * Builds a piece on the oval face and, when it touched the face below the brows, once more on every other face
 * shape: the vertex differences become morph targets "rosto_<shape>" (relative), set by the character from its
 * config and baked like the build morphs. Beards, masks, glasses, helmets and hoods then fit every face (the
 * generators are deterministic: same faces in the same order on every face).
 */
export function withFaceMorphs<T extends Built>(build: () => T): T {
  const prevTouched = faceTouched;
  faceTouched = false;
  const base = withFace('oval', build);
  const touched = faceTouched;
  faceTouched = prevTouched;
  if (!touched) return base;
  for (const shape of FACE_SHAPES) {
    if (shape === 'oval') continue;
    const v = withFace(shape, build);
    addFaceMorph(base.skinned, v.skinned, `rosto_${shape}`);
    addFaceMorph(base.rigid, v.rigid, `rosto_${shape}`);
    v.skinned?.dispose();
    v.rigid?.dispose();
  }
  return base;
}

function addFaceMorph(g: THREE.BufferGeometry | undefined, v: THREE.BufferGeometry | undefined, name: string) {
  if (!g || !v) return;
  const p = g.getAttribute('position').array;
  const q = v.getAttribute('position').array;
  if (p.length !== q.length) {
    console.warn(`rosto: ${name} mudou a topologia da peça (sem morph)`);
    return;
  }
  const d = new Float32Array(p.length);
  let max = 0;
  for (let i = 0; i < p.length; i++) {
    d[i] = q[i] - p[i];
    max = Math.max(max, Math.abs(d[i]));
  }
  if (max < 1e-5) return;
  const attr = new THREE.BufferAttribute(d, 3);
  attr.name = name;
  (g.morphAttributes.position ??= []).push(attr);
  g.morphTargetsRelative = true;
}

/** The head as an analytic surface (used by the head mesh, the face features and every shell on it). */
export class HeadShape {
  readonly y0: number;
  readonly y1: number;
  private readonly terms: (typeof FACE_TERMS)[FaceShape] | null;
  constructor(
    readonly s: BodyShape,
    readonly face: FaceShape = 'oval',
  ) {
    this.y0 = s.head[0][0];
    this.y1 = s.head[s.head.length - 1][0] + 0.012;
    const k = s.sex === 'f' ? 0.85 : 1;
    const t = FACE_TERMS[face];
    this.terms = face === 'oval' ? null : (Object.fromEntries(Object.entries(t).map(([n, v]) => [n, v * k])) as typeof t);
  }

  /** The face shape's push (out +) at (y, a): jaw, lower face, cheeks, cheekbones, chin. */
  private shapeBump(y: number, a: number): number {
    const t = this.terms;
    if (!t || y > FACE_TOP) return 0;
    const front = angDist(a, deg(90));
    if (front > deg(100)) return 0;
    return (
      t.jaw * bell(y, 1.582, 0.034) * bell(front, deg(62), deg(36)) +
      t.low * bell(y, 1.578, 0.04) * bell(front, deg(50), deg(45)) +
      t.cheek * bell(y, 1.612, 0.028) * bell(front, deg(42), deg(30)) +
      t.cheekbone * bell(y, 1.645, 0.016) * bell(front, deg(54), deg(26)) +
      t.chin * bell(y, 1.547, 0.02) * bell(front, 0, deg(22)) +
      t.chinSide * bell(y, 1.553, 0.022) * bell(front, deg(30), deg(20))
    );
  }

  /** How far the face shape lowers the head at (y, a): the chin most, nothing from the mouth up at the sides. */
  private drop(y: number, a: number): number {
    const t = this.terms;
    if (!t || !t.drop || y > 1.6) return 0;
    const front = angDist(a, deg(90));
    return t.drop * THREE.MathUtils.smoothstep(1.6 - y, 0, 0.055) * bell(front, 0, deg(80));
  }

  /** Shaping bumps: jaw angle, chin, cheekbones, eye sockets, brow ridge, temples. */
  bump(y: number, a: number): number {
    const s = this.s;
    const jawA = Math.min(angDist(a, deg(150)), angDist(a, deg(30)));
    const cheekA = Math.min(angDist(a, deg(125)), angDist(a, deg(55)));
    const eyeA = Math.min(angDist(a, deg(118)), angDist(a, deg(62)));
    const front = angDist(a, deg(90));
    let d = 0;
    d += s.jaw * bell(y, 1.59, 0.03) * bell(jawA, 0, deg(28));
    d += s.chin * bell(y, 1.545, 0.02) * bell(front, 0, deg(40));
    d += 0.005 * bell(y, 1.645, 0.018) * bell(cheekA, 0, deg(22));
    d -= 0.006 * bell(y, 1.672, 0.012) * bell(eyeA, 0, deg(16));
    d += s.brow * bell(y, 1.695, 0.012) * bell(front, 0, deg(45));
    d -= 0.003 * bell(y, 1.715, 0.02) * Math.min(bell(angDist(a, deg(160)), 0, deg(18)), 1) - 0.003 * bell(y, 1.715, 0.02) * bell(angDist(a, deg(20)), 0, deg(18));
    return d;
  }

  /** Point on the head at height y and angle a, pushed `d` meters outward. */
  point(y: number, a: number, d = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.s;
    if (y < FACE_TOP && angDist(a, deg(90)) < deg(100)) faceTouched = true;
    const w = sampleTable(s.head, y, 1);
    const dep = sampleTable(s.head, y, 2);
    const fwd = sampleTable(s.head, y, 3);
    const face = y < 1.7 ? 2.35 : 2.1;
    const r = superellipse(face)(a) + (this.bump(y, a) + this.shapeBump(y, a) + d) / Math.max(0.02, Math.hypot(Math.cos(a) * w, Math.sin(a) * dep));
    // side = -X at a = 0, depth = -Z at a = 90° (front), like the tubes.
    return out.set(-Math.cos(a) * w * r, y - this.drop(y, a), -Math.sin(a) * dep * r - fwd);
  }

  /** Outward direction at (y, a) (numerical normal of the surface). */
  normal(y: number, a: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.002;
    const p0 = this.point(y, a - e);
    const p1 = this.point(y, a + e);
    const q0 = this.point(y - e, a);
    const q1 = this.point(y + e, a);
    const ta = p1.sub(p0);
    const ty = q1.sub(q0);
    return out.crossVectors(ty, ta).normalize();
  }

  /** Row heights of the head mesh (the face features sit on its facets). */
  get rows(): number[] {
    return this.s.head.map((r) => r[0]);
  }

  angle(i: number) {
    return HEAD_A0 + (i / HEAD_SEGMENTS) * Math.PI * 2;
  }

  /**
   * Point on the faceted head mesh (not the smooth surface): bilinear in the quad of the mesh grid that
   * holds (y, a), plus `d` along the facet normal. Face features sit here so they never float or sink.
   */
  meshPoint(y: number, a: number, d = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const rows = this.rows;
    let j = 0;
    while (j < rows.length - 2 && y > rows[j + 1]) j++;
    const ky = clamp01((y - rows[j]) / (rows[j + 1] - rows[j]));
    const step = (Math.PI * 2) / HEAD_SEGMENTS;
    let rel = (a - HEAD_A0) / step;
    rel = ((rel % HEAD_SEGMENTS) + HEAD_SEGMENTS) % HEAD_SEGMENTS;
    const i = Math.floor(rel);
    const ka = rel - i;
    const a0 = this.angle(i);
    const a1 = this.angle(i + 1);
    const p00 = this.point(rows[j], a0);
    const p01 = this.point(rows[j], a1);
    const p10 = this.point(rows[j + 1], a0);
    const p11 = this.point(rows[j + 1], a1);
    const bottom = p00.clone().lerp(p01, ka);
    const top = p10.clone().lerp(p11, ka);
    out.copy(bottom).lerp(top, ky);
    if (d) {
      // Outward: (up the rows) × (around the ring), like the winding of the head's quads.
      const n = new THREE.Vector3().crossVectors(p10.clone().sub(p00).add(p11.clone().sub(p01)), p01.clone().sub(p00).add(p11.clone().sub(p10))).normalize();
      out.addScaledVector(n, d);
    }
    return out;
  }
}

const headShapes = new Map<string, HeadShape>();
/** The head of a body, with the face shape being built (`withFace`; oval otherwise). */
export function headShape(sex: Sex, face: FaceShape = currentFace): HeadShape {
  const key = `${sex}|${face}`;
  let h = headShapes.get(key);
  if (!h) {
    h = new HeadShape(SHAPES[sex], face);
    headShapes.set(key, h);
  }
  return h;
}

const HEAD_W: Weights = [['head', 1]];

/** A shell over the head (hair caps, beards, beanies): rows × cols of the head surface pushed out. */
export interface ShellOptions {
  /** Height range and angle range (radians, a = 90° front). */
  y0: number;
  y1: number;
  a0?: number;
  arc?: number;
  rows: number;
  cols?: number;
  /** Offset over the skin per (y, a). */
  d: (y: number, a: number) => number;
  /** Lower edge per angle: the shell starts at max(y0, edge(a)) (hairlines). */
  edge?: (a: number) => number;
  /** Upper edge per angle: the shell ends at top(a) instead of y1 (beard lines). */
  top?: (a: number) => number;
  /** Offset of the lower edge along the axis per angle (jagged tips). */
  tips?: (a: number) => number;
  paint: Paint | ((y: number, a: number) => Paint);
  region: RegionName | ((y: number, a: number) => RegionName);
  /** Close the top (a cap). */
  closeTop?: boolean;
  /** A thickness band on the lower edge. */
  rim?: number;
  /** Close the lower edge onto the skin (no gap under a volume, e.g. an afro). */
  close?: boolean;
  /** Vertical lift per (y, a): `d` pushes sideways, this raises the top (round volumes). */
  lift?: (y: number, a: number) => number;
  /** > 1 packs the rows toward the top (the skull curves fast near the crown: thin shells need it). */
  bias?: number;
  /** Faces to skip (a hole, e.g. the mouth in a beard). */
  skip?: (y: number, a: number) => boolean;
  ao?: (y: number, a: number) => number;
}

export function headShell(b: FacetBuilder, h: HeadShape, o0: ShellOptions) {
  // Far LODs: ¾ of the rows at 1; half the rows and ¾ of the columns at 2 (fewer columns closer up would let
  // the head through thin shells). Shells with a hole (the mouth in a beard) keep their rows at 1: fewer rows
  // would move the hole off the mouth.
  const o =
    b.lod >= 2
      ? { ...o0, rows: Math.max(1, Math.ceil(o0.rows / 2)), cols: lodSegments(o0.cols ?? HEAD_SEGMENTS, 1) }
      : b.lod === 1 && !o0.skip
        ? { ...o0, rows: Math.max(1, Math.ceil(o0.rows * 0.75)) }
        : o0;
  const cols = o.cols ?? HEAD_SEGMENTS;
  const closed = o.arc === undefined;
  const arc = o.arc ?? Math.PI * 2;
  const a0 = o.a0 ?? HEAD_A0;
  const n = closed ? cols : cols + 1;
  const paintOf = typeof o.paint === 'function' ? o.paint : () => o.paint as Paint;
  const regionOf = typeof o.region === 'function' ? o.region : () => o.region as RegionName;
  const ids: number[][] = [];
  const angles = Array.from({ length: n }, (_, i) => a0 + (i / cols) * arc);
  const yAt = (r: number, a: number) => {
    const lo = Math.max(o.y0, o.edge ? o.edge(a) : o.y0);
    return lerp(lo, o.top ? o.top(a) : o.y1, 1 - Math.pow(1 - r / o.rows, o.bias ?? 1));
  };
  const p = new THREE.Vector3();
  const zero = new THREE.Vector3();
  // An optional band under the lower edge (thickness), then the rows.
  const rowList: { r: number; extra: number; drop: number; skin?: boolean }[] = [];
  if (o.close) rowList.push({ r: 0, extra: 0, drop: 0.002, skin: true });
  else if (o.rim) rowList.push({ r: 0, extra: -o.rim * 0.6, drop: 0.004 });
  for (let r = 0; r <= o.rows; r++) rowList.push({ r, extra: 0, drop: 0 });
  for (const row of rowList) {
    const line: number[] = [];
    for (const a of angles) {
      const y = yAt(row.r, a) - row.drop + (row.r === 0 && o.tips ? o.tips(a) : 0);
      h.point(y, a, row.skin ? 0.0015 : o.d(y, a) + row.extra, p);
      if (o.lift && !row.skin) p.y += o.lift(y, a);
      line.push(b.vertex(p, HEAD_W, o.ao ? o.ao(y, a) : 0, { gordo: zero, magro: zero }));
    }
    ids.push(line);
  }
  for (let j = 0; j < ids.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const i1 = closed ? (i + 1) % cols : i + 1;
      const aMid = a0 + ((i + 0.5) / cols) * arc;
      const yMid = (yAt(Math.max(0, rowList[j].r), aMid) + yAt(rowList[j + 1].r, aMid)) / 2;
      if (o.skip?.(yMid, aMid)) continue;
      b.quad(ids[j][i], ids[j + 1][i], ids[j + 1][i1], ids[j][i1], paintOf(yMid, aMid), regionOf(yMid, aMid));
    }
  }
  if (o.closeTop) {
    const top = ids[ids.length - 1];
    const ctr = new THREE.Vector3();
    for (const id of top) ctr.add(b.position(id, p));
    ctr.divideScalar(top.length);
    // The pole clears the head's crown by the shell's thickness (a thin shell would let the skull through).
    ctr.y = Math.max(ctr.y, o.y1, h.y1) + o.d(o.y1, HEAD_A0) + 0.004 + (o.lift ? o.lift(o.y1, HEAD_A0) : 0);
    ctr.z = 0.012;
    const pole = b.vertex(ctr, HEAD_W, 0, { gordo: zero, magro: zero });
    for (let i = 0; i < cols; i++) {
      const i1 = closed ? (i + 1) % cols : i + 1;
      if (!closed && i1 >= n) continue;
      const aMid = a0 + ((i + 0.5) / cols) * arc;
      b.tri(top[i], pole, top[i1], paintOf(o.y1, aMid), regionOf(o.y1, aMid));
    }
  }
  return ids;
}

// --- Body parts (shared with the clothes) -----------------------------------------------------------------------

export interface PartOptions {
  paint?: Paint | ((t: number, a: number) => Paint);
  rimStart?: Rim;
  rimEnd?: Rim;
  capStart?: number;
  capEnd?: number;
  /** Extra radius (flare) along the part. */
  flare?: (t: number) => number;
  /** Extra per-angle radius (folds, pockets, muscles). */
  bump?: (t: number, a: number) => number;
  shade?: (t: number, a: number) => number;
  ao?: (t: number, a: number) => number;
  segments?: number;
  /** Extra rings (t positions) on top of the part's own. */
  ts?: readonly number[];
  region?: RegionName;
  /** Replaces the part's own rings (t positions): fewer rings for clothes over it. */
  rings?: readonly number[];
  /** Neck only: an opening at the front (radians), for V necks and open collars. */
  gap?: number;
}

const mergeTs = (base: readonly number[], t0: number, t1: number, extra: readonly number[] = []) => {
  const all = [...base.map((t) => (t - t0) / (t1 - t0)), ...extra.map((t) => (t - t0) / (t1 - t0)), 0, 1].filter((t) => t >= -1e-6 && t <= 1 + 1e-6);
  return [...new Set(all.map((t) => Math.round(clamp01(t) * 1e4) / 1e4))].sort((a, b) => a - b);
};

/** Shape-following tubes, shared by the body and the clothes (`d` = offset over the skin). */
export class BodyParts {
  readonly j: ReturnType<typeof joints>;
  readonly head: HeadShape;
  constructor(
    readonly b: FacetBuilder,
    readonly s: BodyShape,
  ) {
    this.j = joints(s.sex);
    this.head = headShape(s.sex);
  }

  /** Torso half width, half depth and forward shift at height y. */
  torsoAt(y: number) {
    return { w: sampleTable(this.s.torso, y, 1), d: sampleTable(this.s.torso, y, 2), fwd: sampleTable(this.s.torso, y, 3) };
  }

  /** Muscle/bust bumps of the torso. */
  torsoBump(y: number, a: number): number {
    const s = this.s;
    const pec = Math.min(angDist(a, deg(126)), angDist(a, deg(54)));
    const glute = Math.min(angDist(a, deg(234)), angDist(a, deg(306)));
    const fem = s.sex === 'f';
    return (
      s.chest * bell(y, fem ? 1.27 : 1.3, fem ? 0.055 : 0.05) * bell(pec, 0, deg(fem ? 34 : 40)) +
      s.glutes * bell(y, 0.92, 0.06) * bell(glute, 0, deg(40)) +
      0.006 * bell(y, 1.34, 0.05) * bell(angDist(a, deg(270)), 0, deg(60))
    );
  }

  /**
   * A point on the torso as `torso()` builds it at offset `d` (without the piece's own bumps), with its outward
   * normal, skin weights, region and build morph deltas: for patches, pockets and buttons stuck to a garment.
   */
  torsoSurface(y: number, a: number, d: number) {
    const t = this.torsoAt(y);
    const sx = t.w + d;
    const sz = t.d + d;
    const rad = superellipse(2.4)(a) + this.torsoBump(y, a) * (d > 0.03 ? 0.4 : 1);
    const off = new THREE.Vector3(-Math.cos(a) * rad * sx, 0, -Math.sin(a) * rad * sz);
    const p = new THREE.Vector3(0, y, -t.fwd).add(off);
    const k = torsoBuild(y);
    const gordo = off.clone().multiplyScalar(k);
    if (Math.sin(a) > 0) gordo.z -= torsoBelly(y) * Math.sin(a) * rad * sz;
    const magro = off.clone().multiplyScalar(-k * 0.45);
    const n = new THREE.Vector3(-Math.cos(a) / sx, 0, -Math.sin(a) / sz).normalize();
    return { p, n, w: torsoWeights(y, a), region: torsoRegion(y), gordo, magro };
  }

  torso(y0: number, y1: number, d: number, o: PartOptions = {}) {
    const rows = this.s.torso.map((r) => r[0]);
    const yOf = (t: number) => y0 + (y1 - y0) * t;
    const paint = o.paint;
    const bump = o.bump;
    this.b.tube({
      from: new THREE.Vector3(0, y0, 0),
      to: new THREE.Vector3(0, y1, 0),
      radius: (t) => 1 + (o.flare ? o.flare(t) : 0) / Math.max(0.05, this.torsoAt(yOf(t)).w),
      sx: (t) => this.torsoAt(yOf(t)).w + d,
      sz: (t) => this.torsoAt(yOf(t)).d + d,
      shift: (t) => this.torsoAt(yOf(t)).fwd,
      section: superellipse(2.4),
      bump: (t, a) => this.torsoBump(yOf(t), a) * (d > 0.03 ? 0.4 : 1) + (bump ? bump(t, a) : 0),
      ts: mergeTs(rows, y0, y1, o.ts),
      segments: o.segments ?? 10,
      a0: Math.PI / 2,
      region: o.region ?? ((t) => torsoRegion(yOf(t))),
      weights: (t, a) => torsoWeights(yOf(t), a),
      paint: typeof paint === 'function' ? (t, a) => paint(yOf(t), a) : paint,
      shade: o.shade ? (t, a) => o.shade!(yOf(t), a) : undefined,
      ao: o.ao ? (t, a) => o.ao!(yOf(t), a) : undefined,
      build: (t) => torsoBuild(yOf(t)),
      belly: (t) => torsoBelly(yOf(t)),
      capStart: o.capStart,
      capEnd: o.capEnd,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  neck(y0: number, y1: number, d: number, o: PartOptions = {}) {
    const r = this.s.neck;
    this.b.tube({
      from: new THREE.Vector3(0, y0, 0.004),
      to: new THREE.Vector3(0, y1, -0.004),
      radius: (t) => r + d + (o.flare ? o.flare(t) : 0),
      sz: () => 0.94,
      // Sternocleidomastoid: a diagonal edge from behind the ear to the collarbone.
      bump: (t, a) => 0.005 * bell(angDist(a, deg(90 + 50 - t * 35)), 0, deg(20)) + 0.005 * bell(angDist(a, deg(90 - 50 + t * 35)), 0, deg(20)) + (o.bump ? o.bump(t, a) : 0),
      ts: o.ts ?? [0, 0.35, 0.7, 1],
      segments: o.segments ?? 8,
      a0: Math.PI / 2 + (o.gap ?? 0) / 2,
      arc: o.gap ? Math.PI * 2 - o.gap : undefined,
      region: o.region ?? 'neck',
      weights: (t) => segment('neck', 'chest', 'head', 0.35)(t),
      paint: o.paint,
      ao: o.ao,
      build: () => 0.08,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  /**
   * Upper arm weights: the part inside the torso (before the shoulder joint) stays with the torso and only
   * turns into the arm across the joint, so a lowered arm never lifts it above the shoulder line.
   */
  upperArmWeights(side: Side, t: number): Weights {
    const root = this.j.shoulder - 0.07;
    const tj = (this.j.shoulder - root) / (this.j.elbow - root);
    const arm = THREE.MathUtils.smoothstep(t, tj * 0.4, tj + 0.14);
    // Toward the elbow the forearm takes over gradually (half at the joint), over a wide band: a short blend
    // pinches the elbow into a sliver when the arm bends hard (aiming up).
    const fore = t > 0.7 ? 0.5 * THREE.MathUtils.smoothstep(t, 0.7, 1) : 0;
    const w: [BoneName, number][] = [[sideName('upperArm', side), arm - fore], [sideName('shoulder', side), 1 - arm]];
    if (fore) w.push([sideName('forearm', side), fore]);
    return w;
  }

  upperArm(side: Side, t0: number, t1: number, d: number, o: PartOptions = {}) {
    const [r0, r1] = this.s.upperArm;
    const j = this.j;
    const x = (t: number) => lerp(j.shoulder - 0.07, j.elbow, t);
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(side * x(t0), j.armY - 0.012 * (1 - t0), 0),
      to: new THREE.Vector3(side * x(t1), j.armY - 0.012 * (1 - t1), 0),
      radius: (u) => {
        const t = lerp(t0, t1, u);
        // Thinner where it starts inside the torso, so it never pokes above the shoulder line.
        const root = 0.72 + 0.28 * Math.min(1, t / 0.24);
        return lerp(r0, r1, t) * root + d + (o.flare ? o.flare(t) : 0);
      },
      // Biceps on the front-top, triceps at the back.
      bump: (u, a) => {
        const t = lerp(t0, t1, u);
        return 0.006 * bell(t, 0.55, 0.3) * bell(angDist(a, deg(side < 0 ? 270 : 90)), 0, deg(55)) + (o.bump ? o.bump(t, a) : 0);
      },
      sz: () => 0.92,
      ts: mergeTs(o.rings ?? [0, 0.2, 0.45, 0.7, 0.88, 1], t0, t1, o.ts),
      segments: o.segments ?? 8,
      region: o.region ?? sideName('upperArm', side),
      weights: (u) => this.upperArmWeights(side, lerp(t0, t1, u)),
      paint: typeof paint === 'function' ? (u, a) => paint(lerp(t0, t1, u), a) : paint,
      shade: o.shade ? (u, a) => o.shade!(lerp(t0, t1, u), a) : undefined,
      ao: o.ao ? (u, a) => o.ao!(lerp(t0, t1, u), a) : undefined,
      build: () => 0.16,
      capEnd: o.capEnd,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  forearm(side: Side, t0: number, t1: number, d: number, o: PartOptions = {}) {
    const [r0, r1] = this.s.forearm;
    const j = this.j;
    const x = (t: number) => lerp(j.elbow - 0.02, j.wrist + 0.012, t);
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(side * x(t0), j.armY, 0),
      to: new THREE.Vector3(side * x(t1), j.armY, 0),
      radius: (u) => {
        const t = lerp(t0, t1, u);
        // Forearm muscle near the elbow, thin at the wrist.
        return lerp(r0, r1, Math.pow(t, 0.8)) + 0.005 * bell(t, 0.22, 0.25) + d + (o.flare ? o.flare(t) : 0);
      },
      sz: (u) => lerp(0.95, 0.72, lerp(t0, t1, u)),
      bump: o.bump ? (u, a) => o.bump!(lerp(t0, t1, u), a) : undefined,
      ts: mergeTs(o.rings ?? [0, 0.12, 0.35, 0.65, 0.9, 1], t0, t1, o.ts),
      segments: o.segments ?? 8,
      region: o.region ?? sideName('forearm', side),
      // The upper arm's share fades over the first quarter (see upperArmWeights: the elbow blends widely).
      weights: (u) => segment(sideName('forearm', side), sideName('upperArm', side), sideName('hand', side), 0.25)(lerp(t0, t1, u)),
      paint: typeof paint === 'function' ? (u, a) => paint(lerp(t0, t1, u), a) : paint,
      shade: o.shade ? (u, a) => o.shade!(lerp(t0, t1, u), a) : undefined,
      ao: o.ao ? (u, a) => o.ao!(lerp(t0, t1, u), a) : undefined,
      build: () => 0.1,
      capStart: o.capStart,
      capEnd: o.capEnd,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  thigh(side: Side, t0: number, t1: number, d: number, o: PartOptions = {}) {
    const [r0, r1] = this.s.thigh;
    const j = this.j;
    const y = (t: number) => lerp(j.hipY + 0.03, j.kneeY, t);
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(side * j.legX, y(t0), 0),
      to: new THREE.Vector3(side * j.legX, y(t1), 0),
      radius: (u) => {
        const t = lerp(t0, t1, u);
        return lerp(r0, r1, Math.pow(t, 0.85)) + d + (o.flare ? o.flare(t) : 0);
      },
      sx: () => 0.94,
      // Quadriceps in front, a little forward at the knee.
      bump: (u, a) => {
        const t = lerp(t0, t1, u);
        return 0.006 * bell(t, 0.45, 0.35) * bell(angDist(a, deg(90)), 0, deg(55)) + (o.bump ? o.bump(t, a) : 0);
      },
      ts: mergeTs([0, 0.15, 0.35, 0.55, 0.75, 0.9, 1], t0, t1, o.ts),
      segments: o.segments ?? 8,
      a0: Math.PI / 2,
      region: o.region ?? sideName('thigh', side),
      weights: (u) => segment(sideName('thigh', side), 'hips', sideName('shin', side), 0.14)(lerp(t0, t1, u)),
      paint: typeof paint === 'function' ? (u, a) => paint(lerp(t0, t1, u), a) : paint,
      shade: o.shade ? (u, a) => o.shade!(lerp(t0, t1, u), a) : undefined,
      ao: o.ao ? (u, a) => o.ao!(lerp(t0, t1, u), a) : undefined,
      build: () => 0.2,
      capStart: o.capStart,
      capEnd: o.capEnd,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  /** The garment version of the deltoid (covers the body's, so sleeves never show the shoulder through). */
  deltoid(side: Side, d: number, paint: Paint, region: RegionName = sideName('upperArm', side)) {
    // Far LODs: none (the sleeves over it lose rings and sides and it would poke through; the arm's root is
    // inside the torso, so the shoulder stays closed).
    if (this.b.lod) return;
    const [dx, dy, dz] = this.s.deltoid;
    const k = 1;
    this.b.append(
      new THREE.SphereGeometry(1, 7, 5),
      new THREE.Matrix4().compose(
        new THREE.Vector3(side * (this.j.shoulder + 0.008), this.j.armY - 0.012, 0.002),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * -0.45)),
        new THREE.Vector3((dx + d) * k, (dy + d) * k, (dz + d) * k),
      ),
      [[sideName('upperArm', side), 0.55], [sideName('shoulder', side), 0.25], ['chest', 0.2]],
      region,
      paint,
      { build: 0.18 },
    );
  }

  shinRadius(t: number) {
    return sampleTable(this.s.shin, clamp01(t), 1);
  }

  shin(side: Side, t0: number, t1: number, d: number, o: PartOptions & { loose?: number } = {}) {
    const j = this.j;
    const y = (t: number) => lerp(j.kneeY + 0.01, j.ankleY + 0.02, t);
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(side * j.legX, y(t0), 0),
      to: new THREE.Vector3(side * j.legX, y(t1), 0),
      radius: (u) => {
        const t = lerp(t0, t1, u);
        // Loose pants hang straight: the calf shape fades out.
        const base = this.shinRadius(t);
        const r = o.loose ? lerp(base, this.s.shin[1][1], o.loose) : base;
        return r + d + (o.flare ? o.flare(t) : 0);
      },
      // Calf at the back.
      bump: (u, a) => {
        const t = lerp(t0, t1, u);
        return (o.loose ? 0 : 0.008 * bell(t, 0.25, 0.25) * bell(angDist(a, deg(270)), 0, deg(60))) + (o.bump ? o.bump(t, a) : 0);
      },
      sx: () => 0.92,
      ts: mergeTs([0, 0.12, 0.3, 0.55, ANKLE_T, 0.8, 1], t0, t1, o.ts),
      segments: o.segments ?? 8,
      a0: Math.PI / 2,
      region: o.region ?? ((u) => (lerp(t0, t1, u) > ANKLE_T ? sideName('ankle', side) : sideName('shin', side))),
      weights: (u) => segment(sideName('shin', side), sideName('thigh', side), sideName('foot', side), 0.12)(lerp(t0, t1, u)),
      paint: typeof paint === 'function' ? (u, a) => paint(lerp(t0, t1, u), a) : paint,
      shade: o.shade ? (u, a) => o.shade!(lerp(t0, t1, u), a) : undefined,
      ao: o.ao ? (u, a) => o.ao!(lerp(t0, t1, u), a) : undefined,
      build: () => 0.12,
      capStart: o.capStart,
      capEnd: o.capEnd,
      rimStart: o.rimStart,
      rimEnd: o.rimEnd,
    });
  }

  /**
   * The foot along -Z (heel to toes), 7-sided with a flat bottom. `d` inflates it (shoes), `lift` raises the
   * toe (shoe tips), `len`/`w` scale it.
   */
  foot(side: Side, d: number, o: { paint?: Paint | ((t: number, a: number) => Paint); len?: number; w?: number; top?: number; lift?: number; y?: number; ts?: readonly number[]; region?: RegionName; shade?: (t: number, a: number) => number; capStart?: number } = {}) {
    const f = this.s.foot;
    const x = side * this.j.legX;
    const len = (o.len ?? 1) * f.len + d * 2;
    const heelZ = 0.06 + d;
    const baseY = o.y ?? 0;
    // Sections along the foot: t, half width, height, toe lift (m).
    const lift = o.lift ?? 0.004;
    const sec: Table = [
      [0, 0.62, 0.62, 0],
      [0.14, 0.86, 1.0, 0],
      [0.3, 0.92, 1.0, 0],
      [0.55, 1.0, 0.72, 0],
      [0.78, 1.04, 0.5, 0],
      [0.93, 0.9, 0.36, lift],
      [1, 0.62, 0.26, lift * 1.8],
    ];
    const H = (o.top ?? 0.085) + d;
    const W = (o.w ?? 1) * f.w + d;
    const paint = o.paint;
    this.b.tube({
      from: new THREE.Vector3(x, baseY, heelZ),
      to: new THREE.Vector3(x, baseY, heelZ - len),
      radius: () => 1,
      // A 7-sided section with a flat sole: points at angles around the foot axis (a = 0 at the side).
      sx: (t) => W * sampleTable(sec, t, 1),
      sz: (t) => H * sampleTable(sec, t, 2),
      // Depth axis is +Y here: the lower half of the section collapses onto the axis, a flat sole.
      side: new THREE.Vector3(1, 0, 0),
      section: (a) => (Math.sin(a) < -1e-6 ? 0 : 1),
      shift: (t) => sampleTable(sec, t, 3),
      ts: o.ts ?? [0, 0.14, 0.3, 0.55, 0.78, 0.93, 1],
      segments: 8,
      a0: 0,
      region: o.region ?? sideName('foot', side),
      weights: (t) => (t < 0.2 ? [[sideName('foot', side), 0.7 + t * 1.5], [sideName('shin', side), 0.3 - t * 1.5]] : [[sideName('foot', side), 1]]),
      paint: typeof paint === 'function' ? paint : paint,
      shade: o.shade,
      build: () => 0.05,
      capStart: o.capStart ?? 0.5,
      capEnd: 0.4,
    } satisfies TubeOptions);
  }
}

// --- Hands ------------------------------------------------------------------------------------------------------

interface FingerSpec {
  /** Position across the knuckles (−1 index side … +1 pinky side). */
  across: number;
  len: number;
  /** Relaxed curl (total, radians) and spread. */
  curl: number;
  spread: number;
}

const FINGERS: FingerSpec[] = [
  { across: -0.75, len: 0.92, curl: deg(46), spread: deg(-4) },
  { across: -0.25, len: 1.0, curl: deg(58), spread: deg(0) },
  { across: 0.25, len: 0.94, curl: deg(70), spread: deg(3) },
  { across: 0.75, len: 0.76, curl: deg(82), spread: deg(7) },
];
/** Far LOD: two fingers of double width (index + middle, ring + pinky). */
const FINGERS_FAR: (FingerSpec & { width: number })[] = [
  { across: -0.5, len: 0.96, curl: deg(52), spread: deg(-2), width: 1.9 },
  { across: 0.5, len: 0.86, curl: deg(76), spread: deg(5), width: 1.9 },
];

/**
 * A hand in the hand bone's frame (x along the fingers, y = back of the hand, z = pinky side), then placed
 * at the wrist: palm with a slightly arched back, knuckles marked with an edge, 4 fingers of 2 segments
 * curled like a staircase (index least, pinky most), a thumb with its own volume. The closed fist is a morph
 * target ("punho_L"/"punho_R") of the same vertices.
 */
export function buildHand(b: FacetBuilder, s: BodyShape, side: Side, wrist: THREE.Vector3, paint: Paint) {
  const h = s.hand;
  const hand = sideName('hand', side);
  const fore = sideName('forearm', side);
  const morphName = sideName('punho', side);
  // Hand frame → character: x along the arm (±X), y up (back of the hand faces up in T-pose), z: thumb
  // forward (-Z) for both hands, so pinky toward +Z.
  const toWorld = (v: THREE.Vector3) => new THREE.Vector3(wrist.x + side * v.x, wrist.y + v.y, wrist.z + v.z);
  const W = (x: number): Weights => (x < 0.02 ? [[hand, 0.7], [fore, 0.3]] : [[hand, 1]]);
  const mirror = side < 0;
  const addTri = (a: number, bb: number, c: number, p: Paint, shade = 0) => (mirror ? b.tri(a, c, bb, p, hand, shade) : b.tri(a, bb, c, p, hand, shade));
  const addQuad = (a: number, bb: number, c: number, d: number, p: Paint, shade = 0) => {
    addTri(a, bb, c, p, shade);
    addTri(a, c, d, p, shade);
  };
  const vert = (relaxed: THREE.Vector3, fist: THREE.Vector3, ao = 0) => {
    const p = toWorld(relaxed);
    const q = toWorld(fist);
    return b.vertex(p, W(relaxed.x), ao, { [morphName]: q.sub(p), gordo: new THREE.Vector3(), magro: new THREE.Vector3() });
  };
  const same = (v: THREE.Vector3, ao = 0) => vert(v, v, ao);

  // Palm: two hexagonal rings (wrist, knuckles). Order around: back-thumb, back-mid (arch), back-pinky,
  // palm-pinky, palm-mid, palm-thumb (counter-clockwise seen from the fingers when mirrored right).
  const ring = (x: number, w: number, t: number, arch: number) => [
    new THREE.Vector3(x, t * 0.5, -w * 0.5),
    new THREE.Vector3(x, t * 0.5 + arch, 0),
    new THREE.Vector3(x, t * 0.5, w * 0.5),
    new THREE.Vector3(x, -t * 0.5, w * 0.46),
    new THREE.Vector3(x, -t * 0.62, 0),
    new THREE.Vector3(x, -t * 0.5, -w * 0.46),
  ];
  const wristRing = ring(-0.01, h.palmW * 0.74, h.palmT * 1.05, 0.004).map((v) => same(v));
  const midRing = ring(h.palmLen * 0.55, h.palmW * 0.96, h.palmT, 0.006).map((v) => same(v));
  const knuckles = ring(h.palmLen, h.palmW, h.palmT * 0.82, 0.004).map((v) => same(v, 0.04));
  const rings = [wristRing, midRing, knuckles];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < 6; i++) {
      const i1 = (i + 1) % 6;
      addQuad(rings[r][i], rings[r][i1], rings[r + 1][i1], rings[r + 1][i], paint);
    }
  }
  // Knuckle end cap (behind the fingers).
  addTri(knuckles[0], knuckles[1], knuckles[2], paint);
  addTri(knuckles[0], knuckles[2], knuckles[3], paint);
  addTri(knuckles[0], knuckles[3], knuckles[5], paint);
  addTri(knuckles[3], knuckles[4], knuckles[5], paint);

  // Fingers: square sections, 2 segments, tapering, a knuckle edge on top (far LODs: 1 segment; the farthest
  // also merges them two by two).
  const segs = b.lod >= 1 ? [0, 2] : [0, 1, 2];
  for (const f of b.lod >= 2 ? FINGERS_FAR : FINGERS) {
    const fw = h.fingerW * ('width' in f ? (f.width as number) : 1);
    const baseZ = f.across * h.palmW * 0.42;
    const len = h.finger * f.len;
    const frames = (curl1: number, curl2: number) => {
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(h.palmLen - 0.004, 0.001, baseZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -f.spread, -curl1 * 0.5)),
        new THREE.Vector3(1, 1, 1),
      );
      const mid = base.clone().multiply(new THREE.Matrix4().makeTranslation(len * 0.55, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-curl1 * 0.5 - curl2 * 0.2));
      const tip = mid.clone().multiply(new THREE.Matrix4().makeTranslation(len * 0.45, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-curl2 * 0.25));
      return [base, mid, tip];
    };
    const relaxed = frames(f.curl, f.curl);
    const fist = frames(deg(95), deg(110));
    const sq = (m: THREE.Matrix4, k: number, top: number) =>
      [
        new THREE.Vector3(0, fw * 0.5 * k + top, -fw * 0.5 * k),
        new THREE.Vector3(0, fw * 0.5 * k + top, fw * 0.5 * k),
        new THREE.Vector3(0, -fw * 0.45 * k, fw * 0.5 * k),
        new THREE.Vector3(0, -fw * 0.45 * k, -fw * 0.5 * k),
      ].map((v) => v.applyMatrix4(m));
    const sizes: [number, number][] = [
      [1, 0.002],
      [0.92, 0.0015],
      [0.8, 0],
    ];
    const ringsF = segs.map((k) => {
      const a = sq(relaxed[k], sizes[k][0], sizes[k][1]);
      const c = sq(fist[k], sizes[k][0], sizes[k][1]);
      return a.map((v, i) => vert(v, c[i], k === 0 ? 0.12 : 0));
    });
    for (let r = 0; r < ringsF.length - 1; r++) {
      for (let i = 0; i < 4; i++) {
        const i1 = (i + 1) % 4;
        addQuad(ringsF[r][i], ringsF[r + 1][i], ringsF[r + 1][i1], ringsF[r][i1], paint);
      }
    }
    // Tip: a short pyramid.
    const tipR = new THREE.Vector3(fw * 0.35, -fw * 0.05, 0).applyMatrix4(relaxed[2]);
    const tipF = new THREE.Vector3(fw * 0.35, -fw * 0.05, 0).applyMatrix4(fist[2]);
    const tip = vert(tipR, tipF);
    const last = ringsF[ringsF.length - 1];
    for (let i = 0; i < 4; i++) addTri(last[i], tip, last[(i + 1) % 4], paint);
  }

  // Thumb: own volume at the base (thenar), 2 segments pointing forward and out, folding over the fist.
  const thumbFrames = (fold: number) => {
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(h.palmLen * 0.28, -h.palmT * 0.18, -h.palmW * 0.42),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(-35) - fold * 0.3, deg(26) - fold * 0.5, deg(-28) - fold * 0.6, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const mid = base.clone().multiply(new THREE.Matrix4().makeTranslation(h.finger * 0.46, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-deg(18) - fold * 0.6));
    const tip = mid.clone().multiply(new THREE.Matrix4().makeTranslation(h.finger * 0.38, 0, 0));
    return [base, mid, tip];
  };
  const tr = thumbFrames(0);
  const tf = thumbFrames(1);
  const tw = h.fingerW * 1.18;
  const tsq = (m: THREE.Matrix4, k: number) =>
    [
      new THREE.Vector3(0, tw * 0.5 * k, -tw * 0.5 * k),
      new THREE.Vector3(0, tw * 0.5 * k, tw * 0.5 * k),
      new THREE.Vector3(0, -tw * 0.5 * k, tw * 0.5 * k),
      new THREE.Vector3(0, -tw * 0.5 * k, -tw * 0.5 * k),
    ].map((v) => v.applyMatrix4(m));
  const thumbRings = segs.map((r) => {
    const k = [1.35, 1, 0.82][r];
    const a = tsq(tr[r], k);
    const c = tsq(tf[r], k);
    return a.map((v, i) => vert(v, c[i], r === 0 ? 0.1 : 0));
  });
  for (let r = 0; r < thumbRings.length - 1; r++) {
    for (let i = 0; i < 4; i++) {
      const i1 = (i + 1) % 4;
      addQuad(thumbRings[r][i], thumbRings[r + 1][i], thumbRings[r + 1][i1], thumbRings[r][i1], paint);
    }
  }
  const ttip = vert(new THREE.Vector3(tw * 0.4, 0, 0).applyMatrix4(tr[2]), new THREE.Vector3(tw * 0.4, 0, 0).applyMatrix4(tf[2]));
  const thumbEnd = thumbRings[thumbRings.length - 1];
  for (let i = 0; i < 4; i++) addTri(thumbEnd[i], ttip, thumbEnd[(i + 1) % 4], paint);
  // Base of the thumb closed against the palm.
  addQuad(thumbRings[0][3], thumbRings[0][2], thumbRings[0][1], thumbRings[0][0], paint);
}

// --- Face ------------------------------------------------------------------------------------------------------

/** Everything the body's face is built from: the eye style and the face's features. */
export type FaceLook = Face & { eyes: EyeStyle };

/**
 * Eye shapes (fractions of the eye width/height, u toward the outer corner): the white's outline, convex, from
 * the inner corner over the top to the outer corner (the first 4 points: the lid follows them), then under.
 * Every style is at least as wide as the eye (style guide: eyes readable at 15 m).
 */
const EYE_OUTLINES: Record<EyeStyle, [number, number][]> = {
  // Wider and taller: a soft hexagon.
  redondo: [[-0.5, 0], [-0.3, 0.55], [0.3, 0.55], [0.5, 0.05], [0.3, -0.5], [-0.3, -0.5]],
  // Pointed corners, the outer one up.
  amendoado: [[-0.55, -0.05], [-0.2, 0.5], [0.3, 0.45], [0.58, 0.18], [0.25, -0.42], [-0.25, -0.42]],
  // Narrow, heavy lid.
  marcante: [[-0.55, -0.02], [-0.25, 0.36], [0.35, 0.34], [0.58, 0.12], [0.25, -0.36], [-0.3, -0.34]],
  // Downturned: the lid and the outer corner slope down.
  caido: [[-0.54, 0.04], [-0.24, 0.5], [0.28, 0.42], [0.56, -0.1], [0.3, -0.42], [-0.28, -0.44]],
  // Upturned and narrow: the outer corner high, a low lid.
  puxado: [[-0.56, -0.1], [-0.22, 0.32], [0.3, 0.4], [0.62, 0.32], [0.3, -0.26], [-0.3, -0.36]],
  // Big and open.
  grande: [[-0.56, 0], [-0.33, 0.62], [0.33, 0.62], [0.58, 0.04], [0.34, -0.56], [-0.34, -0.56]],
};

/** Per eye style: lid thickness (fraction of the eye height), iris half width, brow tilt at the inner end (m). */
const EYE_DETAIL: Record<EyeStyle, { lid: number; iris: number; tilt: number }> = {
  redondo: { lid: 0.24, iris: 0.2, tilt: 0.001 },
  amendoado: { lid: 0.24, iris: 0.2, tilt: 0.003 },
  marcante: { lid: 0.36, iris: 0.2, tilt: -0.005 },
  caido: { lid: 0.3, iris: 0.2, tilt: 0.004 },
  puxado: { lid: 0.3, iris: 0.19, tilt: -0.002 },
  grande: { lid: 0.22, iris: 0.23, tilt: 0.002 },
};

/**
 * Brows: thickness (× the body's), the arch's height and where it peaks (0 inner … 1 outer), the outer end's
 * height and thickness (× the inner one), and how much lower the whole brow sits (m).
 */
const BROWS: Record<BrowStyle, { thick: number; arch: number; peak: number; outer: number; taper: number; lower: number }> = {
  reta: { thick: 1, arch: 0.003, peak: 0.5, outer: -0.002, taper: 0.7, lower: 0 },
  arqueada: { thick: 0.9, arch: 0.0068, peak: 0.62, outer: -0.004, taper: 0.55, lower: -0.001 },
  grossa: { thick: 1.5, arch: 0.002, peak: 0.45, outer: -0.002, taper: 0.85, lower: 0.0015 },
  fina: { thick: 0.62, arch: 0.0045, peak: 0.6, outer: -0.002, taper: 0.6, lower: -0.001 },
};

/**
 * Noses: the tip's height offset and how far it stands out (× the body's), the underside (height under the tip,
 * how far out as a fraction of the tip), the bridge's half width, a hump (+) or a dip (−) on the ridge, the
 * wings' half width and how far they stand out. The masks over the face clear the biggest (headwear.ts).
 */
const NOSES: Record<NoseStyle, { tipDy: number; out: number; under: number; underOut: number; bridge: number; hump: number; wing: number; wingOut: number }> = {
  reto: { tipDy: 0, out: 1, under: 0.009, underOut: 0.4, bridge: 0.008, hump: 0, wing: 0.016, wingOut: 0.007 },
  largo: { tipDy: 0.001, out: 0.95, under: 0.009, underOut: 0.42, bridge: 0.011, hump: 0, wing: 0.023, wingOut: 0.009 },
  // Hooked: a hump on the bridge, the tip lower and turned down.
  aquilino: { tipDy: -0.004, out: 1.04, under: 0.006, underOut: 0.55, bridge: 0.009, hump: 0.0045, wing: 0.016, wingOut: 0.007 },
  // Upturned: shorter, the tip up, the nostrils facing a little forward.
  arrebitado: { tipDy: 0.004, out: 0.82, under: 0.008, underOut: 0.62, bridge: 0.007, hump: -0.002, wing: 0.015, wingOut: 0.007 },
};

/** Mouths: width, upper and lower lip heights (× the body's), and how far the lips stand out (m). */
const MOUTHS: Record<MouthStyle, { w: number; up: number; down: number; out: number }> = {
  media: { w: 1, up: 1, down: 1, out: 0 },
  fina: { w: 1.02, up: 0.5, down: 0.55, out: -0.0004 },
  carnuda: { w: 1.08, up: 1.75, down: 1.7, out: 0.002 },
};

/** Ears: size, how far the back edge stands out from the head, and how far the whole ear stands off it (m). */
const EARS: Record<EarStyle, { size: number; out: number; flare: number }> = {
  normal: { size: 1, out: 0.022, flare: 0 },
  pequena: { size: 0.8, out: 0.016, flare: 0 },
  abano: { size: 1.04, out: 0.034, flare: 0.003 },
};

/**
 * Face features as painted faces of the model (style guide): each eye is 3 faces (off-white, iris in the eye
 * color, a highlight) plus a dark lid line; brows are thick quads 20% darker than the hair; the nose has a
 * bridge and a tip as distinct planes and a darker underside; the mouth is a dark line between two lips;
 * ears have a helix rim and a concha; marks are painted faces just over the skin. Every face is oriented
 * outward automatically. Built on the face shape's head (`headShape` inside `withFace`).
 */
function buildFace(b: FacetBuilder, s: BodyShape, look: FaceLook) {
  const h = headShape(s.sex);
  const fem = s.sex === 'f';
  const eyeY = 1.672;
  const center = new THREE.Vector3(0, 1.66, 0);
  /** Point on the faceted face at horizontal position x (+X = the character's right) and height y. */
  const onFace = (x: number, y: number, d: number) => h.meshPoint(y, Math.PI / 2 + Math.asin(THREE.MathUtils.clamp(x / 0.082, -0.95, 0.95)), d);
  const face = (pts: THREE.Vector3[], paint: Paint, shade = 0) => {
    const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length);
    b.poly(pts, HEAD_W, 'head', paint, { facing: c.sub(center), shade });
  };
  const lerpChain = (chain: [number, number][], u: number) => {
    if (u <= chain[0][0]) return chain[0][1];
    for (let i = 1; i < chain.length; i++) if (u <= chain[i][0]) return lerp(chain[i - 1][1], chain[i][1], (u - chain[i - 1][0]) / (chain[i][0] - chain[i - 1][0]));
    return chain[chain.length - 1][1];
  };
  const outline = EYE_OUTLINES[look.eyes];
  const ed = EYE_DETAIL[look.eyes];
  // Over the top (inner corner → outer corner) and under it (inner → outer).
  const upper = outline.slice(0, 4);
  const lower = [outline[0], outline[5], outline[4], outline[3]];
  const brow = BROWS[look.sobrancelhas];
  const browT = (fem ? 0.0078 : 0.0105) * brow.thick;
  for (const side of [-1, 1] as Side[]) {
    const ex = side * s.eye.x;
    // u grows toward the outer corner on both sides.
    const eyePt = (u: number, v: number, d: number) => onFace(ex + side * u * s.eye.w, eyeY + v * s.eye.h * 2, d);
    face(outline.map(([u, v]) => eyePt(u, v, 0.0032)), fixed('eyeWhite'));
    // Iris (the eye color channel) a little toward the nose, as tall as the opening, and a highlight.
    const iu = -0.06;
    const iw = ed.iris;
    const iTop = Math.min(0.42, lerpChain(upper, iu));
    const iBot = Math.max(-0.36, lerpChain(lower, iu) + 0.06);
    face([eyePt(iu - iw, iBot, 0.004), eyePt(iu + iw, iBot, 0.004), eyePt(iu + iw, iTop, 0.004), eyePt(iu - iw, iTop, 0.004)], EYES);
    face([eyePt(iu - 0.12, iTop * 0.12, 0.0047), eyePt(iu + 0.02, iTop * 0.12, 0.0047), eyePt(iu - 0.06, iTop * 0.83, 0.0047)], fixed('highlight'));
    // Upper lid: a dark band along the top edge (reads at distance), a flick at the outer corner on the
    // feminine face.
    const flick = (i: number) => (fem && i === 3 ? 0.18 : 0);
    for (let i = 0; i < 3; i++) {
      const [u0, v0] = upper[i];
      const [u1, v1] = upper[i + 1];
      const a0 = i === 0 ? u0 - 0.03 : u0;
      const a1 = i === 2 ? u1 + 0.04 : u1;
      face([eyePt(a0, v0 - 0.02, 0.0044), eyePt(a1, v1 - 0.02, 0.0044), eyePt(a1, v1 + ed.lid + flick(i + 1), 0.0044), eyePt(a0, v0 + ed.lid + flick(i), 0.0044)], fixed('pupil'));
    }
    // Brow: thick quads 20% darker than the hair, inner end → peak → outer end; its tilt from the eye style.
    const by = eyeY + s.eye.h * 1.25 + 0.011 - brow.lower;
    const xi = side * 0.011;
    const xo = side * (s.eye.x + s.eye.w * 0.62);
    const xm = lerp(xi, xo, brow.peak);
    const bd = 0.0045;
    const yi = by + ed.tilt;
    const ym = by + brow.arch;
    const yo = by + brow.outer;
    const paint = tinted(TINT.hair, 3);
    face([onFace(xi, yi, bd), onFace(xm, ym, bd), onFace(xm, ym + browT, bd), onFace(xi, yi + browT * 0.92, bd)], paint);
    face([onFace(xm, ym, bd), onFace(xo, yo, bd), onFace(xo, yo + browT * brow.taper, bd), onFace(xm, ym + browT, bd)], paint);
    if (look.marcas === 'cicatriz' && side < 0) {
      // A slit through the left brow (skin over it).
      const xs = lerp(xm, xo, 0.3);
      face([onFace(xs - 0.002, ym - 0.002, bd + 0.0006), onFace(xs + 0.0012, ym - 0.002, bd + 0.0006), onFace(xs + 0.0032, ym + browT + 0.002, bd + 0.0006), onFace(xs, ym + browT + 0.002, bd + 0.0006)], SKIN);
    }
  }

  // Nose: bridge and tip as distinct planes (a ridge point between them: a hump or a dip), wings, a darker
  // underside; the back sits inside the face.
  const nose = NOSES[look.nariz];
  const tipY = (fem ? 1.622 : 1.617) + nose.tipDy;
  const tipOut = (fem ? 0.017 : 0.025) * nose.out;
  const v = (p: THREE.Vector3) => b.vertex(p, HEAD_W, 0);
  const iTop = v(onFace(0, 1.668, -0.001));
  const iTip = v(onFace(0, tipY, tipOut));
  const ridgeK = 0.45;
  const iRidge = v(onFace(0, lerp(1.668, tipY, ridgeK), lerp(-0.001, tipOut, ridgeK) + nose.hump));
  const iUnder = v(onFace(0, tipY - nose.under, tipOut * nose.underOut));
  const bw = nose.bridge;
  const bOut = 0.005 + Math.max(0, nose.hump) * 0.6;
  const iBl = v(onFace(-bw, 1.652, bOut));
  const iBr = v(onFace(bw, 1.652, bOut));
  const iWl = v(onFace(-nose.wing, tipY - 0.004, nose.wingOut));
  const iWr = v(onFace(nose.wing, tipY - 0.004, nose.wingOut));
  const iWlIn = v(onFace(-nose.wing - 0.002, tipY - 0.006, -0.004));
  const iWrIn = v(onFace(nose.wing + 0.002, tipY - 0.006, -0.004));
  const iBlIn = v(onFace(-bw - 0.004, 1.656, -0.004));
  const iBrIn = v(onFace(bw + 0.004, 1.656, -0.004));
  const inside = onFace(0, 1.64, -0.012);
  const tri = (a: number, c: number, d: number, p: Paint, shade = 0) => b.triAway(a, c, d, inside, p, 'head', shade);
  tri(iTop, iBl, iRidge, SKIN);
  tri(iTop, iBr, iRidge, SKIN);
  tri(iRidge, iBl, iTip, SKIN);
  tri(iRidge, iBr, iTip, SKIN);
  tri(iBl, iWl, iTip, darker(SKIN, 1));
  tri(iBr, iWr, iTip, darker(SKIN, 1));
  tri(iBl, iBlIn, iWl, darker(SKIN, 1));
  tri(iBlIn, iWlIn, iWl, darker(SKIN, 1));
  tri(iBr, iBrIn, iWr, darker(SKIN, 1));
  tri(iBrIn, iWrIn, iWr, darker(SKIN, 1));
  tri(iTop, iBlIn, iBl, darker(SKIN, 1));
  tri(iTop, iBrIn, iBr, darker(SKIN, 1));
  // Underside: nostrils, darker (the shadow under the nose is a face).
  tri(iTip, iWl, iUnder, darker(SKIN, 3), -1);
  tri(iTip, iWr, iUnder, darker(SKIN, 3), -1);
  tri(iWl, iWlIn, iUnder, darker(SKIN, 4), -1);
  tri(iWr, iWrIn, iUnder, darker(SKIN, 4), -1);

  // Mouth: upper lip (darker), the line, the lower lip (catches the light).
  const m = MOUTHS[look.boca];
  const mouthY = fem ? 1.587 : 1.584;
  const mw = (fem ? 0.021 : 0.022) * m.w;
  const lipUp = (fem ? 0.0055 : 0.0045) * m.up;
  const lipDown = (fem ? 0.007 : 0.0055) * m.down;
  const row = (y: number, d: number, k = 1) => [onFace(-mw * k, y, d), onFace(-mw * 0.4, y, d + 0.0006), onFace(0, y, d + 0.0008), onFace(mw * 0.4, y, d + 0.0006), onFace(mw * k, y, d)];
  const upperTop = row(mouthY + lipUp, 0.0026 + m.out * 0.4, 0.86);
  const lineTop = row(mouthY + 0.0012, 0.0036 + m.out);
  const lineBottom = row(mouthY - 0.0012, 0.0036 + m.out);
  const lowerBottom = row(mouthY - lipDown, 0.0026 + m.out * 0.5, 0.82);
  const strip = (a: THREE.Vector3[], c: THREE.Vector3[], p: Paint) => {
    for (let i = 0; i < a.length - 1; i++) face([a[i], a[i + 1], c[i + 1], c[i]], p);
  };
  strip(lineTop, upperTop, darker(SKIN, fem ? 4 : 3));
  strip(lineBottom, lineTop, fixed('mouth'));
  strip(lowerBottom, lineBottom, darker(SKIN, fem ? 3 : 1));

  // Ears: the helix rim standing out at the back, the concha dipping in (2 planes), the root inside the head.
  const ear = EARS[look.orelhas];
  for (const side of [-1, 1] as Side[]) {
    // a = 180° is +X (the character's right) on the head surface; a little behind the side.
    const a = side > 0 ? deg(186) : deg(-6);
    const cy = 1.648;
    const hgt = (fem ? 0.05 : 0.056) * ear.size;
    const wid = 0.03 * ear.size;
    const around = [
      [0, 0.5],
      [0.45, 0.38],
      [0.55, 0],
      [0.35, -0.42],
      [0, -0.5],
      [-0.35, -0.2],
      [-0.3, 0.3],
    ];
    const base = h.point(cy, a);
    const n = h.normal(cy, a);
    const up = new THREE.Vector3(0, 1, 0);
    // "back" points to +Z (behind the face) along the head's side.
    const back = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize();
    const pt = (u: number, vv: number, out: number) => base.clone().addScaledVector(back, u * wid).addScaledVector(up, vv * hgt).addScaledVector(n, out);
    const rim = around.map(([u, vv]) => v(pt(u, vv, 0.004 + ear.flare + Math.max(0, u) * ear.out)));
    const inner = around.map(([u, vv]) => v(pt(u * 0.55, vv * 0.6, 0.004 + ear.flare * 0.6 + Math.max(0, u) * ear.out * 0.45)));
    const root = around.map(([u, vv]) => v(pt(u * 0.8, vv * 0.8, -0.006)));
    const mid = v(pt(0.02, 0, 0.001));
    const inHead = base.clone().addScaledVector(n, -0.03);
    const k = around.length;
    const et = (x: number, y: number, z: number, p: Paint, shade = 0) => b.triAway(x, y, z, inHead, p, 'head', shade);
    for (let i = 0; i < k; i++) {
      const i1 = (i + 1) % k;
      et(rim[i], inner[i], rim[i1], SKIN);
      et(rim[i1], inner[i], inner[i1], SKIN);
      et(inner[i], mid, inner[i1], darker(SKIN, 3), -0.6);
      et(root[i], rim[i], root[i1], darker(SKIN, 1));
      et(root[i1], rim[i], rim[i1], darker(SKIN, 1));
    }
  }

  // Marks: painted faces just over the skin.
  const dot = (x: number, y: number, r: number, paint: Paint, sides = 4, rot = 0) =>
    face(
      Array.from({ length: sides }, (_, i) => {
        const t = rot + (i / sides) * Math.PI * 2;
        return onFace(x + Math.cos(t) * r, y + Math.sin(t) * r, 0.0016);
      }),
      paint,
    );
  if (look.marcas === 'sardas') {
    // Freckles across the nose and the cheeks (LOD0 only: a few millimeters each).
    b.detail(() => {
      const spots: [number, number][] = [[0.024, 1.646], [0.034, 1.64], [0.045, 1.645], [0.029, 1.632], [0.04, 1.63], [0.051, 1.636], [0.02, 1.638], [0.036, 1.651]];
      for (const side of [-1, 1]) spots.forEach(([x, y], i) => dot(side * (x + (side > 0 ? 0.002 : 0)), y + (i % 2 ? 0.001 : -0.001) * side, 0.0022, darker(SKIN, 4), 4, i * 0.7));
      for (const x of [-0.007, 0.006]) dot(x, 1.645, 0.0019, darker(SKIN, 4), 4, 0.4);
    });
  } else if (look.marcas === 'cicatriz') {
    // A scar down the left cheek: a slightly zigzag line, darker, with a lighter edge.
    b.detail(() => {
      const path: [number, number][] = [[-0.06, 1.66], [-0.05, 1.643], [-0.043, 1.628], [-0.034, 1.61]];
      for (let i = 0; i < path.length - 1; i++) {
        const [x0, y0] = path[i];
        const [x1, y1] = path[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const nx = (-(y1 - y0) / len) * 0.002;
        const ny = ((x1 - x0) / len) * 0.002;
        face([onFace(x0 - nx, y0 - ny, 0.0016), onFace(x1 - nx, y1 - ny, 0.0016), onFace(x1 + nx, y1 + ny, 0.0016), onFace(x0 + nx, y0 + ny, 0.0016)], darker(SKIN, 4), -0.5);
      }
    }, 1);
  } else if (look.marcas === 'pinta') {
    // A beauty mark over the right corner of the mouth.
    b.detail(() => dot(0.027, mouthY + 0.014, 0.0028, darker(SKIN, 6), 6), 1);
  }
}

// --- Body -------------------------------------------------------------------------------------------------------

/** Occlusion of the body's crevices: armpits, crotch, under the jaw, the neck's base. */
function bodyOcclusion(s: BodyShape) {
  const j = joints(s.sex);
  return (p: THREE.Vector3) => {
    const ax = Math.abs(p.x);
    let ao = 0;
    // Armpits: where the upper arm meets the torso, underneath.
    ao += 0.2 * bell(ax, j.shoulder - 0.035, 0.05) * bell(p.y, j.armY - 0.07, 0.05) * (p.y < j.armY ? 1 : 0.3);
    // Crotch and inner thighs.
    ao += 0.16 * bell(ax, 0.0, 0.07) * bell(p.y, 0.85, 0.06);
    // Under the jaw and the neck's front.
    ao += 0.14 * bell(p.y, 1.535, 0.03) * (p.z < 0.02 ? 1 : 0) * bell(ax, 0, 0.06);
    // Between the buttocks.
    ao += 0.1 * bell(ax, 0, 0.03) * bell(p.y, 0.9, 0.06) * (p.z > 0 ? 1 : 0);
    return ao;
  };
}

export interface BodyGeometry {
  skin: THREE.BufferGeometry;
}

const bodyCache = new Map<string, BodyGeometry>();

/** A face look from an eye style alone (the other features at their defaults) or from a partial one. */
export function faceLook(look: EyeStyle | Partial<FaceLook> = {}): FaceLook {
  const l = typeof look === 'string' ? { eyes: look } : look;
  // Unknown values (an old config, a typo in the lab) fall back to the defaults: the face always builds.
  return { ...sanitizeFace({ ...DEFAULT_FACE, ...l }), eyes: EYE_STYLES.includes(l.eyes as EyeStyle) ? (l.eyes as EyeStyle) : 'redondo' };
}

/**
 * The base body with a face (cached by face and level of detail: 0 full; 1, 2 the far ones). The face shape is
 * built into the head here; the pieces over it get it as morphs (`withFaceMorphs`).
 */
export function buildBody(sex: Sex, look: EyeStyle | Partial<FaceLook> = {}, lod = 0): BodyGeometry {
  const f = faceLook(look);
  const key = `${sex}|${f.eyes}|${f.formato}|${f.sobrancelhas}|${f.nariz}|${f.boca}|${f.orelhas}|${f.marcas}|${lod}`;
  let geo = bodyCache.get(key);
  if (geo) {
    // Most recently used last (the eviction below drops the oldest).
    bodyCache.delete(key);
    bodyCache.set(key, geo);
    return geo;
  }
  geo = withLod(lod, () => withFace(f.formato, () => makeBody(sex, f)));
  bodyCache.set(key, geo);
  // Every face combination is a body: keep the most recent ones only (browsing the editor would grow it
  // forever). Evicted geometries aren't disposed: a live character may still use one.
  while (bodyCache.size > BODY_CACHE_MAX) bodyCache.delete(bodyCache.keys().next().value!);
  return geo;
}

/** Bodies kept in the cache (each ~0.7 MB; a 32-player match needs at most 32 × 3 levels). */
const BODY_CACHE_MAX = 120;

function makeBody(sex: Sex, look: FaceLook): BodyGeometry {
  const s = SHAPES[sex];
  const b = new FacetBuilder(sex === 'f' ? 11 : 3);
  const p = new BodyParts(b, s);
  const j = p.j;
  p.torso(Y_TORSO0, Y_TORSO1, 0, { paint: SKIN, capStart: 0.3 });
  p.neck(1.43, 1.575, 0, { paint: SKIN });
  // Head (far LOD: every other row).
  const h = p.head;
  const rows = b.lod >= 2 ? h.rows.filter((_, r) => r % 2 === 0 || r === h.rows.length - 1) : h.rows;
  const zero = new THREE.Vector3();
  const grid = rows.map((y) => Array.from({ length: HEAD_SEGMENTS }, (_, i) => b.vertex(h.point(y, h.angle(i)), HEAD_W, 0, { gordo: zero, magro: zero })));
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < HEAD_SEGMENTS; i++) {
      const i1 = (i + 1) % HEAD_SEGMENTS;
      b.quad(grid[r][i], grid[r + 1][i], grid[r + 1][i1], grid[r][i1], SKIN, 'head');
    }
  }
  const crown = b.vertex(new THREE.Vector3(0, h.y1, 0.012), HEAD_W, 0);
  const lastRow = grid[grid.length - 1];
  for (let i = 0; i < HEAD_SEGMENTS; i++) b.tri(lastRow[i], crown, lastRow[(i + 1) % HEAD_SEGMENTS], SKIN, 'head');
  // Under the chin: close the first row.
  const chinC = b.vertex(h.point(rows[0] - 0.004, Math.PI / 2, -0.012), HEAD_W, 0.1);
  for (let i = 0; i < HEAD_SEGMENTS; i++) b.tri(grid[0][(i + 1) % HEAD_SEGMENTS], chinC, grid[0][i], SKIN, 'head', -1);
  // The face's features: gone at the far LOD (a few pixels there).
  if (b.lod < 2) buildFace(b, s, look);

  // Arms: deltoid over the shoulder joint, upper arm, forearm, hand.
  for (const side of [-1, 1] as Side[]) {
    p.deltoid(side, 0, SKIN);
    p.upperArm(side, 0, 1, 0, { paint: SKIN });
    p.forearm(side, 0, 1, 0, { paint: SKIN, capEnd: 0.3 });
    buildHand(b, s, side, new THREE.Vector3(side * j.wrist, j.armY, 0), SKIN);
    p.thigh(side, 0, 1, 0, { paint: SKIN });
    p.shin(side, 0, 1, 0, { paint: SKIN });
    p.foot(side, 0, { paint: SKIN });
  }
  b.occlude(bodyOcclusion(s));
  return { skin: b.build() };
}

export { HEAD_W, REGION };
