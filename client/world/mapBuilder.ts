// Static map construction shared by code-built blockouts and glTF maps (section 10 pipeline).
//
// Performance rules applied here:
//  - One material per surface (not per color): hue is a per-vertex tint, so 13 surfaces cover the map.
//  - Static geometry is merged per (material, 40 m cell): few draw calls, and cells outside the camera are
//    frustum-culled instead of drawing the whole map every frame.
//  - Colliders are simple shapes (cuboids, convex hulls) or triangle meshes built once at load.
//  - Stairs render as steps but collide as a smooth ramp (autostep on steps next to walls is unreliable).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_GROUPS, type Physics, type SurfaceInfo, type SurfaceMaterial } from './physics';
import { SURFACES, surfaceMaterial, type SurfaceKey } from './surfaces';

const CELL = 40;

export interface PieceOpts {
  /** Hue multiplied over the surface texture. Default white. */
  tint?: THREE.ColorRepresentation;
  rot?: THREE.Euler;
  collide?: boolean;
  /** Overrides the surface's physics material. */
  physics?: SurfaceMaterial;
  onShot?: SurfaceInfo['onShot'];
  castShadow?: boolean;
}

export type Opening = [from: number, to: number, bottom: number, top: number];

/** Trim drawn around every opening of a wall (visual only: it never narrows the hole). */
export interface FrameOpts {
  surface?: SurfaceKey;
  tint?: THREE.ColorRepresentation;
  /** Trim width (m). */
  width?: number;
}

/** A hole in a wall, in world coordinates, kept for automated structure checks. */
export interface WallOpening {
  axis: 'x' | 'z';
  fixed: number;
  thickness: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  door: boolean;
}

export const STEP_H = 0.3;
export const STEP_D = 0.38;
export const stairRun = (rise: number) => Math.ceil(rise / STEP_H) * STEP_D;

interface Batch {
  material: THREE.Material;
  castShadow: boolean;
  geos: THREE.BufferGeometry[];
}

