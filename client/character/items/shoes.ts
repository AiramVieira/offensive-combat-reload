// Items of the shoes slot (catalog "calcado"), built by pieces/shoes.ts.
import type { ItemDef } from '../registry';
import type { RegionName } from '../rig';
import { shade } from './common';

const FEET: RegionName[] = ['foot_L', 'foot_R'];
const ANKLES: RegionName[] = ['ankle_L', 'ankle_R'];
const SHINS: RegionName[] = ['shin_L', 'shin_R'];

/** Shoes and boots up to the ankle: the foot is hidden; the pants go over the collar or the short shaft. */
const low = (id: string, channels: ItemDef['channels']): ItemDef => ({ id, slot: 'calcado', generator: 'shoes', hides: FEET, channels });
/**
 * Boots over the pants' hem: the shaft passes the ankle region, so they hide it too (on the body, and on the
 * pants, which end bloused over the shaft).
 */
const tall = (id: string, channels: ItemDef['channels']): ItemDef => ({ id, slot: 'calcado', generator: 'shoes', hides: [...FEET, ...ANKLES], over: ANKLES, channels });
/** Open shoes (sandals, flats, clogs, barefoot): the foot shows. */
const open = (id: string, channels: ItemDef['channels']): ItemDef => ({ id, slot: 'calcado', generator: 'shoes', channels });

export const SHOE_ITEMS: ItemDef[] = [
  low('tenis', { secondary: 'shade', shade: 0.72, detail: '#e8e2d6' }),
  low('tenisCorrida', { secondary: 'shade', shade: 0.6, detail: '#e8e2d6' }),
  low('canoAlto', { secondary: '#c0392f', detail: '#e8e2d6' }),
  low('skate', { secondary: 'shade', shade: 0.7, detail: '#e8e2d6' }),
  low('tenisBasquete', { secondary: '#1f2226', detail: '#e8e2d6' }),
  low('slipOn', { secondary: '#e8e2d6', detail: '#e8e2d6' }),
  tall('bota', { secondary: '#1f2226', detail: '#1f2226' }),
  tall('botaTatica', { secondary: '#a89a6e', detail: '#1f2226' }),
  low('botaDeserto', { secondary: '#5a3e2a', detail: '#5a3e2a' }),
  low('botaTrilha', { secondary: 'shade', shade: 0.7, detail: '#c0392f' }),
  tall('botaTrabalho', { secondary: '#e8e2d6', detail: '#e8e2d6' }),
  tall('botaMoto', { secondary: 'shade', shade: 0.7, detail: '#9aa3aa' }),
  tall('botaCauboi', { secondary: '#cdbb9a', detail: '#cdbb9a' }),
  tall('botaChuva', shade(0.7)),
  tall('botaNeve', { secondary: '#e8e2d6', detail: '#e8e2d6' }),
  low('chelsea', { secondary: '#1f2226', detail: '#1f2226' }),
  // Knee-high: hides the shins too, and the pants' legs below the knee (tucked in).
  { id: 'botaCanoLongo', slot: 'calcado', generator: 'shoes', hides: [...FEET, ...ANKLES, ...SHINS], over: [...ANKLES, ...SHINS], channels: shade(0.7) },
  low('sapatoSocial', { secondary: '#1f2226', detail: '#1f2226' }),
  low('mocassim', shade(0.7)),
  low('sapatoTrabalho', shade(0.7)),
  open('sapatilha', { secondary: 'shade', shade: 0.7, detail: '#1f2226' }),
  open('papete', { secondary: '#3a3d42', detail: '#3a3d42' }),
  open('chinelo', shade(0.8)),
  low('chuteira', { secondary: '#1f2226', detail: '#e8e2d6' }),
  low('lona', { secondary: '#c0392f', detail: '#e8e2d6' }),
  tall('galocha', shade(0.7)),
  tall('botaSalto', shade(0.7)),
  open('tamanco', { secondary: '#946a43', detail: '#946a43' }),
  low('plataforma', { secondary: 'shade', shade: 0.7, detail: '#e8e2d6' }),
  open('descalco', shade()),
];
