// Character material (style guide, "Configuração no Three.js"): MeshStandardMaterial with flat shading
// (normals per face), roughness 0.85, metalness 0, the palette atlas as the map (nearest, no mipmaps) and
// vertex colors as ambient occlusion. Patched with onBeforeCompile:
// - tints: each face carries `_tint`; tinted faces sample the neutral row of the atlas (a gray gradient) and
//   multiply it by the player's color for that channel, so the gradient and the occlusion stay and only the
//   hue changes;
// - hidden regions: every vertex carries a body region (`_region`) and a bit mask discards the hidden ones
//   (skin under clothes, a missing limb in PCD mode).
// Baked characters (Character.bake) use one shared material with the final colors in the vertex colors.
import * as THREE from 'three';
import { paletteAtlas, TINT, TINT_COUNT } from './palette';

export interface Channels {
  primary: THREE.ColorRepresentation;
  secondary: THREE.ColorRepresentation;
  detail: THREE.ColorRepresentation;
}

/** Colors of the non-piece tints, shared by every piece of a character. */
export interface CharacterTints {
  skin: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  eyes: THREE.ColorRepresentation;
  team: THREE.ColorRepresentation;
}

export type PaintedMaterial = THREE.MeshStandardMaterial & {
  userData: {
    /** Colors come from the palette atlas (and the tints). */
    palette: boolean;
    uniforms: {
      uTints: { value: THREE.Color[] };
      uHidden: { value: number };
    };
  };
};

interface Options {
  /** Final colors come from the vertex colors (baked characters): no atlas, no tints. */
  baked?: boolean;
  /** A GLB piece's own texture (no palette): drawn as it is. */
  map?: THREE.Texture | null;
  color?: THREE.ColorRepresentation;
  side?: THREE.Side;
  transparent?: boolean;
}

/**
 * A character material. Live characters get one instance per piece (their tints and hidden regions are
 * uniforms); the shader program is shared by every instance with the same options.
 */
export function paintedMaterial(o: Options = {}, channels?: Channels, tints?: Partial<CharacterTints>): PaintedMaterial {
  const palette = !o.baked && !o.map;
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    map: o.baked ? null : (o.map ?? paletteAtlas()),
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
  }) as PaintedMaterial;
  const colors = Array.from({ length: TINT_COUNT }, () => new THREE.Color(1, 1, 1));
  const uniforms = { uTints: { value: colors }, uHidden: { value: 0 } };
  m.userData.uniforms = uniforms;
  m.userData.palette = palette;
  setChannels(m, channels ?? { primary: 0xffffff, secondary: 0xffffff, detail: 0xffffff });
  setTints(m, tints ?? {});
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _tint;\nattribute float _region;\nvarying float vTint;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = _tint;\nvRegion = _region;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uTints[${TINT_COUNT}];\nuniform int uHidden;\nvarying float vTint;\nvarying float vRegion;`)
      .replace(
        '#include <map_fragment>',
        palette
          ? `int region = int( vRegion + 0.5 );
if ( region < 31 && ( ( uHidden >> region ) & 1 ) == 1 ) discard;
vec4 texel = texture2D( map, vMapUv );
int tint = int( vTint + 0.5 );
// Tinted faces: the neutral cell's value times the player's color for that channel.
diffuseColor.rgb *= tint > 0 ? texel.r * uTints[ tint ] : texel.rgb;`
          : `int region = int( vRegion + 0.5 );
if ( region < 31 && ( ( uHidden >> region ) & 1 ) == 1 ) discard;
#include <map_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `char|${palette ? 'p' : o.baked ? 'b' : 't'}`;
  return m;
}

/** Updates the piece channels of a live material. */
export function setChannels(m: PaintedMaterial, c: Partial<Channels>) {
  const t = m.userData.uniforms.uTints.value;
  if (c.primary !== undefined) t[TINT.primary].set(c.primary);
  if (c.secondary !== undefined) t[TINT.secondary].set(c.secondary);
  if (c.detail !== undefined) t[TINT.detail].set(c.detail);
}

/** Updates the character tints (skin, hair, eyes, team) of a live material. */
export function setTints(m: PaintedMaterial, c: Partial<CharacterTints>) {
  const t = m.userData.uniforms.uTints.value;
  if (c.skin !== undefined) t[TINT.skin].set(c.skin);
  if (c.hair !== undefined) t[TINT.hair].set(c.hair);
  if (c.eyes !== undefined) t[TINT.eyes].set(c.eyes);
  if (c.team !== undefined) t[TINT.team].set(c.team);
}

let bakedShared: PaintedMaterial | null = null;
/** The one material every baked character shares (colors in the vertices). */
export function bakedMaterial(): PaintedMaterial {
  bakedShared ??= paintedMaterial({ baked: true });
  return bakedShared;
}
