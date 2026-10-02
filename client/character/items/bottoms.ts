// Items of the legs slot: pants (catalog "calca"), shorts and skirts (catalog "short"), built by
// pieces/bottoms.ts. Pants hide the legs' skin down to the shins (the ankles stay: cropped hems and boots);
// shorts and skirts only the pelvis.
import { catalogOf } from '@shared/catalog';
import type { ChannelDefaults, ItemDef } from '../registry';
import type { RegionName } from '../rig';
import { shade } from './common';

const LEGS: RegionName[] = ['pelvis', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'];
/** Tights cover the legs to the ankles. */
const HIDES: Record<string, RegionName[]> = { shortMeiaCalca: [...LEGS, 'ankle_L', 'ankle_R'] };

/**
 * Colors of the channels the catalog doesn't give the player (and the defaults when only the primary is
 * picked): stitching, belts, drawstrings, buttons.
 */
const STITCH: ChannelDefaults = { secondary: '#c9a227', detail: '#b8923e' };
const CHANNELS: Record<string, ChannelDefaults> = {
  calcaJeans: STITCH,
  jeansSkinny: STITCH,
  jeansRasgada: STITCH,
  jeansDobrada: { secondary: '#7f97b5', detail: '#b8923e' },
  jeans90: STITCH,
  bocaSino: STITCH,
  bermudaJeans: STITCH,
  shortJeans: STITCH,
  saiaJeans: STITCH,
  jardineira: STITCH,
  calcaTrabalho: { secondary: 'shade', shade: 0.75, detail: '#b8923e' },
  social: { secondary: '#1f2226', detail: '#9aa3aa' },
  calcaCamuflada: { secondary: '#3b2a1e', detail: '#a89a6e' },
  combate: { secondary: 'shade', shade: 0.8, detail: '#3a3d42' },
  calcaMoto: { secondary: '#3a3d42', detail: '#e8e2d6' },
  calcaEsqui: { secondary: '#1f2226', detail: '#e8e2d6' },
  calcaAgasalho: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  escolar: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  pijama: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  legging: { secondary: '#1f2226', detail: '#f4f1ea' },
  bermudaEsportiva: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  shortFutebol: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  shortCorrida: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  shortCiclista: { secondary: '#1f2226', detail: '#f4f1ea' },
  shortLutador: { secondary: '#1f2226', detail: '#f4f1ea' },
  shortMeiaCalca: { secondary: '#1f2226', detail: '#f4f1ea' },
  bermudaJoelheira: { secondary: '#1f2226', detail: '#f4f1ea' },
  bermudaTatica: { secondary: 'shade', shade: 0.8, detail: '#3a3d42' },
  kilt: { secondary: 'shade', shade: 0.8, detail: '#9aa3aa' },
  saiaCouro: { secondary: 'shade', shade: 0.72, detail: '#9aa3aa' },
  shortCinturaAlta: { secondary: 'shade', shade: 0.72, detail: '#3b2a1e' },
};

export const BOTTOM_ITEMS: ItemDef[] = [
  ...catalogOf('calca', true).map((i): ItemDef => ({ id: i.id, slot: 'baixo', generator: 'bottom', hides: HIDES[i.id] ?? LEGS, channels: CHANNELS[i.id] ?? shade(0.72) })),
  ...catalogOf('short', true).map((i): ItemDef => ({ id: i.id, slot: 'baixo', generator: 'bottom', hides: HIDES[i.id] ?? ['pelvis'], channels: CHANNELS[i.id] ?? shade(0.72) })),
];
