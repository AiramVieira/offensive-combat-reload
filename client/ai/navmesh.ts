// Navigation mesh for bots (section 14: "Bots com navmesh"), built with Recast from the map's own static
// colliders (not the visuals: foliage, trim and door leaves don't block, walls and cars do). Works for
// code-built maps and glTF maps alike.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { init, NavMeshQuery, getNavMeshPositionsAndIndices, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { MOVE } from '@shared/constants';
import type { Physics } from '../world/physics';

// Voxel size (m): horizontal cs, vertical ch. Agent sizes are given in voxels.
const CS = 0.175;
const CH = 0.1;
const HALF_EXTENTS = { x: 1.5, y: 4, z: 1.5 };

export class NavMap {
  private constructor(
    readonly navMesh: NavMesh,
    readonly query: NavMeshQuery,
    readonly buildMs: number,
    readonly triangles: number,
  ) {}

  /** `avoid`: extra solid boxes for bots to route around (hazards such as the dog's bite zone). */
  static async build(physics: Physics, avoid: THREE.Box3[] = []): Promise<NavMap | null> {
    const t0 = performance.now();
    await init();
    const positions: number[] = [];
    const indices: number[] = [];
    const add = (geo: THREE.BufferGeometry) => {
      const base = positions.length / 3;
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      const idx = geo.index;
      if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
      else for (let i = 0; i < pos.count; i++) indices.push(base + i);
      geo.dispose();
    };
    const m = new THREE.Matrix4();
    physics.world.forEachCollider((c) => {
      // Only the static map: characters, dummies and projectiles are dynamic obstacles, not terrain.
      if (c.parent()?.handle !== physics.staticBody.handle || !c.isEnabled()) return;
      const t = c.translation();
      const r = c.rotation();
      m.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1));
      const type = c.shapeType();
      let geo: THREE.BufferGeometry | null = null;
      if (type === RAPIER.ShapeType.Cuboid) {
        const h = c.halfExtents()!;
        geo = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
      } else if (type === RAPIER.ShapeType.Cylinder) {
        geo = new THREE.CylinderGeometry(c.radius(), c.radius(), c.halfHeight() * 2, 8);
      } else if (type === RAPIER.ShapeType.TriMesh || type === RAPIER.ShapeType.ConvexPolyhedron) {
        const idx = c.indices();
        const verts = c.vertices();
        if (idx) {
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
          geo.setIndex(Array.from(idx));
        } else {
          // Convex hulls from points (stair wedges, roofs) carry no faces: rebuild them.
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < verts.length; i += 3) pts.push(new THREE.Vector3(verts[i], verts[i + 1], verts[i + 2]));
          geo = new ConvexGeometry(pts);
        }
      }
      if (!geo) return;
      geo.applyMatrix4(m);
      add(geo);
    });

    for (const box of avoid) {
      const size = box.getSize(new THREE.Vector3());
      add(new THREE.BoxGeometry(size.x, size.y, size.z).translate(...box.getCenter(new THREE.Vector3()).toArray()));
    }

    const { success, navMesh } = generateSoloNavMesh(positions, indices, {
      cs: CS,
      ch: CH,
      walkableSlopeAngle: MOVE.maxSlopeDeg + 1,
      walkableHeight: Math.ceil(MOVE.heightStand / CH),
      walkableClimb: Math.floor(MOVE.stepHeight / CH),
      walkableRadius: Math.ceil(MOVE.radius / CS),
      maxEdgeLen: Math.round(12 / CS),
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!success || !navMesh) {
      console.warn('[bots] falha ao gerar a malha de navegação');
      return null;
    }
    return new NavMap(navMesh, new NavMeshQuery(navMesh), performance.now() - t0, indices.length / 3);
  }

  /** Walkable point closest to `p`, or null if nothing is near. */
  closest(p: THREE.Vector3): THREE.Vector3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: HALF_EXTENTS });
    return r.success && r.polyRef ? new THREE.Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  /** Corner points from `from` to `to` along the walkable area (first point = start), or null. */
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const r = this.query.computePath(from, to, { halfExtents: HALF_EXTENTS });
    if (!r.success || r.path.length === 0) return null;
    return r.path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  }

  randomPoint(): THREE.Vector3 | null {
    const r = this.query.findRandomPoint();
    return r.success ? new THREE.Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z) : null;
  }

  randomAround(p: THREE.Vector3, radius: number): THREE.Vector3 | null {
    const r = this.query.findRandomPointAroundCircle(p, radius, { halfExtents: HALF_EXTENTS });
    return r.success ? new THREE.Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z) : null;
  }

  /** Translucent overlay of the walkable area (debug, F4). */
  debugMesh(): THREE.Mesh {
    const [positions, indices] = getNavMeshPositionsAndIndices(this.navMesh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.translate(0, 0.05, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2fe0ff, transparent: true, opacity: 0.35, depthWrite: false, wireframe: false }));
    mesh.visible = false;
    return mesh;
  }
}
