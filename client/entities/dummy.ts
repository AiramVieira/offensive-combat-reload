// Target dummies for the offline prototype: standard characters (a varied look each, rifle in hand) with the
// same hitboxes as every player (entities/rig.ts: 15 shapes on the bones, never the visual mesh), so
// practice matches a real fight. After dying, the corpse stays "humiliable" for a few seconds with a
// countdown above it (section 8).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { randomAppearance } from '@shared/appearance';
import { HEALTH, HUMILIATION } from '@shared/constants';
import type { HitRegion } from '@shared/weapons';
import type { DummySpot } from '../world/blockoutMap';
import type { HitboxRegistry, Humiliable, Target } from '../gameplay/targets';
import { CorpseTimer } from '../ui/corpseTimer';
import { Avatar } from './avatar';
import { isBehind } from './hitboxes';
import { CharacterRig, type HitPose } from './rig';
const FALL_TIME = 0.45;
const SINK_TIME = 0.8;
const UP = new THREE.Vector3(0, 1, 0);

const NAMES = ['Sr. Alvo', 'Zé Palha', 'Tio Estopa', 'Dona Mira', 'Boneco 404', 'Recruta Zero', 'Cabeça de Balde', 'Seu Madruga-lvo', 'Palhaço Tático', 'Primo Distante', 'Ex-Campeão', 'Cara do Tutorial'];

export type DeathStyle = 'back' | 'forward';

export interface HitResult {
  damage: number;
  killed: boolean;
  headshot: boolean;
  ttk: number | null;
}

export class Dummy implements Target, Humiliable {
  readonly name: string;
  health: number = HEALTH.max;
  dead = false;
  /** Set once the corpse has been humiliated (each corpse only once). */
  humiliated = false;

  readonly group = new THREE.Group();
  private visual = new THREE.Group();
  private rig: CharacterRig;
  private avatar!: Avatar;
  /** Its own copy of the baked material, so a hit flashes this dummy only. */
  private material!: THREE.MeshStandardMaterial;
  private plate: THREE.Sprite;
  private plateCtx: CanvasRenderingContext2D;
  private plateTex: THREE.CanvasTexture;
  private timer = new CorpseTimer();

