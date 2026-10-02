// AssetRegistry: every item a character can wear or hold. Adding an item is registering it here (no change
// to Character). An item comes from a GLB (`url`, exported from Blender on the canonical skeleton, see
// docs/PERSONAGENS.md) or, while there is no GLB, from a procedural generator (pieces/). The slots of the
// look are the catalog's (shared/catalog.ts); the character adds the body, hair, beard and weapons.
import * as THREE from 'three';
import { catalogOf, SLOTS, type Slot } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import { ACCESSORY_ITEMS } from './items/accessories';
import { BOTTOM_ITEMS } from './items/bottoms';
import { shade } from './items/common';
import { HEAD_ITEMS } from './items/head';
import { JACKET_ITEMS } from './items/jackets';
import { SHOE_ITEMS } from './items/shoes';
import { TACTICAL_ITEMS } from './items/tactical';
import { TOP_ITEMS } from './items/tops';
import { regionBits, type RegionName, type SocketName } from './rig';

export type CharSlot = 'body' | 'hair' | 'beard' | Slot | 'weapon_R' | 'weapon_L' | 'weapon_back';
export const CHAR_SLOTS: CharSlot[] = ['body', 'hair', 'beard', ...SLOTS, 'weapon_R', 'weapon_L', 'weapon_back'];

/** How the secondary and detail channels get their color when the player only picks the primary one. */
export interface ChannelDefaults {
  /** 'shade' = the primary color darkened by `shade`; or a fixed color. */
  secondary: 'shade' | string;
  shade?: number;
  detail: string;
}

export interface ItemDef {
  id: string;
  slot: CharSlot;
  /** GLB file (public/…); when present it wins over the generator. */
  url?: string;
  /** Procedural generator name (procedural.ts) used while there is no GLB. */
  generator?: string;
  /** Body regions this item covers completely (hidden to avoid skin poking through). */
  hides?: RegionName[];
  /** Rigid items: the socket they hang from and the grip offset (position, rotation) in socket space. */
  socket?: SocketName;
  grip?: { position?: [number, number, number]; rotation?: [number, number, number, number] };
  channels: ChannelDefaults;
  /** Only for these bodies (hair styles are per body). */
  sexes?: Sex[];
  /**
   * Regions it hides on the OTHER pieces worn with it (not on the body): a jacket over the shirt's sleeves,
   * boots over the pants' hem, a mask over the beard, a balaclava over the hair.
   */
  over?: RegionName[];
  /** Free data for a generator. */
  meta?: Record<string, unknown>;
}

/**
 * Grip of the rifle in the right hand of the canonical rig: the barrel (model -Z) along the arm (bone +X),
 * the top (model +Y) toward bone -Z, which faces up when the arm is raised to aim.
 */
const RIFLE_GRIP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
/** On the back: barrel up, tilted. */
const RIFLE_BACK = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0.55, 'ZXY'));

const ITEMS: ItemDef[] = [
  { id: 'corpo_m', slot: 'body', generator: 'body', sexes: ['m'], channels: { secondary: 'shade', shade: 0.85, detail: '#ffffff' } },
  { id: 'corpo_f', slot: 'body', generator: 'body', sexes: ['f'], channels: { secondary: 'shade', shade: 0.85, detail: '#ffffff' } },

  // Any body can have any hair style (style guide). Ties and bands take the detail color.
  ...catalogOf('cabelo', true).map((i): ItemDef => ({ id: i.id, slot: 'hair', generator: 'hair', channels: { secondary: 'shade', shade: 0.8, detail: '#b3312a' } })),
  // Facial hair takes the hair color (the hair tint).
  ...catalogOf('barba', true).map((i): ItemDef => ({ id: i.id, slot: 'beard', generator: 'beard', channels: shade() })),

  // The catalog by category (one file each: client/character/items/).
  ...TOP_ITEMS,
  ...JACKET_ITEMS,
  ...BOTTOM_ITEMS,
  ...SHOE_ITEMS,
  ...HEAD_ITEMS,
  ...ACCESSORY_ITEMS,
  ...TACTICAL_ITEMS,

  { id: 'rifle', slot: 'weapon_R', generator: 'rifle', socket: 'hand_R', grip: { position: [0.01, -0.01, 0.02], rotation: RIFLE_GRIP.toArray() as [number, number, number, number] }, channels: { secondary: '#6b5a45', detail: '#101012' } },
  { id: 'rifle_costas', slot: 'weapon_back', generator: 'rifle', socket: 'back', grip: { rotation: RIFLE_BACK.toArray() as [number, number, number, number] }, channels: { secondary: '#6b5a45', detail: '#101012' } },
];

const byId = new Map<string, ItemDef>();

export const AssetRegistry = {
  register(item: ItemDef) {
    if (byId.has(item.id)) throw new Error(`item já registrado: ${item.id}`);
    byId.set(item.id, item);
  },
  get(id: string): ItemDef | undefined {
    return byId.get(id);
  },
  list(slot?: CharSlot, sex?: Sex): ItemDef[] {
    return [...byId.values()].filter((i) => (!slot || i.slot === slot) && (!sex || !i.sexes || i.sexes.includes(sex)));
  },
  /** Bit mask of the body regions an item hides. */
  hiddenBits(item: ItemDef): number {
    return regionBits(item.hides ?? []);
  },
};

for (const item of ITEMS) AssetRegistry.register(item);
