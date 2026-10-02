// Character customization: body (height, build, skin), face and hair, every item of the catalog
// (shared/catalog.ts) in its slot with up to 3 colors, and the PCD mode (a missing arm, hand or leg).
// Shared by the client (editor, avatar, hitboxes, movement) and the server (validation, health, eye height
// for hit checks). Every choice that changes the game is in `bodyStats`; cosmetics never do.
//
// Version 2 (style guide catalog): `itens` by slot replaces the 6 fixed `roupas` of version 1; a saved v1
// look is converted by `sanitizeAppearance`. Colors are snapped to the palette (shared/palette.ts). The face's
// features (`rosto`) came later in version 2: a look without them gets the defaults (the face it had).
import { BIG_SLOTS, CATALOG, catalogItem, catalogOf, REQUIRED_SLOTS, SLOTS, type CatalogItem, type Category, type Slot } from './catalog';
import { ALL_ITEM_COLORS, CLOTH_COLORS, EYE_COLORS, HAIR_COLORS, SKIN_COLORS, snap } from './palette';
import type { Sex } from './protocol';

export { EYE_COLORS, HAIR_COLORS, SKIN_COLORS };
export type { Slot };

export type Height = 'pequeno' | 'medio' | 'alto';
export type Build = 'magro' | 'medio' | 'gordo';
/** PCD: which arm or hand is missing ('' = none). */
export type ArmLoss = '' | 'bracoEsq' | 'bracoDir' | 'maoEsq' | 'maoDir';
/** PCD: which leg is missing ('' = none). */
export type LegLoss = '' | 'pernaEsq' | 'pernaDir';

export type EyeStyle = 'redondo' | 'amendoado' | 'marcante' | 'caido' | 'puxado' | 'grande';
export const EYE_STYLES: EyeStyle[] = ['redondo', 'amendoado', 'marcante', 'caido', 'puxado', 'grande'];

// Face (painted geometry of the body, no textures): the shape of the face below the brows, brows, nose, mouth,
// ears and marks. The first value of each list is the default (and what a look saved before them gets).
export type FaceShape = 'oval' | 'quadrado' | 'redondo' | 'longo' | 'coracao';
export type BrowStyle = 'reta' | 'arqueada' | 'grossa' | 'fina';
export type NoseStyle = 'reto' | 'largo' | 'aquilino' | 'arrebitado';
export type MouthStyle = 'media' | 'fina' | 'carnuda';
export type EarStyle = 'normal' | 'pequena' | 'abano';
export type FaceMark = 'nenhuma' | 'sardas' | 'cicatriz' | 'pinta';
export const FACE_SHAPES: FaceShape[] = ['oval', 'quadrado', 'redondo', 'longo', 'coracao'];
export const BROW_STYLES: BrowStyle[] = ['reta', 'arqueada', 'grossa', 'fina'];
export const NOSE_STYLES: NoseStyle[] = ['reto', 'largo', 'aquilino', 'arrebitado'];
export const MOUTH_STYLES: MouthStyle[] = ['media', 'fina', 'carnuda'];
export const EAR_STYLES: EarStyle[] = ['normal', 'pequena', 'abano'];
export const FACE_MARKS: FaceMark[] = ['nenhuma', 'sardas', 'cicatriz', 'pinta'];

/** The face's features (the eyes keep their own fields: `olhos`, `olhosEstilo`). */
export interface Face {
  formato: FaceShape;
  sobrancelhas: BrowStyle;
  nariz: NoseStyle;
  boca: MouthStyle;
  orelhas: EarStyle;
  marcas: FaceMark;
}

export const DEFAULT_FACE: Readonly<Face> = { formato: 'oval', sobrancelhas: 'reta', nariz: 'reto', boca: 'media', orelhas: 'normal', marcas: 'nenhuma' };

/** Any value (a client's, an old row's) as a valid face: unknown or missing features get the default. */
export function sanitizeFace(raw: unknown): Face {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const one = <T extends string>(v: unknown, list: readonly T[]): T => (list.includes(v as T) ? (v as T) : list[0]);
  return {
    formato: one(f.formato, FACE_SHAPES),
    sobrancelhas: one(f.sobrancelhas, BROW_STYLES),
    nariz: one(f.nariz, NOSE_STYLES),
    boca: one(f.boca, MOUTH_STYLES),
    orelhas: one(f.orelhas, EAR_STYLES),
    marcas: one(f.marcas, FACE_MARKS),
  };
}
export const HEIGHTS: Height[] = ['pequeno', 'medio', 'alto'];
export const BUILDS: Build[] = ['magro', 'medio', 'gordo'];
export const ARM_LOSSES: ArmLoss[] = ['', 'bracoEsq', 'bracoDir', 'maoEsq', 'maoDir'];
export const LEG_LOSSES: LegLoss[] = ['', 'pernaEsq', 'pernaDir'];

