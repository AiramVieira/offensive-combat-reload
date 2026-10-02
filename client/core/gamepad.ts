// Console controllers (PS4, PS5, Xbox 360, Xbox One) through the browser's Gamepad API — on a computer (USB or
// Bluetooth) and on phones (Bluetooth: Chrome on Android, Safari on iPhone/iPad). The browser maps them all to
// the "standard" layout (face buttons 0–3 bottom/right/left/top, bumpers 4–5, triggers 6–7, select/start 8–9,
// stick clicks 10–11, D-pad 12–15, home 16, PS touchpad 17).
//
// In a match the controller drives the same named actions as the keyboard (core/input.ts), CoD layout:
//   L2/LT aim · R2/RT fire · L1/LB grenade (hold to cook) · R1/RB knife · ✕/A jump · ◯/B crouch (tap toggles;
//   while running it slides) · □/X reload · △/Y humiliate · L3 run (toggle) · R3 knife · Options/Menu pause ·
//   Touchpad/View scoreboard (hold).
// The left stick moves (analog), the right stick looks (dead zone, response curve, a turn boost held at the
// edge). Out of a match the controller drives the menus (ui/padNav.ts). It also rumbles on hits and damage.

import type { Action, Input } from './input';
import type { Settings } from './settings';

export type PadKind = 'playstation' | 'xbox';

/** Which input the player used last: the HUD shows that device's buttons, aim assist skips the mouse. */
export type Device = 'mouse' | 'touch' | 'pad';

const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16, touchpad: 17 } as const;
export type PadButton = keyof typeof B;

/** Button → game action (held while the button is). */
const HOLD: [PadButton, Action][] = [
  ['rt', 'fire'],
  ['lt', 'ads'],
  ['lb', 'grenade'],
  ['rb', 'melee'],
  ['r3', 'melee'],
  ['a', 'jump'],
  ['x', 'reload'],
  ['y', 'taunt'],
  ['select', 'scoreboard'],
  ['touchpad', 'scoreboard'],
];

/** Look speed at full tilt (degrees per second) at controller sensitivity 1, and the boost held at the edge. */
const LOOK_DEG_S = 220;
const EDGE_BOOST = 1.6;
const MOUSE_DEG_PER_COUNT = 0.022;
const MOVE_DEADZONE = 0.16;
const LOOK_DEADZONE = 0.12;
const TRIGGER = 0.35;

/** Button glyphs per family, for prompts and the help table. */
export const GLYPHS: Record<PadKind, Record<PadButton, string>> = {
  playstation: { a: '✕', b: '◯', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Share', start: 'Options', l3: 'L3', r3: 'R3', up: '↑', down: '↓', left: '←', right: '→', home: 'PS', touchpad: 'Touchpad' },
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'View', start: 'Menu', l3: 'L3', r3: 'R3', up: '↑', down: '↓', left: '←', right: '→', home: 'Xbox', touchpad: 'View' },
};

/**
 * Xbox by name or Microsoft's vendor id first ("Xbox Wireless Controller" also says "Wireless Controller"); then
 * Sony's (DualShock 4, DualSense; a DualShock 4 may call itself just "Wireless Controller"); anything else
 * reads as Xbox (most generic controllers copy its layout).
 */
function kindOf(id: string): PadKind {
  if (/xbox|045e|xinput|microsoft/i.test(id)) return 'xbox';
  return /054c|sony|dualshock|dualsense|playstation|wireless controller/i.test(id) ? 'playstation' : 'xbox';
}

