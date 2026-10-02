// Procedural third-person animation (there are no clips yet), in two layers on the canonical rig:
// - lower body: locomotion with planted feet. Each foot has a target on the ground (stance: it stays put
//   while the body moves over it; swing: it lifts and moves ahead), solved with two-bone IK, so the stride
//   matches the speed in any direction (forward, back, strafe, diagonals: an 8-way blend for free), the
//   crouch bends the knees with the feet on the ground, and the slide stretches the legs ahead. The lower
//   body turns in place only after the torso has twisted 60° (turn in place);
// - upper body: the view pitch spread over spine 30%, chest 40%, head 30% (aim offset, ±70°), the rifle in
//   both hands by IK (right hand on the grip, left under the handguard) for hip fire, ADS and sprint, and
//   short additive layers on top: recoil on every shot, reload, knife, grenade, hit reaction, landing.
// Also the unarmed idle and walk of the editor, the victory dance and the fall. Every "feel" number is in
// ANIM. The hitbox skeleton (entities/rig.ts) runs the same animator, so hitboxes follow these poses.
import * as THREE from 'three';
import { AssetRegistry } from './registry';
import { SOCKETS } from './rig';

/**
 * What the animator moves: bones by canonical name, the group the fall rotates, and the hands' grip. The
 * full Character is one; the hitbox skeleton (entities/rig.ts) is another, so hitboxes follow the same pose.
 */
export interface Posable {
  readonly bones: Record<string, THREE.Bone>;
  readonly body: THREE.Object3D;
  setGrip(left: number, right: number): void;
  /** Build of the body ('magro' | 'medio' | 'gordo'): a bigger belly and hips push the arms out. */
  readonly bodyBuild?: string;
}

export interface AvatarPose {
  /** Horizontal speed (m/s); used as forward speed when `vel` is missing. */
  speed: number;
  /** Horizontal velocity in world space (drives the 8-way locomotion). */
  vel?: { x: number; z: number };
  /** View yaw (the root's rotation): turning the view twists the torso first (turn in place). */
  yaw?: number;
  crouch: boolean;
  slide?: boolean;
  sprint?: boolean;
  /** On the ground (false = jumping or falling). Default true. */
  grounded?: boolean;
  /** View pitch (radians): the torso, head and rifle follow it. */
  pitch: number;
  ads: boolean;
  reload: boolean;
  knife: boolean;
  cook: boolean;
}

/** Every "feel" parameter of the animation, in one place (tunable live with F6). */
export const ANIM = {
  /** Hips height standing, crouched, sliding (m). */
  hips: { stand: 0.925, crouch: 0.56, slide: 0.36, crouchBack: 0.07 },
  /** Ankle height and stance width. */
  foot: { y: 0.08, x: 0.1 },
  /** Half stride (m) = min + perSpeed × speed, up to max. */
  stride: { min: 0.1, perSpeed: 0.105, max: 0.72 },
  /** Foot lift in the swing (m). */
  lift: { walk: 0.09, run: 0.17, crouch: 0.06 },
  /** Hips bob per step (m). */
  bob: 0.025,
  /** Torso lean (rad): running forward, crouched forward, sliding back. */
  lean: { run: -0.16, crouch: -0.3, slide: 0.38 },
  /** Aim offset: share of the pitch on spine, chest and head; limit. */
  pitch: { spine: 0.3, chest: 0.4, head: 0.3, limit: (70 * Math.PI) / 180 },
  /** The torso twists up to this much before the feet turn (rad), and the turn speed (rad/s). */
  turn: { limit: (60 * Math.PI) / 180, speed: 7 },
  /** Rifle (grip) in the chest bone's space: hip fire, aiming down the sights, sprinting. */
  rifle: {
    hip: { pos: [0.115, 0.09, -0.27], rot: [0, 0.06, 0] },
    ads: { pos: [0.035, 0.305, -0.29], rot: [0, 0, 0] },
    sprint: { pos: [0.06, 0.03, -0.24], rot: [-0.55, 0.75, 0.3] },
  },
  /** Where the left hand holds the handguard, in the rifle's space. */
  leftGrip: [0, -0.03, -0.23] as [number, number, number],
  recoil: { back: 0.04, up: 0.09, chest: 0.03, decay: 14 },
  hit: { angle: 0.22, decay: 11 },
  land: { depth: 0.09, decay: 7 },
  reload: { cycle: 1.6 },
  knife: { push: 0.22, swing: 0.42 },
  /** Grenade throw: seconds, and the fraction of it where the grenade leaves the hand. */
  throw: { time: 0.5, release: 0.45 },
  /** Smoothing rates (1/s). */
  rate: { crouch: 10, ads: 12, sprint: 8, gait: 6, air: 12 },
};

