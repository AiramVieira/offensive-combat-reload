// Items of the over-torso slot (catalog "jaqueta"): jackets, coats and vests worn over the top, built by
// pieces/jackets.ts. Long sleeves hide the top's sleeves (`over`: the jacket's cuff ends before the hand, so the
// body's forearm stays); closed fronts hide the skin of the chest and belly (a crop top under a closed jacket),
// open ones hide nothing (the top shows in front).
import { catalogOf } from '@shared/catalog';
import type { ChannelDefaults, ItemDef } from '../registry';
import type { RegionName } from '../rig';
import { shade } from './common';

const SLEEVES: RegionName[] = ['upperArm_L', 'upperArm_R', 'forearm_L', 'forearm_R'];
/** Open in front (the top shows): they hide nothing of the body. */
const OPEN = new Set(['jaquetaJeans', 'coleteJeans', 'blazer', 'paleto', 'shearling', 'guardaPo', 'jaleco', 'coletePesca', 'capaCapuz', 'capaPoncho', 'couroMoto', 'trench', 'sobretudo', 'jaquetaAviador']);

/** Default second and third colors (when the player picks only the first). */
const CHANNELS: Record<string, ChannelDefaults> = {
  jaquetaJeans: { secondary: '#b8912e', detail: '#f4f1ea' },
  coleteJeans: { secondary: 'shade', shade: 0.8, detail: '#9a4a2a' },
  couroMoto: { secondary: 'shade', shade: 0.8, detail: '#9aa3aa' },
  jaquetaAviador: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  bomber: { secondary: 'shade', shade: 0.7, detail: '#e0702a' },
  cortaVento: { secondary: '#e8e2d6', detail: '#1f2226' },
  pufferCurta: shade(0.7),
  pufferLonga: shade(0.7),
  coletePuffer: shade(0.7),
  parka: { secondary: '#cdbb9a', detail: '#1f2226' },
  m65: { secondary: '#3a3d42', detail: '#f4f1ea' },
  softshell: { secondary: 'shade', shade: 0.65, detail: '#3a3d42' },
  jaquetaCamuflada: { secondary: 'shade', shade: 0.75, detail: '#5e4330' },
  blazer: { secondary: '#5e4330', detail: '#f4f1ea' },
  paleto: { secondary: 'shade', shade: 0.85, detail: '#e8e2d6' },
  trench: { secondary: '#5e4330', detail: '#f4f1ea' },
  shearling: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  brim: { secondary: '#5e4330', detail: '#f4f1ea' },
  varsity: { secondary: '#e8e2d6', detail: '#e8e2d6' },
  jaquetaCorrida: { secondary: 'shade', shade: 0.6, detail: '#e6c23a' },
  jaquetaChuva: shade(0.7),
  jaquetaEsqui: { secondary: '#e8e2d6', detail: '#1f2226' },
  macacaoVoo: { secondary: '#9aa3aa', detail: '#e8e2d6' },
  chef: { secondary: 'shade', detail: '#1f2226' },
  jaleco: { secondary: 'shade', detail: '#1f4f5a' },
  coletePesca: { secondary: 'shade', shade: 0.75, detail: '#f4f1ea' },
  capaCapuz: { secondary: 'shade', shade: 0.6, detail: '#f4f1ea' },
};

export const JACKET_ITEMS: ItemDef[] = catalogOf('jaqueta', true).map((i): ItemDef => {
  const sleeves = i.sleeve === 'longa';
  const hides: RegionName[] = [...(OPEN.has(i.id) ? [] : (['chest', 'belly'] as RegionName[])), ...(sleeves ? (['upperArm_L', 'upperArm_R'] as RegionName[]) : [])];
  // The hooded cape takes the head: the hood hides the top of the hair (which is rebuilt flat).
  if (i.id === 'capaCapuz') hides.push('hairTop');
  // The closed poncho covers the upper arms (and the top's sleeves on them, `over`): when they come forward to
  // hold the weapon, the forearms come out of the cloth instead of the whole arm cutting through it.
  if (i.id === 'capaPoncho') hides.push('upperArm_L', 'upperArm_R');
  // Its hood also covers the rest of the hair (a ponytail would poke out of it).
  const over: RegionName[] = [...(sleeves ? SLEEVES : i.id === 'capaCapuz' ? (['hair'] as RegionName[]) : i.id === 'capaPoncho' ? (['upperArm_L', 'upperArm_R'] as RegionName[]) : [])];
  // Closed fronts also hide the torso of what's under them (a thick sweater's ribs, a kangaroo pocket or the
  // overalls' bib would come through): only lower layers, so vests, packs and straps worn over it stay.
  if (!OPEN.has(i.id) && !i.id.startsWith('capa')) over.push('chest', 'belly');
  return { id: i.id, slot: 'sobreposicao', generator: 'jacket', hides, over: over.length ? over : undefined, channels: CHANNELS[i.id] ?? shade() };
});
