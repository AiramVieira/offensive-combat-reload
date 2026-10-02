// Items of the head (catalog "cabeca": hats, caps, helmets, ear pieces) and of the face and ears (catalog
// "acessorio": glasses, masks, earrings), built by pieces/rigid.ts and pieces/headwear.ts.
import type { ChannelDefaults, ItemDef, CharSlot } from '../registry';
import type { RegionName } from '../rig';
import { shade } from './common';

const BLACK = '#1f2226';
const GRAPHITE = '#3a3d42';
const OFF_WHITE = '#f4f1ea';

/** Headwear and face items on the head socket (generator `headwear`): slot, default channels, layering. */
const HEADWEAR: [id: string, slot: CharSlot, channels: ChannelDefaults, layering?: { hides?: RegionName[]; over?: RegionName[] }][] = [
  // Caps, knit hats and hats: they cover the top of the hair (rebuilt flat under them).
  ['boneReto', 'cabeca', shade(0.78)],
  ['bonePraTras', 'cabeca', shade(0.78)],
  ['boneTatico', 'cabeca', { secondary: 'shade', shade: 0.78, detail: BLACK }],
  ['gorroLa', 'cabeca', shade(0.78)],
  ['touca', 'cabeca', shade()],
  ['cauboi', 'cabeca', { secondary: '#3b2a1e', detail: OFF_WHITE }],
  ['panama', 'cabeca', { secondary: BLACK, detail: OFF_WHITE }],
  ['fedora', 'cabeca', { secondary: 'shade', shade: 0.55, detail: OFF_WHITE }],
  ['bucket', 'cabeca', shade(0.8)],
  ['boonie', 'cabeca', shade(0.75)],
  ['boina', 'cabeca', shade()],
  ['bandanaCabeca', 'cabeca', { secondary: OFF_WHITE, detail: OFF_WHITE }],
  ['chapeuChef', 'cabeca', shade()],
  ['pescadorOculos', 'cabeca', { secondary: BLACK, detail: '#9aa3aa' }],
  // Helmets.
  ['capaceteMilitar', 'cabeca', { secondary: GRAPHITE, detail: OFF_WHITE }],
  ['capaceteTatico', 'cabeca', { secondary: BLACK, detail: GRAPHITE }],
  ['capaceteVisao', 'cabeca', { secondary: BLACK, detail: GRAPHITE }],
  ['motoAberto', 'cabeca', { secondary: BLACK, detail: '#9aa3aa' }],
  ['capaceteObra', 'cabeca', shade()],
  ['capaceteBike', 'cabeca', { secondary: BLACK, detail: OFF_WHITE }],
  // Full-face helmets hide all the hair and the beard.
  ['motoFechado', 'cabeca', { secondary: OFF_WHITE, detail: BLACK }, { hides: ['hairTop'], over: ['hair', 'beard'] }],
  ['capacetePiloto', 'cabeca', { secondary: GRAPHITE, detail: '#e6c23a' }, { hides: ['hairTop'], over: ['hair', 'beard'] }],
  // The shemagh covers the head and the face below the eyes.
  ['shemagh', 'cabeca', { secondary: BLACK, detail: OFF_WHITE }, { hides: ['hairTop'], over: ['beard'] }],
  // Worn over the hair (they don't flatten nor hide it).
  ['faixaCabeca', 'cabeca', { secondary: OFF_WHITE, detail: OFF_WHITE }, {}],
  ['coroaFlores', 'cabeca', { secondary: '#4a5a32', detail: '#e6c23a' }, {}],
  ['headset', 'orelhas', { secondary: BLACK, detail: OFF_WHITE }, {}],
  ['protetorAuricular', 'orelhas', { secondary: BLACK, detail: OFF_WHITE }, {}],
  // Face.
  ['balistico', 'rosto', { secondary: '#1c2530', detail: OFF_WHITE }, {}],
  ['oculosEsqui', 'rosto', { secondary: '#e0702a', detail: OFF_WHITE }, {}],
  ['tapaOlho', 'rosto', shade(), {}],
  ['piercings', 'rosto', shade(), {}],
  ['argola', 'orelhas', shade(), {}],
  // Masks over the beard; the balaclava over all the hair too.
  ['mascaraCirurgica', 'rosto', shade(), { over: ['beard'] }],
  ['bandanaRosto', 'rosto', { secondary: OFF_WHITE, detail: OFF_WHITE }, { over: ['beard'] }],
  ['mascaraGas', 'rosto', { secondary: '#4f5536', detail: GRAPHITE }, { over: ['beard'] }],
  ['mascaraHoquei', 'rosto', { secondary: '#c0392f', detail: OFF_WHITE }, { over: ['beard'] }],
  ['balaclava', 'rosto', shade(), { hides: ['hairTop'], over: ['hair', 'beard'] }],
];

export const HEAD_ITEMS: ItemDef[] = [
  // A hat hides the top of the hair (region hairTop).
  ...['bone', 'palha', 'gorro'].map((id): ItemDef => ({ id, slot: 'cabeca', generator: 'hat', socket: 'head', hides: ['hairTop'], channels: { secondary: 'shade', shade: id === 'palha' ? 0.45 : 0.78, detail: '#f4f1ea' } })),
  ...['escuros', 'redondos', 'aviador'].map((id): ItemDef => ({ id, slot: 'rosto', generator: 'glasses', socket: 'head', channels: { secondary: '#3a4a5a', detail: '#f4f1ea' } })),
  ...HEADWEAR.map(([id, slot, channels, layering]): ItemDef => ({ id, slot, generator: 'headwear', socket: 'head', channels, ...(layering ?? { hides: ['hairTop'] }) })),
];
