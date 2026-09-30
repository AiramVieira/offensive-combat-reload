// The player's saved progression (localStorage for now): points earned with each weapon, and which
// unlocked level of each weapon is equipped. Kills feed only the weapon that made them.
import { DEFAULT_LOADOUT, levelForXp, PROG_WEAPONS, clampLevel, type Loadout, type ProgWeapon } from '@shared/progression';

const KEY = 'oc.profile';

interface SavedProfile {
  xp: Record<ProgWeapon, number>;
  equipped: Loadout;
}

export interface LevelUp {
  weapon: ProgWeapon;
  level: number;
}

export class Progress {
  private p: SavedProfile;
  private listeners = new Set<() => void>();

  constructor() {
    this.p = { xp: { rifle: 0, faca: 0, granada: 0 }, equipped: { ...DEFAULT_LOADOUT } };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        for (const w of PROG_WEAPONS) {
          const xp = Number(raw.xp?.[w]);
          this.p.xp[w] = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
          this.p.equipped[w] = Math.min(clampLevel(w, raw.equipped?.[w]), this.unlocked(w));
        }
      }
    } catch {
      /* storage unavailable or corrupted: start fresh */
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.p));
    } catch {
      /* storage unavailable */
    }
    for (const f of this.listeners) f();
  }

  onChange(f: () => void) {
    this.listeners.add(f);
  }

  xp(w: ProgWeapon): number {
    return this.p.xp[w];
  }

  /** Highest level unlocked for `w`. */
  unlocked(w: ProgWeapon): number {
    return levelForXp(w, this.p.xp[w]);
  }

  equipped(w: ProgWeapon): number {
    return this.p.equipped[w];
  }

  get loadout(): Loadout {
    return { ...this.p.equipped };
  }

  /** Equips an unlocked level (locked ones are ignored). */
  equip(w: ProgWeapon, level: number): boolean {
    if (level < 1 || level > this.unlocked(w) || this.p.equipped[w] === level) return false;
    this.p.equipped[w] = level;
    this.save();
    return true;
  }

  /**
   * Adds a kill's points to the weapon that made it. Returns the new level when it goes up; the new level
   * is equipped automatically if the player was using their best one.
   */
  addKill(w: ProgWeapon, points: number): LevelUp | null {
    if (points <= 0) return null;
    const before = this.unlocked(w);
    this.p.xp[w] += Math.round(points);
    const after = this.unlocked(w);
    let up: LevelUp | null = null;
    if (after > before) {
      up = { weapon: w, level: after };
      if (this.p.equipped[w] === before) this.p.equipped[w] = after;
    }
    this.save();
    return up;
  }
}
