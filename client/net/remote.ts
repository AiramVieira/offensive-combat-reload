// Other players and corpses in an online session. Remote players are drawn NET.interpDelayMs in the past,
// interpolating between the two server snapshots around that time, and carry the same hitboxes as everyone
// (entities/rig.ts), in the pose their flags describe, so shooting them works identically.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FLAG, NET, type CorpseInfo, type NetState, type PlayerInfo, type Sex } from '@shared/protocol';
import { DEFAULT_LOADOUT, type Loadout } from '@shared/progression';
import type { HitRegion } from '@shared/weapons';
import { bodyStats, defaultAppearance, type Appearance } from '@shared/appearance';
import { Avatar } from '../entities/avatar';
import { isBehind } from '../entities/hitboxes';
import { CharacterRig, type HitPose } from '../entities/rig';
import type { HitboxRegistry, Target } from '../gameplay/targets';
import { Corpse, groundBelow } from '../gameplay/corpse';
import type { Connection } from './connection';


interface Snap {
  t: number;
  s: NetState;
}

const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

function nameplate(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = '800 28px Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.fillStyle = color;
  g.strokeText(name, 128, 24);
  g.fillText(name, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.3, 0.24, 1);
  s.position.y = 2.15;
  return s;
}

export class RemotePlayer implements Target {
  alive = false;
  health = 100;
  readonly position = new THREE.Vector3(0, -100, 0);
  yaw = 0;
  pitch = 0;
  flags = 0;
  speed = 0;
  /** Smoothed horizontal velocity (drives the 8-way locomotion). */
  private vel = { x: 0, z: 0 };
  private buffer: Snap[] = [];
  private avatar: Avatar;
  private plate: THREE.Sprite;
  private rig: CharacterRig;
  private danceT: number | null = null;
  private loadoutKey = '';
  private lastPos = new THREE.Vector3();

  constructor(
    readonly id: number,
    public name: string,
    readonly sex: Sex,
    look: Appearance,
    world: RAPIER.World,
    private scene: THREE.Scene,
    registry: HitboxRegistry,
  ) {
    // Everyone appears the way they customized their character.
    this.avatar = new Avatar(scene, look, sex);
    const body = bodyStats(look);
    this.plate = nameplate(name, '#ff8a80');
    this.plate.position.y *= body.visualScale;
    this.avatar.root.add(this.plate);
    this.rig = new CharacterRig(world, this, registry, body.missing);
    this.avatar.followHitboxes(this.rig.animator);
    this.avatar.root.add(this.rig.debug);
    this.rig.follow(this.position, 0, false, { kind: 'idle', t: 0 }, 0);
  }

  get dead() {
    return !this.alive;
  }

  setDebug(v: boolean) {
    this.rig.setDebug(v);
  }

  /** What the body is doing, from the flags: the avatar plays it and the hitboxes follow it. */
  private currentPose(): HitPose {
    const f = this.flags;
    if (f & FLAG.dance) return { kind: 'dance', t: this.danceT ?? 0 };
    return {
      kind: 'armed',
      pose: {
        speed: this.speed,
        vel: this.vel,
        yaw: this.yaw,
        grounded: !!(f & FLAG.grounded),
        sprint: !!(f & FLAG.sprint),
        crouch: !!(f & FLAG.crouch),
        slide: !!(f & FLAG.slide),
        pitch: this.pitch,
        ads: !!(f & FLAG.ads),
        reload: !!(f & FLAG.reload),
        knife: !!(f & FLAG.knife),
        cook: !!(f & FLAG.cook),
      },
    };
  }

  push(time: number, s: NetState, alive: boolean, health: number) {
    this.health = health;
    if (alive !== this.alive) {
      this.alive = alive;
      // Respawns teleport: drop the old history so we don't interpolate across the map.
      if (alive) this.buffer.length = 0;
      // Dead = no hitboxes, from the same tick.
      if (!alive) this.rig.follow(this.position, this.yaw, false, this.currentPose(), 0);
    }
    if (!alive) return;
    this.buffer.push({ t: time, s });
    while (this.buffer.length > 30) this.buffer.shift();
  }