/** Hair styles with a model (any body can have any of them). */
export const HAIR_STYLES: readonly string[] = catalogOf('cabelo').map((i) => i.id);
/** Facial hair ('' = none), in the hair color; any body can have one. */
export const BEARDS: readonly string[] = ['', ...catalogOf('barba').map((i) => i.id)];

/** An item worn in a slot and its colors, one per channel of the item (primary, secondary, detail). */
export interface ItemChoice {
  id: string;
  cores: string[];
}

export interface Appearance {
  v: 2;
  altura: Height;
  biotipo: Build;
  pele: string;
  /** Iris color. */
  olhos: string;
  /** Eye style (the face is part of the body). */
  olhosEstilo: EyeStyle;
  /** Face shape, brows, nose, mouth, ears and marks (missing in looks saved before them: the defaults). */
  rosto: Face;
  cabelo: { id: string; cor: string };
  /** Facial hair id ('' = none). */
  barba: string;
  /** Items by their first slot; an item that takes more slots keeps the others free of anything else. */
  itens: Partial<Record<Slot, ItemChoice>>;
  pcd: { braco: ArmLoss; perna: LegLoss };
}

/** Colors a channel of a slot can take: no accents on the primary color of the big pieces. */
export function allowedColors(slot: Slot, channel: number): readonly string[] {
  return channel === 0 && BIG_SLOTS.includes(slot) ? CLOTH_COLORS : ALL_ITEM_COLORS;
}

/** Default colors by category (primary, secondary, detail), all from the palette. */
const DEFAULT_COLORS: Record<Category, [string, string, string]> = {
  cabelo: ['#45301f', '#45301f', '#45301f'],
  barba: ['#45301f', '#45301f', '#45301f'],
  camiseta: ['#e8e2d6', '#3a3d42', '#1f2226'],
  blusa: ['#3a3d42', '#1f2226', '#e8e2d6'],
  jaqueta: ['#5e4330', '#3b2a1e', '#9aa3aa'],
  calca: ['#3e5878', '#5a3e2a', '#b8923e'],
  short: ['#a89a6e', '#5e4330', '#e8e2d6'],
  calcado: ['#1f2226', '#3a3d42', '#e8e2d6'],
  cabeca: ['#5c6435', '#3a3d42', '#e8e2d6'],
  acessorio: ['#3a3d42', '#9aa3aa', '#e8e2d6'],
  tatico: ['#5c6435', '#3a3d42', '#9aa3aa'],
};

/** An item choice with valid colors (one per channel, snapped to what the slot allows). */
export function choice(item: CatalogItem, cores: readonly unknown[] = []): ItemChoice {
  const slot = item.slots[0];
  return { id: item.id, cores: item.channels.map((_, i) => snap(cores[i], allowedColors(slot, i), DEFAULT_COLORS[item.category][i])) };
}

const item = (id: string) => catalogItem(id)!;

export function defaultAppearance(sex: Sex): Appearance {
  const f = sex === 'f';
  return {
    v: 2,
    altura: 'medio',
    biotipo: 'medio',
    pele: '#e8bfa0',
    olhos: '#4a6fa5',
    olhosEstilo: 'redondo',
    rosto: { ...DEFAULT_FACE },
    cabelo: { id: f ? 'rabo' : 'curto', cor: '#45301f' },
    barba: '',
    itens: {
      tronco: choice(item('basica'), [f ? '#1f2a44' : '#4a5a32', '#3a3d42']),
      baixo: choice(item('calcaCargo'), ['#a89a6e', '#5e4330']),
      calcado: choice(item('tenis'), ['#1f2226', '#3a3d42', '#e8e2d6']),
    },
    pcd: { braco: '', perna: '' },
  };
}

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Version 1 clothes (6 fixed slots, one color each) as version 2 items. */
function fromV1(roupas: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, Slot> = { camiseta: 'tronco', baixo: 'baixo', sapatos: 'calcado', chapeu: 'cabeca', oculos: 'rosto' };
  const out: Record<string, unknown> = {};
  for (const [old, raw] of Object.entries(roupas)) {
    const p = obj(raw);
    if (typeof p.id !== 'string' || !p.id) continue;
    const slot = old === 'pulseira' ? catalogItem(p.id)?.slots[0] : map[old];
    if (slot) out[slot] = { id: p.id, cores: [p.cor] };
  }
  return out;
}

