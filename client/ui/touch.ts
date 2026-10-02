// Touch controls for phones and tablets, laid out like CoD Mobile: a floating stick on the left (pushed to the
// edge it sprints), drag anywhere else to look, a big fire button bottom right with aim next to it (drag the
// fire button to keep aiming while shooting; a second fire button on the left), jump and crouch in the corner,
// reload, knife and grenade (hold to cook, let go to throw), and pause, scoreboard, fullscreen and chat at the
// top. Minimal line icons (white strokes on dark translucent circles). The buttons carry the state the thumb
// needs: grenades left on the grenade button, a ring filling while reloading and a pulse when the magazine
// runs low on the reload button. The look has a response curve: slow drags are precise, fast flicks turn
// more. Everything feeds the same named actions as the keyboard (core/input.ts), so the game code doesn't
// know which one it got. Button size, opacity and look speed come from the settings; the layout editor lets
// the player drag the buttons where they like. Default positions keep clear of notches (safe areas).
import type { Action, Input } from '../core/input';
import type { Settings } from '../core/settings';
import { CAN_FULLSCREEN, enterFullscreen, exitFullscreen, isFullscreen } from '../core/device';
import { t } from './strings';

/** Look speed at sensitivity 1: degrees per pixel dragged. */
const DEG_PER_PX = 0.18;
/** Mouse counts → degrees in the game (Source style), to turn pixels into "counts". */
const MOUSE_DEG_PER_COUNT = 0.022;

interface ButtonDef {
  id: string;
  /** The action it drives (none: a UI button). */
  action?: Action;
  /** Tap toggles the action on and off (aim, crouch). */
  toggle?: boolean;
  icon: string;
  label: string;
  /** Default center: x from the right (or left with `left`), y from the bottom, in units of the screen height. */
  x: number;
  y: number;
  left?: boolean;
  top?: boolean;
  /** In the top-left row: placed one after another, whichever of them this game has (`x` unused). */
  row?: boolean;
  /** Diameter in units of the screen height. */
  size: number;
  /** Dragging on it also turns the view (fire). */
  look?: boolean;
}

/** Minimal line icons (24×24, white strokes). */
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS: Record<string, string> = {
  // A bullet.
  fire: svg('<path d="M12 3c2 2 3 4.5 3 7v8H9v-8c0-2.5 1-5 3-7z"/><path d="M9 21h6"/><path d="M9 14h6"/>'),
  // A scope reticle.
  ads: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  jump: svg('<path d="M6 14l6-6 6 6"/><path d="M6 19h12"/>'),
  crouch: svg('<path d="M6 10l6 6 6-6"/><path d="M6 5h12"/>'),
  reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  // A knife: blade, guard, handle.
  melee: svg('<path d="M9 15L19.5 4.5c1.5 2.5.5 6-2.5 8.5L12 18z"/><path d="M7 13l5 5"/><path d="M8.5 16.5L4 21"/>'),
  // A grenade: body, top and the pin's ring.
  grenade: svg('<circle cx="12" cy="14.5" r="6"/><path d="M10 8.5V6h4v2.5"/><path d="M14 7h3"/><circle cx="18.5" cy="7" r="1.5"/>'),
  pause: svg('<path d="M9 6v12M15 6v12"/>'),
  board: svg('<path d="M5 7h14M5 12h14M5 17h9"/>'),
  fs: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  // A speech bubble.
  chat: svg('<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>'),
};