  /** Samples the interpolated state at server time `t` and moves the hitboxes there. */
  update(t: number, dt: number) {
    if (!this.alive || this.buffer.length === 0) {
      this.rig.follow(this.position.set(0, -100, 0), this.yaw, false, this.currentPose(), 0);
      return;
    }
    const b = this.buffer;
    let s: NetState;
    if (t <= b[0].t) s = b[0].s;
    else if (t >= b[b.length - 1].t) s = b[b.length - 1].s; // no newer data: hold the last state
    else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1].t < t) i++;
      const a = b[i];
      const c = b[i + 1];
      const k = (t - a.t) / Math.max(1, c.t - a.t);
      s = {
        p: [a.s.p[0] + (c.s.p[0] - a.s.p[0]) * k, a.s.p[1] + (c.s.p[1] - a.s.p[1]) * k, a.s.p[2] + (c.s.p[2] - a.s.p[2]) * k],
        yaw: lerpAngle(a.s.yaw, c.s.yaw, k),
        pitch: a.s.pitch + (c.s.pitch - a.s.pitch) * k,
        f: c.s.f,
      };
    }
    this.lastPos.copy(this.position);
    this.position.set(s.p[0], s.p[1], s.p[2]);
    if (dt > 0) {
      this.speed = this.speed * 0.8 + (Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z) / dt) * 0.2;
      this.vel.x = this.vel.x * 0.8 + ((this.position.x - this.lastPos.x) / dt) * 0.2;
      this.vel.z = this.vel.z * 0.8 + ((this.position.z - this.lastPos.z) / dt) * 0.2;
    }
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.flags = s.f;
    this.rig.follow(this.position, this.yaw, true, this.currentPose(), dt);
  }

  render(dt: number) {
    this.avatar.visible = this.alive && this.buffer.length > 0;
    if (!this.avatar.visible) return;
    this.avatar.root.position.copy(this.position);
    this.avatar.root.rotation.y = this.yaw;
    if (this.flags & FLAG.dance) this.danceT = (this.danceT ?? 0) + dt;
    else this.danceT = null;
    const pose = this.currentPose();
    if (pose.kind === 'dance') this.avatar.dance(pose.t);
    else if (pose.kind === 'armed') this.avatar.pose(dt, pose.pose);
  }

  /** A shot of theirs: recoil on the avatar. */
  fire() {
    this.avatar.fire();
  }

  /** Their equipped weapon levels (the models in their hands). */
  setLoadout(lo: Loadout) {
    const key = JSON.stringify(lo);
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.avatar.setLoadout(lo);
  }

  /** A grenade of theirs: the throwing arm swings. */
  throwGrenade() {
    this.avatar.throwGrenade();
  }

  /** Hit by a bullet from `from`: the torso jerks. */
  hitReact(from: THREE.Vector3) {
    this.avatar.hitReact(from);
  }

  /** Approximate muzzle position (for tracers from their shots). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * 0.6, 1.4, -Math.cos(this.yaw) * 0.6).add(this.position);
  }

  refineRegion(point: THREE.Vector3, region: HitRegion): HitRegion {
    return this.rig.refineRegion(point, region);
  }

  isBehind(point: THREE.Vector3): boolean {
    return isBehind(point, this.position, this.yaw);
  }

  dispose() {
    this.rig.dispose();
    this.scene.remove(this.avatar.root);
  }
}

/** Remote players and corpses of one session. */
export class RemoteWorld {
  readonly players = new Map<number, RemotePlayer>();
  readonly corpses = new Map<number, Corpse>();
  readonly info = new Map<number, PlayerInfo>();

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    private registry: HitboxRegistry,
    private conn: Connection,
    readonly me: number,
  ) {}

  upsertInfo(p: PlayerInfo) {
    // The look only comes when the player appears: keep it across later updates.
    const ap = p.ap ?? this.info.get(p.id)?.ap;
    this.info.set(p.id, { ...p, ap });
    if (p.id === this.me) return;
    const rp = this.players.get(p.id);
    const sex = p.sex ?? 'm';
    if (!rp) this.players.set(p.id, new RemotePlayer(p.id, p.name, sex, ap ?? defaultAppearance(sex), this.world, this.scene, this.registry));
    this.players.get(p.id)?.setLoadout(p.lo ?? DEFAULT_LOADOUT);
  }

  /** A player equipped other weapon levels. */
  setLoadout(id: number, lo: Loadout) {
    const info = this.info.get(id);
    if (info) info.lo = lo;
    this.players.get(id)?.setLoadout(lo);
  }

  remove(id: number) {
    this.players.get(id)?.dispose();
    this.players.delete(id);
    this.info.delete(id);
  }

  addCorpse(c: CorpseInfo) {
    if (this.corpses.has(c.id)) return;
    // The server arbitrates humiliations: the hooks report the local player's dance, results come back
    // as broadcasts (taunt / tauntEnd).
    const conn = this.conn;
    const corpse = new Corpse({ ...c, until: c.until / 1000 }, this.me, this.scene, groundBelow(this.world, c.p), {
      now: () => conn.serverNow() / 1000,
      claim: (k) => conn.send({ t: 'taunt', corpse: k.info.id }),
      release: (k) => conn.send({ t: 'tauntEnd', corpse: k.info.id, done: false }),
      finish: (k) => conn.send({ t: 'tauntEnd', corpse: k.info.id, done: true }),
    });
    this.corpses.set(c.id, corpse);
  }



  snapshot(time: number, list: { id: number; s: NetState; h: number; alive: boolean }[]) {
    for (const e of list) this.players.get(e.id)?.push(time, e.s, e.alive, e.h);
  }

  /** Server time at which remote players are drawn. */
  renderTime(): number {
    return this.conn.serverNow() - NET.interpDelayMs;
  }

  update(dt: number) {
    const t = this.renderTime();
    for (const p of this.players.values()) p.update(t, dt);
  }

  render(dt: number) {
    for (const p of this.players.values()) p.render(dt);
    for (const [id, c] of this.corpses) {
      c.render(dt);
      if (c.gone) {
        c.dispose();
        this.corpses.delete(id);
      }
    }
  }

  setDebug(v: boolean) {
    for (const p of this.players.values()) p.setDebug(v);
  }

  targets(): RemotePlayer[] {
    return [...this.players.values()];
  }

  dispose() {
    for (const p of this.players.values()) p.dispose();
    for (const c of this.corpses.values()) c.dispose();
    this.players.clear();
    this.corpses.clear();
  }
}
