// Keyboard/mouse state with named actions so every key can be remapped later (section 4).
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'crouch' | 'sprint' | 'reload'
  | 'fire' | 'ads' | 'melee' | 'grenade' | 'taunt' | 'scoreboard' | 'debug' | 'hitboxes' | 'tuning';

// Crouch is on C only: Ctrl+W closes the browser tab and cannot be intercepted outside fullscreen keyboard lock.
export const BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  crouch: ['KeyC'],
  sprint: ['ShiftLeft'],
  reload: ['KeyR'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  melee: ['KeyF'],
  grenade: ['KeyG'],
  taunt: ['KeyE'],
  scoreboard: ['Tab'],
  debug: ['F3'],
  hitboxes: ['F4'],
  /** Live tuning of the animation feel (dev). */
  tuning: ['F6'],
};

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked && !e.code.startsWith('F')) return;
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3' || e.code === 'F4' || e.code === 'F6') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.held.add(code);
      this.pressed.add(code);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.held.clear();
      this.onLockChange(this.locked);
    });
  }

  async lock() {
    try {
      // Raw input where supported (no OS mouse acceleration).
      await (this.element.requestPointerLock as (o?: object) => Promise<void>)({ unadjustedMovement: true });
    } catch {
      try {
        await this.element.requestPointerLock();
      } catch {
        /* user will click again */
      }
    }
  }

  down(a: Action): boolean {
    return BINDINGS[a].some((c) => this.held.has(c));
  }

  /**
   * True once per physical press. Presses are kept until consumed, so a tap that lands on a render frame
   * with no simulation tick (common at 144 Hz+) is not lost.
   */
  consume(a: Action): boolean {
    let hit = false;
    for (const c of BINDINGS[a]) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  /** Whether the action was pressed since it was last consumed, without consuming it. */
  peek(a: Action): boolean {
    return BINDINGS[a].some((c) => this.pressed.has(c));
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
