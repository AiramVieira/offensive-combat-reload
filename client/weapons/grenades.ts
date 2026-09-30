// Frag grenades (G): hold to pull the pin and cook the fuse, release to throw (section 4/6).
// GrenadeThrower is the player's hand (state machine, count, recharge); GrenadeProjectiles owns the live
// grenades in the world as Rapier dynamic bodies that bounce and roll until the fuse runs out.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups } from '@shared/constants';
import type { GrenadeData } from '@shared/weapons';
import { toon } from '../render/materials';
import type { Physics } from '../world/physics';

// Grenades bounce off the map and off characters' blockers, never off the player (who would shove them).
const PROJECTILE_GROUPS = groups(GROUP.PROJECTILE, GROUP.WORLD | GROUP.BLOCKER);
// What sets off an impact grenade: the map, characters' blockers and their hitboxes.
const IMPACT_GROUPS = groups(GROUP.PROJECTILE, GROUP.WORLD | GROUP.BLOCKER | GROUP.HITBOX);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export type ThrowerEvent =
  | { type: 'pin' }
  | { type: 'throw'; fuseLeft: number }
  | { type: 'inHand' };

export class GrenadeThrower {
  count: number;
  /** Seconds since the pin was pulled while still in hand, or null. */
  cookT: number | null = null;
  /** Seconds since release, for the follow-through animation, or null. */
  throwT: number | null = null;
  private releaseQueued = false;
  private cooldown = 0;
  private recharge = 0;

  constructor(readonly data: GrenadeData) {
    this.count = data.quantidade;
  }

  /** Holding a live grenade (the throw follow-through is only an animation and never blocks). */
  get busy() {
    return this.cookT !== null;
  }

  /** Cuts the throw follow-through animation short (the trigger was pulled). */
  endFollowThrough() {
    this.throwT = null;
  }

  /** Remaining fuse while cooking (for the HUD), or null. */
  get fuseLeft(): number | null {
    return this.cookT === null ? null : Math.max(0, this.data.pavio - this.cookT);
  }

  refill() {
    this.count = this.data.quantidade;
    this.cookT = null;
    this.throwT = null;
    this.releaseQueued = false;
    this.recharge = 0;
  }

  /**
   * `held`: G is down this tick; `pressed`: G went down since the last tick (catches taps shorter than a
   * tick); `canStart`: nothing else (knife, dance, death) is using the hands.
   */
  update(dt: number, held: boolean, pressed: boolean, canStart: boolean): ThrowerEvent | null {
    const d = this.data;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.throwT !== null) {
      this.throwT += dt;
      if (this.throwT > 0.5) this.throwT = null;
    }
    // Offline prototype: grenades trickle back so the range never runs dry.
    if (d.recargaSegundos > 0 && this.count < d.quantidade) {
      this.recharge += dt;
      if (this.recharge >= d.recargaSegundos) {
        this.recharge = 0;
        this.count++;
      }
    } else {
      this.recharge = 0;
    }

    if (this.cookT === null) {
      if ((pressed || held) && canStart && this.count > 0 && this.cooldown <= 0 && this.throwT === null) {
        this.cookT = 0;
        this.count--;
        this.releaseQueued = !held; // a tap that was already released: throw once the pin is out
        return { type: 'pin' };
      }
      return null;
    }

    this.cookT += dt;
    if (!held) this.releaseQueued = true;
    if (this.cookT >= d.pavio) {
      // Held too long: it goes off in your hand.
      this.cookT = null;
      this.cooldown = d.intervalo;
      return { type: 'inHand' };
    }
    if (this.releaseQueued && this.cookT >= d.tempoMinimoPuxar) {
      const fuseLeft = d.pavio - this.cookT;
      this.cookT = null;
      this.releaseQueued = false;
      this.throwT = 0;
      this.cooldown = d.intervalo;
      return { type: 'throw', fuseLeft };
    }
    return null;
  }

  /** Knife/dance/death interrupt: the pin goes back in, the grenade is not lost. */
  cancel() {
    if (this.cookT !== null) this.count++;
    this.cookT = null;
    this.releaseQueued = false;
  }
}

interface Live {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Explodes on first contact (thrown); false = by fuse (a cooked grenade dropped on death). */
  impact: boolean;
  /** The thrower's own hitbox body: touching yourself doesn't set it off. */
  ignore?: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  fuse: number;
  prev: THREE.Vector3;
  curr: THREE.Vector3;
  prevQ: THREE.Quaternion;
  currQ: THREE.Quaternion;
  lastVel: THREE.Vector3;
  /** Set for another player's grenade: purely visual, removed when their explosion arrives. */
  remote?: string;
  /** Our own grenade's id, reported with its explosion. */
  id: number;
}

export interface Explosion {
  position: THREE.Vector3;
  id: number;
}

export interface SpawnOpts {
  impact?: boolean;
  ignore?: RAPIER.RigidBody;
}

