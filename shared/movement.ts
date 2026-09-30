// First-person movement step, shared between client prediction and (later) the authoritative server.
// Pure function of (state, input, dt) plus the Rapier world, so both sides produce the same result.
import { Ray, QueryFilterFlags, Cylinder } from '@dimforge/rapier3d-compat';
import type { World, Collider, RigidBody, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { MOVE, GROUP, groups } from './constants';

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  ads: boolean;
  yaw: number;
  /** Weapon movement multiplier (e.g. 0.9 for snipers). */
  speedMul: number;
  /** Melee lunge: overrides horizontal velocity while set (m/s, world space). */
  lunge?: { x: number; z: number } | null;
}

export interface MoveState {
  vel: { x: number; y: number; z: number };
  grounded: boolean;
  crouched: boolean;
  /** 0 = standing eye height, 1 = crouched eye height (smoothed). */
  crouchT: number;
  sprinting: boolean;
  jumpHeld: boolean;
  airPeakY: number;
  sliding: boolean;
  /** Seconds into the current slide. */
  slideT: number;
  slideCooldown: number;
  crouchHeld: boolean;
  // Per-tick events, reset at the start of every step.
  jumped: boolean;
  landed: boolean;
  fallHeight: number;
  slideStarted: boolean;
  /** Normal of the walkable surface under the player (from the last step's contacts). */
  groundNormal: { x: number; y: number; z: number };
}

export interface MoveBody {
  world: World;
  body: RigidBody;
  collider: Collider;
  controller: KinematicCharacterController;
  /** The character's own hitbox/blocker body (it follows the character): never collide with yourself. */
  ignoreBody?: RigidBody;
}

/** Cylinder half-heights = distance from the collider center to the feet. */
export const HALF_STAND = MOVE.heightStand / 2;
export const HALF_CROUCH = MOVE.heightCrouch / 2;
const CROUCH_DROP = HALF_STAND - HALF_CROUCH;
const JUMP_VELOCITY = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
const MIN_WALKABLE_Y = Math.cos(((MOVE.maxSlopeDeg + 1) * Math.PI) / 180);
const MOVE_GROUPS = groups(GROUP.PLAYER, GROUP.WORLD | GROUP.BLOCKER);
const HEADROOM_GROUPS = groups(GROUP.PLAYER, GROUP.WORLD | GROUP.BLOCKER);
const OVERLAP_GROUPS = groups(GROUP.PLAYER, GROUP.BLOCKER);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

// Probe = player cylinder grown by the controller's contact gap, to find blockers we touch or penetrate.
const GAP = 0.02;
/** Skin width the character controllers are created with (world.createCharacterController(offset)). */
export const CONTROLLER_OFFSET = 0.02;
const MAX_PUSH = 0.08;
let probes: { stand: Cylinder; crouch: Cylinder } | null = null;
const stillInside = new Set<number>();
const candidates: Collider[] = [];

/**
 * Pushes the player out of movable blockers (other characters) they overlap, e.g. a dummy that respawned on
 * top of them. Rapier's character controller refuses to move while penetrating anything, even away from it,
 * so without this the player is frozen. Returns blockers still overlapped after this tick's push (deep
 * overlaps resolve over a few ticks); those are ignored by the controller for this step.
 */