const BUTTONS: ButtonDef[] = [
  // Right hand: fire big, aim at its upper left, jump and crouch stacked in the corner, reload/knife/grenade around.
  { id: 'fire', action: 'fire', icon: 'fire', label: 'touchFire', x: 0.36, y: 0.36, size: 0.24, look: true },
  { id: 'ads', action: 'ads', toggle: true, icon: 'ads', label: 'touchAds', x: 0.66, y: 0.5, size: 0.15 },
  { id: 'jump', action: 'jump', icon: 'jump', label: 'touchJump', x: 0.1, y: 0.36, size: 0.14 },
  { id: 'crouch', action: 'crouch', toggle: true, icon: 'crouch', label: 'touchCrouch', x: 0.1, y: 0.14, size: 0.14 },
  { id: 'reload', action: 'reload', icon: 'reload', label: 'touchReload', x: 0.62, y: 0.2, size: 0.12 },
  { id: 'melee', action: 'melee', icon: 'melee', label: 'touchMelee', x: 0.36, y: 0.11, size: 0.12 },
  { id: 'grenade', action: 'grenade', icon: 'grenade', label: 'touchGrenade', x: 0.38, y: 0.66, size: 0.12 },
  // Left hand: a second fire button above the stick.
  { id: 'fire2', action: 'fire', icon: 'fire', label: 'touchFire', x: 0.16, y: 0.62, size: 0.14, left: true, look: true },
  // Top row. The scoreboard toggles (holding a button to read it doesn't work with a thumb busy aiming).
  { id: 'pause', icon: 'pause', label: 'touchPause', x: 0, y: 0.07, size: 0.1, left: true, top: true, row: true },
  { id: 'board', action: 'scoreboard', toggle: true, icon: 'board', label: 'touchBoard', x: 0, y: 0.07, size: 0.1, left: true, top: true, row: true },
  { id: 'fs', icon: 'fs', label: 'touchFullscreen', x: 0, y: 0.07, size: 0.1, left: true, top: true, row: true },
  { id: 'chat', icon: 'chat', label: 'touchChat', x: 0, y: 0.07, size: 0.1, left: true, top: true, row: true },
];
/** Gap between the buttons of the top row, and from the screen's edge (screen heights). */
const ROW_GAP = 0.02;

/** The stick's travel radius (screen heights) and where it starts to sprint. */
const STICK_R = 0.11;
const SPRINT_AT = 0.92;

export class TouchControls {
  readonly root = document.createElement('div');
  private stick = document.createElement('div');
  private knob = document.createElement('div');
  private buttons = new Map<string, HTMLElement>();
  /** Pointer → what it's doing (stick, look, or a button). */
  private pointers = new Map<number, { kind: 'stick' | 'look' | 'button'; id?: string; x: number; y: number; ox?: number; oy?: number; t: number }>();
  private toggled = new Set<Action>();
  private editing = false;
  /** Reads the safe-area insets (notches, rounded corners) the browser gives through CSS env(). */
  private safeProbe = document.createElement('div');
  private grenadeBadge = document.createElement('span');
  private statusKey = '';
  onPause: () => void = () => {};
  onChat: () => void = () => {};

