// Character customization: body (height, build, skin), hair, clothes and the PCD mode (a missing arm, hand
// or leg). Shared by the client (editor, avatar, hitboxes, movement) and the server (validation, health,
// eye height for hit checks). Every choice that changes the game is in `bodyStats`.
import type { Sex } from './protocol';

export type Height = 'pequeno' | 'medio' | 'alto';
export type Build = 'magro' | 'medio' | 'gordo';
/** PCD: which arm or hand is missing ('' = none). */
export type ArmLoss = '' | 'bracoEsq' | 'bracoDir' | 'maoEsq' | 'maoDir';
/** PCD: which leg is missing ('' = none). */
export type LegLoss = '' | 'pernaEsq' | 'pernaDir';

export const HEIGHTS: Height[] = ['pequeno', 'medio', 'alto'];
export const BUILDS: Build[] = ['magro', 'medio', 'gordo'];
export const ARM_LOSSES: ArmLoss[] = ['', 'bracoEsq', 'bracoDir', 'maoEsq', 'maoDir'];
export const LEG_LOSSES: LegLoss[] = ['', 'pernaEsq', 'pernaDir'];

/** Clothing catalog: 3 of each piece, for everyone (the piece fits either body). */
export const CATALOG = {
  camiseta: ['basica', 'regata', 'polo'],
  /** Bottom piece: pants, shorts or skirt (one at a time). */
  baixo: ['calcaJeans', 'calcaCargo', 'calcaMoletom', 'bermudaPraia', 'bermudaJeans', 'bermudaEsportiva', 'saiaLapis', 'saiaRodada', 'saiaPregas'],
  sapatos: ['tenis', 'bota', 'chinelo'],
  chapeu: ['', 'bone', 'palha', 'gorro'],
  oculos: ['', 'escuros', 'redondos', 'aviador'],
  pulseira: ['', 'couro', 'micangas', 'relogio'],
} as const;

export const HAIR: Record<Sex, readonly string[]> = {
  m: ['curto', 'topete', 'blackPower'],
  f: ['rabo', 'longo', 'coque'],
};

export type Slot = keyof typeof CATALOG;
export const SLOTS = Object.keys(CATALOG) as Slot[];

export interface Piece {
  /** '' = not wearing one (hat, glasses and bracelet are optional). */
  id: string;
  cor: string;
}

export interface Appearance {
  altura: Height;
  biotipo: Build;
  pele: string;
  /** Iris color. */
  olhos: string;
  cabelo: Piece;
  roupas: Record<Slot, Piece>;
  pcd: { braco: ArmLoss; perna: LegLoss };
}

/** Skin tones offered first in the editor (any color can still be picked). */
export const SKIN_TONES = ['#f6d7c3', '#eec4a4', '#dfa77f', '#c68a5c', '#a86b43', '#8a5232', '#6b3d24', '#4a2a19'];
export const EYE_COLORS = ['#3b2418', '#6b4226', '#4a6fa5', '#3d7a4f', '#7a8a96', '#8a3a8a', '#b3312a', '#c9a227'];
export const HAIR_COLORS = ['#1c1410', '#3b2418', '#6b4226', '#a8742f', '#e2c07a', '#b8b8b8', '#b3312a', '#3f6fd8'];

const HEX = /^#[0-9a-f]{6}$/;

export function defaultAppearance(sex: Sex): Appearance {
  const f = sex === 'f';
  return {
    altura: 'medio',
    biotipo: 'medio',
    pele: '#eec4a4',
    olhos: '#4a6fa5',
    cabelo: { id: f ? 'rabo' : 'curto', cor: '#3b2418' },
    roupas: {
      camiseta: { id: 'basica', cor: '#ff7a1a' },
      baixo: { id: 'calcaCargo', cor: '#4a5a32' },
      sapatos: { id: 'tenis', cor: '#222226' },
      chapeu: { id: '', cor: '#2f9bff' },
      oculos: { id: '', cor: '#222226' },
      pulseira: { id: '', cor: '#6b4226' },
    },
    pcd: { braco: '', perna: '' },
  };
}

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fallback);

