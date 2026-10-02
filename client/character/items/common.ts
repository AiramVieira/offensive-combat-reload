// Shared helpers for the item lists (one file per catalog category).
import type { ChannelDefaults } from '../registry';

/** Secondary = the primary darkened by `s`; detail off-white. */
export const shade = (s = 0.72): ChannelDefaults => ({ secondary: 'shade', shade: s, detail: '#f4f1ea' });
