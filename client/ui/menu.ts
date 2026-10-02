// Loading screen (with rotating tips) and the start/pause menu with settings (section 5).
import { CAN_FULLSCREEN, CAN_KEEP_ESCAPE, enterFullscreen, IS_IOS, IS_MOBILE, STANDALONE } from '../core/device';
import type { GamepadInput, PadButton } from '../core/gamepad';
import {
  assign,
  clearSlot,
  keyLabel,
  mergeKeybinds,
  REBINDABLE,
  type LayoutMap,
  type RebindableAction,
  type Slot,
} from '../core/keybinds';
import type { Settings } from '../core/settings';
import type { Quality } from '../render/quality';
import { getLang, t, TIPS, type StringKey } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ACTION_NAME: Record<RebindableAction, StringKey> = {
  forward: 'keyForward',
  back: 'keyBack',
  left: 'keyLeft',
  right: 'keyRight',
  jump: 'keyJump',
  crouch: 'keyCrouch',
  sprint: 'keySprint',
  fire: 'keyFire',
  ads: 'keyAds',
  reload: 'keyReload',
  melee: 'keyMelee',
  grenade: 'keyGrenade',
  taunt: 'keyTaunt',
  scoreboard: 'keyScoreboard',
  chat: 'keyChat',
};

/** navigator.keyboard (Chrome and Edge only; not in TypeScript's DOM types). */
type KeyboardApi = { getLayoutMap?: () => Promise<LayoutMap> };

export class Screens {
  private tipTimer = 0;

  constructor() {
    this.startTips();

    $('menu-subtitle').textContent = t('subtitle');
    $('controls-title').textContent = t('controls');
    $('settings-title').textContent = t('settings');
    $('menu-debug-hint').textContent = t('debugHint');
    $('menu-resume-hint').textContent = t(IS_MOBILE ? 'tapToResume' : 'clickToResume');
    const labels: [string, StringKey][] = [['lbl-sens', 'sensitivity'], ['lbl-ads', 'adsSensitivity'], ['lbl-fov', 'fov'], ['lbl-vol', 'volume'], ['lbl-spatial', 'spatialAudio'], ['lbl-invert', 'invertY'], ['lbl-quality', 'quality']];
    for (const [id, key] of labels) $(id).textContent = t(key);

    $('keys-reset').textContent = t('keysReset');
    $('keys-reset').addEventListener('click', () => {
      if (!this.settings) return;
      this.stopCapture();
      this.settings.keybinds = mergeKeybinds(undefined);
      this.settings.keyLabels = {};
      this.keysChanged('');
    });
    // Chrome and Edge tell what is printed on each key (AZERTY, Dvorak…); elsewhere the names come from the keys
    // the player pressed to bind (Settings.keyLabels), else QWERTY.
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
    keyboard?.getLayoutMap?.().then(
      (map) => {
        this.layout = map;
        this.renderKeys();
      },
      () => {},
    );
    this.showControls(null);
    // Phones: touch settings, the layout editor's bar, the "turn the phone" notice.
    const touchLabels: [string, StringKey][] = [
      ['lbl-touch-sens', 'touchSensitivity'],
      ['lbl-touch-scale', 'touchScale'],
      ['lbl-touch-opacity', 'touchOpacity'],
      ['lbl-aim-assist', 'aimAssist'],
      ['lbl-ads-hold', 'adsHold'],
      ['lbl-pad-sens', 'padSensitivity'],
      ['lbl-fullscreen', 'fullscreenOnPlay'],
      ['touch-edit-btn', 'editLayout'],
      ['touch-fs-btn', 'fullscreen'],
      ['touch-edit-hint', 'editLayoutHint'],
      ['touch-edit-reset', 'editLayoutReset'],
      ['touch-edit-done', 'editLayoutDone'],
      ['rotate-text', 'rotatePhone'],
    ];
    for (const [id, key] of touchLabels) $(id).textContent = t(key);
    // No Fullscreen API (iPhone): explain "Add to Home Screen" instead (unless already opened from there).
    if (!CAN_FULLSCREEN) for (const el of document.querySelectorAll('.fs-only')) el.classList.add('hidden');
    if (IS_MOBILE && !CAN_FULLSCREEN && IS_IOS && !STANDALONE) {
      $('ios-fs-hint').textContent = t('iosFullscreen');
      $('ios-fs-hint').classList.remove('hidden');
    }
    $('touch-fs-btn').addEventListener('click', () => void enterFullscreen());
  }

