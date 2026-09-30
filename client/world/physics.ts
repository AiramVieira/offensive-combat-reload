import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';

export type SurfaceMaterial = 'grass' | 'concrete' | 'wood' | 'metal' | 'glass' | 'tile';

export interface SurfaceInfo {
  material: SurfaceMaterial;
  /** Optional environmental gag triggered when shot (section 10). */
  onShot?: (point: RAPIER.Vector) => void;
}

export interface Physics {
  world: RAPIER.World;
  staticBody: RAPIER.RigidBody;
  surfaces: Map<number, SurfaceInfo>;
}

export const WORLD_GROUPS = groups(GROUP.WORLD, 0xffff);

export async function createPhysics(): Promise<Physics> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
  world.timestep = 1 / 60;
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return { world, staticBody, surfaces: new Map() };
}
