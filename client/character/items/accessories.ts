// Items of the body accessories (catalog "acessorio" except the face and ears: neck, wrists, hands, bags,
// belts, suspenders, tattoos), built by pieces/rigid.ts and pieces/accessories.ts.
import type { ItemDef } from '../registry';
import { shade } from './common';

const acc = (id: string, slot: ItemDef['slot'], channels: ItemDef['channels'], extra: Partial<ItemDef> = {}): ItemDef => ({ id, slot, generator: 'accessory', channels, ...extra });

export const ACCESSORY_ITEMS: ItemDef[] = [
  { id: 'relogio', slot: 'pulsoE', generator: 'bracelet', socket: 'wrist_L', channels: { secondary: '#222226', detail: '#f4f1ea' } },
  ...['couro', 'micangas'].map((id): ItemDef => ({ id, slot: 'pulsoD', generator: 'bracelet', socket: 'wrist_R', channels: { secondary: '#222226', detail: '#f4f1ea' } })),

  // Neck: chains and the tie lie over the top's collar; scarves wrap over everything.
  acc('corrente', 'pescoco', shade(0.7)),
  acc('dogTag', 'pescoco', shade(0.7)),
  acc('cachecol', 'pescoco', { secondary: '#e8e2d6', detail: '#f4f1ea' }),
  acc('lencoPescoco', 'pescoco', { secondary: '#e8e2d6', detail: '#f4f1ea' }),
  acc('gravata', 'pescoco', shade(0.7)),

  // Hands: full gloves hide the hands (their fingers are the glove's); fingerless ones leave the fingers.
  acc('luvasSemDedos', 'maos', shade(0.6)),
  acc('luvasTaticas', 'maos', { secondary: '#1f2226', detail: '#f4f1ea' }, { hides: ['hand_L', 'hand_R'] }),
  acc('luvasTrabalho', 'maos', shade(0.78), { hides: ['hand_L', 'hand_R'] }),

  // Bags and belts.
  // Packs hide the long hair hanging down the back (it would run through them).
  acc('mochilaEscolar', 'costas', { secondary: 'shade', shade: 0.65, detail: '#e8e2d6' }, { over: ['hairBack'] }),
  acc('mochilaTrilha', 'costas', { secondary: 'shade', shade: 0.65, detail: '#1f2226' }, { over: ['hairBack'] }),
  acc('bolsaTransversal', 'ombro', shade(0.7)),
  acc('pochete', 'cintura', { secondary: '#1f2226', detail: '#f4f1ea' }),
  acc('cinto', 'cintura', { secondary: 'shade', shade: 0.7, detail: '#9aa3aa' }),
  acc('suspensorios', 'peito', { secondary: 'shade', shade: 0.7, detail: '#9aa3aa' }),

  // Tattoos: on the skin of the arms, under any sleeve; a PCD limb takes its design with it.
  acc('tatuagens', 'pele', shade()),
];