  /** The settings being edited (bindSettings), and what to call when they change. */
  private settings: Settings | null = null;
  private changed: (s: Settings) => void = () => {};
  private layout: LayoutMap | undefined;
  /** The keyboard's table is shown (not the controller's or the touch help). */
  private keysShown = false;
  /** The slot waiting for a key ("press a key…"), and how to stop listening. */
  private capturing: { action: RebindableAction; slot: Slot } | null = null;
  private endCapture: () => void = () => {};
  private notice = '';

  /** The name of the key an action is on (its primary, else its alternate), for hints like the HUD's. */
  keyName(action: RebindableAction): string {
    const code = this.settings?.keybinds[action].find((c) => c !== null);
    return code ? this.label(code) : '—';
  }

  private label(code: string): string {
    return keyLabel(code, getLang(), this.layout, this.settings?.keyLabels);
  }

  /**
   * The controls help: the controller's buttons (PlayStation or Xbox glyphs) while one is in use, the touch
   * help on phones, the remappable keys otherwise.
   */
  showControls(pad: GamepadInput | null) {
    const table = $('controls-table');
    $('menu-resume-hint').textContent =
      pad && pad.device === 'pad' ? t('padToResume', { a: pad.glyph('a'), start: pad.glyph('start') }) : t(IS_MOBILE ? 'tapToResume' : 'clickToResume');
    this.keysShown = !IS_MOBILE && !(pad && pad.device === 'pad');
    if (!this.keysShown) {
      this.stopCapture();
      $('keys-notice').classList.add('hidden');
      $('keys-reset').classList.add('hidden');
    }
    if (pad && pad.device === 'pad') {
      const g = (b: PadButton) => `<kbd>${pad.glyph(b)}</kbd>`;
      const rows: [StringKey, string][] = [
        ['keyMove', `${t('padLeftStick')}`],
        ['padLook', `${t('padRightStick')}`],
        ['keyFire', g('rt')],
        ['keyAds', g('lt')],
        ['keyJump', g('a')],
        ['keyCrouch', g('b')],
        ['keySprint', g('l3')],
        ['keyReload', g('x')],
        ['keyMelee', `${g('rb')} / ${g('r3')}`],
        ['keyGrenade', g('lb')],
        ['keyTaunt', g('y')],
        ['keyPause', g('start')],
      ];
      table.innerHTML = rows.map(([k, v]) => `<tr><td>${t(k)}</td><td>${v}</td></tr>`).join('');
      return;
    }
    if (IS_MOBILE) table.innerHTML = `<tr><td>${t('touchControlsHelp')}</td></tr>`;
    else this.renderKeys();
  }

  /** The keyboard's table: action, primary and alternate key; a click on a key waits for the new one. */
  private renderKeys() {
    if (!this.keysShown || !this.settings) return;
    const kb = this.settings.keybinds;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
      const e = document.createElement(tag);
      e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    const head = el('tr');
    for (const k of ['keyAction', 'keyPrimary', 'keyAlternate'] as const) head.appendChild(el('th', t(k)));
    const rows = [head];
    for (const action of REBINDABLE) {
      const tr = el('tr');
      tr.appendChild(el('td', t(ACTION_NAME[action])));
      for (const slot of [0, 1] as const) {
        const td = el('td');
        const cell = el('span', '', 'bind');
        const code = kb[action][slot];
        const waiting = this.capturing?.action === action && this.capturing.slot === slot;
        const key = el('button', waiting ? t('keyPress') : code ? this.label(code) : '—', 'bind-key');
        key.type = 'button';
        key.classList.toggle('empty', !code);
        key.classList.toggle('capturing', waiting);
        key.addEventListener('click', () => this.startCapture(action, slot));
        cell.appendChild(key);
        if (code && !waiting) {
          const clear = el('button', '×', 'bind-clear');
          clear.type = 'button';
          clear.title = clear.ariaLabel = t('keyClear');
          clear.addEventListener('click', () => {
            this.stopCapture();
            this.settings!.keybinds = clearSlot(this.settings!.keybinds, action, slot);
            this.keysChanged('');
          });
          cell.appendChild(clear);
        }
        td.appendChild(cell);
        tr.appendChild(td);
      }
      if (!kb[action][0] && !kb[action][1]) {
        tr.classList.add('unbound');
        tr.title = t('keyUnbound');
      }
      rows.push(tr);
    }
    // Esc stays the browser's (it lets go of the mouse): shown, not remappable.
    const esc = el('tr');
    esc.append(el('td', t('keyPause')), el('td'), el('td'));
    esc.children[1].appendChild(el('kbd', 'Esc'));
    rows.push(esc);
    $('controls-table').replaceChildren(...rows);
    $('keys-notice').textContent = this.notice;
    $('keys-notice').classList.toggle('hidden', !this.notice);
    $('keys-reset').classList.remove('hidden');
  }

