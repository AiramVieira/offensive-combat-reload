// Character hitboxes (style guide, "Hitboxes"): 15 simple shapes attached to the bones, the same for every
// body and never the visual mesh, so no clothes, hair or hat give an advantage or a disadvantage. Poses
// change them (crouching, aiming, reloading move the bones), clothes never do. Shapes are given in the
// bone's own space of the canonical rig (bones have no rotation at rest, so bone space = model axes).
//
// | Zone            | Shape                  | Bone               | Multiplier (weapon data) |
// | head            | sphere, 12 cm × 1.12   | head               | 2.5× |
// | neck            | short capsule          | neck               | 1.5× |
// | chest           | horizontal capsule     | chest              | 1.0× |
// | abdomen         | horizontal capsule     | spine              | 1.0× |
// | hips            | horizontal capsule     | hips               | 0.9× |
// | arms            | a capsule per segment  | upperArm, forearm  | 0.75× |
// | hands           | small sphere           | hand               | 0.5× |
// | thighs          | capsule                | thigh              | 0.75× |
// | shins and feet  | capsule                | shin               | 0.6× |
import * as THREE from 'three';
import type { BodyStats } from '@shared/appearance';
import type { HitRegion } from '@shared/weapons';
import type { BoneName } from '../character/rig';

export type Missing = BodyStats['missing'];

export const NOTHING_MISSING: Missing = { armL: false, armR: false, handL: false, handR: false, legL: false, legR: false };

/** One shape: a sphere (`a` only) or a capsule from `a` to `b`, in the bone's space. */
export interface ZoneDef {
  region: HitRegion;
  bone: BoneName;
  r: number;
  a: readonly [number, number, number];
  b?: readonly [number, number, number];
}

/** The head is 10–15% bigger than the visual one: shots that graze it count (style guide). */
const HEAD_GROW = 1.12;

function zonesOfSide(s: -1 | 1): ZoneDef[] {
  const n = s < 0 ? 'L' : 'R';
  return [
    { region: 'bracos', bone: `upperArm_${n}`, r: 0.058, a: [s * 0.03, -0.004, 0], b: [s * 0.27, 0, 0] },
    { region: 'bracos', bone: `forearm_${n}`, r: 0.048, a: [s * 0.01, 0, 0], b: [s * 0.245, 0, 0] },
    { region: 'maos', bone: `hand_${n}`, r: 0.065, a: [s * 0.085, -0.01, -0.01] },
    { region: 'coxas', bone: `thigh_${n}`, r: 0.085, a: [0, -0.03, 0], b: [0, -0.4, -0.005] },
    { region: 'canelas', bone: `shin_${n}`, r: 0.062, a: [0, -0.03, 0], b: [0, -0.4, -0.045] },
  ];
}

/** The 15 shapes of a complete body. */
export const ZONES: readonly ZoneDef[] = [
  { region: 'cabeca', bone: 'head', r: 0.12 * HEAD_GROW, a: [0, 0.105, -0.01] },
  { region: 'pescoco', bone: 'neck', r: 0.058, a: [0, 0, 0.005], b: [0, 0.06, -0.005] },
  { region: 'peito', bone: 'chest', r: 0.125, a: [-0.085, 0.095, 0], b: [0.085, 0.095, 0] },
  { region: 'abdomen', bone: 'spine', r: 0.115, a: [-0.065, 0.06, 0.005], b: [0.065, 0.06, 0.005] },
  { region: 'quadril', bone: 'hips', r: 0.115, a: [-0.075, -0.02, 0.005], b: [0.075, -0.02, 0.005] },
  ...zonesOfSide(-1),
  ...zonesOfSide(1),
];

/**
 * The shapes of a body in PCD mode: a missing arm takes its arm and hand away, a missing hand only the hand,
 * a missing leg leaves the stump of the thigh.
 */
export function zonesFor(m: Missing): ZoneDef[] {
  const out: ZoneDef[] = [];
  for (const z of ZONES) {
    const side = z.bone.endsWith('_L') ? 'L' : z.bone.endsWith('_R') ? 'R' : null;
    if (!side) {
      out.push(z);
      continue;
    }
    const arm = side === 'L' ? m.armL : m.armR;
    const hand = side === 'L' ? m.handL : m.handR;
    const leg = side === 'L' ? m.legL : m.legR;
    if (arm && (z.bone.startsWith('upperArm') || z.bone.startsWith('forearm'))) continue;
    if (hand && z.bone.startsWith('hand')) continue;
    if (leg && z.bone.startsWith('shin')) continue;
    if (leg && z.bone.startsWith('thigh')) {
      out.push({ ...z, b: [0, -0.13, 0] });
      continue;
    }
    out.push(z);
  }
  return out;
}

/**
 * Groin zone, in the hips bone's space (the front of the pelvis): a hips, abdomen or thigh hit that lands
 * inside it is reclassified as 'virilha' ("No pássaro!"). It moves with the pose (crouching, sliding).
 */
export const GROIN = { min: new THREE.Vector3(-0.09, -0.17, -0.2), max: new THREE.Vector3(0.09, -0.03, 0.01) };
export const GROIN_FROM: ReadonlySet<HitRegion> = new Set(['quadril', 'abdomen', 'coxas']);

export function isBehind(point: THREE.Vector3, feet: THREE.Vector3, yaw: number): boolean {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return fx * (point.x - feet.x) + fz * (point.z - feet.z) < 0;
}
