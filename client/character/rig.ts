// Canonical character rig: bone names, rest pose (T-pose, every bone with zero rotation), body regions and
// sockets. The procedural body and every procedural piece are skinned to this skeleton; GLB bodies and
// pieces must use the same bone names (docs/PERSONAGENS.md) so pieces can be rebound by name.
//
// Proportions (style guide): 1.80 m, 7 heads of 0.257 m; crotch at 3.5 heads (0.90 m); shoulders 2 heads
// wide on the masculine body and 1.6 on the feminine one, 5% wider than real for presence; shoulders at
// their real height (not dropped), so the posture reads open.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';

/** Bone name → [parent, rest position relative to the parent (m)]. Feet at y = 0, facing -Z. */
export const BONES = {
  root: [null, [0, 0, 0]],
  hips: ['root', [0, 0.95, 0]],
  spine: ['hips', [0, 0.12, 0]],
  chest: ['spine', [0, 0.18, 0]],
  neck: ['chest', [0, 0.22, 0]],
  head: ['neck', [0, 0.09, 0]],
  shoulder_L: ['chest', [-0.05, 0.17, 0]],
  upperArm_L: ['shoulder_L', [-0.14, 0, 0]],
  forearm_L: ['upperArm_L', [-0.29, 0, 0]],
  hand_L: ['forearm_L', [-0.26, 0, 0]],
  shoulder_R: ['chest', [0.05, 0.17, 0]],
  upperArm_R: ['shoulder_R', [0.14, 0, 0]],
  forearm_R: ['upperArm_R', [0.29, 0, 0]],
  hand_R: ['forearm_R', [0.26, 0, 0]],
  thigh_L: ['hips', [-0.095, -0.03, 0]],
  shin_L: ['thigh_L', [0, -0.42, 0]],
  foot_L: ['shin_L', [0, -0.42, 0]],
  thigh_R: ['hips', [0.095, -0.03, 0]],
  shin_R: ['thigh_R', [0, -0.42, 0]],
  foot_R: ['shin_R', [0, -0.42, 0]],
} as const satisfies Record<string, readonly [string | null, readonly [number, number, number]]>;

export type BoneName = keyof typeof BONES;
export const BONE_NAMES = Object.keys(BONES) as BoneName[];
export const boneIndex = (name: BoneName) => BONE_NAMES.indexOf(name);

/** The feminine body: same bones, narrower shoulders and slightly shorter arms. */
const FEMININE: Partial<Record<BoneName, readonly [number, number, number]>> = {
  upperArm_L: [-0.115, 0, 0],
  upperArm_R: [0.115, 0, 0],
  forearm_L: [-0.28, 0, 0],
  forearm_R: [0.28, 0, 0],
  hand_L: [-0.25, 0, 0],
  hand_R: [0.25, 0, 0],
  thigh_L: [-0.092, -0.03, 0],
  thigh_R: [0.092, -0.03, 0],
};

/** Rest offset of a bone from its parent, for a body. */
export function boneOffset(name: BoneName, sex: Sex = 'm'): readonly [number, number, number] {
  return (sex === 'f' ? FEMININE[name] : undefined) ?? (BONES[name][1] as readonly [number, number, number]);
}

/** Rest (T-pose) position of a bone in character space. */
export function restPosition(name: BoneName, sex: Sex = 'm', out = new THREE.Vector3()): THREE.Vector3 {
  out.set(0, 0, 0);
  let b: BoneName | null = name;
  while (b) {
    const p = boneOffset(b, sex);
    out.x += p[0];
    out.y += p[1];
    out.z += p[2];
    b = BONES[b][0] as BoneName | null;
  }
  return out;
}

/**
 * Body regions: every skinned vertex (body and pieces) carries one in its `_region` attribute, and a
 * character hides regions with a bit mask (under clothes, or missing in PCD mode).
 */
export const REGION = {
  head: 0,
  neck: 1,
  chest: 2,
  belly: 3,
  pelvis: 4,
  upperArm_L: 5,
  forearm_L: 6,
  hand_L: 7,
  upperArm_R: 8,
  forearm_R: 9,
  hand_R: 10,
  thigh_L: 11,
  shin_L: 12,
  foot_L: 13,
  thigh_R: 14,
  shin_R: 15,
  foot_R: 16,
  /** Hair that a hat covers (the top); hidden when a hat is worn. */
  hairTop: 17,
  /** Lower shin (where boots go over the pants' hem). */
  ankle_L: 18,
  ankle_R: 19,
  /** Facial hair (a mask or a full helmet hides it). */
  beard: 20,
  /** The rest of the hair (a balaclava or a hood hides it). */
  hair: 21,
  /** Hair hanging down the back below the nape (a backpack worn over it hides it). */
  hairBack: 22,
  /** Never hidden. */
  none: 31,
} as const;
export type RegionName = keyof typeof REGION;
export const regionBits = (names: readonly RegionName[]) => names.reduce((m, n) => m | (1 << REGION[n]), 0);

/** Where rigid items attach: a bone and an offset from it. */
export const SOCKETS = {
  head: { bone: 'head', pos: [0, 0, 0] },
  back: { bone: 'chest', pos: [0.06, 0.1, 0.13] },
  hand_R: { bone: 'hand_R', pos: [0.055, -0.01, 0] },
  hand_L: { bone: 'hand_L', pos: [-0.055, -0.01, 0] },
  wrist_L: { bone: 'forearm_L', pos: [-0.235, 0, 0] },
  wrist_R: { bone: 'forearm_R', pos: [0.235, 0, 0] },
} as const satisfies Record<string, { bone: BoneName; pos: readonly [number, number, number] }>;
export type SocketName = keyof typeof SOCKETS;

/** Builds the canonical skeleton in rest pose. Inverses are computed with the root at the origin. */
export function createCanonicalSkeleton(sex: Sex = 'm'): { root: THREE.Bone; bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones = BONE_NAMES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...(boneOffset(name, sex) as [number, number, number]));
    return b;
  });
  BONE_NAMES.forEach((name, i) => {
    const parent = BONES[name][0];
    if (parent) bones[boneIndex(parent as BoneName)].add(bones[i]);
  });
  const root = bones[0];
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new THREE.Skeleton(bones) };
}
