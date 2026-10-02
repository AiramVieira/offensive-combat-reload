// Spatial sound math, kept free of Web Audio and physics so it can be tested: how loud and how muffled a sound
// is from where the listener stands (distance, air, walls in between), and how enclosed a spot is (room echo).
import type { SurfaceMaterial } from '../world/physics';

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** How a kind of sound carries: inverse-distance rolloff from `ref` meters, inaudible past `max`. */
export interface SpatialKind {
  ref: number;
  rolloff: number;
  max: number;
  /** Echo send in an enclosed spot (room) and in the open (long tail, only loud sounds). */
  room: number;
  open: number;
  /** Dropped first when too many sounds play at once (0 lowest). */
  priority: number;
}

export const SPATIAL_KINDS = {
  /** Gunshots: heard across the map. */
  gun: { ref: 6, rolloff: 0.9, max: 220, room: 0.45, open: 0.32, priority: 3 },
  /** Explosions. */
  boom: { ref: 9, rolloff: 0.7, max: 260, room: 0.5, open: 0.45, priority: 3 },
  /** Footsteps and other quiet body sounds: a few rooms away at most. */
  step: { ref: 2.5, rolloff: 1.3, max: 34, room: 0.3, open: 0, priority: 1 },
  /** Reloads, knives, impacts, grenade bounces. */
  normal: { ref: 2.5, rolloff: 1.2, max: 70, room: 0.35, open: 0, priority: 2 },
  /** Loud props: gong, dragon roar, ice cream truck. */
  loud: { ref: 6, rolloff: 1, max: 140, room: 0.4, open: 0.2, priority: 2 },
  /** Birds in the sky: soft, far, no echo. */
  ambient: { ref: 18, rolloff: 1, max: 400, room: 0, open: 0, priority: 0 },
} satisfies Record<string, SpatialKind>;

export type SpatialKindName = keyof typeof SPATIAL_KINDS;

/** Web Audio's "inverse" distance model, used to scale the echo sends like the direct sound. */
export function distanceGain(d: number, k: SpatialKind): number {
  return k.ref / (k.ref + k.rolloff * (Math.max(d, k.ref) - k.ref));
}

/** How much each material in the way blocks a sound (1 = a solid wall). */
export const OCCLUSION_WEIGHT: Record<SurfaceMaterial, number> = {
  concrete: 1,
  tile: 1,
  metal: 1,
  grass: 1,
  wood: 0.7,
  glass: 0.35,
  paper: 0.25,
};

/**
 * Gain and low-pass cutoff of a sound `d` meters away behind `occlusion` worth of walls (0 = line of sight,
 * 1 = one wall, 2 = two or a thick one). Air dulls far sounds; a wall muffles and lowers them, but never
 * silences them: you still hear the fight in the next room.
 */
export function voiceParams(d: number, occlusion: number): { gain: number; cutoff: number } {
  const air = Math.max(2500, 20000 * Math.exp(-d / 70));
  if (occlusion <= 0.01) return { gain: 1, cutoff: air };
  const occ = Math.min(occlusion, 2);
  return {
    gain: Math.max(0.2, 1 - 0.42 * occ),
    cutoff: Math.min(air, Math.max(450, 1700 / occ)),
  };
}

/** A ray cast against the static world: distance to the first hit within `max`, or null. */
export type CastFn = (origin: Vec, dir: Vec, max: number) => number | null;

const H = Math.SQRT1_2;
const AROUND: Vec[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: H, y: 0, z: H },
  { x: -H, y: 0, z: -H },
];

/**
 * How enclosed a spot is, 0 (open field) to 1 (small room): a roof overhead counts most, walls around add the
 * rest; closer walls make it more enclosed. Cached per 2 m cell since the map doesn't move.
 */
export class Enclosure {
  private cache = new Map<string, number>();

  constructor(private cast: CastFn) {}