function resolveBlockerOverlaps(b: MoveBody, s: MoveState): Set<number> {
  probes ??= { stand: new Cylinder(HALF_STAND + GAP, MOVE.radius + GAP), crouch: new Cylinder(HALF_CROUCH + GAP, MOVE.radius + GAP) };
  stillInside.clear();
  candidates.length = 0;
  const c = b.body.translation();
  b.world.intersectionsWithShape(c, IDENTITY, s.crouched ? probes.crouch : probes.stand, (col) => {
    candidates.push(col);
    return true;
  }, QueryFilterFlags.EXCLUDE_SENSORS, OVERLAP_GROUPS, b.collider, b.ignoreBody);

  let px = 0;
  let pz = 0;
  for (const col of candidates) {
    const contact = b.collider.contactCollider(col, GAP);
    if (!contact || contact.distance >= GAP * 0.5) continue;
    const need = GAP - contact.distance;
    // normal1 points out of the player toward the blocker: push the opposite way, horizontally.
    let nx = -contact.normal1.x;
    let nz = -contact.normal1.z;
    const len = Math.hypot(nx, nz);
    if (len < 1e-3) {
      nx = 1;
      nz = 0;
    } else {
      nx /= len;
      nz /= len;
    }
    const amount = Math.min(MAX_PUSH, need);
    px += nx * amount;
    pz += nz * amount;
    if (need > MAX_PUSH) stillInside.add(col.handle);
  }
  if (px !== 0 || pz !== 0) {
    const next = { x: c.x + px, y: c.y, z: c.z + pz };
    b.body.setTranslation(next, true);
    b.collider.setTranslation(next);
  }
  return stillInside;
}

export function createMoveState(): MoveState {
  return {
    vel: { x: 0, y: 0, z: 0 },
    grounded: false,
    crouched: false,
    crouchT: 0,
    sprinting: false,
    jumpHeld: false,
    airPeakY: 0,
    sliding: false,
    slideT: 0,
    slideCooldown: 0,
    crouchHeld: false,
    jumped: false,
    landed: false,
    fallHeight: 0,
    slideStarted: false,
    groundNormal: { x: 0, y: 1, z: 0 },
  };
}

export function configureController(controller: KinematicCharacterController) {
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle((MOVE.maxSlopeDeg * Math.PI) / 180);
  controller.setMinSlopeSlideAngle(((MOVE.maxSlopeDeg + 5) * Math.PI) / 180);
  controller.enableAutostep(MOVE.stepHeight, 0.2, false);
  // Snapping down is done by stepMovement's settle pass (see there).
  controller.disableSnapToGround();
  controller.setApplyImpulsesToDynamicBodies(false);
}

export function feetY(b: MoveBody, s: MoveState): number {
  const half = s.crouched ? HALF_CROUCH : HALF_STAND;
  return b.body.translation().y - half;
}

export function eyeHeight(s: MoveState): number {
  return MOVE.eyeStand + (MOVE.eyeCrouch - MOVE.eyeStand) * s.crouchT;
}

function hasHeadroom(b: MoveBody): boolean {
  const c = b.body.translation();
  const reach = HALF_CROUCH + CROUCH_DROP * 2 + 0.02;
  const r = MOVE.radius * 0.7;
  const offsets = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
  for (const [ox, oz] of offsets) {
    const ray = new Ray({ x: c.x + ox, y: c.y, z: c.z + oz }, { x: 0, y: 1, z: 0 });
    if (b.world.castRay(ray, reach, true, QueryFilterFlags.EXCLUDE_SENSORS, HEADROOM_GROUPS, b.collider, b.ignoreBody)) return false;
  }
  return true;
}

/** Steps and ramps down to this far below the feet keep you on the ground instead of starting a fall. */
const SNAP_DISTANCE = 0.35;
/**
 * Resting height of the feet over the floor: a little more than the controller's skin width, so the move
 * pass never grazes the edge of the next floor piece (its skin-width contact there slowed that tick).
 */
const REST_HEIGHT = CONTROLLER_OFFSET + 0.01;

let floorProbes: { stand: Cylinder; crouch: Cylinder } | null = null;

/**
 * Walkable floor under the character centered at `at`: how far the feet are above their resting height
 * (REST_HEIGHT), from a cast of the whole cylinder (the rim still finds a ramp or step the center is past),
 * and the slope there from a ray at the center, which returns the face normal even on an internal edge.
 */
