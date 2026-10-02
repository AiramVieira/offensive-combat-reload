// Items of the tactical gear (catalog "tatico": vests, belts, holsters, packs, pads), built by
// pieces/tactical.ts. Gear goes over the clothes and hides no skin (nothing under it is ever fully covered),
// except the ghillie's hood, which is a hat (the hair's top) and a hood (the rest of the hair).
import type { ChannelDefaults, ItemDef } from '../registry';
import type { CharSlot } from '../registry';

/** Secondary = the primary darkened; detail dark (buckles, webbing). */
const darkTrim = (s = 0.75, detail = '#1f2226'): ChannelDefaults => ({ secondary: 'shade', shade: s, detail });
/** Secondary a fixed color. */
const fixedS = (secondary: string, detail = '#1f2226'): ChannelDefaults => ({ secondary, detail });

const item = (id: string, slot: CharSlot, channels: ChannelDefaults, o: Partial<ItemDef> = {}): ItemDef => ({ id, slot, generator: 'tactical', channels, ...o });

export const TACTICAL_ITEMS: ItemDef[] = [
  // Vests.
  item('coletePlacas', 'colete', darkTrim(0.78)),
  item('portaCarregadores', 'colete', darkTrim(0.72)),
  item('assaltoPesado', 'colete', darkTrim(0.78)),
  item('chestRig', 'colete', darkTrim(0.6)),
  item('coleteImprensa', 'colete', darkTrim(0.7, '#f4f1ea')),
  item('coletePolicia', 'colete', fixedS('#1f2226', '#e8e2d6')),
  // Waist, thighs.
  item('cinturao', 'cintura', darkTrim(0.7)),
  item('primeirosSocorros', 'cintura', darkTrim(0.7, '#c0392f')),
  item('protetorVirilha', 'cintura', darkTrim(0.72)),
  item('rapel', 'cintura', fixedS('#1f2226', '#9aa3aa')),
  item('coldre', 'coxaD', fixedS('#1f2226')),
  item('bolsaPerna', 'coxaE', darkTrim(0.72)),
  // Clipped to the chest, on the shoulder, across the chest.
  item('portaGranadas', 'acessorioColete', darkTrim(0.72)),
  item('patches', 'acessorioColete', darkTrim(0.7, '#e8e2d6')),
  item('canivete', 'acessorioColete', fixedS('#1f2226')),
  item('radioOmbro', 'ombro', fixedS('#2e3236')),
  item('lanternaOmbro', 'ombro', fixedS('#1f2226')),
  item('bandoleira', 'peito', darkTrim(0.65, '#b8923e')),
  // Back.
  // Packs hide the long hair hanging down the back (it would run through them).
  item('mochilaAssalto', 'costas', darkTrim(0.75), { over: ['hairBack'] }),
  item('mochilaRadio', 'costas', fixedS('#3a3d42'), { over: ['hairBack'] }),
  item('hidratacao', 'costas', fixedS('#1f2226'), { over: ['hairBack'] }),
  item('ghillie', 'costas', darkTrim(0.7), { hides: ['hairTop'], over: ['hair'] }),
  item('capaTatica', 'costas', darkTrim(0.75)),
  // Limbs.
  item('joelheiras', 'joelhos', fixedS('#1f2226')),
  item('cotoveleiras', 'cotovelos', fixedS('#1f2226')),
  item('ombreiras', 'ombros', darkTrim(0.75)),
  item('protetorPescoco', 'pescoco', darkTrim(0.75)),
  item('facaBota', 'pes', fixedS('#1f2226')),
  item('mapaBussola', 'antebraco', fixedS('#cdbb9a')),
];