const q = new THREE.Quaternion();
const e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Rifle in the right hand: the hand → rifle transform (socket offset and the item's grip). */
function rifleInHand(): THREE.Matrix4 {
  const item = AssetRegistry.get('rifle');
  const s = SOCKETS.hand_R.pos;
  const gp = item?.grip?.position ?? [0, 0, 0];
  const gr = item?.grip?.rotation ?? [0, 0, 0, 1];
  return new THREE.Matrix4()
    .makeTranslation(s[0], s[1], s[2])
    .multiply(new THREE.Matrix4().compose(new THREE.Vector3(...gp), new THREE.Quaternion(...gr), new THREE.Vector3(1, 1, 1)));
}
let handToRifleInv: THREE.Matrix4 | null = null;

// Scratch objects (the animator runs for many characters every frame).
const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mC = new THREE.Matrix4();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const basisL = new THREE.Matrix4();
const basisW = new THREE.Matrix4();

/** Limbs for the IK: the bone chain, the limb's rest direction and its hinge axis (in bone space). */
interface Limb {
  upper: string;
  lower: string;
  end: string;
  axis: THREE.Vector3;
  hinge: THREE.Vector3;
}
const limb = (kind: 'arm' | 'leg', side: 'L' | 'R'): Limb => {
  const s = side === 'L' ? -1 : 1;
  return kind === 'arm'
    ? { upper: `upperArm_${side}`, lower: `forearm_${side}`, end: `hand_${side}`, axis: new THREE.Vector3(s, 0, 0), hinge: new THREE.Vector3(0, s, 0) }
    : { upper: `thigh_${side}`, lower: `shin_${side}`, end: `foot_${side}`, axis: new THREE.Vector3(0, -1, 0), hinge: new THREE.Vector3(-1, 0, 0) };
};
const LIMBS = { armL: limb('arm', 'L'), armR: limb('arm', 'R'), legL: limb('leg', 'L'), legR: limb('leg', 'R') };

export class CharacterAnimator {
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos = new Map<THREE.Bone, THREE.Vector3>();
  /** Rest rotation with the limb swung to hang straight down (arms from the T-pose). */
  private hang = new Map<THREE.Bone, THREE.Quaternion>();
  private hipsY: number;
  // Locomotion state.
  private phase = 0;
  private gait = 0;
  private legYaw = 0;
  private lastYaw: number | null = null;
  private turning = false;
  private crouchT = 0;
  private slideT = 0;
  private sprintT = 0;
  private adsT = 0;
  private airT = 0;
  private land = 0;
  // Additive layers.
  private recoil = 0;
  private hitX = 0;
  private hitZ = 0;
  private reloadT = 0;
  private knifeT = 0;
  /** Seconds into the current knife swing (null: not swinging). */
  private knifeSwing: number | null = null;
  /** Seconds since a grenade throw started (null: none). */
  private throwT: number | null = null;
  /** The grenade is in the hand (cooking, or a throw before the release). */
  grenadeInHand = false;
  private time = 0;
  private lastIdleT: number | null = null;

  constructor(private c: Posable) {
    for (const b of Object.values(c.bones)) {
      this.rest.set(b, b.quaternion.clone());
      this.restPos.set(b, b.position.clone());
    }
    for (const side of ['L', 'R']) {
      for (const name of [`upperArm_${side}`, `forearm_${side}`, `hand_${side}`]) {
        const b = c.bones[name];
        if (!b) continue;
        const child = b.children.find((x) => (x as THREE.Bone).isBone) as THREE.Bone | undefined;
        const dirLocal = (child ? child.position : b.position).clone().normalize();
        const restQ = this.rest.get(b)!;
        const dirParent = dirLocal.clone().applyQuaternion(restQ);
        const swing = name.startsWith('upperArm') ? new THREE.Quaternion().setFromUnitVectors(dirParent, DOWN) : new THREE.Quaternion();
        this.hang.set(b, swing.multiply(restQ));
      }
    }
    this.hipsY = c.bones.hips?.position.y ?? 0.95;
    handToRifleInv ??= rifleInHand().invert();
  }

  // --- Events (additive layers) ------------------------------------------------------------------------

  /** A shot: the rifle kicks back and up, the chest a little. */
  fire() {
    this.recoil = 1;
  }

  /** A grenade throw: the left arm swings forward from the cooking pose (the grenade leaves at RELEASE). */
  throwGrenade() {
    this.throwT = 0;
  }

  /** A hit: the torso jerks along the bullet's path (`dir` in the character's space, facing -Z). */
  hitReact(dir: THREE.Vector3) {
    this.hitX = THREE.MathUtils.clamp(dir.z, -1, 1);
    this.hitZ = THREE.MathUtils.clamp(-dir.x, -1, 1);
  }

  // --- Helpers ---------------------------------------------------------------------------------------------

  private bone(name: string) {
    return this.c.bones[name];
  }

  /** Sets a bone to its rest rotation turned by an Euler (in the parent's frame). */
  private turn(name: string, x = 0, y = 0, z = 0, base: 'rest' | 'hang' = 'rest') {
    const b = this.bone(name);
    if (!b) return;
    const r = (base === 'hang' ? this.hang.get(b) : undefined) ?? this.rest.get(b)!;
    b.quaternion.copy(q.setFromEuler(e.set(x, y, z))).multiply(r);
  }

  /** Arm: angles for an arm hanging along -Y (x forward/up, z out to the side). */
  private arm(side: 'L' | 'R', x: number, y: number, z: number, elbow = 0) {
    this.turn(`upperArm_${side}`, x, y, z, 'hang');
    const fore = this.bone(`forearm_${side}`);
    if (fore) {
      const s = side === 'L' ? -1 : 1;
      fore.quaternion.copy(q.setFromEuler(e.set(0, s * elbow, 0))).multiply(this.hang.get(fore)!);
    }
    this.turn(`hand_${side}`, 0, 0, 0, 'hang');
  }

  /** Leg by rotations (dance, fall): thigh forward (x), knee bend (back, positive). */
  private leg(side: 'L' | 'R', x: number, knee = 0, z = 0) {
    this.turn(`thigh_${side}`, x, 0, z);
    this.turn(`shin_${side}`, -knee);
    this.turn(`foot_${side}`, knee * 0.35 - x * 0.2);
  }

  private reset() {
    this.c.body.rotation.set(0, 0, 0);
    this.c.body.position.set(0, 0, 0);
    for (const [b, r] of this.rest) b.quaternion.copy(r);
    const hips = this.bone('hips');
    if (hips) hips.position.copy(this.restPos.get(hips)!);
  }

  private setHipsY(dy: number) {
    const hips = this.bone('hips');
    if (hips) hips.position.y = this.hipsY + dy;
  }

  /** A bone's transform in the body's space (forward kinematics from the current local transforms). */
  private fk(bone: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    out.identity();
    const chain: THREE.Object3D[] = [];
    for (let b: THREE.Object3D | null = bone; b && b !== this.c.body; b = b.parent) chain.push(b);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(mC.compose(chain[i].position, chain[i].quaternion, chain[i].scale));
    return out;
  }

  /**
   * Two-bone IK: the end of `l` reaches `target` (body space), bending toward `pole`; the end bone takes
   * `endRot` (body space) if given. Limbs at rest point along `axis` and bend around `hinge` (bone space).
   */
  private ik(l: Limb, target: THREE.Vector3, pole: THREE.Vector3, endRot?: THREE.Quaternion) {
    const upper = this.bone(l.upper);
    const lower = this.bone(l.lower);
    const end = this.bone(l.end);
    if (!upper || !lower || !end) return;
    const parentM = this.fk(upper.parent!, mA);
    const shoulder = vA.copy(upper.position).applyMatrix4(parentM);
    const parentQ = qA.setFromRotationMatrix(parentM);
    const l1 = lower.position.length();
    const l2 = end.position.length();
    const toT = vB.subVectors(target, shoulder);
    const d = THREE.MathUtils.clamp(toT.length(), 1e-3, (l1 + l2) * 0.999);
    const dir = toT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const perp = vC.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1).addScaledVector(dir, dir.z);
    perp.normalize();
    const elbow = new THREE.Vector3().copy(shoulder).addScaledVector(dir, a).addScaledVector(perp, h);
    const reach = new THREE.Vector3().copy(shoulder).addScaledVector(dir, d);
    const dirU = new THREE.Vector3().subVectors(elbow, shoulder).normalize();
    const dirL = new THREE.Vector3().subVectors(reach, elbow).normalize();
    const hinge = new THREE.Vector3().crossVectors(dirU, dirL);
    if (hinge.lengthSq() < 1e-8) hinge.crossVectors(perp, dir);
    hinge.normalize();
    // World (body space) rotation of each segment: its rest axis onto its direction, its hinge onto the
    // bending plane's normal.
    const rot = (dirW: THREE.Vector3, out: THREE.Quaternion) => {
      basisL.makeBasis(l.axis, l.hinge, new THREE.Vector3().crossVectors(l.axis, l.hinge));
      basisW.makeBasis(dirW, hinge, new THREE.Vector3().crossVectors(dirW, hinge));
      return out.setFromRotationMatrix(basisW.multiply(basisL.transpose()));
    };
    const rU = rot(dirU, qB);
    const rL = rot(dirL, qC);
    upper.quaternion.copy(parentQ).invert().multiply(rU);
    lower.quaternion.copy(rU).invert().multiply(rL);
    if (endRot) end.quaternion.copy(rL).invert().multiply(endRot);
    else end.quaternion.identity();
  }

  // --- Lower body: locomotion -------------------------------------------------------------------------------

  /** Updates the locomotion state and poses the hips, legs and feet. Returns the torso lean. */
  private lowerBody(dt: number, s: AvatarPose): number {
    const A = ANIM;
    // The view turning twists the lower body back (its feet are planted), until the turn catches up.
    const yaw = s.yaw ?? this.lastYaw ?? 0;
    if (this.lastYaw !== null) this.legYaw = wrap(this.legYaw - wrap(yaw - this.lastYaw));
    this.lastYaw = yaw;
    // Velocity in the character's space (facing -Z).
    let vx = 0;
    let vz = -s.speed;
    if (s.vel) {
      const c = Math.cos(-yaw);
      const sn = Math.sin(-yaw);
      vx = s.vel.x * c + s.vel.z * sn;
      vz = -s.vel.x * sn + s.vel.z * c;
    }
    const speed = Math.hypot(vx, vz);
    const grounded = s.grounded ?? true;
    this.crouchT = damp(this.crouchT, s.crouch && !s.slide ? 1 : 0, A.rate.crouch, dt);
    this.slideT = damp(this.slideT, s.slide ? 1 : 0, A.rate.crouch, dt);
    this.sprintT = damp(this.sprintT, s.sprint ? 1 : 0, A.rate.sprint, dt);
    const wasAir = this.airT > 0.5;
    this.airT = damp(this.airT, grounded ? 0 : 1, A.rate.air, dt);
    if (wasAir && grounded) this.land = 1;
    this.land = damp(this.land, 0, A.land.decay, dt);
    const moving = speed > 0.35 && grounded && this.slideT < 0.5;
    this.gait = damp(this.gait, moving ? 1 : 0, A.rate.gait, dt);
    // Turn in place: the feet follow when moving, or when the torso can't twist any further.
    if (moving) this.legYaw = damp(this.legYaw, 0, 10, dt);
    else {
      if (Math.abs(this.legYaw) > A.turn.limit) this.turning = true;
      if (this.turning) {
        const step = Math.min(Math.abs(this.legYaw), A.turn.speed * dt);
        this.legYaw -= Math.sign(this.legYaw) * step;
        if (Math.abs(this.legYaw) < 0.05) this.turning = false;
      }
    }
    // Stride: half a stride per foot, so a cycle (two steps) covers 4 half strides at this speed.
    const half = THREE.MathUtils.clamp(A.stride.min + A.stride.perSpeed * speed, A.stride.min, A.stride.max) * (1 - 0.35 * this.crouchT);
    const rate = moving ? speed / (4 * half) : this.turning ? 2.2 : this.gait > 0.05 ? 1.2 : 0;
    this.phase = (this.phase + rate * dt) % 1;
    const stepW = Math.max(this.gait, this.turning ? 0.6 : 0);
    const run = THREE.MathUtils.clamp((speed - 3) / 3, 0, 1);
    const lift = THREE.MathUtils.lerp(THREE.MathUtils.lerp(A.lift.walk, A.lift.run, run), A.lift.crouch, this.crouchT);
    const mx = speed > 0.01 ? vx / speed : 0;
    const mz = speed > 0.01 ? vz / speed : -1;

    // Hips: height (crouch, slide, bob, landing), sitting back when crouched, yaw of the lower body.
    const bob = A.bob * Math.abs(Math.cos(this.phase * Math.PI * 2)) * this.gait;
    let hy = THREE.MathUtils.lerp(A.hips.stand, A.hips.crouch, this.crouchT) - bob - 0.03 * run * this.gait - A.land.depth * this.land;
    hy = THREE.MathUtils.lerp(hy, A.hips.slide, this.slideT);
    const hips = this.bone('hips');
    if (hips) {
      hips.position.set(0, hy, A.hips.crouchBack * this.crouchT);
      hips.quaternion.setFromEuler(e.set(-0.18 * this.crouchT - 0.25 * this.slideT, this.legYaw, 0.04 * Math.sin(this.phase * Math.PI * 2) * this.gait));
    }

    // Feet: planted (stance) or stepping (swing), in the lower body's frame, then IK.
    const legQ = qA.setFromAxisAngle(Y, this.legYaw).clone();
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? -1 : 1;
      const ph = (this.phase + (side === 'L' ? 0.5 : 0)) % 1;
      let off: number;
      let up: number;
      if (ph < 0.5) {
        off = half - 2 * half * (ph / 0.5);
        up = 0;
      } else {
        const u = (ph - 0.5) / 0.5;
        off = -half + 2 * half * smooth(u);
        up = lift * Math.sin(Math.PI * u);
      }
      // Crouched stance: one foot ahead, one behind.
      const stanceZ = this.crouchT * (side === 'L' ? -0.12 : 0.14);
      const target = new THREE.Vector3(sx * A.foot.x, A.foot.y, stanceZ);
      target.x += mx * off * this.gait;
      target.z += mz * off * this.gait;
      target.y += up * stepW + 0.26 * this.airT * (side === 'L' ? 1 : 0.7);
      // Sliding: legs stretched ahead.
      target.lerp(new THREE.Vector3(sx * 0.13, A.foot.y + 0.02, side === 'L' ? -0.62 : -0.44), this.slideT);
      target.applyQuaternion(legQ);
      const pole = new THREE.Vector3(sx * 0.15, 0, -1).applyQuaternion(legQ);
      // The foot stays flat (its toe lifts a little in the swing).
      const footQ = legQ.clone().multiply(q.setFromEuler(e.set(ph >= 0.5 ? 0.25 * Math.sin(Math.PI * ((ph - 0.5) / 0.5)) * stepW : 0, 0, 0)));
      this.ik(side === 'L' ? LIMBS.legL : LIMBS.legR, target, pole, footQ);
    }
    // Torso lean: forward running and crouched, back when sliding; the walk twists the spine a little.
    return A.lean.run * run * this.gait * (0.5 + 0.5 * this.sprintT) + A.lean.crouch * this.crouchT + A.lean.slide * this.slideT;
  }

  /** Spine, chest and head: lean, twist back toward the view (turn in place), aim pitch, hit reaction. */
  private torso(dt: number, pitch: number, lean: number, breathe = 0) {
    const A = ANIM;
    const p = THREE.MathUtils.clamp(pitch, -A.pitch.limit, A.pitch.limit);
    this.recoil = damp(this.recoil, 0, A.recoil.decay, dt);
    this.hitX = damp(this.hitX, 0, A.hit.decay, dt);
    this.hitZ = damp(this.hitZ, 0, A.hit.decay, dt);
    const twist = -this.legYaw;
    const sway = 0.06 * Math.sin(this.phase * Math.PI * 2) * this.gait;
    const hx = this.hitX * A.hit.angle;
    const hz = this.hitZ * A.hit.angle;
    // The hips are tilted forward when crouched/back when sliding: the spine takes the rest of the lean.
    const hipTilt = -0.18 * this.crouchT - 0.25 * this.slideT;
    this.turn('spine', p * A.pitch.spine + (lean - hipTilt) * 0.5 + hx * 0.6, twist * 0.5 + sway, hz * 0.6);
    this.turn('chest', p * A.pitch.chest + (lean - hipTilt) * 0.5 + hx * 0.4 + breathe - A.recoil.chest * this.recoil, twist * 0.5 - sway * 0.5, hz * 0.4);
    // The head keeps the eyes on the view: it takes back the lean.
    this.turn('head', p * A.pitch.head - lean, 0, 0);
    return p;
  }

  /**
   * Knife swing (the rifle is slung on the back meanwhile): the right hand winds up beside the head and
   * slashes across and forward, the left arm guards in front of the chest. Positions in the chest's space.
   */
  private knifeArms(dt: number) {
    this.knifeSwing = (this.knifeSwing ?? 0) + dt;
    const u = Math.min(1, this.knifeSwing / ANIM.knife.swing);
    const guard = new THREE.Vector3(0.16, 0.06, -0.3);
    const up = new THREE.Vector3(0.26, 0.3, -0.08);
    const hit = new THREE.Vector3(-0.14, -0.02, -0.5);
    const end = new THREE.Vector3(-0.08, 0.02, -0.4);
    const k = (a: number, b: number) => smooth(THREE.MathUtils.clamp((u - a) / (b - a), 0, 1));
    const right = guard.clone().lerp(up, k(0, 0.35)).lerp(hit, k(0.35, 0.6)).lerp(end, k(0.6, 1));
    const chest = this.fk(this.bone('chest')!, new THREE.Matrix4());
    this.ik(LIMBS.armR, right.applyMatrix4(chest), new THREE.Vector3(0.6, -0.7, 0.4));
    this.ik(LIMBS.armL, new THREE.Vector3(-0.12, 0.04, -0.3).applyMatrix4(chest), new THREE.Vector3(-0.7, -0.6, 0.2));
    this.c.setGrip(0.8, 1);
  }

  /** Both hands on the rifle (IK): hip fire, ADS or sprint; recoil, reload, knife and grenade on top. */
  private rifleArms(dt: number, s: AvatarPose, pitch: number, lean: number) {
    const A = ANIM;
    this.adsT = damp(this.adsT, s.ads && !s.sprint ? 1 : 0, A.rate.ads, dt);
    this.reloadT = s.reload ? this.reloadT + dt : 0;
    this.knifeT = s.knife ? Math.min(1, this.knifeT + dt * 6) : damp(this.knifeT, 0, 10, dt);
    const lerp3 = (a: readonly number[], b: readonly number[], k: number) => a.map((x, i) => x + (b[i] - x) * k);
    let pos = lerp3(A.rifle.hip.pos, A.rifle.ads.pos, this.adsT);
    let rot = lerp3(A.rifle.hip.rot, A.rifle.ads.rot, this.adsT);
    const sprint = this.sprintT * (1 - this.adsT);
    pos = lerp3(pos, A.rifle.sprint.pos, sprint);
    rot = lerp3(rot, A.rifle.sprint.rot, sprint);
    // The chest carries 70% of the pitch and the torso's lean; the rifle takes back the lean and adds the
    // head's share, so it points along the view.
    const rest = pitch * A.pitch.head - lean;
    const rifle = this.fk(this.bone('chest')!, new THREE.Matrix4()).multiply(
      mB.compose(
        new THREE.Vector3(pos[0], pos[1], pos[2] + A.recoil.back * this.recoil - A.knife.push * this.knifeT),
        qA.setFromEuler(e.set(rot[0] + rest + A.recoil.up * this.recoil - 0.35 * this.knifeT, rot[1], rot[2])),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    // Right hand: where the grip puts the rifle.
    const hand = new THREE.Matrix4().multiplyMatrices(rifle, handToRifleInv!);
    const handPos = new THREE.Vector3().setFromMatrixPosition(hand);
    const handQ = new THREE.Quaternion().setFromRotationMatrix(hand);
    this.ik(LIMBS.armR, handPos, new THREE.Vector3(0.7, -0.6, 0.35), handQ);
    // Left hand: under the handguard, palm up; to the magazine and the pouch while reloading; up and back
    // holding the grenade while cooking.
    const rifleQ = new THREE.Quaternion().setFromRotationMatrix(rifle);
    let left = new THREE.Vector3(...A.leftGrip).applyMatrix4(rifle);
    let leftQ = rifleQ.clone().multiply(q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    if (s.reload) {
      const u = (this.reloadT % A.reload.cycle) / A.reload.cycle;
      const mag = new THREE.Vector3(0, -0.08, -0.1).applyMatrix4(rifle);
      const pouch = new THREE.Vector3(-0.16 - this.spread * 0.4, 0.95, -0.1);
      // grip → magazine → pouch → magazine → grip.
      const k = u < 0.2 ? smooth(u / 0.2) : u < 0.8 ? 1 : 1 - smooth((u - 0.8) / 0.2);
      const out = u > 0.25 && u < 0.75 ? Math.sin(((u - 0.25) / 0.5) * Math.PI) : 0;
      left = left.lerp(mag, k).lerp(pouch, out);
    }
    const cookPos = new THREE.Vector3(-0.26, 1.62 - 0.37 * this.crouchT, 0.12);
    if (s.cook) {
      left = cookPos.clone();
      leftQ = q.setFromEuler(e.set(-0.6, 0, 0)).clone();
    }
    // Throw: from the cooking pose, over the shoulder and forward (release at RELEASE), then back down to the
    // handguard.
    if (this.throwT !== null) {
      this.throwT += dt;
      const T = A.throw;
      const u = this.throwT / T.time;
      if (u >= 1) this.throwT = null;
      else {
        const release = new THREE.Vector3(-0.14, 1.52 - 0.37 * this.crouchT, -0.5);
        const k1 = smooth(THREE.MathUtils.clamp(u / T.release, 0, 1));
        const k2 = smooth(THREE.MathUtils.clamp((u - T.release) / (1 - T.release), 0, 1));
        left = cookPos.clone().lerp(release, k1).lerp(left, k2);
        leftQ = q.setFromEuler(e.set(-0.6 + 1.4 * k1, 0, 0)).clone().slerp(leftQ, k2);
      }
    }
    this.grenadeInHand = s.cook || (this.throwT !== null && this.throwT < A.throw.time * A.throw.release);
    // The support elbow points out and down (not in front of the chest, where a vest or the chest itself
    // would swallow the upper arm); more on a gordo body.
    this.ik(LIMBS.armL, left, new THREE.Vector3(-0.9 - this.spread * 2, -0.5, 0.12), leftQ);
  }

  /** How far the arms spread for the body's build (radians): hanging hands clear a gordo belly and hips. */
  private get spread() {
    return this.c.bodyBuild === 'gordo' ? 0.24 : this.c.bodyBuild === 'magro' ? -0.02 : 0.03;
  }

  /** Unarmed arms swinging against the legs (the editor's walk), or hanging relaxed. */
  private looseArms(speed: number) {
    const swing = Math.sin(this.phase * Math.PI * 2) * Math.min(0.7, 0.15 + speed * 0.08) * this.gait;
    const run = speed > 5 ? 1 : 0;
    const out = 0.14 + this.spread;
    this.arm('L', swing, 0, -out, 0.15 + run * 1.1 + 0.2 * this.gait);
    this.arm('R', -swing, 0, out, 0.15 + run * 1.1 + 0.2 * this.gait);
  }

  // --- Public poses -------------------------------------------------------------------------------------------

  /** Standing, arms relaxed (`t` in seconds: breathing). */
  idle(t = 0) {
    const dt = this.lastIdleT === null ? 0 : THREE.MathUtils.clamp(t - this.lastIdleT, 0, 0.1);
    this.lastIdleT = t;
    this.reset();
    this.c.setGrip(0, 0);
    const lean = this.lowerBody(dt, { speed: 0, crouch: false, pitch: 0, ads: false, reload: false, knife: false, cook: false, yaw: this.lastYaw ?? 0 });
    this.torso(dt, 0, lean, Math.sin(t * 2) * 0.012);
    this.looseArms(0);
  }

  /** Unarmed walk / run (editor preview). */
  walk(dt: number, speed: number) {
    this.reset();
    this.c.setGrip(speed > 5 ? 0.6 : 0, speed > 5 ? 0.6 : 0);
    const lean = this.lowerBody(dt, { speed, sprint: speed > 5, crouch: false, pitch: 0, ads: false, reload: false, knife: false, cook: false, yaw: this.lastYaw ?? 0 });
    this.torso(dt, 0, lean);
    this.looseArms(speed);
  }

  /** In game, armed: locomotion, aim offset and the rifle in both hands, with the action layers on top. */
  pose(dt: number, s: AvatarPose) {
    this.reset();
    this.time += dt;
    this.c.setGrip(s.reload ? 0.4 : 0.8, 0.9);
    const lean = this.lowerBody(dt, s);
    const p = this.torso(dt, s.pitch, lean, Math.sin(this.time * 2) * 0.008 * (1 - this.gait));
    if (s.knife) {
      this.knifeArms(dt);
      this.grenadeInHand = false;
    } else {
      this.knifeSwing = null;
      this.rifleArms(dt, s, p, lean);
    }
  }

  /** "Dancinha da Vitória": raise the roof, spin, then disco pointing. `t` in seconds, 150 bpm. */
  dance(t: number) {
    this.reset();
    this.c.setGrip(0.5, 0.5);
    const b = t / 0.4;
    const bounce = Math.abs(Math.sin(b * Math.PI));
    this.setHipsY(-0.06 + bounce * 0.1);
    const hipZ = Math.sin(b * Math.PI) * 0.14;
    this.turn('hips', 0, 0, hipZ);
    this.leg('L', Math.sin(b * Math.PI) * 0.35, 0.25 * bounce);
    this.leg('R', -Math.sin(b * Math.PI) * 0.35, 0.25 * (1 - bounce));
    this.turn('spine', 0, 0, -hipZ * 1.4);
    this.turn('head', Math.sin(b * Math.PI * 2) * 0.15, 0, Math.sin(b * Math.PI) * 0.2);
    if (t < 1.6) {
      const pump = Math.sin(b * Math.PI * 2) * 0.25;
      this.arm('L', 0, 0, -2.7 - pump, 0.3);
      this.arm('R', 0, 0, 2.7 + pump, 0.3);
    } else if (t < 2.4) {
      const s = (t - 1.6) / 0.8;
      this.turn('hips', 0, THREE.MathUtils.smootherstep(s, 0, 1) * Math.PI * 2, 0);
      this.arm('L', 0, 0, -1.5);
      this.arm('R', 0, 0, 1.5);
    } else {
      const up = Math.floor(b) % 2 === 0;
      this.arm('R', 0, 0, up ? 2.6 : 0.6, 0.1);
      this.arm('L', 0, 0, up ? -0.6 : -2.6, 0.1);
    }
  }

  /** Stiff cartoon fall onto the back (`dir` 1) or face (-1), `t` seconds after death. */
  die(t: number, dir: 1 | -1 = 1) {
    this.reset();
    this.c.setGrip(0.3, 0.3);
    this.arm('L', 0, 0, -0.5, 0.3);
    this.arm('R', 0, 0, 0.5, 0.3);
    this.leg('L', 0.1, 0.2);
    this.leg('R', -0.05, 0.1);
    const k = Math.min(1, t / 0.45);
    const after = t - 0.45;
    const bounce = k < 1 ? k * k : 1 + Math.sin(after * 18) * Math.exp(-after * 7) * 0.06;
    // Fall around the feet: positive X rotation tips the top toward +Z (backward for a -Z facing body).
    this.c.body.rotation.x = dir * bounce * (Math.PI / 2 - 0.08);
  }
}

