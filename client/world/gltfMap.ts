// Loads maps and props authored in Blender (glTF 2.0 .glb) using the naming conventions from section 10.
// Full reference for level designers: docs/MAPAS.md.
//
//   COL_*          collision only, never rendered. Suffix _BOX = box, _CONVEX = convex hull, else triangle mesh
//   SPAWN_A_* / SPAWN_B_* / SPAWN_FFA_*   spawn markers (empties); facing = the empty's rotation
//   DUMMY_*        training dummy spot
//   KILLVOLUME     falling below this object's height kills
//   GAG_*          environmental gag trigger (e.g. GAG_LATIDO), wired up by the map code
//   MAT_<surface>  material name → shared library surface (tijolo, madeira, telhado...), tinted by the
//                  material's base color and textured in world meters (no UV unwrap needed)
//   any other material with its own texture is kept (UVs from Blender), converted to toon shading
//   NOCOL in a mesh name, or custom property nocol = true → no collision
//   custom property fisica = "wood" | "metal" | ... → physics/sound material override
//
// If a file has any COL_ object, only COL_ objects collide; otherwise every visible mesh gets a
// triangle-mesh collider (handy for quick blockouts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonGradient } from '../render/materials';
import { boxProjectUVs, type MapBuilder } from './mapBuilder';
import { isSurfaceKey, SURFACES, surfaceMaterial } from './surfaces';
import type { SurfaceMaterial } from './physics';
import type { DummySpot, GameMap, SpawnPoint } from './blockoutMap';
import { PropBus } from './props';

export interface GltfMarkers {
  spawnsA: SpawnPoint[];
  spawnsB: SpawnPoint[];
  spawnsFFA: SpawnPoint[];
  dummies: DummySpot[];
  gags: { name: string; position: THREE.Vector3 }[];
  killY: number | null;
}

let loader: GLTFLoader | null = null;

export function gltfLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
  }
  return loader;
}

const PHYSICS = new Set<SurfaceMaterial>(['grass', 'concrete', 'wood', 'metal', 'glass', 'tile', 'paper']);
const converted = new Map<THREE.Material, THREE.Material>();

