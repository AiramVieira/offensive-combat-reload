// Land mines (grenade level 2): planted at your feet with G, armed after a moment, set off by an enemy
// stepping close. They exist only while their owner is alive: they vanish when the owner respawns (so they
// linger a few seconds after the owner dies). Other players' mines are visual; their owner reports the blast.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import { mineModel } from '../render/weaponModels';
import type { Physics } from '../world/physics';

const ARM_TIME = 1;
const TRIGGER_RADIUS = 1.1;
const TRIGGER_HEIGHT = 1.2;
/** Most live mines one player can have at once. */
export const MAX_MINES = 3;
const GROUND_GROUPS = groups(GROUP.BULLET, GROUP.WORLD);

interface Mine {
  id: number;
  /** null = ours; otherwise the owner's player id (online). */
  owner: number | null;
  position: THREE.Vector3;
  group: THREE.Group;
  led: THREE.Mesh;
  age: number;
}

export class Mines {
  private list: Mine[] = [];
  private t = 0;

  constructor(
    private physics: Physics,
    private scene: THREE.Scene,
  ) {}

  /** Where a mine dropped at `at` comes to rest (the floor below it). */
  groundAt(at: THREE.Vector3): THREE.Vector3 {
    const hit = this.physics.world.castRay(new RAPIER.Ray({ x: at.x, y: at.y + 0.3, z: at.z }, { x: 0, y: -1, z: 0 }), 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, GROUND_GROUPS);
    return new THREE.Vector3(at.x, hit ? at.y + 0.3 - hit.timeOfImpact : at.y, at.z);
  }

  /** Places a mine: `owner` null = ours (the caller keeps us under MAX_MINES). */
  place(id: number, owner: number | null, at: THREE.Vector3) {
    const { group, led } = mineModel();
    group.position.copy(at);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);
    this.list.push({ id, owner, position: at.clone(), group, led, age: 0 });
  }

  remove(id: number, owner: number | null) {
    const i = this.list.findIndex((m) => m.id === id && m.owner === owner);
    if (i < 0) return;
    this.scene.remove(this.list[i].group);
    this.list.splice(i, 1);
  }

  /** The owner respawned (or left): their mines disappear. */
  clearOwner(owner: number | null) {
    for (const m of [...this.list]) if (m.owner === owner) this.remove(m.id, owner);
  }

  get own(): number {
    return this.list.filter((m) => m.owner === null).length;
  }

  /** Our armed mines with an enemy's feet close enough: they go off (removed here, blast done by the caller). */
  triggered(enemyFeet: THREE.Vector3[]): { id: number; position: THREE.Vector3 }[] {
    const out: { id: number; position: THREE.Vector3 }[] = [];
    for (const m of [...this.list]) {
      if (m.owner !== null || m.age < ARM_TIME) continue;
      const hit = enemyFeet.some((f) => Math.hypot(f.x - m.position.x, f.z - m.position.z) < TRIGGER_RADIUS && Math.abs(f.y - m.position.y) < TRIGGER_HEIGHT);
      if (!hit) continue;
      out.push({ id: m.id, position: m.position.clone() });
      this.remove(m.id, null);
    }
    return out;
  }

  /** Per frame: the LED blinks slowly while arming, then fast once armed. */
  update(dt: number) {
    this.t += dt;
    for (const m of this.list) {
      m.age += dt;
      const rate = m.age < ARM_TIME ? 2 : 5;
      m.led.visible = Math.floor(this.t * rate + m.id) % 2 === 0;
    }
  }
}
