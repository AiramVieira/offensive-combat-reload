// Movement feel (section 4, proposed values). Shared so the server can run the same simulation.
export const MOVE = {
  walkSpeed: 5.5,
  sprintSpeed: 8.0,
  crouchSpeed: 2.8,
  adsSpeed: 3.5,
  jumpHeight: 1.1,
  gravity: 22,
  groundAccel: 60,
  airControl: 0.3,
  eyeStand: 1.65,
  eyeCrouch: 1.05,
  stepHeight: 0.4,
  maxSlopeDeg: 45,
  fallDamageHeight: 6,
  fallDamagePerMeter: 15,
  /** Player collider is an upright cylinder: flat sides give Rapier horizontal contact normals, which autostep needs. */
  radius: 0.35,
  heightStand: 1.8,
  heightCrouch: 1.2,
  crouchTransition: 10,
  /** Slide (sprint + crouch): burst of speed that bleeds off; you can aim and shoot while sliding. */
  slideBoost: 2.2,
  slideMaxSpeed: 10.5,
  slideFriction: 7.5,
  slideMaxTime: 0.9,
  slideMinSpeed: 3.4,
  slideCooldown: 0.5,
  /** How fast the slide direction turns toward the movement keys (rad/s). */
  slideSteer: 1.2,
} as const;

export const HEALTH = {
  max: 100,
  regenDelay: 4,
  regenPerSecond: 25,
  lowThreshold: 30,
} as const;

/** Points per action (section 6). Computed server-side once multiplayer exists. */
export const SCORE = {
  kill: 100,
  headshot: 50,
  longShot: 50,
  longShotDistance: 50,
  knife: 50,
  backstab: 50,
  groin: 100,
  // Tripled: dancing on a body leaves you exposed for 3 s, it has to pay off.
  humiliation: 150,
} as const;

/** Humiliation (section 8): the corpse can be taunted for a few seconds after the kill. */
export const HUMILIATION = {
  window: 6,
  radius: 2,
  duration: 3.2,
} as const;

export const SIM = {
  dt: 1 / 60,
  maxStepsPerFrame: 5,
} as const;

// Rapier interaction groups: (membership << 16) | filter.
export const GROUP = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  HITBOX: 0x0004,
  BULLET: 0x0008,
  BLOCKER: 0x0010,
  PROJECTILE: 0x0020,
} as const;

export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);