export class MapBuilder {
  private batches = new Map<string, Batch>();
  private materialIds = new Map<THREE.Material, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);
  private box3 = new THREE.Box3();
  private center = new THREE.Vector3();
  readonly stats = { pieces: 0, colliders: 0, meshes: 0, triangles: 0 };
  readonly openings: WallOpening[] = [];

  constructor(readonly physics: Physics, readonly scene: THREE.Scene) {}

  // --- Low level --------------------------------------------------------------------------------

  /** Adds world-space geometry to the static batch of `material`, tinted per vertex. */
  addGeometry(geo: THREE.BufferGeometry, material: THREE.Material, tint: THREE.ColorRepresentation = 0xffffff, castShadow = true) {
    const g = normalize(geo, tint);
    g.computeBoundingBox();
    this.box3.copy(g.boundingBox!).getCenter(this.center);
    let id = this.materialIds.get(material);
    if (id === undefined) {
      id = this.materialIds.size;
      this.materialIds.set(material, id);
    }
    const key = `${id}|${Math.floor(this.center.x / CELL)}|${Math.floor(this.center.z / CELL)}|${castShadow ? 1 : 0}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { material, castShadow, geos: [] };
      this.batches.set(key, batch);
    }
    batch.geos.push(g);
    this.stats.pieces++;
  }

  private register(desc: RAPIER.ColliderDesc, physics: SurfaceMaterial, onShot?: SurfaceInfo['onShot']) {
    const col = this.physics.world.createCollider(desc.setCollisionGroups(WORLD_GROUPS), this.physics.staticBody);
    this.physics.surfaces.set(col.handle, { material: physics, onShot });
    this.stats.colliders++;
    return col;
  }

  cuboidCollider(center: THREE.Vector3, halfExtents: THREE.Vector3, rotation: THREE.Quaternion, physics: SurfaceMaterial, onShot?: SurfaceInfo['onShot']) {
    return this.register(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
      physics,
      onShot,
    );
  }

  ballCollider(center: THREE.Vector3, radius: number, physics: SurfaceMaterial, onShot?: SurfaceInfo['onShot']) {
    return this.register(RAPIER.ColliderDesc.ball(radius).setTranslation(center.x, center.y, center.z), physics, onShot);
  }

  convexCollider(points: Float32Array, physics: SurfaceMaterial, onShot?: SurfaceInfo['onShot']) {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    return desc ? this.register(desc, physics, onShot) : null;
  }

  /** Triangle-mesh collider from world-space geometry (arbitrary shapes from glTF). */
  trimeshCollider(geo: THREE.BufferGeometry, physics: SurfaceMaterial, onShot?: SurfaceInfo['onShot']) {
    const pos = geo.getAttribute('position');
    const vertices = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) vertices.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    const indices = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    return this.register(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES), physics, onShot);
  }

  // --- Primitives -------------------------------------------------------------------------------

  /** Box from center and full size, textured in world meters, with a matching cuboid collider. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, surface: SurfaceKey, o: PieceOpts = {}) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    this.q.setFromEuler(o.rot ?? new THREE.Euler());
    this.m.compose(new THREE.Vector3(cx, cy, cz), this.q, this.one);
    geo.applyMatrix4(this.m);
    worldUVs(geo);
    this.addGeometry(geo, surfaceMaterial(surface), o.tint, o.castShadow ?? true);
    geo.dispose();
    if (o.collide === false) return null;
    const physics = o.physics ?? SURFACES[surface].physics;
    return this.cuboidCollider(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx / 2, sy / 2, sz / 2), this.q, physics, o.onShot);
  }

  /** Box from min/max corners. */
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: SurfaceKey, o: PieceOpts = {}) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, surface, o);
  }

  /** Vertical cylinder standing on `y0` (posts, poles, hydrants), with a matching collider. */
  cylinder(cx: number, y0: number, cz: number, r: number, h: number, surface: SurfaceKey, o: PieceOpts & { radiusTop?: number; segments?: number } = {}) {
    const geo = new THREE.CylinderGeometry(o.radiusTop ?? r, r, h, o.segments ?? 12);
    geo.translate(cx, y0 + h / 2, cz);
    worldUVs(geo);
    this.addGeometry(geo, surfaceMaterial(surface), o.tint, o.castShadow ?? true);
    geo.dispose();
    if (o.collide === false) return null;
    return this.register(RAPIER.ColliderDesc.cylinder(h / 2, Math.max(r, o.radiusTop ?? r)).setTranslation(cx, y0 + h / 2, cz), o.physics ?? SURFACES[surface].physics, o.onShot);
  }

  /**
   * Wall running along X (at z = fixed) or along Z (at x = fixed) from a to b, with rectangular openings
   * [from, to, bottom, top] measured along the wall and from its base.
   *
   * The wall is cut into vertical columns at every opening edge; each column is solid everywhere except
   * the openings that cover it, and neighbouring columns with the same profile are merged. Openings may be
   * stacked (a door under a window, two floors of windows) without ever covering each other.
   */
  wall(axis: 'x' | 'z', fixed: number, a: number, b: number, t: number, h: number, surface: SurfaceKey, openings: Opening[] = [], y0 = 0, o: PieceOpts & { frame?: FrameOpts } = {}) {
    const ops = openings
      .map(([s0, s1, v0, v1]) => [Math.max(a, s0), Math.min(b, s1), Math.max(0, v0), Math.min(h, v1)] as Opening)
      .filter(([s0, s1, v0, v1]) => s1 - s0 > 0.01 && v1 - v0 > 0.01);
    const cuts = [...new Set([a, b, ...ops.flatMap(([s0, s1]) => [s0, s1])])].sort((p, q) => p - q);
    // Solid vertical intervals of each column.
    const columns: { s0: number; s1: number; solid: [number, number][] }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i];
      const s1 = cuts[i + 1];
      if (s1 - s0 < 0.005) continue;
      const mid = (s0 + s1) / 2;
      const holes = ops.filter(([o0, o1]) => o0 <= mid && o1 >= mid).map(([, , v0, v1]) => [v0, v1] as [number, number]).sort((p, q) => p[0] - q[0]);
      const solid: [number, number][] = [];
      let cursor = 0;
      for (const [v0, v1] of holes) {
        if (v0 > cursor + 0.01) solid.push([cursor, v0]);
        cursor = Math.max(cursor, v1);
      }
      if (h > cursor + 0.01) solid.push([cursor, h]);
      const prev = columns[columns.length - 1];
      if (prev && Math.abs(prev.s1 - s0) < 1e-6 && JSON.stringify(prev.solid) === JSON.stringify(solid)) prev.s1 = s1;
      else columns.push({ s0, s1, solid });
    }
    const piece = (s0: number, s1: number, v0: number, v1: number, depth: number, opts: PieceOpts, surf: SurfaceKey) => {
      if (axis === 'x') this.span(s0, y0 + v0, fixed - depth / 2, s1, y0 + v1, fixed + depth / 2, surf, opts);
      else this.span(fixed - depth / 2, y0 + v0, s0, fixed + depth / 2, y0 + v1, s1, surf, opts);
    };
    for (const c of columns) for (const [v0, v1] of c.solid) piece(c.s0, c.s1, v0, v1, t, o, surface);

    for (const [s0, s1, v0, v1] of ops) {
      const door = v0 <= 0.01;
      this.openings.push({ axis, fixed, thickness: t, s0, s1, y0: y0 + v0, y1: y0 + v1, door });
      if (!o.frame) continue;
      // Trim protrudes a little from both faces and sits on the wall around the hole, never inside it.
      const fw = o.frame.width ?? 0.1;
      const fs = o.frame.surface ?? 'pintura';
      const fo: PieceOpts = { tint: o.frame.tint ?? 0xf7f3ea, collide: false, castShadow: false };
      const depth = t + 0.08;
      // The trim reaches a few millimetres into the hole so it covers the wall's reveal faces instead of
      // sharing their plane (coplanar faces z-fight: the flickering edges). Collision is unaffected.
      const e = 0.008;
      piece(s0 - fw, s1 + fw, v1 - e, Math.min(h, v1 + fw), depth, fo, fs);
      piece(s0 - fw, s0 + e, v0, v1 - e, depth, fo, fs);
      piece(s1 - e, s1 + fw, v0, v1 - e, depth, fo, fs);
      if (!door) piece(s0 - fw - 0.05, s1 + fw + 0.05, Math.max(0, v0 - fw), v0 + e, t + 0.2, fo, fs); // sill
    }
  }

  /**
   * Stairs climbing `rise` meters from `start` toward `dir` along `axis`. Steps are visual only; collision
   * is one ramp through the step nosings plus the top step as a landing, so walking up is smooth and never
   * snags on a riser (e.g. when hugging a wall).
   */
  stairs(axis: 'x' | 'z', dir: 1 | -1, start: number, across0: number, across1: number, baseY: number, rise: number, surface: SurfaceKey, o: PieceOpts = {}) {
    const n = Math.ceil(rise / STEP_H);
    const h = rise / n;
    const place = (s0: number, s1: number, top: number, collide: boolean) => {
      const a = Math.min(s0, s1);
      const b = Math.max(s0, s1);
      if (axis === 'x') this.span(a, baseY, across0, b, top, across1, surface, { ...o, collide });
      else this.span(across0, baseY, a, across1, top, b, surface, { ...o, collide });
    };
    for (let i = 0; i < n; i++) {
      const s0 = start + dir * i * STEP_D;
      place(s0, s0 + dir * STEP_D, baseY + h * (i + 1), i === n - 1);
    }
    // Collision: a solid wedge whose top is the ramp from the bottom of the first step to the nosing of the
    // last one. The steps look solid down to the floor, so the space under the ramp must be too (a thin
    // ramp left a hollow players could crawl into and shoot out of).
    const run = (n - 1) * STEP_D;
    const s0 = start;
    const s1 = start + dir * run;
    const top = baseY + rise;
    const pts: number[] = [];
    for (const across of [across0, across1]) {
      for (const [sv, y] of [[s0, baseY], [s1, baseY], [s1, top]]) {
        if (axis === 'x') pts.push(sv, y, across);
        else pts.push(across, y, sv);
      }
    }
    this.convexCollider(new Float32Array(pts), o.physics ?? SURFACES[surface].physics, o.onShot);
  }

  /**
   * Gable roof over the rectangle [x0,x1]x[z0,z1], ridge along `ridgeAxis`, eaves at `eaveY`, ridge `rise`
   * meters higher, with `overhang` on every side. Gable triangles use `gableSurface`/`gableTint`.
   */
  gableRoof(x0: number, z0: number, x1: number, z1: number, eaveY: number, rise: number, surface: SurfaceKey, o: PieceOpts & { overhang?: number; ridgeAxis?: 'x' | 'z'; gableSurface?: SurfaceKey; gableTint?: THREE.ColorRepresentation } = {}) {
    const oh = o.overhang ?? 0.45;
    const alongX = (o.ridgeAxis ?? 'x') === 'x';
    // Work in (u = along ridge, w = across) and map back to world.
    const [u0, u1, w0, w1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const wc = (w0 + w1) / 2;
    const halfW = (w1 - w0) / 2 + oh;
    const slopeRise = rise * (halfW / ((w1 - w0) / 2));
    const eave = eaveY - (slopeRise - rise); // eaves drop a little with the overhang
    const ridgeY = eaveY + rise;
    const P = (u: number, y: number, w: number) => (alongX ? [u, y, w] : [w, y, u]);
    const slopeLen = Math.hypot(halfW, ridgeY - eave);

    const roof: number[] = [];
    const uvs: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) => {
      roof.push(...a, ...b, ...c, ...a, ...c, ...d);
      uvs.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
    };
    const U0 = u0 - oh;
    const U1 = u1 + oh;
    for (const side of [-1, 1]) {
      const we = wc + side * halfW;
      // Top faces (winding chosen so normals point up/out), then undersides.
      const a = P(U0, eave, we);
      const b = P(U1, eave, we);
      const c = P(U1, ridgeY, wc);
      const d = P(U0, ridgeY, wc);
      const uvA = [U0, 0];
      const uvB = [U1, 0];
      const uvC = [U1, slopeLen];
      const uvD = [U0, slopeLen];
      const flip = (side === 1) !== alongX;
      if (flip) quad(a, b, c, d, uvA, uvB, uvC, uvD);
      else quad(b, a, d, c, uvB, uvA, uvD, uvC);
      const down = (p: number[]) => [p[0], p[1] - 0.12, p[2]];
      if (flip) quad(down(b), down(a), down(d), down(c), uvB, uvA, uvD, uvC);
      else quad(down(a), down(b), down(c), down(d), uvA, uvB, uvC, uvD);
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
    roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roofGeo.computeVertexNormals();
    this.addGeometry(roofGeo, surfaceMaterial(surface), o.tint);

    // Gable triangles closing the attic at both ends (flush with the walls).
    const gable: number[] = [];
    const gUv: number[] = [];
    for (const u of [u0, u1]) {
      const a = P(u, eaveY, w0);
      const b = P(u, eaveY, w1);
      const c = P(u, ridgeY, wc);
      // Both windings: visible from outside and from the attic, whatever the orientation.
      gable.push(...a, ...b, ...c, ...a, ...c, ...b);
      gUv.push(w0, eaveY, w1, eaveY, wc, ridgeY, w0, eaveY, wc, ridgeY, w1, eaveY);
    }
    const gableGeo = new THREE.BufferGeometry();
    gableGeo.setAttribute('position', new THREE.Float32BufferAttribute(gable, 3));
    gableGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
    gableGeo.computeVertexNormals();
    this.addGeometry(gableGeo, surfaceMaterial(o.gableSurface ?? surface), o.gableTint ?? o.tint);

    if (o.collide !== false) {
      const hull = [P(U0, eave, wc - halfW), P(U1, eave, wc - halfW), P(U0, eave, wc + halfW), P(U1, eave, wc + halfW), P(U0, ridgeY, wc), P(U1, ridgeY, wc)].flat();
      this.convexCollider(new Float32Array(hull), o.physics ?? SURFACES[surface].physics, o.onShot);
    }
    roofGeo.dispose();
    gableGeo.dispose();
  }

  /** Merges every batch into static meshes and adds them to the scene. */
  finish() {
    for (const batch of this.batches.values()) {
      const merged = mergeGeometries(batch.geos, false);
      batch.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, batch.material);
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `static:${batch.material.name}`;
      this.scene.add(mesh);
      this.stats.meshes++;
      this.stats.triangles += (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3;
    }
    this.batches.clear();
  }
}

/** Keeps only position/normal/uv, adds a tint color attribute, and makes the geometry indexed. */
function normalize(src: THREE.BufferGeometry, tint: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  g.setAttribute('position', pos.clone());
  if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
  else {
    g.setIndex(src.index ? src.index.clone() : null);
    g.computeVertexNormals();
  }
  const uv = src.getAttribute('uv');
  g.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  const c = new THREE.Color(tint);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(src.index ? src.index.clone() : Array.from({ length: pos.count }, (_, i) => i));
  return g;
}

/**
 * UVs from world coordinates (meters), picked per vertex from its face normal. Adjacent boxes then continue
 * the same texture seamlessly: siding boards and brick courses line up across every wall segment instead of
 * restarting at each piece (which made patched walls look like a second structure). Each face reads
 * left-to-right for a viewer in front of it.
 */
export function worldUVs(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) [u, v] = [nx > 0 ? -z : z, y];
    else if (az >= ay) [u, v] = [nz > 0 ? x : -x, y];
    else [u, v] = [x, ny > 0 ? -z : z];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * World-space box projection: each triangle takes UVs from the two axes its normal is not facing, in meters.
 * Lets glTF blockouts use library surfaces without any UV unwrapping in Blender.
 */
export function boxProjectUVs(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k];
      const [u, v] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}
