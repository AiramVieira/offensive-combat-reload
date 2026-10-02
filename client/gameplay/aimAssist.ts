// Aim assist for touch and controllers (never the mouse), off by default (settings): console-style, it never
// drags the aim onto someone — it only helps while the crosshair is already on (or right next to) an enemy:
// - slowdown: the look slows to 40% over a body (and blends back to 100% just outside it), so the aim
//   doesn't slide off;
// - tracking: while the player is aiming (look or move input in the last moments), the view follows part of
//   the target's own movement across the screen, the way a thumb would.

import * as THREE from 'three';

export interface AssistTarget {
  /** Feet position. */
  readonly position: THREE.Vector3;
  readonly dead: boolean;
}

export interface AssistResult {
  /** Multiplier for the player's look input (1 = no effect). */
  slow: number;
  /** View rotation to add this frame (radians), following the target. */
  dYaw: number;
  dPitch: number;
}

export const ASSIST = {
  /** Look speed over a body. */
  slow: 0.4,
  /** Half width of the "on target" bubble (m), plus a small angle. */
  radius: 0.35,
  minAngle: 0.015,
  /** Share of the target's angular motion the view follows while aiming. */
  follow: 0.6,
  /** Most the tracking turns per second (rad). */
  maxRate: 1.6,
  /** Heights checked on the body (head, chest, hips). */
  heights: [1.6, 1.25, 0.95],
  /** Farthest target it considers (m). */
  range: 90,
};

const NONE: AssistResult = { slow: 1, dYaw: 0, dPitch: 0 };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class AimAssist {
  /** The target followed last frame and the angles it was at. */
  private last: { target: AssistTarget; h: number; yaw: number; pitch: number } | null = null;
  private v = new THREE.Vector3();

  /**
   * `eye`: the camera; `yaw`/`pitch`: the view (yaw 0 looks down −Z); `aiming`: the player is giving look or
   * move input. Returns the slowdown and the tracking for this frame.
   */
  update(eye: THREE.Vector3, yaw: number, pitch: number, targets: Iterable<AssistTarget>, dt: number, aiming: boolean): AssistResult {
    let best: { target: AssistTarget; h: number; yaw: number; pitch: number; err: number; bubble: number } | null = null;
    for (const t of targets) {
      if (t.dead) continue;
      for (const h of ASSIST.heights) {
        const d = this.v.copy(t.position).setY(t.position.y + h).sub(eye);
        const horiz = Math.hypot(d.x, d.z);
        const dist = Math.hypot(horiz, d.y);
        if (dist < 0.5 || dist > ASSIST.range) continue;
        const ty = Math.atan2(-d.x, -d.z);
        const tp = Math.atan2(d.y, horiz);
        // Angle between the view and the point (yaw error shrinks toward the poles).
        const err = Math.hypot(wrap(ty - yaw) * Math.cos(pitch), tp - pitch);
        const bubble = Math.atan2(ASSIST.radius, dist) + ASSIST.minAngle;
        if (err < bubble * 2 && (!best || err / bubble < best.err / best.bubble)) best = { target: t, h, yaw: ty, pitch: tp, err, bubble };
      }
    }
    if (!best) {
      this.last = null;
      return NONE;
    }
    // Full slowdown inside the bubble, back to normal at twice its size.
    const k = THREE.MathUtils.clamp((best.err - best.bubble) / best.bubble, 0, 1);
    const slow = ASSIST.slow + (1 - ASSIST.slow) * k;
    let dYaw = 0;
    let dPitch = 0;
    // Same target and the same point on it (switching from chest to head isn't motion).
    if (aiming && k < 1 && this.last && this.last.target === best.target && this.last.h === best.h) {
      // The target's motion across the view since last frame (its own movement and the player's).
      const max = ASSIST.maxRate * dt;
      dYaw = THREE.MathUtils.clamp(wrap(best.yaw - this.last.yaw) * ASSIST.follow * (1 - k), -max, max);
      dPitch = THREE.MathUtils.clamp((best.pitch - this.last.pitch) * ASSIST.follow * (1 - k), -max, max);
    }
    this.last = { target: best.target, h: best.h, yaw: best.yaw, pitch: best.pitch };
    return { slow, dYaw, dPitch };
  }
}
