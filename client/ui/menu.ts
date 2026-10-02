// Loading screen (with rotating tips) and the start/pause menu with settings (section 5).
import { CAN_FULLSCREEN, enterFullscreen, IS_IOS, IS_MOBILE, STANDALONE } from '../core/device';
import type { GamepadInput, PadButton } from '../core/gamepad';
import type { Settings } from '../core/settings';
import type { Quality } from '../render/quality';
import { getLang, t, TIPS, type StringKey } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Screens {
  private tipTimer = 0;

  constructor() {
    this.startTips();

    $('menu-subtitle').textContent = t('subtitle');
    $('controls-title').textContent = t('controls');
    $('settings-title').textContent = t('settings');
    $('menu-debug-hint').textContent = t('debugHint');
    $('menu-resume-hint').textContent = t(IS_MOBILE ? 'tapToResume' : 'clickToResume');
    const labels: [string, StringKey][] = [['lbl-sens', 'sensitivity'], ['lbl-ads', 'adsSensitivity'], ['lbl-fov', 'fov'], ['lbl-vol', 'volume'], ['lbl-invert', 'invertY'], ['lbl-quality', 'quality']];
    for (const [id, key] of labels) $(id).textContent = t(key);

    const rows: [StringKey, string][] = [
      ['keyMove', '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>'],
      ['keyJump', `<kbd>${getLang() === 'pt-BR' ? 'Espaço' : 'Space'}</kbd>`],
      ['keyCrouch', '<kbd>C</kbd>'],
      ['keySprint', '<kbd>Shift</kbd>'],
      ['keyFire', `<kbd>${t('mouseLeft')}</kbd>`],
      ['keyAds', `<kbd>${t('mouseRight')}</kbd>`],
      ['keyReload', '<kbd>R</kbd>'],
      ['keyMelee', '<kbd>F</kbd>'],
      ['keyGrenade', '<kbd>G</kbd>'],
      ['keyTaunt', '<kbd>E</kbd>'],
      ['keyPause', '<kbd>Esc</kbd>'],
    ];
    this.keyRows = rows;
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

  private keyRows: [StringKey, string][] = [];

  /**
   * The controls help: the controller's buttons (PlayStation or Xbox glyphs) while one is in use, the touch
   * help on phones, the keys otherwise.
   */
  showControls(pad: GamepadInput | null) {
    const table = $('controls-table');
    $('menu-resume-hint').textContent =
      pad && pad.device === 'pad' ? t('padToResume', { a: pad.glyph('a'), start: pad.glyph('start') }) : t(IS_MOBILE ? 'tapToResume' : 'clickToResume');
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
    table.innerHTML = IS_MOBILE ? `<tr><td>${t('touchControlsHelp')}</td></tr>` : this.keyRows.map(([k, keys]) => `<tr><td>${t(k)}</td><td>${keys}</td></tr>`).join('');
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
    $('menu').classList.add('hidden');
  }

  onPlay(cb: () => void) {
    $('play-btn').addEventListener('click', cb);
  }

  bindSettings(s: Settings, changed: (s: Settings) => void) {
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
    const inv = $<HTMLInputElement>('set-invert');
    inv.checked = s.invertY;
    inv.addEventListener('change', () => {
      s.invertY = inv.checked;
      changed(s);
    });
  }
}
