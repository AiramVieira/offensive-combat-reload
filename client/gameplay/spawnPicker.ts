// Section 6 spawn choice, shared by free-for-all online and the bots mode: never on top of someone, avoid
// spots with an enemy closer than 15 m or with a clear line of sight to them, prefer far from everyone,
// and draw among the best three so spawns don't become predictable.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import type { Physics } from '../world/physics';
import type { SpawnPoint } from '../world/blockoutMap';

const LOS_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);

export interface SpawnThreat {
  feet: THREE.Vector3;
  eye: THREE.Vector3;
}

export function pickSafeSpawn(spawns: SpawnPoint[], threats: SpawnThreat[], physics: Physics): SpawnPoint {
  const dir = new THREE.Vector3();
  const scored = spawns.map((sp) => {
    let score = Math.random() * 4;
    let nearest = 60;
    const head = sp.position.clone().setY(sp.position.y + 1.5);
    for (const t of threats) {
      const d = t.feet.distanceTo(sp.position);
      nearest = Math.min(nearest, d);
      if (d < 2) score -= 1000;
      if (d < 15) score -= 25;
      dir.subVectors(head, t.eye);
      const len = dir.length();
      const hit = physics.world.castRay(new RAPIER.Ray(t.eye, dir.divideScalar(len)), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, LOS_GROUPS);
      if (!hit || hit.timeOfImpact > len - 0.2) score -= 20;
    }
    return { sp, score: score + nearest };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[Math.floor(Math.random() * Math.min(3, scored.length))].sp;
}