  at(p: Vec): number {
    const key = `${Math.floor(p.x / 2)},${Math.floor(p.y / 2)},${Math.floor(p.z / 2)}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.measure({ x: Math.floor(p.x / 2) * 2 + 1, y: p.y + 0.5, z: Math.floor(p.z / 2) * 2 + 1 });
      if (this.cache.size > 4000) this.cache.clear();
      this.cache.set(key, v);
    }
    return v;
  }

  clear() {
    this.cache.clear();
  }

  private measure(o: Vec): number {
    const roof = this.cast(o, { x: 0, y: 1, z: 0 }, 14);
    const roofK = roof === null ? 0 : roof < 5 ? 1 : 0.6;
    let walls = 0;
    for (const d of AROUND) {
      const hit = this.cast(o, d, 12);
      if (hit !== null) walls += hit < 5 ? 1 : 0.6;
    }
    return Math.min(1, roofK * 0.6 + (walls / AROUND.length) * 0.4);
  }
}

/** Footstep, jump/landing, slide and reload sounds of someone else, from what their body is doing. */
export interface Walker {
  feet: Vec;
  alive: boolean;
  grounded: boolean;
  sprint: boolean;
  crouch: boolean;
  slide: boolean;
  reload: boolean;
}

export type BodySound = { kind: 'step'; loud: number } | { kind: 'land'; hard: boolean } | { kind: 'slide' } | { kind: 'reload' };

interface WalkState {
  x: number;
  z: number;
  speed: number;
  stride: number;
  air: number;
  grounded: boolean;
  slide: boolean;
  reload: boolean;
}

/** Same stride rules as the local player (entities/localPlayer.ts): crouch-walking is silent. */
export class BodySounds {
  private state = new Map<number, WalkState>();

  update(id: number, w: Walker, dt: number): BodySound[] {
    const out: BodySound[] = [];
    let s = this.state.get(id);
    if (!w.alive || dt <= 0) {
      if (!w.alive) this.state.delete(id);
      return out;
    }
    if (!s) {
      s = { x: w.feet.x, z: w.feet.z, speed: 0, stride: 0, air: 0, grounded: w.grounded, slide: w.slide, reload: w.reload };
      this.state.set(id, s);
      return out;
    }
    const moved = Math.hypot(w.feet.x - s.x, w.feet.z - s.z);
    s.x = w.feet.x;
    s.z = w.feet.z;
    // A teleport (respawn) is not a step.
    if (moved > 4) {
      s.stride = 0;
      s.speed = 0;
      return out;
    }
    s.speed = s.speed * 0.7 + (moved / dt) * 0.3;
    if (w.grounded && !s.grounded && s.air > 0.35) out.push({ kind: 'land', hard: s.air > 0.9 });
    s.air = w.grounded ? 0 : s.air + dt;
    s.grounded = w.grounded;
    if (w.slide && !s.slide) out.push({ kind: 'slide' });
    s.slide = w.slide;
    if (w.reload && !s.reload) out.push({ kind: 'reload' });
    s.reload = w.reload;
    if (w.grounded && !w.slide && s.speed > 1) {
      s.stride += moved;
      if (s.stride >= (w.sprint ? 2.6 : 2.0)) {
        s.stride = 0;
        if (!w.crouch) out.push({ kind: 'step', loud: w.sprint ? 1.3 : 0.8 });
      }
    }
    return out;
  }

  forget(id: number) {
    this.state.delete(id);
  }
}

/** What the map and its props need to play a sound from a point (implemented by audio/sfx.ts). */
export interface SpatialSfx {
  at(pos: Vec, kind: SpatialKindName, play: (s: this) => void): void;
}

/** A spot in the sky around the listener, for birds: above, 20-35 m out in a random direction. */
export function skySpot(listener: Vec): Vec {
  const a = Math.random() * Math.PI * 2;
  const r = 20 + Math.random() * 15;
  return { x: listener.x + Math.cos(a) * r, y: listener.y + 10 + Math.random() * 12, z: listener.z + Math.sin(a) * r };
}
