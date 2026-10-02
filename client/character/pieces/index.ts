// Procedural stand-ins for the GLB assets: every piece of the catalog, skinned to the canonical rig, faceted,
// with the same attributes a Blender export would have (builder.ts). Pieces are built over the body they
// dress (body.ts), so they fit every body and deform with it.
import type * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import { BodyParts, SHAPES, sideName, type Side } from '../body';
import { FacetBuilder } from '../builder';
import type { Paint } from '../palette';
import { REGION } from '../rig';
import { ACCESSORY_GENERATORS } from './accessories';
import { bottom } from './bottoms';
import { facialHair, hair } from './hair';
import { HEADWEAR_GENERATORS } from './headwear';
import { JACKET_GENERATORS } from './jackets';
import { bracelet, glasses, hat, rifle } from './rigid';
import { shoes } from './shoes';
import { TACTICAL_GENERATORS } from './tactical';
import { top } from './tops';

export interface PieceGeometry {
  /** Skinned parts (canonical bone order). */
  skinned?: THREE.BufferGeometry;
  /** Rigid parts, in the socket's space. */
  rigid?: THREE.BufferGeometry;
  /** Render both sides (skirts). */
  doubleSided?: boolean;
}

/** A procedural generator: the piece `id` for a body (`flat`: the version under a hat, for hair). */
export type Generator = (id: string, sex: Sex, flat: boolean) => PieceGeometry;

/** Generators by name (the registry's `generator`); each module of the catalog adds its own. */
const GENERATORS: Record<string, Generator> = {
  top: (id, sex) => top(id, sex),
  bottom: (id, sex) => bottom(id, sex),
  shoes: (id, sex) => shoes(id, sex),
  hair: (id, sex, flat) => hair(id, sex, flat),
  beard: (id, sex) => facialHair(id, sex),
  hat: (id, sex) => hat(id, sex),
  glasses: (id, sex) => glasses(id, sex),
  bracelet: (id) => bracelet(id),
  rifle: () => rifle(),
  ...JACKET_GENERATORS,
  ...HEADWEAR_GENERATORS,
  ...ACCESSORY_GENERATORS,
  ...TACTICAL_GENERATORS,
};

/** Builds a procedural piece by generator name (see registry.ts). */
export function buildPiece(generator: string, id: string, sex: Sex, flat = false): PieceGeometry {
  const g = GENERATORS[generator];
  if (!g) throw new Error(`gerador desconhecido: ${generator}`);
  return g(id, sex, flat);
}

/**
 * PCD stumps: a rounded end where a limb is missing (skinned to the bone above, painted like whatever covers
 * that spot). `where`: shoulder, wrist or thigh.
 */
export function buildStump(where: 'shoulder' | 'wrist' | 'thigh', side: Side, sex: Sex, d: number, paint: Paint): THREE.BufferGeometry {
  const b = new FacetBuilder(5);
  const p = new BodyParts(b, SHAPES[sex]);
  if (where === 'shoulder') {
    p.upperArm(side, 0, 0.22, d, { paint, capEnd: 0.5 });
  } else if (where === 'wrist') {
    p.forearm(side, 0.88, 1, d, { paint, capEnd: 0.45, region: sideName('forearm', side) });
  } else {
    p.thigh(side, 0, 0.32, d, { paint, capEnd: 0.45 });
  }
  // The stump stands where the limb's region is hidden: it must never be hidden itself.
  const g = b.build();
  (g.getAttribute('_region') as THREE.BufferAttribute).array.fill(REGION.none);
  return g;
}
