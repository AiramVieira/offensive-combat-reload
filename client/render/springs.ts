// Damped springs (spring-damper) for the procedural first-person layers: each value is pulled toward a
// target by a stiffness and slowed by a damping, so motion lags, overshoots a little and settles, and
// impulses (a shot, a landing) add velocity instead of snapping the position.

export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  constructor(
    /** Pull toward the target (1/s²). */
    public stiffness: number,
    /** Damping (1/s): 2·√stiffness is critical (no overshoot). */
    public damping: number,
  ) {}

  /** A spring that settles in about `time` seconds; `bounce` 0 = critically damped, up to ~0.5 = springy. */
  static settling(time: number, bounce = 0): Spring {
    const w = 4.7 / time;
    return new Spring(w * w, 2 * w * (1 - bounce));
  }

  /** Re-tunes it in place (the tuning panel changes the numbers live). */
  tune(time: number, bounce = 0) {
    const w = 4.7 / Math.max(0.01, time);
    this.stiffness = w * w;
    this.damping = 2 * w * (1 - bounce);
  }

  impulse(v: number) {
    this.velocity += v;
  }

  /** Semi-implicit Euler in small steps (stable at any frame rate). */
  update(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (-this.stiffness * (this.value - this.target) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}