function probeFloor(b: MoveBody, s: MoveState, at: { x: number; y: number; z: number }, half: number, filter?: (c: Collider) => boolean) {
  floorProbes ??= { stand: new Cylinder(HALF_STAND, MOVE.radius), crouch: new Cylinder(HALF_CROUCH, MOVE.radius) };
  const cast = b.world.castShape(at, IDENTITY, { x: 0, y: -1, z: 0 }, s.crouched ? floorProbes.crouch : floorProbes.stand, 0, CONTROLLER_OFFSET + SNAP_DISTANCE, false, QueryFilterFlags.EXCLUDE_SENSORS, MOVE_GROUPS, b.collider, b.ignoreBody, filter);
  if (!cast) return null;
  const ray = b.world.castRayAndGetNormal(new Ray(at, { x: 0, y: -1, z: 0 }), half + CONTROLLER_OFFSET + SNAP_DISTANCE + 0.3, true, QueryFilterFlags.EXCLUDE_SENSORS, MOVE_GROUPS, b.collider, b.ignoreBody, filter);
  const n = ray && ray.normal.y > MIN_WALKABLE_Y ? ray.normal : cast.normal2;
  if (n.y <= MIN_WALKABLE_Y) return null;
  return { gap: cast.time_of_impact - REST_HEIGHT, normal: { x: n.x, y: n.y, z: n.z } };
}

/** Whether jump goes down this step (same rule the vertical section uses), without consuming it. */
function jumpPressedPeek(input: MoveInput, s: MoveState): boolean {
  return input.jump && !s.jumpHeld;
}

function setCrouched(b: MoveBody, s: MoveState, crouched: boolean) {
  // Keep the feet planted: shrink/grow the capsule and move its center by the height difference.
  const c = b.body.translation();
  const dy = crouched ? -CROUCH_DROP : CROUCH_DROP;
  const next = { x: c.x, y: c.y + dy, z: c.z };
  b.collider.setHalfHeight(crouched ? HALF_CROUCH : HALF_STAND);
  b.body.setTranslation(next, true);
  b.collider.setTranslation(next);
  s.crouched = crouched;
}

