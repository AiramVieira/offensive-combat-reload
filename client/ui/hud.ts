// In-match HUD (section 5): DOM updated by direct reference, numbers throttled by the caller.
import { t } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type HitKind = 'hit' | 'head' | 'kill';
export type FeedIcon = 'head' | 'knife' | 'bird' | 'taunt' | 'grenade' | 'dog' | null;
const FEED_ICONS: Record<Exclude<FeedIcon, null>, string> = { head: '✚', knife: '🔪', bird: '🐦', taunt: '💃', grenade: '💣', dog: '🐕' };

export class Hud {
  private root = $('hud');
  private crosshair = $('crosshair');
  private hitmarker = $('hitmarker');
  private healthFill = $('health-fill');
  private healthNum = $('health-num');
  private healthBox = $('health');
  private ammoMag = $('ammo-mag');
  private ammoReserve = $('ammo-reserve');
  private ammoWarn = $('ammo-warn');
  private weaponName = $('weapon-name');
  private scorePoints = $('score-points');
  private scoreKills = $('score-kills');
  private scoreAcc = $('score-acc');
  private feed = $('killfeed');
  private popups = $('popups');
  private vignette = $('vignette');
  private death = $('death');
  private deathMsg = $('death-msg');
  private deathTimer = $('death-timer');
  private debug = $('debug');
  private banner = $('banner');
  private prompt = $('prompt');
  private promptText = $('prompt-text');
  private promptFill = $('prompt-fill');
  private promptKey = '';
  private grenadesEl = $('grenades');
  private grenadesKey = '';
  private cook = $('cook');
  private cookFill = $('cook-fill');
  private warn = $('grenade-warn');
  private bannerTimer = 0;
  private hitTimer = 0;
  private popupTotal = 0;
  private popupTotalEl: HTMLElement | null = null;
  private popupTimer = 0;
  private lastHealth = -1;
  private lastAmmo = '';

