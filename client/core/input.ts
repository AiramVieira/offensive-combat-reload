// Keyboard/mouse state with named actions so every key can be remapped later (section 4). On phones and
// tablets the touch controls (ui/touch.ts) drive the same actions (`press`), an analog stick (`move`) and the
// look (`addLook`), and "locked" means "playing" (there is no pointer lock: the play/pause buttons set it).
import { IS_MOBILE } from './device';
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
  /** Actions held or pressed by the touch controls. */
  private vHeld = new Set<Action>();
  private vPressed = new Set<Action>();
  /**
   * The player is on a controller: playing doesn't take the pointer lock (the browser only grants it to a
   * mouse click or key), and the mouse moves nothing until a click takes it back.
   */
  padActive = false;
  /** Analog stick (touch): forward and right in -1..1; zero when the stick is idle. */
  readonly move = { forward: 0, right: 0 };
  /** Typing in the chat: keys and the mouse belong to the text box, the game gets none of them. */
  private typing = false;
  /** The game let go of the mouse itself (releaseMouse): losing the pointer lock doesn't pause. */
  private keepPlaying = false;
  /** A key press is taking the mouse back (one request at a time). */
  private relocking = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (this.locked && !IS_MOBILE && !this.padActive && document.pointerLockElement !== this.element) {
        // Playing with the mouse let go (the browser kept it after an Esc): Esc pauses, as it does with the
        // mouse locked; any other key is a press the browser accepts to give the mouse back.
        if (e.code === 'Escape') {
          this.setPlaying(false);
          return;
        }
        if (!this.relocking) {
          this.relocking = true;
          void this.lock().finally(() => (this.relocking = false));
        }
      }
      if (!this.locked && !e.code.startsWith('F')) return;
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3' || e.code === 'F4' || e.code === 'F6') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || this.typing) return;
      // Desktop: a click with the mouse free takes it back (main.ts), it doesn't shoot.
      if (!IS_MOBILE && document.pointerLockElement !== this.element) return;
      const code = `Mouse${e.button}`;
      this.held.add(code);
      this.pressed.add(code);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      // Desktop: only with the pointer locked (playing on a controller leaves the cursor free).
      if (!this.locked || this.typing || (!IS_MOBILE && document.pointerLockElement !== this.element)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      const has = document.pointerLockElement === this.element;
      if (!has && this.keepPlaying) {
        this.keepPlaying = false;
        return;
      }
      this.keepPlaying = false;
      this.locked = has;
      if (!this.locked) this.held.clear();
      this.onLockChange(this.locked);
    });
  }

  /**
   * Takes the mouse for the game; resolves whether the browser gave it. It does only inside a click or a key
   * press (not Esc), or with none when the game itself let go of it last (releaseMouse, unlock with Esc kept
   * by the game): after the player's own Esc, it waits for their next click or key.
   */
  async lock(): Promise<boolean> {
    if (IS_MOBILE || this.padActive) {
      this.setPlaying(true);
      return true;
    }
    if (document.pointerLockElement === this.element) return true;
    // Raw input where supported (no OS mouse acceleration), else the plain lock.
    return (await this.requestLock({ unadjustedMovement: true })) || this.requestLock();
  }

  /** One pointer lock request, settled by the browser's change or error event (or its promise, where any). */
  private requestLock(opts?: object): Promise<boolean> {
    return new Promise((resolve) => {
      const done = () => {
        document.removeEventListener('pointerlockchange', done);
        document.removeEventListener('pointerlockerror', done);
        clearTimeout(timer);
        resolve(document.pointerLockElement === this.element);
      };
      document.addEventListener('pointerlockchange', done);
      document.addEventListener('pointerlockerror', done);
      const timer = setTimeout(done, 1500);
      try {
        const r = (this.element.requestPointerLock as (o?: object) => Promise<void> | undefined)(opts);
        r?.catch?.(done);
      } catch {
        done();
      }
    });
  }

  /**
   * Starts or stops playing without the pointer lock: phones (the pause button, the menu's play button), a
   * controller, and Esc out of the pause menu on a computer (the mouse comes back with the next key or click).
   */
  setPlaying(on: boolean) {
    if (on === this.locked) return;
    this.locked = on;
    if (!on) {
      this.held.clear();
      this.vHeld.clear();
      this.move.forward = this.move.right = 0;
    }
    this.onLockChange(on);
  }

  /**
   * The chat's text box took (or gave back) the keyboard. Keys held when it opens are let go, so the player
   * doesn't keep walking; presses not consumed yet are dropped (the Enter that opened it, for one).
   */
  setTyping(on: boolean) {
    this.typing = on;
    if (on) {
      this.held.clear();
      this.pressed.clear();
    }
  }

  /**
   * Lets go of the mouse without pausing (the chat opening). With the mouse locked, the browser always takes
   * Esc to release it, and that would open the menu; freed first, Esc reaches the chat box instead.
   */
  releaseMouse() {
    if (IS_MOBILE || document.pointerLockElement !== this.element) return;
    this.keepPlaying = true;
    document.exitPointerLock();
  }

  /** Leaves the game for the menu (Esc does it with the mouse; the pause button on phones). */
  unlock() {
    if (IS_MOBILE || document.pointerLockElement !== this.element) this.setPlaying(false);
    else document.exitPointerLock();
  }

  /** A touch control pressed (`on`) or released an action. */
  press(a: Action, on: boolean) {
    if (on) {
      if (!this.vHeld.has(a)) this.vPressed.add(a);
      this.vHeld.add(a);
    } else this.vHeld.delete(a);
  }

  /** Look from touch drags, in the same units as mouse counts. */
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Movement axis: the analog stick when it's moved, else the keys. */
  axis(pos: Action, neg: Action, analog: number): number {
    if (Math.abs(analog) > 0.01) return analog;
    return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
  }

  down(a: Action): boolean {
    return this.vHeld.has(a) || BINDINGS[a].some((c) => this.held.has(c));
  }

  /**
   * True once per physical press. Presses are kept until consumed, so a tap that lands on a render frame
   * with no simulation tick (common at 144 Hz+) is not lost.
   */
  consume(a: Action): boolean {
    let hit = this.vPressed.delete(a);
    for (const c of BINDINGS[a]) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  /** Whether the action was pressed since it was last consumed, without consuming it. */
  peek(a: Action): boolean {
    return this.vPressed.has(a) || BINDINGS[a].some((c) => this.pressed.has(c));
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
