// Data-driven firearm logic (section 6/7): fire rate, magazine, reloads, four-state spread with bloom,
// semi-deterministic recoil pattern, ADS and the sprint-out delay. Pure game logic, no rendering.
import type { WeaponData } from '@shared/weapons';

export interface WeaponInput {
  fireHeld: boolean;
  firePressed: boolean;
  adsHeld: boolean;
  reloadPressed: boolean;
  /** Still sprinting this tick (the game drops sprint as soon as the trigger is pulled). */
  sprinting: boolean;
  grounded: boolean;
  crouched: boolean;
  speed: number;
}

export interface WeaponHooks {
  /** Called once per bullet with the spread offset (radians) to apply around the aim direction. */
  shoot(spreadRad: number, shotIndex: number): void;
  dryFire(): void;
  reloadStart(duration: number, empty: boolean): void;
  reloadEnd(): void;
}

const DEG = Math.PI / 180;

export class Weapon {
  mag: number;
  reserve: number;
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  /** Current recoil offset in degrees, added to the camera aim (pitch up, yaw sideways). */
  recoilPitch = 0;
  recoilYaw = 0;
  reloadTimer = 0;
  reloadDuration = 0;
  /** Reload time multiplier of the body holding it (PCD: no hand or arm reloads slower). */
  reloadMul = 1;
  reloading = false;
  private reloadEmpty = false;
  private cooldown = 0;
  private bloom = 0;
  private sinceShot = 99;
  private shotIndex = 0;
  private semiLatch = false;

  constructor(
    public data: WeaponData,
    private hooks: WeaponHooks,
  ) {
    this.mag = data.pente;
    this.reserve = data.reserva;
  }

  /**
   * Switches to another level of the gun mid-life. Ammo carries over (up to the new capacities), so a level
   * up is not a free reload.
   */
  setData(d: WeaponData) {
    if (d === this.data) return;
    this.data = d;
    this.mag = Math.min(this.mag, d.pente);
    this.reserve = Math.min(this.reserve, d.reserva);
  }

  get reloadProgress(): number | null {
    return this.reloading ? Math.min(1, this.reloadTimer / this.reloadDuration) : null;
  }

  /** Cone half-angle in degrees for the current movement state (also drives the dynamic crosshair). */
  spreadDeg(input: Pick<WeaponInput, 'grounded' | 'sprinting' | 'speed' | 'crouched'>): number {
    const d = this.data.dispersao;
    let base = !input.grounded || input.sprinting ? d.noAr : input.speed > 0.6 ? d.andando : d.parado;
    if (input.crouched && input.grounded) base *= 0.8;
    const hip = base + this.bloom;
    const aimed = d.mirando + this.bloom * 0.25;
    return hip + (aimed - hip) * this.ads;
  }

  /** Knife and humiliations interrupt a reload; the magazine is untouched and R starts over. */
  cancelReload() {
    this.reloading = false;
  }

  refill() {
    this.mag = this.data.pente;
    this.reserve = this.data.reserva;
    this.reloading = false;
    this.recoilPitch = this.recoilYaw = this.bloom = 0;
  }

  update(dt: number, input: WeaponInput) {
    const d = this.data;

    // ADS blends in over ads.tempo seconds; sprinting drops it.
    const adsTarget = input.adsHeld && !input.sprinting ? 1 : 0;
    const adsRate = dt / d.ads.tempo;
    this.ads = adsTarget === 1 ? Math.min(1, this.ads + adsRate) : Math.max(0, this.ads - adsRate * 1.3);

    this.sinceShot += dt;
    if (this.sinceShot > 0.35) this.shotIndex = 0;

    // Reload.
    if (input.reloadPressed) this.startReload();
    if (this.reloading) {
      this.reloadTimer += dt;
      if (this.reloadTimer >= this.reloadDuration) {
        const needed = d.pente - this.mag;
        const moved = Math.min(needed, this.reserve);
        this.mag += moved;
        this.reserve -= moved;
        this.reloading = false;
        this.hooks.reloadEnd();
      }
    }

    // Fire.
    this.cooldown -= dt;
    // A tap shorter than one tick still fires (firePressed is latched until consumed).
    const trigger = d.modo === 'auto' ? input.fireHeld || input.firePressed : input.firePressed || (input.fireHeld && !this.semiLatch);
    if (!input.fireHeld) this.semiLatch = false;
    // Shots have priority: pulling the trigger ends the sprint, so only a sprint still active blocks it.
    const sprintBlocked = input.sprinting;
    if (trigger && !sprintBlocked && !this.reloading) {
      if (this.mag <= 0) {
        if (input.firePressed) {
          if (this.reserve > 0) this.startReload();
          else this.hooks.dryFire();
        }
      } else {
        const interval = 60 / d.cadencia;
        let guard = 0;
        while (this.cooldown <= 0 && this.mag > 0 && guard++ < 4) {
          this.fireOne(input);
          this.cooldown += interval;
          if (d.modo !== 'auto') {
            this.semiLatch = true;
            break;
          }
        }
      }
    }
    if (this.cooldown < 0) this.cooldown = 0;

    // Bloom and recoil recovery. Recoil recovers slowly while firing and fully once you stop.
    if (this.sinceShot > 0.08) this.bloom = Math.max(0, this.bloom - d.dispersao.decaimento * dt);
    const recover = Math.exp(-d.recuo.retorno * dt * (this.sinceShot < 0.12 ? 0.25 : 1));
    this.recoilPitch *= recover;
    this.recoilYaw *= recover;
  }

  private fireOne(input: WeaponInput) {
    const d = this.data;
    // The shot uses the aim before this shot's kick: the first bullet goes where the crosshair is.
    this.hooks.shoot(this.spreadDeg(input) * DEG, this.shotIndex);
    this.mag--;
    this.sinceShot = 0;
    this.bloom = Math.min(this.bloom + d.dispersao.porTiro, d.dispersao.noAr);

    // Semi-deterministic pattern: climbs and drifts to one side, with a little noise.
    const [hMin, hMax] = d.recuo.horizontal;
    const side = 0.5 + 0.5 * Math.sin(this.shotIndex * 0.9 + 0.6);
    const aimMul = 1 - this.ads * 0.25;
    this.recoilPitch += d.recuo.vertical * (0.9 + Math.random() * 0.2) * aimMul;
    this.recoilYaw += (hMin + (hMax - hMin) * side + (Math.random() - 0.5) * 0.1) * aimMul;
    this.shotIndex++;
  }

  private startReload() {
    if (this.reloading || this.mag >= this.data.pente || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadEmpty = this.mag === 0;
    this.reloadTimer = 0;
    this.reloadDuration = (this.reloadEmpty ? this.data.recarga.vazia : this.data.recarga.tatica) * this.reloadMul;
    this.hooks.reloadStart(this.reloadDuration, this.reloadEmpty);
  }
}