/** Whatever a client sends (or an old row holds) becomes a valid appearance for `sex`. */
export function sanitizeAppearance(raw: unknown, sex: Sex): Appearance {
  const d = defaultAppearance(sex);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Appearance, unknown>>;
  const piece = (v: unknown, list: readonly string[], fb: Piece): Piece => {
    const p = (v && typeof v === 'object' ? v : {}) as Partial<Piece>;
    return { id: pick(p.id, list, fb.id), cor: color(p.cor, fb.cor) };
  };
  const roupasIn = (o.roupas && typeof o.roupas === 'object' ? o.roupas : {}) as Partial<Record<Slot, unknown>>;
  const roupas = {} as Record<Slot, Piece>;
  for (const s of SLOTS) roupas[s] = piece(roupasIn[s], CATALOG[s], d.roupas[s]);
  const pcd = (o.pcd && typeof o.pcd === 'object' ? o.pcd : {}) as Partial<Appearance['pcd']>;
  return {
    altura: pick(o.altura, HEIGHTS, d.altura),
    biotipo: pick(o.biotipo, BUILDS, d.biotipo),
    pele: color(o.pele, d.pele),
    olhos: color(o.olhos, d.olhos),
    // Hair styles belong to a body: switching body type falls back to that body's first style.
    cabelo: piece(o.cabelo, HAIR[sex], d.cabelo),
    roupas,
    pcd: { braco: pick(pcd.braco, ARM_LOSSES, ''), perna: pick(pcd.perna, LEG_LOSSES, '') },
  };
}

// --- Game effects -------------------------------------------------------------------------------------------

export const EFFECTS = {
  heightScale: { pequeno: 0.9, medio: 1, alto: 1.1 } as Record<Height, number>,
  /** Torso width (hitbox and body). */
  buildWidth: { magro: 0.85, medio: 1, gordo: 1.3 } as Record<Build, number>,
  gordoExtraHealth: 50,
  /** Reload time multiplier without a hand or an arm. */
  armLossReload: 1.3,
  /** Movement speed multiplier without a leg. */
  legLossSpeed: 0.75,
};

export interface BodyStats {
  /** Whole-body scale: height, eye height and hitboxes. */
  scale: number;
  /** Torso width multiplier. */
  width: number;
  maxHealth: number;
  reloadMul: number;
  speedMul: number;
  /** Missing parts, by side. */
  missing: { armL: boolean; armR: boolean; handL: boolean; handR: boolean; legL: boolean; legR: boolean };
}

export function bodyStats(a: Appearance): BodyStats {
  const arm = a.pcd.braco;
  const leg = a.pcd.perna;
  return {
    scale: EFFECTS.heightScale[a.altura],
    width: EFFECTS.buildWidth[a.biotipo],
    maxHealth: 100 + (a.biotipo === 'gordo' ? EFFECTS.gordoExtraHealth : 0),
    reloadMul: arm ? EFFECTS.armLossReload : 1,
    speedMul: leg ? EFFECTS.legLossSpeed : 1,
    missing: {
      armL: arm === 'bracoEsq',
      armR: arm === 'bracoDir',
      // No arm = no hand either.
      handL: arm === 'bracoEsq' || arm === 'maoEsq',
      handR: arm === 'bracoDir' || arm === 'maoDir',
      legL: leg === 'pernaEsq',
      legR: leg === 'pernaDir',
    },
  };
}

/**
 * How big a target the body is compared with the default one (1 = 100%): height scales both dimensions,
 * the build widens the torso, and a missing arm, hand or leg takes its share away. Shown in the editor.
 */
export function hitboxSize(b: BodyStats): number {
  const m = b.missing;
  const arms = (m.armL ? 0.07 : m.handL ? 0.02 : 0) + (m.armR ? 0.07 : m.handR ? 0.02 : 0);
  const legs = (m.legL ? 0.12 : 0) + (m.legR ? 0.12 : 0);
  return b.scale * b.scale * (0.55 + 0.45 * b.width) * (1 - arms - legs);
}

/** A random look (bots): any clothes and colors; now and then a PCD body. */
export function randomAppearance(sex: Sex, rnd: () => number = Math.random): Appearance {
  const one = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`;
  const roupas = {} as Record<Slot, Piece>;
  for (const slot of SLOTS) roupas[slot] = { id: one(CATALOG[slot]), cor: hex() };
  return {
    altura: one(HEIGHTS),
    biotipo: one(BUILDS),
    pele: one(SKIN_TONES),
    olhos: one(EYE_COLORS),
    cabelo: { id: one(HAIR[sex]), cor: one(HAIR_COLORS) },
    roupas,
    pcd: { braco: rnd() < 0.12 ? one(ARM_LOSSES.slice(1)) : '', perna: rnd() < 0.08 ? one(LEG_LOSSES.slice(1)) : '' },
  };
}