  constructor() {
    $('score-points-label').textContent = t('points');
    $('score-kills-label').textContent = t('kills');
    $('score-acc-label').textContent = t('accuracy');
    $('health-label').textContent = t('health');
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  setWeaponName(name: string) {
    this.weaponName.textContent = name;
  }

  setHealth(h: number) {
    const v = Math.ceil(h);
    if (v === this.lastHealth) return;
    this.lastHealth = v;
    this.healthNum.textContent = String(v);
    this.healthFill.style.width = `${v}%`;
    this.healthBox.classList.toggle('low', v < 25);
    this.vignette.style.setProperty('--low', String(Math.max(0, (30 - v) / 30)));
  }

  setAmmo(mag: number, reserve: number, size: number, reloading: boolean) {
    const key = `${mag}|${reserve}|${reloading}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle('low', mag <= size * 0.3);
    let warn = '';
    if (reloading) warn = t('reloading');
    else if (mag === 0 && reserve === 0) warn = t('noAmmo');
    else if (mag <= size * 0.3) warn = t('reload');
    this.ammoWarn.textContent = warn;
    this.ammoWarn.classList.toggle('visible', warn !== '');
  }

  setCrosshair(gapPx: number, visible: boolean) {
    this.crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    this.crosshair.classList.toggle('hidden', !visible);
  }

  setScore(points: number, kills: number, accuracy: number) {
    this.scorePoints.textContent = String(points);
    this.scoreKills.textContent = String(kills);
    this.scoreAcc.textContent = `${Math.round(accuracy * 100)}%`;
  }

  hit(kind: HitKind) {
    this.hitmarker.className = `show ${kind}`;
    // Restart the CSS animation.
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('pop');
    this.hitTimer = kind === 'kill' ? 0.35 : 0.18;
  }

  /** Score popups stack under the crosshair and add up into a running total. */
  popup(label: string, points: number) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.innerHTML = `<b>+${points}</b> ${label}`;
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 1600);
    if (!this.popupTotalEl || this.popupTimer <= 0) {
      this.popupTotal = 0;
      this.popupTotalEl?.remove();
      this.popupTotalEl = document.createElement('div');
      this.popupTotalEl.className = 'popup-total';
      this.popups.prepend(this.popupTotalEl);
    }
    this.popupTotal += points;
    this.popupTotalEl.textContent = `+${this.popupTotal}`;
    this.popupTotalEl.classList.remove('bump');
    void this.popupTotalEl.offsetWidth;
    this.popupTotalEl.classList.add('bump');
    this.popupTimer = 2;
  }

  killfeed(killer: string, weapon: string, victim: string, icon: FeedIcon = null) {
    const el = document.createElement('div');
    el.className = 'feed-row';
    el.innerHTML = `<span class="me"></span><span class="weapon"></span>${icon ? `<span class="icon ${icon}">${FEED_ICONS[icon]}</span>` : ''}<span class="victim"></span>`;
    el.querySelector('.me')!.textContent = killer;
    el.querySelector('.weapon')!.textContent = `[${weapon}]`;
    el.querySelector('.victim')!.textContent = victim;
    this.feed.prepend(el);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 5000);
    setTimeout(() => el.remove(), 5600);
  }

  /** Grenade slots next to the ammo counter: filled = carried, faded = used. */
  setGrenades(count: number, max: number) {
    const key = `${count}/${max}`;
    if (key === this.grenadesKey) return;
    this.grenadesKey = key;
    this.grenadesEl.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
  }

  /** Fuse bar under the crosshair while a grenade is cooking; null hides it. */
  setCook(fraction: number | null) {
    this.cook.classList.toggle('hidden', fraction === null);
    if (fraction === null) return;
    this.cookFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.cook.classList.toggle('danger', fraction < 0.34);
  }

  /** Grenade nearby: icon around the crosshair pointing at it. `angle` in radians, 0 = straight ahead. */
  setGrenadeWarning(angle: number | null, closeness = 0) {
    this.warn.classList.toggle('hidden', angle === null);
    if (angle === null) return;
    const r = 96;
    this.warn.style.transform = `translate(${Math.sin(angle) * r}px, ${-Math.cos(angle) * r}px)`;
    (this.warn.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${angle}rad)`;
    this.warn.style.opacity = String(0.55 + closeness * 0.45);
  }

  /** Big animated banner ("NO PÁSSARO!", "HUMILHADO!"). */
  showBanner(text: string, variant: 'bird' | 'taunt' | 'level') {
    this.banner.textContent = text;
    this.banner.className = variant;
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = 1.8;
  }

  /** Context prompt with a key badge and a draining bar; null hides it. */
  setPrompt(key: string | null, text = '', frac = 0) {
    if (key === null) {
      if (this.promptKey !== '') {
        this.prompt.classList.add('hidden');
        this.promptKey = '';
      }
      return;
    }
    const id = `${key}|${text}`;
    if (id !== this.promptKey) {
      this.promptKey = id;
      this.prompt.classList.remove('hidden');
      this.prompt.querySelector('kbd')!.textContent = key;
      this.promptText.textContent = text;
    }
    this.promptFill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  /** Plain line in the kill feed ("Fulano entrou"). */
  notice(text: string) {
    const el = document.createElement('div');
    el.className = 'feed-row notice';
    el.textContent = text;
    this.feed.prepend(el);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 4000);
    setTimeout(() => el.remove(), 4600);
  }

  setNetStatus(text: string | null) {
    const el = document.getElementById('net-status')!;
    el.classList.toggle('hidden', text === null);
    if (text !== null) el.textContent = text;
  }

  damageFlash(amount: number) {
    this.vignette.style.setProperty('--hit', String(Math.min(1, 0.3 + amount / 60)));
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }

  showDeath(message: string | null) {
    this.death.classList.toggle('hidden', message === null);
    if (message !== null) this.deathMsg.textContent = message;
  }

  setDeathTimer(seconds: number) {
    this.deathTimer.textContent = t('respawnIn', { s: Math.ceil(seconds) });
  }

  setDebug(text: string | null) {
    this.debug.classList.toggle('hidden', text === null);
    if (text !== null) this.debug.textContent = text;
  }

  update(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.className = '';
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.className = '';
    }
    if (this.popupTimer > 0) {
      this.popupTimer -= dt;
      if (this.popupTimer <= 0 && this.popupTotalEl) {
        const el = this.popupTotalEl;
        el.classList.add('fade');
        setTimeout(() => el.remove(), 400);
        this.popupTotalEl = null;
      }
    }
  }
}
