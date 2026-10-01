// Loading screen (with rotating tips) and the start/pause menu with settings (section 5).
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
    $('menu-resume-hint').textContent = t('clickToResume');
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
    $('controls-table').innerHTML = rows.map(([k, keys]) => `<tr><td>${t(k)}</td><td>${keys}</td></tr>`).join('');
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
    const inv = $<HTMLInputElement>('set-invert');
    inv.checked = s.invertY;
    inv.addEventListener('change', () => {
      s.invertY = inv.checked;
      changed(s);
    });
  }
}
