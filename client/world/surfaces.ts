// Surface library: every static surface in a map is one of these keys. Each key owns ONE material shared
// by the whole map (hue comes from a per-vertex tint), a physics/sound material, and a texture that tiles
// every `metros` meters. Maps built in code use the keys directly; glTF maps reference them with Blender
// material names like "MAT_tijolo". See docs/MAPAS.md.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { toonGradient } from '../render/materials';
import { PAINTERS, paintTexture } from './textures';
import type { SurfaceMaterial } from './physics';

export interface SurfaceDef {
  /** Physics/sound material (footsteps, impacts, bullet penetration). */
  physics: SurfaceMaterial;
  /** Meters covered by one repeat of the texture. */
  metros: number;
  /** Procedural painter used until a real texture is provided; null = flat color. */
  painter: keyof typeof PAINTERS | null;
}

export const SURFACES = {
  grama: { physics: 'grass', metros: 2.5, painter: 'grama' },
  asfalto: { physics: 'concrete', metros: 3, painter: 'asfalto' },
  calcada: { physics: 'concrete', metros: 2, painter: 'calcada' },
  concreto: { physics: 'concrete', metros: 2, painter: 'concreto' },
  tijolo: { physics: 'concrete', metros: 1.6, painter: 'tijolo' },
  reboco: { physics: 'concrete', metros: 1.8, painter: 'reboco' },
  madeira: { physics: 'wood', metros: 1.2, painter: 'madeira' },
  piso: { physics: 'wood', metros: 1.8, painter: 'piso' },
  telhado: { physics: 'wood', metros: 1.2, painter: 'telhado' },
  azulejo: { physics: 'tile', metros: 1, painter: 'azulejo' },
  metal: { physics: 'metal', metros: 2, painter: 'metal' },
  vidro: { physics: 'glass', metros: 2, painter: 'vidro' },
  /** Shoji: rice paper on a wooden lattice. Thin panels are shot through (physics "paper"). */
  papel: { physics: 'paper', metros: 1.8, painter: 'papel' },
  /** Garden flagstones, irregular courses (paths and terraces). */
  pedra: { physics: 'concrete', metros: 2.4, painter: 'pedra' },
  /** Car paint: vehicles UV it in their own meters (v = height), see world/vehicles.ts. */
  lataria: { physics: 'metal', metros: 2, painter: 'lataria' },
  /** Flat paint: team colors, stripes, small props. */
  pintura: { physics: 'concrete', metros: 1, painter: null },
} as const satisfies Record<string, SurfaceDef>;

export type SurfaceKey = keyof typeof SURFACES;

export const isSurfaceKey = (k: string): k is SurfaceKey => k in SURFACES;

const materials = new Map<SurfaceKey, THREE.MeshToonMaterial>();

/** Shared material for a surface. Its texture expects UVs in meters (repeat = 1 / metros). */
export function surfaceMaterial(key: SurfaceKey): THREE.MeshToonMaterial {
  let m = materials.get(key);
  if (!m) {
    const def: SurfaceDef = SURFACES[key];
    m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
    m.name = `MAT_${key}`;
    if (def.painter) m.map = withRepeat(paintTexture(def.painter, PAINTERS[def.painter]), def.metros);
    materials.set(key, m);
  }
  return m;
}

function withRepeat(tex: THREE.Texture, metros: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metros, 1 / metros);
  t.needsUpdate = true;
  return t;
}

interface ManifestEntry {
  /** File name inside public/textures (.png, .jpg, .webp or .ktx2). */
  arquivo: string;
  /** Optional override of the tile size in meters. */
  metros?: number;
  /**
   * false = the file already has its final colors: ignore the map's per-piece tints for this surface.
   * Default true (tints multiply the texture, which is how the grayscale placeholders get their hue).
   */
  tingir?: boolean;
}

/**
 * Replaces procedural textures with real files listed in public/textures/manifest.json, e.g.
 * { "tijolo": { "arquivo": "tijolo.ktx2", "metros": 1.6 } }. Missing files keep the placeholder.
 */
export async function loadTextureOverrides(renderer: THREE.WebGLRenderer): Promise<string[]> {
  let manifest: Record<string, ManifestEntry>;
  try {
    const res = await fetch('/textures/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = await res.json();
  } catch {
    return [];
  }
  const image = new THREE.TextureLoader();
  let ktx2: KTX2Loader | null = null;
  const applied: string[] = [];
  await Promise.all(
    Object.entries(manifest).map(async ([key, entry]) => {
      if (key.startsWith('_') || !isSurfaceKey(key) || !entry?.arquivo) return;
      const url = `/textures/${entry.arquivo}`;
      try {
        let tex: THREE.Texture;
        if (entry.arquivo.endsWith('.ktx2')) {
          ktx2 ??= new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
          tex = await ktx2.loadAsync(url);
        } else {
          tex = await image.loadAsync(url);
          tex.colorSpace = THREE.SRGBColorSpace;
        }
        tex.anisotropy = 8;
        const m = surfaceMaterial(key);
        m.map?.dispose();
        m.map = withRepeat(tex, entry.metros ?? SURFACES[key].metros);
        if (entry.tingir === false) m.vertexColors = false;
        m.needsUpdate = true;
        applied.push(key);
      } catch (err) {
        console.warn(`[texturas] não foi possível carregar ${url}:`, err);
      }
    }),
  );
  return applied;
}
