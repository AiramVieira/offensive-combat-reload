import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 3-tone ramp: cheap cartoon shading that matches the art direction (section 2).
let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();
/** Cached flat toon material for props and characters (map surfaces use world/surfaces.ts). */
export function toon(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation } = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      emissive: opts.emissive ?? 0x000000,
    });
    cache.set(key, m);
  }
  return m;
}

export interface ColoredPart {
  geo: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/** Bakes primitives into one vertex-colored geometry: one draw call per character instead of one per part. */
export function mergeColoredParts(parts: ColoredPart[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.deleteAttribute('uv');
    q.setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...p.pos), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    const c = new THREE.Color(p.color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return merged;
}

export const PALETTE = {
  grass: 0x7cc750,
  asphalt: 0x6d7078,
  sidewalk: 0xc9c4b8,
  brick: 0xc8663d,
  house: 0xf1e3c2,
  houseAlt: 0xbfe0e8,
  houseAlt2: 0xf4c7d0,
  floor: 0xb99a74,
  roof: 0x8e4b3a,
  wood: 0xb07a45,
  concrete: 0xa9a9a4,
  poolTile: 0x7fd3e6,
  metal: 0x8c96a3,
  teamA: 0xff7a1a,
  teamB: 0x2f9bff,
  truck: 0xffd1e8,
  truckTrim: 0xff4f9a,
  carRed: 0xe0463c,
  carYellow: 0xf2c230,
  carGreen: 0x3fae6a,
  glass: 0x9fd8ff,
  foliage: 0x4fa83a,
  trunk: 0x7a5230,
  flamingo: 0xff6fb5,
  skin: 0xf2b58f,
  sleeve: 0x55733a,
} as const;