  constructor(
    private input: Input,
    private settings: Settings,
    host: HTMLElement,
  ) {
    this.root.id = 'touch';
    const look = document.createElement('div');
    look.className = 'touch-look';
    const zone = document.createElement('div');
    zone.className = 'touch-stick-zone';
    this.stick.className = 'touch-stick hidden';
    this.knob.className = 'touch-knob';
    this.stick.appendChild(this.knob);
    this.root.append(look, zone, this.stick);
    for (const b of BUTTONS) {
      if (b.id === 'fs' && !CAN_FULLSCREEN) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `touch-btn touch-${b.id}`;
      el.innerHTML = ICONS[b.icon];
      el.setAttribute('aria-label', t(b.label as never));
      this.root.appendChild(el);
      this.buttons.set(b.id, el);
      el.addEventListener('pointerdown', (e) => this.down(e, 'button', b.id));
    }
    this.grenadeBadge.className = 'touch-badge';
    this.buttons.get('grenade')?.appendChild(this.grenadeBadge);
    // Chat: online only (setChat).
    this.buttons.get('chat')?.classList.add('hidden');
    this.safeProbe.style.cssText =
      'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(this.safeProbe);
    look.addEventListener('pointerdown', (e) => this.down(e, 'look'));
    zone.addEventListener('pointerdown', (e) => this.down(e, 'stick'));
    // Moves and releases are tracked on the window: a finger may slide off the element it started on.
    window.addEventListener('pointermove', (e) => this.moveTo(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    host.appendChild(this.root);
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  /** Applies size, opacity and positions (the player's, or the defaults inside the safe area). */
  layout() {
    const h = window.innerHeight;
    const w = window.innerWidth;
    const cs = getComputedStyle(this.safeProbe);
    const safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    this.root.style.setProperty('--touch-opacity', String(this.settings.touchOpacity));
    let rowX = ROW_GAP;
    for (const b of BUTTONS) {
      const el = this.buttons.get(b.id);
      if (!el || el.classList.contains('hidden')) continue;
      const units = b.size * this.settings.touchScale;
      const size = units * h;
      // The top row packs whichever buttons are there (no fullscreen on iPhone, no chat offline).
      let x = b.x;
      if (b.row) {
        x = rowX + units / 2;
        rowX += units + ROW_GAP;
      }
      const saved = this.settings.touchLayout[b.id];
      const cx = saved ? saved[0] * w : b.left ? safe.l + x * h : w - safe.r - x * h;
      const cy = saved ? saved[1] * h : b.top ? safe.t + b.y * h : h - safe.b - b.y * h;
      el.style.width = el.style.height = `${size}px`;
      el.style.setProperty('--icon', `${Math.round(size * 0.46)}px`);
      el.style.left = `${cx - size / 2}px`;
      el.style.top = `${cy - size / 2}px`;
    }
  }

  /** Releases everything (the match paused). */
  reset() {
    for (const [, p] of this.pointers) if (p.kind === 'button') this.release(p.id!);
    this.pointers.clear();
    this.toggled.clear();
    this.stick.classList.add('hidden');
    this.input.move.forward = this.input.move.right = 0;
    for (const el of this.buttons.values()) el.classList.remove('on');
  }

  /** The layout editor: buttons can be dragged; `save` keeps the positions in the settings. */
  setEditing(on: boolean) {
    this.reset();
    this.editing = on;
    this.root.classList.toggle('editing', on);
  }

  /** The chat button: online only. */
  setChat(on: boolean) {
    this.buttons.get('chat')?.classList.toggle('hidden', !on);
    this.layout();
  }

  /**
   * What the buttons show (every frame; cheap when nothing changed): grenades left on the grenade button
   * (dimmed at none), the reload progress as a ring on the reload button (`reload` 0..1, null when not
   * reloading), and a pulse on it when the magazine runs low.
   */
  setStatus(grenades: number, reload: number | null, lowAmmo: boolean) {
    const key = `${grenades}|${reload === null ? '' : reload.toFixed(2)}|${lowAmmo}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.grenadeBadge.textContent = String(grenades);
    this.buttons.get('grenade')?.classList.toggle('empty', grenades === 0);
    const r = this.buttons.get('reload');
    if (!r) return;
    r.classList.toggle('reloading', reload !== null);
    r.classList.toggle('low', lowAmmo && reload === null);
    r.style.setProperty('--p', String(reload ?? 0));
  }

  /** Back to the default positions. */
  resetLayout() {
    this.settings.touchLayout = {};
    this.layout();
  }

  private down(e: PointerEvent, kind: 'stick' | 'look' | 'button', id?: string) {
    e.preventDefault();
    e.stopPropagation();
    if (this.editing) {
      if (kind === 'button' && id) this.pointers.set(e.pointerId, { kind, id, x: e.clientX, y: e.clientY, t: e.timeStamp });
      return;
    }
    this.pointers.set(e.pointerId, { kind, id, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, t: e.timeStamp });
    if (kind === 'stick') {
      // The stick appears under the finger.
      const s = this.stickRadius();
      this.stick.style.left = `${e.clientX - s}px`;
      this.stick.style.top = `${e.clientY - s}px`;
      this.stick.style.width = this.stick.style.height = `${s * 2}px`;
      this.stick.classList.remove('hidden');
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (kind === 'button' && id) this.pressButton(id);
  }

  private moveTo(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const dt = Math.max(1, e.timeStamp - p.t);
    p.x = e.clientX;
    p.y = e.clientY;
    p.t = e.timeStamp;
    if (this.editing) {
      if (p.id) this.dragButton(p.id, e.clientX, e.clientY);
      return;
    }
    if (p.kind === 'stick') this.stickTo(e.clientX - p.ox!, e.clientY - p.oy!);
    else if (p.kind === 'look' || (p.kind === 'button' && BUTTONS.find((b) => b.id === p.id)?.look)) {
      // Response curve: slow drags at 75% (fine aim), fast flicks up to 170% (turning). Pixels → mouse counts
      // at the current mouse sensitivity, so the game applies one formula (ADS and zoom included).
      const speed = Math.hypot(dx, dy) / dt; // px per ms
      const gain = 0.75 + 0.95 * Math.min(1, Math.max(0, (speed - 0.25) / 2.25));
      const k = (DEG_PER_PX * this.settings.touchSensitivity * gain) / (this.settings.sensitivity * MOUSE_DEG_PER_COUNT);
      this.input.addLook(dx * k, dy * k);
    }
  }

  private up(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.editing) return;
    if (p.kind === 'stick') {
      this.stick.classList.add('hidden');
      this.input.move.forward = this.input.move.right = 0;
      this.input.press('sprint', false);
    } else if (p.kind === 'button' && p.id) this.release(p.id);
  }

  private stickRadius() {
    return STICK_R * window.innerHeight * this.settings.touchScale;
  }

  private stickTo(dx: number, dy: number) {
    const r = this.stickRadius();
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    // A small dead zone, then the full range.
    const mag = Math.min(1, len / r);
    const live = mag < 0.12 ? 0 : (mag - 0.12) / 0.88;
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    this.input.move.forward = -ny * live;
    this.input.move.right = nx * live;
    // Pushed to the edge, mostly forward: sprint.
    this.input.press('sprint', mag >= SPRINT_AT && -ny > 0.6);
  }

  private pressButton(id: string) {
    const b = BUTTONS.find((x) => x.id === id)!;
    const el = this.buttons.get(id)!;
    if (id === 'pause') {
      this.onPause();
      return;
    }
    if (id === 'fs') {
      void (isFullscreen() ? exitFullscreen() : enterFullscreen());
      return;
    }
    if (id === 'chat') {
      this.onChat();
      return;
    }
    if (!b.action) return;
    // Aim: tap to toggle (CoD's default) or hold, per the settings.
    if (b.toggle && !(b.action === 'ads' && this.settings.adsHold)) {
      const on = !this.toggled.has(b.action);
      if (on) this.toggled.add(b.action);
      else this.toggled.delete(b.action);
      this.input.press(b.action, on);
      el.classList.toggle('on', on);
      return;
    }
    this.input.press(b.action, true);
    el.classList.add('on');
  }

  private release(id: string) {
    const b = BUTTONS.find((x) => x.id === id);
    if (!b?.action || (b.toggle && !(b.action === 'ads' && this.settings.adsHold))) return;
    // Two fire buttons: keep firing while either is down.
    const stillHeld = [...this.pointers.values()].some((p) => p.kind === 'button' && p.id !== id && BUTTONS.find((x) => x.id === p.id)?.action === b.action);
    if (!stillHeld) this.input.press(b.action, false);
    this.buttons.get(id)?.classList.remove('on');
  }

  /** Aim and crouch toggles turned off by the game (e.g. a sprint ends the aim). */
  clearToggle(a: Action) {
    if (!this.toggled.delete(a)) return;
    this.input.press(a, false);
    for (const b of BUTTONS) if (b.action === a) this.buttons.get(b.id)?.classList.remove('on');
  }

  private dragButton(id: string, x: number, y: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.settings.touchLayout[id] = [Math.min(0.98, Math.max(0.02, x / w)), Math.min(0.98, Math.max(0.02, y / h))];
    this.layout();
  }
}
