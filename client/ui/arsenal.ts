// Menu panel with the weapon progression: for each weapon, the equipped level, the points toward the next
// one, every level (unlocked ones can be equipped with a click) and what each level does.
import { PROG_WEAPONS, PROGRESSION, levelInfo, type ProgWeapon } from '@shared/progression';
import type { Progress } from '../gameplay/progress';
import { t, type StringKey } from './strings';

const LABEL: Record<ProgWeapon, StringKey> = { rifle: 'weaponRifle', faca: 'weaponKnife', granada: 'weaponGrenade' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Arsenal {
  private grid: HTMLElement;
  /** Level whose details are shown per weapon (hovered chip), null = the equipped one. */
  private preview: Record<ProgWeapon, number | null> = { rifle: null, faca: null, granada: null };

  constructor(
    private progress: Progress,
    private onEquip: () => void,
  ) {
    document.getElementById('arsenal-title')!.textContent = t('arsenal');
    document.getElementById('arsenal-hint')!.textContent = t('arsenalHint');
    this.grid = document.getElementById('arsenal-grid')!;
    this.grid.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.level-chip');
      if (!chip || chip.disabled) return;
      if (this.progress.equip(chip.dataset.w as ProgWeapon, Number(chip.dataset.l))) this.onEquip();
    });
    this.grid.addEventListener('mouseover', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.level-chip');
      if (!chip) return;
      const w = chip.dataset.w as ProgWeapon;
      const l = Number(chip.dataset.l);
      if (this.preview[w] === l) return;
      this.preview[w] = l;
      this.renderDetail(w);
    });
    this.grid.addEventListener('mouseleave', () => {
      for (const w of PROG_WEAPONS) {
        if (this.preview[w] === null) continue;
        this.preview[w] = null;
        this.renderDetail(w);
      }
    });
    progress.onChange(() => this.render());
    this.render();
  }

  render() {
    this.grid.innerHTML = PROG_WEAPONS.map((w) => this.card(w)).join('');
  }

  private card(w: ProgWeapon): string {
    const levels = PROGRESSION[w];
    const eq = this.progress.equipped(w);
    const unlocked = this.progress.unlocked(w);
    const xp = this.progress.xp(w);
    const cur = levelInfo(w, eq);
    const next = levels[unlocked]; // the first locked level, if any
    const prevXp = levels[unlocked - 1].xp;
    const frac = next ? Math.min(1, (xp - prevXp) / (next.xp - prevXp)) : 1;
    const chips = levels
      .map((l) => {
        const open = l.nivel <= unlocked;
        const cls = ['level-chip', open ? 'unlocked' : 'locked', l.nivel === eq ? 'equipped' : ''].join(' ');
        const title = open ? `${l.nome}` : `${l.nome} (${t('unlockAt', { xp: l.xp })})`;
        return `<button type="button" class="${cls}" data-w="${w}" data-l="${l.nivel}" ${open ? '' : 'disabled'} title="${esc(title)}"><span class="chip-icon">${open ? l.icone : '🔒'}</span><span class="chip-n">${l.nivel}</span></button>`;
      })
      .join('');
    const xpText = next ? t('xpToNext', { xp, next: next.xp, level: next.nivel }) : t('maxLevel', { xp });
    return `<div class="arsenal-card" data-w="${w}">
      <div class="arsenal-head"><span class="arsenal-icon">${cur.icone}</span><div>
        <div class="arsenal-weapon">${t(LABEL[w])} · ${t('level')} ${eq}/${levels.length}</div>
        <div class="arsenal-name">${esc(cur.nome)}</div></div></div>
      <div class="xp-bar"><div class="xp-fill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
      <div class="xp-text">${xpText}</div>
      <div class="level-chips">${chips}</div>
      <div class="level-detail">${this.detail(w)}</div>
    </div>`;
  }

  private detail(w: ProgWeapon): string {
    const l = levelInfo(w, this.preview[w] ?? this.progress.equipped(w));
    const unlocked = l.nivel <= this.progress.unlocked(w);
    const status = l.nivel === this.progress.equipped(w) ? t('equipped') : unlocked ? t('equip') : `🔒 ${t('unlockAt', { xp: l.xp })}`;
    return `<b>${l.icone} ${t('level')} ${l.nivel}: ${esc(l.nome)}</b> <span class="detail-status">${status}</span><br>${esc(l.descricao)}`;
  }

  private renderDetail(w: ProgWeapon) {
    const el = this.grid.querySelector(`.arsenal-card[data-w="${w}"] .level-detail`);
    if (el) el.innerHTML = this.detail(w);
  }
}