/** Radial dead zone, rescaled so the stick still reaches 1 at the edge. */
function deadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export class GamepadInput {
  /** The controller in use (the last one that moved), or null. */
  private index: number | null = null;
  kind: PadKind = 'xbox';
  device: Device = 'mouse';
  private prev: boolean[] = [];
  private input: Input | null = null;
  private settings: Settings | null = null;
  private crouchOn = false;
  private sprintOn = false;
  /** The sprint action as the controller last set it. */
  private sprintHeld = false;
  private moving = false;
  private edgeT = 0;
  /** Seconds since the sticks were last moved (aim assist only helps while aiming). */
  sinceStick = 99;
  /** Called every frame out of a match (menus): rising edges and stick directions. */
  onMenu: ((pad: GamepadInput, dt: number) => void) | null = null;
  /** Called when the device or the controller family changes (HUD glyphs, help table). */
  onDeviceChange: () => void = () => {};
  /** Start pressed while not playing (resume / play). */
  onStart: () => void = () => {};

  constructor() {
    window.addEventListener('gamepadconnected', (e) => this.use((e as GamepadEvent).gamepad));
    window.addEventListener('gamepaddisconnected', (e) => {
      if ((e as GamepadEvent).gamepad.index === this.index) {
        this.index = null;
        this.release();
        this.setDevice('mouse');
        document.documentElement.classList.remove('has-pad');
      }
    });
    // Back to mouse/touch when they're used.
    window.addEventListener('pointerdown', (e) => this.setDevice(e.pointerType === 'touch' ? 'touch' : 'mouse'), true);
    window.addEventListener('keydown', () => this.setDevice('mouse'), true);
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastT) / 1000 || 0);
      this.lastT = t;
      this.poll(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  private lastT = 0;

  /** Hooks the match's input and settings (the game drives the actions; menus work before this too). */
  attach(input: Input, settings: Settings) {
    this.input = input;
    this.settings = settings;
  }

  get connected() {
    return this.index !== null;
  }

  private use(g: Gamepad) {
    this.index = g.index;
    const kind = kindOf(g.id);
    document.documentElement.classList.add('has-pad');
    if (kind !== this.kind) {
      this.kind = kind;
      this.onDeviceChange();
    }
  }

  setDevice(d: Device) {
    if (d === this.device) return;
    this.device = d;
    document.documentElement.classList.toggle('pad-active', d === 'pad');
    if (this.input) this.input.padActive = d === 'pad';
    this.onDeviceChange();
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    // The last controller that pressed something becomes the one in use.
    for (const p of pads) {
      if (p && p.index !== this.index && (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5))) this.use(p);
    }
    return this.index !== null ? (pads[this.index] ?? null) : null;
  }

  /** Current state of a button (triggers past their threshold). */
  down(b: PadButton): boolean {
    return !!this.now[B[b]];
  }

  /** Pressed this frame. */
  pressed(b: PadButton): boolean {
    return !!this.now[B[b]] && !this.prev[B[b]];
  }

  /** Left stick (dead zone applied); D-pad as a stick for menus. */
  stick: [number, number] = [0, 0];
  look: [number, number] = [0, 0];
  private now: boolean[] = [];

  private poll(dt: number) {
    const g = this.pad();
    if (!g) return;
    this.prev = this.now;
    this.now = g.buttons.map((b, i) => (i === B.lt || i === B.rt ? b.value > TRIGGER : b.pressed));
    this.stick = deadzone(g.axes[0] ?? 0, g.axes[1] ?? 0, MOVE_DEADZONE);
    this.look = deadzone(g.axes[2] ?? 0, g.axes[3] ?? 0, LOOK_DEADZONE);
    const active = this.now.some((b, i) => b && !this.prev[i]) || this.stick[0] !== 0 || this.stick[1] !== 0 || this.look[0] !== 0 || this.look[1] !== 0;
    if (active) this.setDevice('pad');
    this.sinceStick = this.stick[0] || this.stick[1] || this.look[0] || this.look[1] ? 0 : this.sinceStick + dt;
    const input = this.input;
    if (input?.locked) this.game(input, dt);
    else {
      if (this.pressed('start')) this.onStart();
      this.onMenu?.(this, dt);
    }
  }

  /** Releases every action the controller holds (pause, disconnect). */
  release() {
    const input = this.input;
    if (!input) return;
    for (const [, a] of HOLD) input.press(a, false);
    input.press('crouch', false);
    input.press('sprint', false);
    input.press('fire', false);
    this.crouchOn = this.sprintOn = this.sprintHeld = false;
    if (this.moving) input.move.forward = input.move.right = 0;
    this.moving = false;
  }

  private game(input: Input, dt: number) {
    if (this.pressed('start')) {
      this.release();
      input.unlock();
      return;
    }
    // Held actions: only on edges (the touch controls drive the same actions).
    const want = new Map<Action, boolean>();
    for (const [b, a] of HOLD) want.set(a, (want.get(a) ?? false) || this.down(b));
    for (const [a, on] of want) {
      const was = HOLD.some(([b, x]) => x === a && this.prev[B[b]]);
      if (on !== was) input.press(a, on);
    }
    // Crouch toggles on ◯/B (a press while running slides).
    if (this.pressed('b')) {
      this.crouchOn = !this.crouchOn;
      input.press('crouch', this.crouchOn);
    }
    // Move: analog; run toggles on L3 and stops with the stick.
    const [sx, sy] = this.stick;
    const movingNow = sx !== 0 || sy !== 0;
    if (movingNow || this.moving) {
      input.move.forward = -sy;
      input.move.right = sx;
    }
    this.moving = movingNow;
    if (this.pressed('l3')) this.sprintOn = !this.sprintOn;
    if (this.sprintOn && -sy < 0.3) this.sprintOn = false;
    if (this.sprintOn !== this.sprintHeld) {
      this.sprintHeld = this.sprintOn;
      input.press('sprint', this.sprintOn);
    }
    // Look: a response curve (fine near the center), a boost when held at the edge to turn around.
    const [lx, ly] = this.look;
    const mag = Math.hypot(lx, ly);
    if (mag > 0) {
      this.edgeT = mag > 0.95 ? this.edgeT + dt : 0;
      const boost = 1 + (EDGE_BOOST - 1) * Math.min(1, Math.max(0, (this.edgeT - 0.15) / 0.35));
      const curve = Math.pow(mag, 1.8) / mag;
      const s = this.settings!;
      const degPerS = LOOK_DEG_S * s.padSensitivity * boost;
      const k = (degPerS * dt * curve) / (s.sensitivity * MOUSE_DEG_PER_COUNT);
      input.addLook(lx * k, ly * k);
    } else this.edgeT = 0;
  }

  /** Rumble (Chrome, Edge; Safari ignores it). `strong`/`weak` 0..1. */
  rumble(ms: number, strong: number, weak: number) {
    if (this.device !== 'pad') return;
    const g = this.index !== null ? navigator.getGamepads?.()[this.index] : null;
    const act = (g as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }

  /** The glyph of the button that does an action, for the controller in use. */
  glyph(b: PadButton): string {
    return GLYPHS[this.kind][b];
  }
}

/** One controller reader for the whole app (menus before a match, the match itself). */
export const gamepad = new GamepadInput();
