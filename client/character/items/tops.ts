// Items of the torso slot: tees and shirts (catalog "camiseta") and sweaters (catalog "blusa"), built by
// pieces/tops.ts (with pieces/sweaters.ts). They hide the skin they cover.
import { catalogOf } from '@shared/catalog';
import type { ChannelDefaults, ItemDef } from '../registry';
import type { RegionName } from '../rig';
import { shade } from './common';

const TOP_HIDES: Record<string, RegionName[]> = { regata: ['belly'], regataCavada: ['belly'], regataCanelada: ['belly'], cropped: ['chest'], topEsportivo: [] };
/** Default second and third colors (when the player picks only the first). */
const TOP_CHANNELS: Record<string, ChannelDefaults> = {
  polo: shade(0.78),
  raglan: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  listrada: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  timeEsportivo: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  camisetaTatica: { secondary: 'shade', shade: 0.78, detail: '#1f2226' },
  xadrezAberta: { secondary: '#e8e2d6', detail: '#1f2226' },
  flanela: { secondary: '#1f2226', detail: '#e8e2d6' },
  camisaJeans: { secondary: '#c9a227', detail: '#f4f1ea' },
  hoquei: { secondary: '#e8e2d6', detail: '#1f2226' },
  coleteLa: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  bata: { secondary: '#c9a227', detail: '#f4f1ea' },
  socialCurta: shade(0.92),
  socialLonga: shade(0.92),
};

const BODY: RegionName[] = ['chest', 'belly'];
/**
 * Sweaters: what they hide (the hood up hides the top of the hair, which is rebuilt flat; the balaclava also
 * covers the neck) and what they hide on the other pieces (`over`: the balaclava over the hair and the beard).
 */
const SWEATER_HIDES: Record<string, RegionName[]> = {
  moletomCapuz: [...BODY, 'hairTop'],
  balaclavaMoletom: [...BODY, 'hairTop', 'neck'],
  moletomCropped: ['chest'],
  // Off the shoulders: the top of the chest shows.
  golaCanoa: ['belly'],
  ciganinha: ['belly'],
};
// The hood up keeps the hair inside it (long hair and ponytails would come out through the cloth), the part
// hanging down the back too.
const SWEATER_OVER: Record<string, RegionName[]> = { balaclavaMoletom: ['hair', 'hairBack', 'beard'], moletomCapuz: ['hair', 'hairBack'] };
const SWEATER_CHANNELS: Record<string, ChannelDefaults> = {
  moletomCanguru: shade(0.72),
  moletomCapuz: shade(0.72),
  moletomZiper: { secondary: 'shade', shade: 0.72, detail: '#9aa3aa' },
  moletomSemCapuz: shade(0.8),
  moletomOversized: shade(0.75),
  moletomCropped: shade(0.75),
  universitario: { secondary: '#e8e2d6', detail: '#e8e2d6' },
  bicolor: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  trico: shade(0.8),
  golaAlta: shade(0.8),
  sueterV: shade(0.7),
  natalino: { secondary: '#e8e2d6', detail: '#c0392f' },
  cardiga: { secondary: 'shade', shade: 0.75, detail: '#e8e2d6' },
  cardigaLongo: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  pescador: shade(0.8),
  fleeceMeioZiper: { secondary: 'shade', shade: 0.7, detail: '#9aa3aa' },
  fleeceTatico: { secondary: 'shade', shade: 0.7, detail: '#3a3d42' },
  termicaMontanha: { secondary: '#3a3d42', detail: '#f4f1ea' },
  anorak: { secondary: 'shade', shade: 0.72, detail: '#1f2226' },
  puloverMilitar: shade(0.75),
  sueterHoquei: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  golaCanoa: shade(0.8),
  ciganinha: shade(0.85),
  poncho: { secondary: '#e8e2d6', detail: '#b8912e' },
  ciclista: { secondary: '#1f2226', detail: '#e6c23a' },
  agasalho: { secondary: '#e8e2d6', detail: '#f4f1ea' },
  goleiro: { secondary: '#1f2226', detail: '#f4f1ea' },
  tunica: { secondary: '#9c6a3a', detail: '#f4f1ea' },
  remendos: { secondary: '#5e4330', detail: '#f4f1ea' },
  balaclavaMoletom: { secondary: '#1f2226', detail: '#f4f1ea' },
};

export const TOP_ITEMS: ItemDef[] = [
  ...catalogOf('camiseta', true).map((i): ItemDef => ({ id: i.id, slot: 'tronco', generator: 'top', hides: TOP_HIDES[i.id] ?? ['chest', 'belly'], channels: TOP_CHANNELS[i.id] ?? shade() })),
  ...catalogOf('blusa', true).map(
    (i): ItemDef => ({ id: i.id, slot: 'tronco', generator: 'top', hides: SWEATER_HIDES[i.id] ?? BODY, over: SWEATER_OVER[i.id], channels: SWEATER_CHANNELS[i.id] ?? shade() }),
  ),
];
