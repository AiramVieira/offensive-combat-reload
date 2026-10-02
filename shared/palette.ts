// Character color palette (style guide, "Paleta"): the families every color of a character comes from.
// Shared by the client (atlas, editor swatches) and the server (a saved look is snapped to these colors).
// Saturation rule: at most ~15% of a character in a saturated color, so accents never go on the primary
// color of the big pieces (top, overlay, bottom).

export type Family = 'skin' | 'hair' | 'metal' | 'fabricNeutral' | 'fabricEarth' | 'fabricCold' | 'leather' | 'accent';

export const FAMILIES: Record<Family, readonly (readonly [string, string])[]> = {
  skin: [
    ['skin1', '#f3d4c0'], ['skin2', '#e8bfa0'], ['skin3', '#d9a57e'], ['skin4', '#c48a5e'],
    ['skin5', '#a96e45'], ['skin6', '#8c5434'], ['skin7', '#6e3f26'], ['skin8', '#4e2c1b'],
  ],
  hair: [
    ['hairBlack', '#151211'], ['hairEspresso', '#2b211d'], ['hairDarkBrown', '#45301f'], ['hairBrown', '#633f25'],
    ['hairLightBrown', '#8a5a33'], ['hairDarkBlond', '#b07f45'], ['hairBlond', '#d4ae6e'], ['hairLightBlond', '#e6cf9a'],
    ['hairAuburn', '#8f3b20'], ['hairGray', '#bdb8ae'],
    ['hairRed', '#b3282d'], ['hairBlue', '#2f5fc9'], ['hairGreen', '#2e8b4a'], ['hairPurple', '#6a3ba6'], ['hairPink', '#d65a9c'], ['hairPlatinum', '#e8e4da'],
  ],
  metal: [['steel', '#9aa3aa'], ['brass', '#b8923e'], ['bronze', '#8c5e34'], ['paintedMetal', '#4f5536'], ['darkSteel', '#4a4f55'], ['gunmetal', '#2e3236']],
  fabricNeutral: [['black', '#1f2226'], ['graphite', '#3a3d42'], ['gray', '#7a7e83'], ['offWhite', '#e8e2d6'], ['beige', '#cdbb9a'], ['khaki', '#a89a6e']],
  fabricEarth: [['olive', '#5c6435'], ['moss', '#4a5a32'], ['brown', '#5e4330'], ['caramel', '#9c6a3a'], ['rust', '#9a4a2a'], ['mustard', '#b8912e']],
  fabricCold: [['navy', '#1f2a44'], ['denim', '#3e5878'], ['petrol', '#1f4f5a'], ['wine', '#5e1f2a'], ['darkPurple', '#3a2a4f']],
  leather: [['leather1', '#3b2a1e'], ['leather2', '#5a3e2a'], ['leather3', '#7a5436'], ['leather4', '#946a43'], ['leather5', '#b08355'], ['rubber', '#1f2226'], ['rubberGray', '#3a3d42']],
  accent: [['orange', '#e0702a'], ['yellow', '#e6c23a'], ['red', '#c0392f'], ['turquoise', '#2fb0a8'], ['lime', '#9ccb3b']],
};

const hexes = (...f: Family[]) => [...new Set(f.flatMap((x) => FAMILIES[x].map(([, h]) => h)))];

export const SKIN_COLORS = hexes('skin');
export const HAIR_COLORS = hexes('hair');
/** Iris colors (a channel of the face, not a palette family of the guide). */
export const EYE_COLORS = ['#3b2418', '#6b4226', '#4a6fa5', '#3d7a4f', '#7a8a96', '#8a3a8a', '#b3312a', '#c9a227'];
/** Fabrics and leather: the primary color of the big pieces. */
export const CLOTH_COLORS = hexes('fabricNeutral', 'fabricEarth', 'fabricCold', 'leather');
/** Everything a channel can take otherwise (secondary, detail, small items): plus metals and accents. */
export const ALL_ITEM_COLORS = hexes('fabricNeutral', 'fabricEarth', 'fabricCold', 'leather', 'metal', 'accent');
export const ACCENT_COLORS = hexes('accent');

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The closest color of a list (weighted RGB distance); anything that isn't a hex color gets `fallback`. */
export function snap(hex: unknown, allowed: readonly string[], fallback: string): string {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const h = hex.toLowerCase();
  if (allowed.includes(h)) return h;
  const [r, g, b] = rgb(h);
  let best = fallback;
  let bestD = Infinity;
  for (const c of allowed) {
    const [r2, g2, b2] = rgb(c);
    const rm = (r + r2) / 2;
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