export function stepMovement(b: MoveBody, s: MoveState, input: MoveInput, dt: number) {
  s.jumped = false;
  s.landed = false;
  s.fallHeight = 0;
  s.slideStarted = false;
  const wasGrounded = s.grounded;
  const crouchPressed = input.crouch && !s.crouchHeld;
  s.crouchHeld = input.crouch;
  s.slideCooldown = Math.max(0, s.slideCooldown - dt);

  // Crouch (jumping while crouched stands you up if there is room).
  const wantCrouch = input.crouch && !(input.jump && !s.jumpHeld);
  if (wantCrouch && !s.crouched) setCrouched(b, s, true);
  else if (!wantCrouch && s.crouched && hasHeadroom(b)) setCrouched(b, s, false);
  const crouchTarget = s.crouched ? 1 : 0;
  s.crouchT += (crouchTarget - s.crouchT) * Math.min(1, MOVE.crouchTransition * dt);

  // Wish direction relative to the camera yaw (camera looks down -Z at yaw 0).
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = -sin * input.forward + cos * input.right;
  let wz = -cos * input.forward - sin * input.right;
  const wlen = Math.hypot(wx, wz);
  if (wlen > 1) {
    wx /= wlen;
    wz /= wlen;
  }

  // Slide: pressing crouch while sprinting on the ground. Checked before `sprinting` is recomputed (the
  // crouch just pressed would otherwise cancel the sprint first).
  const hSpeed = Math.hypot(s.vel.x, s.vel.z);
  if (!s.sliding && crouchPressed && s.grounded && s.slideCooldown <= 0 && !input.lunge && (s.sprinting || hSpeed > MOVE.walkSpeed + 0.5)) {
    const dx = hSpeed > 0.5 ? s.vel.x / hSpeed : wx;
    const dz = hSpeed > 0.5 ? s.vel.z / hSpeed : wz;
    const boosted = Math.min(MOVE.slideMaxSpeed, Math.max(hSpeed, MOVE.sprintSpeed * input.speedMul) + MOVE.slideBoost);
    s.vel.x = dx * boosted;
    s.vel.z = dz * boosted;
    s.sliding = true;
    s.slideT = 0;
    s.slideStarted = true;
  }
  if (s.sliding) {
    s.slideT += dt;
    const speedNow = Math.hypot(s.vel.x, s.vel.z);
    // Releasing crouch stands up, jumping keeps the momentum (slide-jump), leaving the ground ends it.
    if (!input.crouch || jumpPressedPeek(input, s) || !s.grounded || s.slideT > MOVE.slideMaxTime || speedNow < MOVE.slideMinSpeed || input.lunge) {
      s.sliding = false;
      s.slideCooldown = MOVE.slideCooldown;
    }
  }

  s.sprinting = !s.sliding && input.sprint && input.forward > 0 && !s.crouched && !input.ads && (s.grounded || s.sprinting);
  const baseSpeed = s.crouched
    ? MOVE.crouchSpeed
    : input.ads
      ? MOVE.adsSpeed
      : s.sprinting
        ? MOVE.sprintSpeed
        : MOVE.walkSpeed;
  const speed = baseSpeed * input.speedMul;
  const tx = wx * speed;
  const tz = wz * speed;

  // Accelerate horizontally toward the target velocity; stops almost instantly on the ground.
  if (input.lunge) {
    s.vel.x = input.lunge.x;
    s.vel.z = input.lunge.z;
    s.sprinting = false;
  } else if (s.sliding) {
    // Friction bleeds the speed off; the movement keys bend the direction a little.
    let speedNow = Math.hypot(s.vel.x, s.vel.z);
    let dx = s.vel.x / speedNow;
    let dz = s.vel.z / speedNow;
    if (wlen > 0.01) {
      // Signed angle from the slide direction to the wish direction, turned at most slideSteer rad/s.
      const turn = Math.atan2(dx * wz - dz * wx, dx * wx + dz * wz);
      const step = Math.max(-MOVE.slideSteer * dt, Math.min(MOVE.slideSteer * dt, turn));
      const c = Math.cos(step);
      const sn = Math.sin(step);
      [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
    }
    speedNow = Math.max(0, speedNow - MOVE.slideFriction * dt);
    s.vel.x = dx * speedNow;
    s.vel.z = dz * speedNow;
  } else if (s.grounded || wlen > 0.01) {
    const prevSpeed = Math.hypot(s.vel.x, s.vel.z);
    const accel = MOVE.groundAccel * (s.grounded ? 1 : MOVE.airControl);
    const dx = tx - s.vel.x;
    const dz = tz - s.vel.z;
    const dlen = Math.hypot(dx, dz);
    const maxDelta = accel * dt;
    if (dlen <= maxDelta || dlen === 0) {
      s.vel.x = tx;
      s.vel.z = tz;
    } else {
      s.vel.x += (dx / dlen) * maxDelta;
      s.vel.z += (dz / dlen) * maxDelta;
    }
    // In the air (and on the tick you jump) the keys steer but never brake below the speed you had: keeps
    // slide-jumps and sprint-jumps fast. Landing brakes normally.
    if ((!s.grounded || jumpPressedPeek(input, s)) && prevSpeed > speed) {
      const now = Math.hypot(s.vel.x, s.vel.z);
      if (now > 0 && now < prevSpeed) {
        s.vel.x *= prevSpeed / now;
        s.vel.z *= prevSpeed / now;
      }
    }
  }

  // Vertical.
  const jumpPressed = input.jump && !s.jumpHeld;
  s.jumpHeld = input.jump;
  if (s.grounded && jumpPressed && !s.crouched) {
    s.vel.y = JUMP_VELOCITY;
    s.grounded = false;
    s.jumped = true;
  } else if (s.grounded && s.vel.y <= 0) {
    // No downward push while standing: pressing into the floor every tick made the controller hit it at
    // distance ~0, and every few ticks it spent the whole horizontal move on that hit (a one-tick freeze
    // while walking on flat ground). Snap-to-ground keeps us on steps, ramps and curbs going down.
    s.vel.y = 0;
  } else {
    s.vel.y -= MOVE.gravity * dt;
  }

  const desired = { x: s.vel.x * dt, y: s.vel.y * dt, z: s.vel.z * dt };
  // On a slope, move along the surface: same horizontal distance, plus the rise/fall of the plane. Left to
  // itself the controller projects horizontal motion onto the slope and loses ~half the speed going up.
  const n = s.groundNormal;
  if (s.grounded && s.vel.y <= 0 && n.y < 0.999 && n.y > MIN_WALKABLE_Y) {
    desired.y = -(n.x * desired.x + n.z * desired.z) / n.y - 0.002;
  }
  const inside = resolveBlockerOverlaps(b, s);
  const own = b.ignoreBody;
  const filter =
    inside.size > 0 || own
      ? (c: Collider) => !inside.has(c.handle) && (!own || c.parent()?.handle !== own.handle)
      : undefined;
  // Two passes. 1) The move itself, hovering at the controller's skin width: nothing touches the floor, so
  // floor seams can't interfere. 2) Settle straight down onto the floor measured by a ray (our own
  // snap-to-ground). Rapier's built-in snap and a constant downward push both cast the character into the
  // floor every tick; at internal edges (two floor pieces side by side, triangle edges) those casts return
  // tilted normals that bump the player up, and sometimes swallow the whole horizontal move (a freeze).
  b.controller.computeColliderMovement(b.collider, desired, QueryFilterFlags.EXCLUDE_SENSORS, MOVE_GROUPS, filter);
  const m1 = b.controller.computedMovement();
  const moved = { x: m1.x, y: m1.y, z: m1.z };
  s.grounded = b.controller.computedGrounded();
  const start = b.body.translation();
  const half = s.crouched ? HALF_CROUCH : HALF_STAND;
  const at = { x: start.x + moved.x, y: start.y + moved.y, z: start.z + moved.z };
  const floor = !s.jumped && s.vel.y <= 0 ? probeFloor(b, s, at, half, filter) : null;
  if (floor && (wasGrounded || s.grounded) && floor.gap <= SNAP_DISTANCE) {
    if (Math.abs(floor.gap) > 0.001) {
      b.collider.setTranslation(at);
      b.controller.computeColliderMovement(b.collider, { x: 0, y: -floor.gap, z: 0 }, QueryFilterFlags.EXCLUDE_SENSORS, MOVE_GROUPS, filter);
      const m2 = b.controller.computedMovement();
      moved.x += m2.x;
      moved.y += m2.y;
      moved.z += m2.z;
      b.collider.setTranslation(start);
    }
    s.grounded = true;
    // The face under us, not a contact normal (those tilt at edges): drives slope-following next step.
    s.groundNormal = floor.normal;
  } else {
    s.groundNormal = { x: 0, y: 1, z: 0 };
  }

  // Hit a ceiling: kill upward velocity. Horizontal velocity is not fed back from the collision result:
  // the controller already slides along walls, and feeding it back would slow the player on ramps.
  if (s.vel.y > 0 && moved.y < desired.y * 0.5) s.vel.y = 0;

  const c = b.body.translation();
  b.body.setNextKinematicTranslation({ x: c.x + moved.x, y: c.y + moved.y, z: c.z + moved.z });

  // Fall tracking uses the feet height after this step.
  const fy = c.y + moved.y - half;
  if (!s.grounded) {
    if (wasGrounded) s.airPeakY = fy;
    s.airPeakY = Math.max(s.airPeakY, fy);
  } else {
    if (!wasGrounded) {
      s.landed = true;
      s.fallHeight = Math.max(0, s.airPeakY - fy);
      if (s.vel.y < 0) s.vel.y = 0;
    }
    s.airPeakY = fy;
  }
}
