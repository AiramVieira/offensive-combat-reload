// Weapon progression: each kill's points go to the weapon that made it (rifle, knife or grenade), and
// each weapon levels up on its own. Level data lives in data/progression.json; this module turns a level
// into the weapon data the game (client and server) actually uses.
import data from './data/progression.json';
import { MELEE, WEAPONS, type MeleeData, type WeaponData } from './weapons';
import type { KillKind } from './protocol';

export type ProgWeapon = 'rifle' | 'faca' | 'granada';
export const PROG_WEAPONS: ProgWeapon[] = ['rifle', 'faca', 'granada'];

export type RifleSight = 'ferro' | 'pontoVermelho' | 'holo' | 'holoLupa' | 'luneta2x' | 'luneta3x' | 'luneta4x';
export type RifleLook = 'padrao' | 'fita' | 'tia' | 'natal' | 'chamas' | 'vovo' | 'ouro';
export type KnifeModel = 'faca' | 'colher' | 'frango' | 'baguete' | 'peixe' | 'macarrao' | 'sabre';
export type KnifeSound = 'faca' | 'madeira' | 'frango' | 'crocante' | 'tapa' | 'boing' | 'sabre';
export type GrenadeKind = 'granada' | 'mina' | 'dupla';

interface LevelBase {
  nivel: number;
  /** Points earned with this weapon needed to unlock the level. */
  xp: number;
  nome: string;
  icone: string;
  descricao: string;
}

export interface RifleLevel extends LevelBase {
  mira: RifleSight;
  visual: RifleLook;
  /** Damage at close range / at long range. */
  dano: [number, number];
  pente: number;
  cadencia: number;
  /** Multipliers over the base rifle: recoil, spread, reload time. */
  recuo: number;
  dispersao: number;
  recarga: number;
  /** ADS FOV multiplier (lower = more zoom). */
  zoom: number;
}

export interface KnifeLevel extends LevelBase {
  modelo: KnifeModel;
  som: KnifeSound;
  alcance: number;
  alcanceInvestida: number;
}

export interface GrenadeEvolution extends LevelBase {
  tipo: GrenadeKind;
}

export const PROGRESSION = data as unknown as { rifle: RifleLevel[]; faca: KnifeLevel[]; granada: GrenadeEvolution[] };

export type Loadout = Record<ProgWeapon, number>;
export const DEFAULT_LOADOUT: Loadout = { rifle: 1, faca: 1, granada: 1 };

export const levelCount = (w: ProgWeapon) => PROGRESSION[w].length;

/** Clamps whatever a client claims to a valid level number. */
export function clampLevel(w: ProgWeapon, level: unknown): number {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 1;
  return Math.max(1, Math.min(levelCount(w), n));
}

export function sanitizeLoadout(v: unknown): Loadout {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<ProgWeapon, unknown>>;
  return { rifle: clampLevel('rifle', o.rifle), faca: clampLevel('faca', o.faca), granada: clampLevel('granada', o.granada) };
}

/** Highest level unlocked with `xp` points. */
export function levelForXp(w: ProgWeapon, xp: number): number {
  let lvl = 1;
  for (const l of PROGRESSION[w]) if (xp >= l.xp) lvl = l.nivel;
  return lvl;
}

export const levelInfo = <W extends ProgWeapon>(w: W, level: number) => PROGRESSION[w][clampLevel(w, level) - 1] as (typeof PROGRESSION)[W][number];

/** Which weapon gets the points of a kill. */
export function weaponOfKill(kind: KillKind): ProgWeapon | null {
  if (kind === 'gun' || kind === 'head' || kind === 'groin') return 'rifle';
  if (kind === 'knife') return 'faca';
  if (kind === 'grenade') return 'granada';
  return null;
}

const rifleCache = new Map<number, WeaponData>();
/** The rifle's full weapon data at a level: the base rifle JSON with the level's changes applied. */
export function rifleData(level: number): WeaponData {
  const n = clampLevel('rifle', level);
  let d = rifleCache.get(n);
  if (d) return d;
  const base = WEAPONS.rifle_padrao;
  const l = PROGRESSION.rifle[n - 1];
  const sp = base.dispersao;
  d = {
    ...base,
    nome: l.nome,
    dano: { ...base.dano, max: l.dano[0], min: l.dano[1] },
    pente: l.pente,
    reserva: l.pente * 4,
    cadencia: l.cadencia,
    recarga: { tatica: base.recarga.tatica * l.recarga, vazia: base.recarga.vazia * l.recarga },
    dispersao: { ...sp, mirando: sp.mirando * l.dispersao, parado: sp.parado * l.dispersao, andando: sp.andando * l.dispersao, noAr: sp.noAr * l.dispersao, porTiro: sp.porTiro * l.dispersao },
    recuo: { ...base.recuo, vertical: base.recuo.vertical * l.recuo, horizontal: [base.recuo.horizontal[0] * l.recuo, base.recuo.horizontal[1] * l.recuo] },
    ads: { ...base.ads, zoom: l.zoom },
  };
  rifleCache.set(n, d);
  return d;
}

/** The knife's data at a level: longer reach every level (and a new weapon to swing). */
export function knifeData(level: number): MeleeData {
  const l = PROGRESSION.faca[clampLevel('faca', level) - 1];
  return { ...MELEE.faca, nome: l.nome, alcance: l.alcance, alcanceInvestida: l.alcanceInvestida };
}