/** Whatever a client sends (or an old row holds) becomes a valid version 2 appearance for `sex`. */
export function sanitizeAppearance(raw: unknown, sex: Sex): Appearance {
  const d = defaultAppearance(sex);
  const o = obj(raw);
  const itensIn = o.itens !== undefined ? obj(o.itens) : fromV1(obj(o.roupas));
  const itens: Partial<Record<Slot, ItemChoice>> = {};
  const taken = new Set<Slot>();
  // In slot order: the first item to take a slot keeps it.
  for (const slot of SLOTS) {
    const e = obj(itensIn[slot]);
    const it = typeof e.id === 'string' ? catalogItem(e.id) : undefined;
    if (!it || !it.ready || it.slots[0] !== slot || it.slots.some((s) => taken.has(s))) continue;
    for (const s of it.slots) taken.add(s);
    itens[slot] = choice(it, Array.isArray(e.cores) ? e.cores : []);
  }
  for (const slot of REQUIRED_SLOTS) if (!taken.has(slot)) itens[slot] = d.itens[slot];
  const cabelo = obj(o.cabelo);
  const pcd = obj(o.pcd);
  return {
    v: 2,
    altura: pick(o.altura, HEIGHTS, d.altura),
    biotipo: pick(o.biotipo, BUILDS, d.biotipo),
    pele: snap(o.pele, SKIN_COLORS, d.pele),
    olhos: snap(o.olhos, EYE_COLORS, d.olhos),
    olhosEstilo: pick(o.olhosEstilo, EYE_STYLES, d.olhosEstilo),
    rosto: sanitizeFace(o.rosto),
    cabelo: { id: pick(cabelo.id, HAIR_STYLES, d.cabelo.id), cor: snap(cabelo.cor, HAIR_COLORS, d.cabelo.cor) },
    barba: pick(o.barba, BEARDS, ''),
    itens,
    pcd: { braco: pick(pcd.braco, ARM_LOSSES, ''), perna: pick(pcd.perna, LEG_LOSSES, '') },
  };
}

/**
 * Puts an item on (or takes a slot off with `id` = ''): whatever else used any of its slots comes off, and
 * a required slot left empty gets the default back.
 */
export function wear(a: Appearance, slot: Slot, id: string, sex: Sex): void {
  const it = id ? catalogItem(id) : undefined;
  const previous = it ? (a.itens[it.slots[0]]?.cores ?? []) : [];
  if (!it) {
    delete a.itens[slot];
  } else {
    for (const [s, c] of Object.entries(a.itens) as [Slot, ItemChoice][]) {
      if (catalogItem(c.id)?.slots.some((x) => it.slots.includes(x))) delete a.itens[s];
    }
    a.itens[it.slots[0]] = choice(it, previous);
  }
  const d = defaultAppearance(sex);
  const taken = new Set(Object.values(a.itens).flatMap((c) => catalogItem(c!.id)?.slots ?? []));
  for (const s of REQUIRED_SLOTS) if (!taken.has(s)) a.itens[s] = d.itens[s];
}

/** The item a slot shows: the one stored there or the one that also takes it (a hood takes the head). */
export function itemIn(a: Appearance, slot: Slot): ItemChoice | undefined {
  if (a.itens[slot]) return a.itens[slot];
  return Object.values(a.itens).find((c) => catalogItem(c!.id)?.slots.includes(slot));
}

/** Tops whose sleeves are in the second color (a sweater vest over a shirt, raglan sleeves). */
const SLEEVE_IN_SECONDARY = new Set(['coleteLa', 'raglan', 'camisetaTatica', 'varsity', 'bicolor']);

