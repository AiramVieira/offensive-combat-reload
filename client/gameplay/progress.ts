// The player's weapon progression, owned by the account on the server: points only come from online kills
// the server validated (it sends 'progresso'), and every mode uses the account's equipped levels. Without
// an account, everything stays at level 1.
import type { ProfileResponse } from '@shared/account';
import { DEFAULT_LOADOUT, levelForXp, PROG_WEAPONS, type Loadout, type ProgWeapon } from '@shared/progression';
import type { ServerMsg } from '@shared/protocol';
import { api } from '../net/api';

export class Progress {
  private xpOf: Record<ProgWeapon, number> = { rifle: 0, faca: 0, granada: 0 };
  private equippedOf: Loadout = { ...DEFAULT_LOADOUT };
  private listeners = new Set<() => void>();
  readonly signedIn: boolean;

  constructor(profile: ProfileResponse | null) {
    this.signedIn = !!profile;
    if (profile) for (const w of PROG_WEAPONS) this.set(w, profile.armas[w].xp, profile.armas[w].equipado);
  }

  private set(w: ProgWeapon, xp: number, equipped: number) {
    this.xpOf[w] = Math.max(0, Math.floor(xp));
    this.equippedOf[w] = Math.max(1, Math.min(equipped, this.unlocked(w)));
  }

  private changed() {
    for (const f of this.listeners) f();
  }

  onChange(f: () => void) {
    this.listeners.add(f);
  }

  xp(w: ProgWeapon): number {
    return this.xpOf[w];
  }

  /** Highest level unlocked for `w`. */
  unlocked(w: ProgWeapon): number {
    return levelForXp(w, this.xpOf[w]);
  }

  equipped(w: ProgWeapon): number {
    return this.equippedOf[w];
  }

  get loadout(): Loadout {
    return { ...this.equippedOf };
  }

  /** Equips an unlocked level (locked ones are ignored) and saves the choice to the account. */
  equip(w: ProgWeapon, level: number): boolean {
    if (level < 1 || level > this.unlocked(w) || this.equippedOf[w] === level) return false;
    this.equippedOf[w] = level;
    if (this.signedIn) api('PATCH', '/api/perfil', { equipado: { [w]: level } }).catch(() => {});
    this.changed();
    return true;
  }

  /** Progress pushed by the game server. */
  applyServer(armas: Extract<ServerMsg, { t: 'progresso' }>['armas']) {
    for (const w of PROG_WEAPONS) this.set(w, armas[w].xp, armas[w].equipado);
    this.changed();
  }
}