  private base: THREE.Vector3;
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3();
  private patrolT = Math.random() * 10;
  private lastDamageAt = -99;
  private firstHitAt: number | null = null;
  private deathAt = 0;
  private humiliableUntil = 0;
  private respawnAt = 0;
  private claimed = false;
  private flashT = 0;
  private flinch = 0;
  private fallDir = 1;
  private deathStyle: DeathStyle = 'back';

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    private spot: DummySpot,
    index: number,
    registry: HitboxRegistry,
  ) {
    this.name = NAMES[index % NAMES.length];
    this.base = spot.position.clone();
    this.curr.copy(this.base);
    this.prev.copy(this.base);

    this.rig = new CharacterRig(world, this, registry);
    this.rig.follow(this.curr, spot.yaw, true, this.currentPose(), 0);

    this.buildVisual(index);
    this.group.add(this.visual, this.rig.debug);
    this.group.position.copy(this.base);
    this.group.rotation.y = spot.yaw;

    [this.plate, this.plateCtx, this.plateTex] = makeSprite(256, 64);
    this.plate.scale.set(1.2, 0.3, 1);
    this.plate.position.set(0, 2.15, 0);
    this.group.add(this.plate);
    this.drawPlate();

    this.group.add(this.timer.sprite);

    scene.add(this.group);
  }

  /** A standard character with a varied look (seeded by the dummy's index), never missing a limb. */
  private buildVisual(index: number) {
    let seed = index * 9301 + 49297;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const sex = index % 2 ? 'f' : 'm';
    const look = randomAppearance(sex, rnd);
    look.pcd = { braco: '', perna: '' };
    this.avatar = new Avatar(this.visual, look, sex);
    this.avatar.followHitboxes(this.rig.animator);
    this.avatar.visible = true;
    this.avatar.pose(0, this.armed());
    this.avatar.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.visible || !(mesh.material as THREE.MeshStandardMaterial).vertexColors) return;
      this.material = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = this.material;
    });
  }

  private armed() {
    const p = this.spot.patrol;
    // Patrolling strafes along an axis (the derivative of the patrol's sine).
    const v = p ? Math.cos(this.patrolT) * p.amplitude * p.speed : 0;
    const vel = { x: p?.axis === 'x' ? v : 0, z: p?.axis === 'z' ? v : 0 };
    return { speed: Math.abs(v), vel, yaw: this.spot.yaw, crouch: false, pitch: 0, ads: false, reload: false, knife: false, cook: false };
  }

  /** Standing guard with the rifle (walking when it patrols): the avatar plays it, the hitboxes follow it. */
  private currentPose(): HitPose {
    return { kind: 'armed', pose: this.armed() };
  }

  setDebug(show: boolean) {
    this.rig.setDebug(show);
  }

  get position() {
    return this.curr;
  }

  refineRegion(point: THREE.Vector3, region: HitRegion): HitRegion {
    return this.rig.refineRegion(point, region);
  }

  /** True if `point` is behind this dummy (used for the backstab bonus). */
  isBehind(point: THREE.Vector3): boolean {
    return isBehind(point, this.curr, this.spot.yaw);
  }

  private drawPlate() {
    const g = this.plateCtx;
    g.clearRect(0, 0, 256, 64);
    g.font = '800 26px Nunito, system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.fillStyle = '#ffffff';
    g.strokeText(this.name, 128, 26);
    g.fillText(this.name, 128, 26);
    const frac = this.health / HEALTH.max;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(38, 38, 180, 16);
    g.fillStyle = frac > 0.5 ? '#7dff5a' : frac > 0.25 ? '#ffd23f' : '#ff4a3d';
    g.fillRect(41, 41, 174 * frac, 10);
    this.plateTex.needsUpdate = true;
  }

  applyHit(damage: number, region: HitRegion, time: number, shotDir: THREE.Vector3, style: DeathStyle = 'back'): HitResult {
    if (this.dead) return { damage: 0, killed: false, headshot: false, ttk: null };
    if (this.health === HEALTH.max) this.firstHitAt = time;
    const dealt = Math.min(this.health, damage);
    this.health -= dealt;
    this.lastDamageAt = time;
    this.flashT = 0.08;
    this.flinch = Math.min(0.35, this.flinch + damage / 180);
    let ttk: number | null = null;
    if (this.health <= 0) {
      ttk = this.firstHitAt !== null ? time - this.firstHitAt : null;
      this.die(time, shotDir, style);
    }
    this.drawPlate();
    return { damage: dealt, killed: this.dead, headshot: region === 'cabeca', ttk };
  }

  private die(time: number, shotDir: THREE.Vector3, style: DeathStyle) {
    this.health = 0;
    this.dead = true;
    this.humiliated = false;
    this.claimed = false;
    this.deathAt = time;
    this.humiliableUntil = time + HUMILIATION.window;
    this.respawnAt = this.humiliableUntil + SINK_TIME;
    this.deathStyle = style;
    // No hitboxes from the same tick.
    this.rig.follow(this.curr, this.spot.yaw, false, this.currentPose(), 0);
    // 'back' falls away from the attacker; 'forward' doubles over toward them.
    const localDir = shotDir.clone().applyAxisAngle(UP, -this.spot.yaw);
    const away = localDir.z < 0 ? -1 : 1;
    this.fallDir = style === 'back' ? away : -away;
    this.plate.visible = false;
    // Countdown floats above the lying body (the body rotates around the feet along local Z).
    this.timer.sprite.position.set(0, 0.85, this.fallDir * 0.9);
  }

  // --- Humiliation ------------------------------------------------------------------------------------

  canHumiliate(time: number): boolean {
    return this.dead && !this.humiliated && !this.claimed && time < this.humiliableUntil;
  }

  humiliationTimeLeft(time: number): number {
    return Math.max(0, this.humiliableUntil - time);
  }

  /** World position of the lying body's center, for the proximity check. */
  corpseCenter(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0.25, this.fallDir * 0.9).applyAxisAngle(UP, this.spot.yaw);
    return out.add(this.curr);
  }

  /** Locks the corpse while someone is dancing on it (it won't despawn or accept a second taunt). */
  claim() {
    this.claimed = true;
  }

  releaseClaim(time: number) {
    this.claimed = false;
    this.humiliableUntil = Math.max(this.humiliableUntil, time + 1.5);
    this.respawnAt = this.humiliableUntil + SINK_TIME;
  }

  finishHumiliation(time: number) {
    this.claimed = false;
    this.humiliated = true;
    this.humiliableUntil = time;
    this.respawnAt = time + 1.6 + SINK_TIME;
  }

  /** `occupied` reports whether someone is standing where this dummy would respawn. */
  fixedUpdate(dt: number, time: number, occupied: (spot: THREE.Vector3) => boolean) {
    this.prev.copy(this.curr);
    if (this.dead) {
      // Never respawn inside a player: wait until the spot is clear.
      if (!this.claimed && time >= this.respawnAt && !occupied(this.curr)) this.respawn();
      return;
    }
    const p = this.spot.patrol;
    if (p) {
      this.patrolT += dt * p.speed;
      this.curr.copy(this.base);
      this.curr[p.axis] += Math.sin(this.patrolT) * p.amplitude;
    }
    this.rig.follow(this.curr, this.spot.yaw, true, this.currentPose(), dt);
    // Same regen rule as players: full recovery 4 s after the last hit.
    if (this.health < HEALTH.max && time - this.lastDamageAt > HEALTH.regenDelay) {
      this.health = Math.min(HEALTH.max, this.health + HEALTH.regenPerSecond * dt);
      if (this.health === HEALTH.max) this.firstHitAt = null;
      this.drawPlate();
    }
  }

  private respawn() {
    this.dead = false;
    this.health = HEALTH.max;
    this.firstHitAt = null;
    this.plate.visible = true;
    this.timer.hide();
    this.visual.scale.setScalar(0.01);
    this.drawPlate();
  }

  render(alpha: number, dt: number, time: number) {
    this.group.position.lerpVectors(this.prev, this.curr, alpha);

    if (this.dead) {
      const since = time - this.deathAt;
      if (this.deathStyle === 'forward') {
        // Hop, clutch, and fold forward.
        const hop = since < 0.25 ? Math.sin((since / 0.25) * Math.PI) * 0.35 : 0;
        const t = THREE.MathUtils.clamp((since - 0.2) / FALL_TIME, 0, 1);
        this.visual.rotation.x = this.fallDir * t * t * (Math.PI / 2 - 0.08);
        this.visual.position.y = hop;
      } else {
        // Stiff cartoon fall with a little bounce.
        const t = Math.min(1, since / FALL_TIME);
        const after = since - FALL_TIME;
        const bounce = t < 1 ? t * t : 1 + Math.sin(after * 18) * Math.exp(-after * 7) * 0.06;
        this.visual.rotation.x = this.fallDir * bounce * (Math.PI / 2 - 0.08);
        this.visual.position.y = 0;
      }
      if (!this.claimed) {
        const sink = Math.min(1, Math.max(0, time - (this.respawnAt - SINK_TIME)) / SINK_TIME);
        this.visual.position.y -= sink * 0.6;
      }
      this.drawTimer(time);
    } else {
      this.visual.position.y = 0;
      this.flinch *= Math.exp(-10 * dt);
      this.visual.rotation.x = this.flinch;
      const s = this.visual.scale.x;
      if (s < 1) this.visual.scale.setScalar(Math.min(1, s + dt * 5));
      this.avatar.pose(dt, this.armed());
    }

    this.flashT -= dt;
    const e = this.flashT > 0 ? 0.6 : 0;
    this.material.emissive.setScalar(e);
  }

  private drawTimer(time: number) {
    const left = this.humiliationTimeLeft(time);
    if (!this.humiliated && !this.claimed && left > 0) this.timer.countdown(left, HUMILIATION.window);
    else if (this.humiliated && time < this.respawnAt - SINK_TIME) this.timer.done();
    else this.timer.hide();
  }
}

export class DummyManager {
  readonly list: Dummy[] = [];

  constructor(world: RAPIER.World, scene: THREE.Scene, spots: DummySpot[], registry: HitboxRegistry) {
    spots.forEach((s, i) => this.list.push(new Dummy(world, scene, s, i, registry)));
  }

  fixedUpdate(dt: number, time: number, occupied: (spot: THREE.Vector3) => boolean) {
    for (const d of this.list) d.fixedUpdate(dt, time, occupied);
  }

  render(alpha: number, dt: number, time: number) {
    for (const d of this.list) d.render(alpha, dt, time);
  }

  setDebug(show: boolean) {
    for (const d of this.list) d.setDebug(show);
  }
}

function makeSprite(w: number, h: number): [THREE.Sprite, CanvasRenderingContext2D, THREE.CanvasTexture] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  return [sprite, canvas.getContext('2d')!, tex];
}