/** The sleeve the first-person arms show: the jacket's, else the top's (null = bare arms). */
export function armSleeve(a: Appearance): { color: string; long: boolean } | null {
  for (const slot of ['sobreposicao', 'tronco'] as Slot[]) {
    const c = a.itens[slot];
    const it = c && catalogItem(c.id);
    if (it && it.sleeve && it.sleeve !== 'nenhuma') return { color: c.cores[SLEEVE_IN_SECONDARY.has(it.id) ? 1 : 0] ?? c.cores[0], long: it.sleeve === 'longa' };
    if (it && slot === 'tronco') return null;
  }
  return null;
}

/** The gloves the first-person hands show: the item in the hands slot and its colors (null = bare hands). */
export function armGlove(a: Appearance): { id: string; colors: readonly string[] } | null {
  const c = a.itens.maos;
  return c && catalogItem(c.id) ? { id: c.id, colors: c.cores } : null;
}

/** How often bots wear something in an optional slot. */
const OPTIONAL_ODDS: Partial<Record<Slot, number>> = { sobreposicao: 0.3, cabeca: 0.35, rosto: 0.25, pulsoE: 0.2, pulsoD: 0.2 };

/** A random look (bots): any items and palette colors; now and then a PCD body. */
export function randomAppearance(sex: Sex, rnd: () => number = Math.random): Appearance {
  const one = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const a = defaultAppearance(sex);
  a.itens = {};
  for (const slot of SLOTS) {
    const options = CATALOG.filter((i) => i.ready && i.slots[0] === slot);
    if (!options.length) continue;
    if (!REQUIRED_SLOTS.includes(slot) && rnd() > (OPTIONAL_ODDS[slot] ?? 0.1)) continue;
    const it = one(options);
    const taken = new Set(Object.values(a.itens).flatMap((c) => catalogItem(c!.id)?.slots ?? []));
    if (it.slots.some((s) => taken.has(s))) continue;
    a.itens[slot] = choice(it, it.channels.map((_, i) => one(allowedColors(slot, i))));
  }
  return sanitizeAppearance(
    {
      ...a,
      altura: one(HEIGHTS),
      biotipo: one(BUILDS),
      pele: one(SKIN_COLORS),
      olhos: one(EYE_COLORS),
      olhosEstilo: one(EYE_STYLES),
      rosto: {
        formato: one(FACE_SHAPES),
        sobrancelhas: one(BROW_STYLES),
        nariz: one(NOSE_STYLES),
        boca: one(MOUTH_STYLES),
        orelhas: one(EAR_STYLES),
        // Marks now and then (most faces have none).
        marcas: rnd() < 0.3 ? one(FACE_MARKS.slice(1)) : 'nenhuma',
      },
      cabelo: { id: one(HAIR_STYLES), cor: one(HAIR_COLORS) },
      barba: sex === 'm' && rnd() < 0.45 ? one(BEARDS.slice(1)) : '',
      pcd: { braco: rnd() < 0.12 ? one(ARM_LOSSES.slice(1)) : '', perna: rnd() < 0.08 ? one(LEG_LOSSES.slice(1)) : '' },
    },
    sex,
  );
}

// --- Game effects -------------------------------------------------------------------------------------------

export const EFFECTS = {
  /**
   * Visual only (style guide): the hitbox and the eye use the standard height, or the shortest body would be
   * the meta. Kept small so the body you see stays close to the hitbox.
   */
  heightScale: { pequeno: 0.96, medio: 1, alto: 1.04 } as Record<Height, number>,
  /** Reload time multiplier without a hand or an arm. */
  armLossReload: 1.3,
  /** Movement speed multiplier without a leg. */
  legLossSpeed: 0.75,
};

/**
 * What the body does in the game. Height and build are only looks (same hitbox, eye height and health for
 * everyone); only the PCD mode changes the game (a missing limb has no hitbox, and costs reload or speed).
 */
export interface BodyStats {
  /** Visual height scale of the model (never the hitbox nor the eye). */
  visualScale: number;
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
    visualScale: EFFECTS.heightScale[a.altura],
    maxHealth: 100,
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
 * How big a target the body is compared with the default one (1 = 100%): only a missing arm, hand or leg
 * takes its share away (the rest of the body is the same for everyone). Shown in the editor.
 */
export function hitboxSize(b: BodyStats): number {
  const m = b.missing;
  const arms = (m.armL ? 0.07 : m.handL ? 0.02 : 0) + (m.armR ? 0.07 : m.handR ? 0.02 : 0);
  const legs = (m.legL ? 0.12 : 0) + (m.legR ? 0.12 : 0);
  return 1 - arms - legs;
}