  /**
   * Waits for the next key or mouse button for one slot. Listens first (capture phase on window), so neither
   * the game nor the menu's Esc sees that press; Esc cancels.
   */
  private startCapture(action: RebindableAction, slot: Slot) {
    this.stopCapture();
    this.capturing = { action, slot };
    this.notice = '';
    const block = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      block(e);
      if (e.repeat) return;
      if (e.code === 'Escape') {
        this.stopCapture();
        this.renderKeys();
      } else this.bindKey(e.code, e.key);
    };
    const onMouse = (e: MouseEvent) => {
      block(e);
      // The click that follows this button (and the page going back on a side button's release) is swallowed
      // too, so it doesn't land on another key of the table.
      // (A mouseup that never comes, released outside the window, frees them after a while.)
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      this.endCapture = () => {};
      window.addEventListener('mouseup', () => setTimeout(removeSwallow), { capture: true, once: true });
      setTimeout(removeSwallow, 3000);
      this.bindKey(`Mouse${e.button}`);
    };
    // The wheel (not passive, so the menu doesn't scroll on the step that binds).
    const onWheel = (e: WheelEvent) => {
      block(e);
      if (e.deltaY !== 0 && this.capturing) this.bindKey(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    };
    const swallowed = ['mouseup', 'click', 'auxclick', 'contextmenu'];
    const removeSwallow = () => {
      for (const type of swallowed) window.removeEventListener(type, block, true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    for (const type of swallowed) window.addEventListener(type, block, true);
    this.endCapture = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      removeSwallow();
    };
    this.renderKeys();
  }

  /** Stops waiting for a key (the swallowed click after a mouse button still goes, on its own). */
  private stopCapture() {
    if (!this.capturing) return;
    this.capturing = null;
    this.endCapture();
    this.endCapture = () => {};
  }

  /** The key pressed while waiting: bound (the other action losing it is told), or refused with the reason. */
  private bindKey(code: string, printed?: string) {
    if (!this.capturing || !this.settings) return;
    const s = this.settings;
    const { action, slot } = this.capturing;
    const r = assign(s.keybinds, action, slot, code);
    if (!r.ok) {
      // Still waiting: the player presses another key.
      this.notice = r.reason === 'ctrl' ? t('keyNoCtrl') : r.reason === 'wheel' ? t('keyWheelHold') : t('keyFixed', { key: this.label(code) });
      this.renderKeys();
      return;
    }
    // What is printed on the key, for its name where the browser has no layout map.
    if (printed && printed.length === 1 && printed.trim()) s.keyLabels[code] = printed;
    s.keybinds = r.keybinds;
    const lost = r.cleared;
    this.stopCapture();
    this.keysChanged(
      lost
        ? t('keyMoved', { key: this.label(code), action: t(ACTION_NAME[lost.action]), slot: t(lost.slot === 0 ? 'keyPrimary' : 'keyAlternate').toLowerCase() })
        : '',
    );
  }

  private keysChanged(notice: string) {
    this.notice = notice;
    this.changed(this.settings!);
    this.renderKeys();
  }

  /** The "arrange buttons" entry of the pause menu and the editor bar (phones). */
  onEditLayout(start: () => void, done: () => void, reset: () => void) {
    $('touch-edit-btn').addEventListener('click', () => {
      this.hideMenu();
      $('touch-edit-bar').classList.remove('hidden');
      start();
    });
    $('touch-edit-done').addEventListener('click', () => {
      $('touch-edit-bar').classList.add('hidden');
      done();
      this.showMenu('pause');
    });
    $('touch-edit-reset').addEventListener('click', reset);
  }

  showGpuWarning(gpu: string) {
    const el = $('gpu-warning');
    el.textContent = `⚠ ${t('gpuWarning', { gpu })}`;
    el.classList.remove('hidden');
  }

  setProgress(p: number) {
    $('loading-fill').style.width = `${Math.round(p * 100)}%`;
  }

  private startTips() {
    const tips = TIPS[getLang()];
    let i = (Math.random() * tips.length) | 0;
    const tip = $('loading-tip');
    tip.textContent = tips[i];
    clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(() => {
      i = (i + 1) % tips.length;
      tip.textContent = tips[i];
    }, 2500);
  }

  /** Back to the loading screen (the map is built after the home screen, once it is chosen). */
  showLoading() {
    this.setProgress(0);
    this.startTips();
    $('loading').classList.remove('hidden');
  }

  hideLoading() {
    clearInterval(this.tipTimer);
    $('loading').classList.add('hidden');
  }

  showMenu(mode: 'start' | 'pause') {
    $('menu').classList.remove('hidden');
    $('play-btn').textContent = mode === 'start' ? t('play') : t('resume');
    $('menu-resume-hint').classList.toggle('hidden', mode === 'start');
  }

  setSubtitle(text: string) {
    $('menu-subtitle').textContent = text;
  }

  /** Shows the "back to home" button in the pause menu. */
  onExit(label: string, cb: () => void) {
    const b = $('menu-exit');
    b.textContent = label;
    b.classList.remove('hidden');
    b.onclick = cb;
  }

  hideMenu() {
    this.stopCapture();
    this.notice = '';
    this.renderKeys();
    $('menu').classList.add('hidden');
  }

  onPlay(cb: () => void) {
    $('play-btn').addEventListener('click', cb);
  }

  bindSettings(s: Settings, changed: (s: Settings) => void) {
    this.settings = s;
    this.changed = changed;
    this.renderKeys();
    const range = (id: string, out: string, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'volume', fmt: (v: number) => string) => {
      const el = $<HTMLInputElement>(id);
      const o = $(out);
      el.value = String(s[key]);
      o.textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = Number(el.value);
        o.textContent = fmt(s[key]);
        changed(s);
      });
    };
    range('set-sens', 'out-sens', 'sensitivity', (v) => v.toFixed(2));
    range('set-ads', 'out-ads', 'adsSensitivity', (v) => v.toFixed(2));
    range('set-fov', 'out-fov', 'fov', (v) => `${v}°`);
    range('set-vol', 'out-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
    const sp = $<HTMLSelectElement>('set-spatial');
    const spatial: [Settings['spatialAudio'], StringKey][] = [['auto', 'spatialAuto'], ['hrtf', 'spatialHeadphones'], ['stereo', 'spatialSpeakers']];
    sp.innerHTML = spatial.map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join('');
    sp.value = s.spatialAudio;
    sp.addEventListener('change', () => {
      s.spatialAudio = sp.value as Settings['spatialAudio'];
      changed(s);
    });
    const q = $<HTMLSelectElement>('set-quality');
    const options: [Quality, StringKey][] = [['auto', 'qualityAuto'], ['baixa', 'qualityLow'], ['media', 'qualityMedium'], ['alta', 'qualityHigh']];
    q.innerHTML = options.map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join('');
    q.value = s.quality;
    q.addEventListener('change', () => {
      s.quality = q.value as Quality;
      changed(s);
    });
    const touchRange = (id: string, out: string, key: 'touchSensitivity' | 'touchScale' | 'touchOpacity' | 'padSensitivity', fmt: (v: number) => string) => {
      const el = $<HTMLInputElement>(id);
      const o = $(out);
      el.value = String(s[key]);
      o.textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = Number(el.value);
        o.textContent = fmt(s[key]);
        changed(s);
      });
    };
    touchRange('set-touch-sens', 'out-touch-sens', 'touchSensitivity', (v) => v.toFixed(2));
    touchRange('set-pad-sens', 'out-pad-sens', 'padSensitivity', (v) => v.toFixed(2));
    touchRange('set-touch-scale', 'out-touch-scale', 'touchScale', (v) => `${Math.round(v * 100)}%`);
    touchRange('set-touch-opacity', 'out-touch-opacity', 'touchOpacity', (v) => `${Math.round(v * 100)}%`);
    const check = (id: string, key: 'aimAssist' | 'fullscreen' | 'adsHold') => {
      const el = $<HTMLInputElement>(id);
      el.checked = s[key];
      el.addEventListener('change', () => {
        s[key] = el.checked;
        changed(s);
      });
    };
    check('set-aim-assist', 'aimAssist');
    check('set-ads-hold', 'adsHold');
    check('set-fullscreen', 'fullscreen');
    // Computer: the same setting, where fullscreen lets the game keep Esc (device.ts CAN_KEEP_ESCAPE).
    $('lbl-fullscreen-desktop').textContent = t('fullscreenDesktop');
    if (CAN_KEEP_ESCAPE) check('set-fullscreen-desktop', 'fullscreen');
    else $('fs-desktop').classList.add('hidden');
    const inv = $<HTMLInputElement>('set-invert');
    inv.checked = s.invertY;
    inv.addEventListener('change', () => {
      s.invertY = inv.checked;
      changed(s);
    });
  }
}