/** "MAT_tijolo.001" → "tijolo" (Blender appends .001 to duplicated material names). */
function surfaceName(mat: THREE.Material): string | null {
  const m = /^MAT_([a-z_]+?)(\.\d+)?$/i.exec(mat.name ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** Keeps a Blender material's own texture and color but renders it with the game's toon ramp. */
function toToon(src: THREE.Material): THREE.Material {
  let out = converted.get(src);
  if (!out) {
    const s = src as THREE.MeshStandardMaterial;
    const toon = new THREE.MeshToonMaterial({
      name: s.name,
      color: 0xffffff,
      map: s.map ?? null,
      gradientMap: toonGradient(),
      vertexColors: true,
      transparent: s.transparent,
      alphaTest: s.alphaTest,
      side: s.side,
    });
    // The per-vertex tint carries the base color so batched meshes can share this material.
    out = toon;
    converted.set(src, out);
  }
  return out;
}

function physicsOf(obj: THREE.Object3D, mat: THREE.Material | null): SurfaceMaterial {
  const fromProp = obj.userData?.fisica;
  if (typeof fromProp === 'string' && PHYSICS.has(fromProp as SurfaceMaterial)) return fromProp as SurfaceMaterial;
  const key = mat ? surfaceName(mat) : null;
  return key && isSurfaceKey(key) ? SURFACES[key].physics : 'concrete';
}

function yawOf(obj: THREE.Object3D): number {
  const q = new THREE.Quaternion();
  obj.getWorldQuaternion(q);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

/**
 * Adds a loaded glTF scene to the map: batches visible meshes, creates colliders, and returns markers.
 * `placement` positions the whole file (props placed by map code); omit it for full maps.
 */
export function addGltfToMap(gltf: GLTF, builder: MapBuilder, placement?: { position: THREE.Vector3; yaw?: number; scale?: number }): GltfMarkers {
  const root = new THREE.Group();
  root.add(gltf.scene);
  if (placement) {
    root.position.copy(placement.position);
    root.rotation.y = placement.yaw ?? 0;
    root.scale.setScalar(placement.scale ?? 1);
  }
  root.updateMatrixWorld(true);

  const markers: GltfMarkers = { spawnsA: [], spawnsB: [], spawnsFFA: [], dummies: [], gags: [], killY: null };
  const meshes: THREE.Mesh[] = [];
  const colliders: THREE.Mesh[] = [];

  root.traverse((obj) => {
    const name = obj.name ?? '';
    const pos = obj.getWorldPosition(new THREE.Vector3());
    if (/^SPAWN_(A|B|FFA)/i.test(name)) {
      const team = name.slice(6).split('_')[0].toUpperCase();
      const list = team === 'A' ? markers.spawnsA : team === 'B' ? markers.spawnsB : markers.spawnsFFA;
      list.push({ position: pos, yaw: yawOf(obj) });
      return;
    }
    if (/^DUMMY/i.test(name)) {
      const u = obj.userData ?? {};
      const patrol = u.eixo === 'x' || u.eixo === 'z' ? { axis: u.eixo as 'x' | 'z', amplitude: Number(u.amplitude ?? 2), speed: Number(u.velocidade ?? 1) } : undefined;
      markers.dummies.push({ position: pos, yaw: yawOf(obj), patrol });
      return;
    }
    if (/^KILLVOLUME/i.test(name)) {
      markers.killY = pos.y;
      return;
    }
    if (/^GAG_/i.test(name)) {
      markers.gags.push({ name: name.slice(4).toUpperCase(), position: pos });
      return;
    }
    if (!(obj as THREE.Mesh).isMesh) return;
    if (/^COL_/i.test(name) || /^COL_/i.test(obj.parent?.name ?? '')) colliders.push(obj as THREE.Mesh);
    else meshes.push(obj as THREE.Mesh);
  });

  const explicitCollision = colliders.length > 0;

  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const world = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // Multi-material meshes: split by group so each part batches with its own material.
    const parts = mesh.geometry.groups.length > 1 && Array.isArray(mesh.material)
      ? mesh.geometry.groups.map((gr) => ({ geo: subGeometry(world, gr.start, gr.count), mat: mats[gr.materialIndex ?? 0] }))
      : [{ geo: world, mat: mats[0] }];
    for (const { geo, mat } of parts) {
      const key = surfaceName(mat);
      const tint = (mat as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff);
      if (key && isSurfaceKey(key) && !mesh.userData?.uv_proprio) {
        builder.addGeometry(boxProjectUVs(geo), surfaceMaterial(key), tint);
      } else {
        builder.addGeometry(geo, toToon(mat), tint);
      }
      const nocol = /NOCOL/i.test(mesh.name) || mesh.userData?.nocol === true;
      if (!explicitCollision && !nocol) builder.trimeshCollider(geo, physicsOf(mesh, mat));
    }
  }

  for (const col of colliders) {
    const phys = physicsOf(col, Array.isArray(col.material) ? col.material[0] : col.material);
    if (/_BOX/i.test(col.name)) {
      // Oriented box from the mesh's local bounds and world transform.
      col.geometry.computeBoundingBox();
      const bb = col.geometry.boundingBox!;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      col.matrixWorld.decompose(p, q, s);
      const localCenter = bb.getCenter(new THREE.Vector3());
      const center = localCenter.applyMatrix4(col.matrixWorld);
      const half = bb.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
      builder.cuboidCollider(center, half, q, phys);
    } else {
      const geo = col.geometry.clone().applyMatrix4(col.matrixWorld);
      if (/_CONVEX/i.test(col.name)) builder.convexCollider(new Float32Array(geo.getAttribute('position').array), phys);
      else builder.trimeshCollider(geo, phys);
    }
  }
  return markers;
}

function subGeometry(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const g = src.clone();
  if (g.index) g.setIndex(Array.from(g.index.array.slice(start, start + count)));
  g.clearGroups();
  return g;
}

/**
 * Builds a whole map from one .glb (open with ?mapa=/maps/arquivo.glb). Everything comes from the file:
 * geometry, collision, SPAWN_A/SPAWN_B spawns, DUMMY_ spots and KILLVOLUME.
 */
export async function buildGltfMap(url: string, builder: MapBuilder, renderer: THREE.WebGLRenderer): Promise<GameMapLike> {
  const gltf = await gltfLoader(renderer).loadAsync(url);
  const m = addGltfToMap(gltf, builder);
  builder.finish();
  const spawnsA = m.spawnsA.length ? m.spawnsA : m.spawnsFFA;
  if (!spawnsA.length) throw new Error(`${url}: nenhum SPAWN_A_* ou SPAWN_FFA_* encontrado`);
  return {
    spawnsA,
    spawnsB: m.spawnsB.length ? m.spawnsB : spawnsA,
    spawnsFFA: m.spawnsFFA.length ? m.spawnsFFA : [...spawnsA, ...m.spawnsB],
    dummies: m.dummies,
    killY: m.killY ?? -20,
    stats: builder.stats,
    openings: builder.openings,
    props: new PropBus(),
    update() {},
    dog: null,
  };
}

export type GameMapLike = GameMap;
