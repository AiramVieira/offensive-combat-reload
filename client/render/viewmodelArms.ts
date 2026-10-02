// First-person arms (style guide: the viewmodel arms are a model of their own and can carry more detail,
// they fill a third of the screen all the time): the character's own forearm and hand, faceted, built from
// the body (character/body.ts) with the fingers closed by the fist morph, the skin tint and the sleeve of
// what is worn (long sleeves cover the forearm with a cuff; short ones leave it bare), and the gloves (the
// same model as in third person: full gloves replace the hand, fingerless ones leave the fingers' skin).
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import { BodyParts, buildHand, SHAPES, type Side } from '../character/body';
import { FacetBuilder } from '../character/builder';
import { paintedMaterial } from '../character/material';
import { darker, DETAIL, PRIMARY, SECONDARY, SKIN } from '../character/palette';
import { buildGlove, FULL_GLOVES } from '../character/pieces/accessories';

export interface ArmOptions {
  /** Long sleeve color (null = bare forearm). */
  sleeve: string | null;
  skin: string;
  /** How closed the hand is (0 relaxed … 1 fist). */
  grip: number;
  /** Draw the hand (PCD: a missing hand leaves the forearm). */
  hand: boolean;
  /** Gloves worn (catalog id and its colors: primary, secondary), or none. */
  glove?: { id: string; colors: readonly string[] } | null;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Forearm + hand in the arm's own space: the wrist at the origin, the forearm going back along +Z (the elbow
 * at +Z), the fingers forward (-Z), the back of the hand up (+Y); the thumb is on the inner side.
 */
function armGeometry(sex: Sex, side: Side, long: boolean, grip: number, hand: boolean, glove: string | null): THREE.BufferGeometry {
  const key = `${sex}|${side}|${long}|${grip.toFixed(2)}|${hand}|${glove}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const s = SHAPES[sex];
  const b = new FacetBuilder(side < 0 ? 61 : 67);
  const p = new BodyParts(b, s);
  const j = p.j;
  p.forearm(side, 0, 1, 0, { paint: SKIN, capStart: 0.5, capEnd: hand ? undefined : 0.45 });
  if (long) p.forearm(side, 0, 0.88, 0.009, { paint: PRIMARY, capStart: 0.5, rimEnd: { h: 0.028, out: 0.006, paint: darker(PRIMARY, 1) } });
  // Full gloves replace the hand; the glove's colors are the material's secondary and detail channels.
  if (hand && !(glove && FULL_GLOVES.has(glove))) buildHand(b, s, side, new THREE.Vector3(side * j.wrist, j.armY, 0), SKIN);
  if (hand && glove) buildGlove(b, s, side, glove, { p: SECONDARY, s: DETAIL });
  const g = b.build();
  // Close the hand: the fist morph baked into the positions.
  const morphs = g.morphAttributes.position ?? [];
  const fist = morphs.find((m) => m.name === `punho_${side < 0 ? 'L' : 'R'}`);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (fist) for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + fist.getX(i) * grip, pos.getY(i) + fist.getY(i) * grip, pos.getZ(i) + fist.getZ(i) * grip);
  g.morphAttributes = {};
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  // T-pose (the arm along ±X) → arm space (the arm along -Z), wrist at the origin.
  g.translate(-side * j.wrist, -j.armY, 0);
  g.rotateY(side * (Math.PI / 2));
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

/** A first-person arm mesh; place it with `placeArm`. */
export function armMesh(sex: Sex, side: Side, o: ArmOptions): THREE.Mesh {
  const g = o.glove ?? null;
  const channels = { primary: o.sleeve ?? o.skin, secondary: g?.colors[0] ?? o.skin, detail: g?.colors[1] ?? g?.colors[0] ?? o.skin };
  const m = new THREE.Mesh(armGeometry(sex, side, !!o.sleeve, o.grip, o.hand, g?.id ?? null), paintedMaterial({}, channels, { skin: o.skin }));
  m.frustumCulled = false;
  return m;
}

const FWD = new THREE.Vector3(0, 0, -1);

/**
 * Puts an arm with its wrist at `wrist`, the forearm coming from `elbow`, rolled by `roll` around the
 * forearm (0 = back of the hand up).
 */
export function placeArm(arm: THREE.Object3D, elbow: THREE.Vector3, wrist: THREE.Vector3, roll: number) {
  const dir = new THREE.Vector3().subVectors(wrist, elbow).normalize();
  arm.position.copy(wrist);
  arm.quaternion.setFromUnitVectors(FWD, dir).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, -roll));
}