export class GrenadeProjectiles {
  readonly live: Live[] = [];
  private tmpV = new THREE.Vector3();
  private probe: RAPIER.Ball;

  constructor(private physics: Physics, private scene: THREE.Scene, private data: GrenadeData, private onBounce: (strength: number) => void) {
    this.probe = new RAPIER.Ball(data.raio);
  }

  /**
   * `fuseLeft`: seconds to the explosion, or for impact grenades the flight time limit. Remote grenades are
   * visual only (their owner reports the explosion).
   */
  spawn(position: THREE.Vector3, velocity: THREE.Vector3, fuseLeft: number, remote?: string, id = 0, opts: SpawnOpts = {}) {
    const d = this.data;
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 20 })
        .setLinearDamping(0.1)
        .setAngularDamping(0.8)
        // Fast and small: continuous collision so it can't tunnel through 15 cm fences.
        .setCcdEnabled(true),
    );
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(d.raio).setRestitution(d.quique).setFriction(d.atrito).setDensity(900).setCollisionGroups(PROJECTILE_GROUPS),
      body,
    );
    const mesh = grenadeModel();
    mesh.traverse((o) => (o.castShadow = true));
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.live.push({
      body,
      collider,
      impact: !!opts.impact,
      ignore: opts.ignore,
      mesh,
      fuse: fuseLeft,
      prev: position.clone(),
      curr: position.clone(),
      prevQ: new THREE.Quaternion(),
      currQ: new THREE.Quaternion(),
      lastVel: velocity.clone(),
      remote,
      id,
    });
  }

  /** Removes another player's grenade when the server reports its explosion. */
  removeRemote(key: string) {
    const i = this.live.findIndex((g) => g.remote === key);
    if (i >= 0) this.destroy(i);
  }

  private destroy(i: number) {
    const g = this.live[i];
    this.physics.world.removeRigidBody(g.body);
    this.scene.remove(g.mesh);
    this.live.splice(i, 1);
  }

  /** Call once per tick, before world.step(). Returns grenades that went off (impact or fuse) this tick. */
  fixedUpdate(dt: number): Explosion[] {
    const out: Explosion[] = [];
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.prev.copy(g.curr);
      g.prevQ.copy(g.currQ);
      const t = g.body.translation();
      const r = g.body.rotation();
      g.curr.set(t.x, t.y, t.z);
      g.currQ.set(r.x, r.y, r.z, r.w);
      // Bounce "tink": a sudden change of velocity means it hit something.
      const v = g.body.linvel();
      const dv = this.tmpV.set(v.x, v.y, v.z).sub(g.lastVel).length();
      if (dv > 2.5) this.onBounce(Math.min(1, dv / 12));
      g.lastVel.set(v.x, v.y, v.z);

      g.fuse -= dt;
      if (g.remote) {
        // Safety net in case the owner's explosion message never arrives.
        if (g.fuse < -2) this.destroy(i);
        continue;
      }
      if (g.curr.y < -30) {
        this.destroy(i); // fell out of the map
        continue;
      }
      let at: THREE.Vector3 | null = null;
      if (g.impact) {
        // Sweep the ball along this tick's motion: touching anything (or already touching) sets it off
        // right there. A sudden change of velocity (it bounced during the last step) also counts.
        const hit = this.physics.world.castShape(t, IDENTITY, v, this.probe, 0, dt * 1.05, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, IMPACT_GROUPS, g.collider, g.ignore);
        if (hit) at = g.curr.clone().addScaledVector(this.tmpV.set(v.x, v.y, v.z), hit.time_of_impact);
        else if (dv > 3) at = g.curr.clone();
        else if (g.fuse <= 0) at = g.curr.clone();
      } else if (g.fuse <= 0) at = g.curr.clone();
      if (at) {
        out.push({ position: at, id: g.id });
        this.destroy(i);
      }
    }
    return out;
  }

  render(alpha: number) {
    for (const g of this.live) {
      g.mesh.position.lerpVectors(g.prev, g.curr, alpha);
      g.mesh.quaternion.slerpQuaternions(g.prevQ, g.currQ, alpha);
    }
  }
}

/** Cartoon frag grenade: ribbed body, spoon and pin ring, ~12 cm tall. Shared by world and viewmodel. */
export function grenadeGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.06, 12, 10).scale(1, 1.2, 1);
}

export function grenadeModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(grenadeGeometry(), toon(0x3f5f2a));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 12), toon(0x2c4520));
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.035, 8), toon(0x8c96a3));
  top.position.y = 0.08;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.008), toon(0x8c96a3));
  spoon.position.set(0.035, 0.05, 0);
  spoon.rotation.z = -0.35;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 12), toon(0xd8dde3));
  ring.position.set(-0.03, 0.095, 0);
  g.add(body, band, top, spoon, ring);
  return g;
}
