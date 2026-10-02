// Palette atlas (style guide, "Pintura e texturização"): one 256×256 texture of 16×16 px cells, each a
// short vertical gradient (lighter on top, ~10% darker at the bottom). Every face of every piece has its UV
// collapsed to one point inside one cell: faces facing up sample the top of the cell and faces facing down
// the bottom (free fake occlusion), and a few faces are nudged up or down a little so big areas never look
// flat. All characters share one material and one texture.
//
// A face is painted with a `Paint`: a fixed cell (a color of the palette) or a tint (the player's color for
// a channel: primary, secondary, detail, skin, hair, eyes, team) times a value from the neutral row. Tinted
// faces sample the neutral row, so the gradient and the occlusion stay and only the hue changes.
import * as THREE from 'three';
import { FAMILIES } from '@shared/palette';

export const ATLAS_SIZE = 256;
export const CELL = 16;
const COLS = ATLAS_SIZE / CELL;

/** Color sources a face can take its hue from (the material has one uniform color per tint). */
export const TINT = { none: 0, primary: 1, secondary: 2, detail: 3, skin: 4, hair: 5, eyes: 6, team: 7 } as const;
export type Tint = (typeof TINT)[keyof typeof TINT];
export const TINT_COUNT = 8;

/** Rows of the atlas, in the order of the guide's palette table (families shared with the server). */
const ROWS: Record<string, readonly (readonly [string, string])[]> = {
  // Row 0: neutral values for tinted faces (1.0 down to 0.1, perceptual). Filled below.
  neutral: [],
  skin: FAMILIES.skin,
  hair: FAMILIES.hair,
  metal: FAMILIES.metal,
  fabricNeutral: FAMILIES.fabricNeutral,
  fabricEarth: FAMILIES.fabricEarth,
  fabricCold: FAMILIES.fabricCold,
  leather: FAMILIES.leather,
  accent: FAMILIES.accent,
  special: [['eyeWhite', '#e8e2d6'], ['highlight', '#f5f2ea'], ['pupil', '#16181c'], ['teeth', '#e2dccb'], ['lensDark', '#1c2530'], ['lensLight', '#9fb8c8'], ['mouth', '#3a1a1a']],
};

/** Neutral row values (perceptual multipliers): column k = 1 − 0.06·k. */
export const NEUTRAL_VALUES = Array.from({ length: COLS }, (_, k) => Math.max(0.1, 1 - 0.06 * k));

const cellIndex = new Map<string, number>();
const cellColor: THREE.Color[] = [];
{
  let row = 0;
  for (const [name, list] of Object.entries(ROWS)) {
    if (name === 'neutral') {
      NEUTRAL_VALUES.forEach((v, k) => {
        cellColor[row * COLS + k] = new THREE.Color().setRGB(v, v, v, THREE.SRGBColorSpace);
      });
    } else {
      list.forEach(([cell, hex], k) => {
        cellIndex.set(cell, row * COLS + k);
        cellColor[row * COLS + k] = new THREE.Color(hex);
      });
    }
    row++;
  }
}

/** Index of a named palette cell. */
export function cell(name: string): number {
  const i = cellIndex.get(name);
  if (i === undefined) throw new Error(`cor fora da paleta: ${name}`);
  return i;
}

/** Palette hex of a named cell (for UI swatches). */
export function cellHex(name: string): string {
  return `#${cellColor[cell(name)].getHexString()}`;
}

/** Every named cell of a family (a row), e.g. for the editor's swatches. */
export function family(row: keyof typeof ROWS): { name: string; hex: string }[] {
  return ROWS[row].map(([name, hex]) => ({ name, hex }));
}

// --- Paint ------------------------------------------------------------------------------------------------

/** How a face is colored: (tint << 8) | cell. Tint 0 = the cell's own color; otherwise a neutral cell. */
export type Paint = number;

export const paintTint = (p: Paint) => (p >> 8) as Tint;
export const paintCell = (p: Paint) => p & 0xff;

/** A tint at a value step (0 = full value, each step 6% darker). */
export const tinted = (t: Tint, step = 0): Paint => (t << 8) | Math.min(COLS - 1, Math.max(0, step));
/** A fixed palette color. */
export const fixed = (name: string): Paint => cell(name);
/** The same paint, `steps` darker (tints) — fixed colors are returned as they are. */
export const darker = (p: Paint, steps = 1): Paint => (paintTint(p) ? tinted(paintTint(p), paintCell(p) + steps) : p);

export const PRIMARY = tinted(TINT.primary);
export const SECONDARY = tinted(TINT.secondary);
export const DETAIL = tinted(TINT.detail);
export const SKIN = tinted(TINT.skin);
export const HAIR = tinted(TINT.hair);
export const EYES = tinted(TINT.eyes);
export const TEAM = tinted(TINT.team);

// --- UVs ----------------------------------------------------------------------------------------------------

/**
 * UV of a face inside its cell. `g` is the position in the gradient: 0 = bottom (darkest), 1 = top (lightest).
 * A 1.5 px margin keeps nearest filtering inside the cell.
 */
export function cellUv(p: Paint, g: number, out: [number, number] = [0, 0]): [number, number] {
  const c = paintTint(p) ? paintCell(p) : p;
  const col = c % COLS;
  const row = Math.floor(c / COLS);
  const k = THREE.MathUtils.clamp(g, 0, 1);
  out[0] = (col * CELL + CELL / 2) / ATLAS_SIZE;
  out[1] = (row * CELL + 1.5 + k * (CELL - 3)) / ATLAS_SIZE;
  return out;
}

/** Gradient multiplier at position g (1 at the top, 0.9 at the bottom). */
const gradientAt = (g: number) => 0.9 + 0.1 * THREE.MathUtils.clamp(g, 0, 1);

let atlas: THREE.DataTexture | null = null;
/** The shared atlas texture (sRGB, nearest, no mipmaps: neighboring cells never bleed). */
export function paletteAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const c = new THREE.Color();
  for (let i = 0; i < cellColor.length; i++) {
    const base = cellColor[i];
    if (!base) continue;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    for (let y = 0; y < CELL; y++) {
      const k = gradientAt((y - 1.5) / (CELL - 3));
      // Cells are authored in sRGB; the gradient is applied to the sRGB value.
      c.copy(base).convertLinearToSRGB().multiplyScalar(k);
      for (let x = 0; x < CELL; x++) {
        const o = ((row * CELL + y) * ATLAS_SIZE + col * CELL + x) * 4;
        data[o] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
        data[o + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
        data[o + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
        data[o + 3] = 255;
      }
    }
  }
  atlas = new THREE.DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  return atlas;
}

/**
 * The linear color a face gets (what the shader computes), for baking: the cell at gradient position `g`,
 * times the tint color when the paint is tinted.
 */
export function paintColor(p: Paint, g: number, tints: readonly THREE.Color[], out = new THREE.Color()): THREE.Color {
  const t = paintTint(p);
  const base = cellColor[t ? paintCell(p) : p] ?? cellColor[0];
  out.copy(base).convertLinearToSRGB().multiplyScalar(gradientAt(g)).convertSRGBToLinear();
  if (t) out.multiply(tints[t]);
  return out;
}

/** Gradient position a UV points at (inverse of cellUv), for baking from geometry. */
export function uvToGradient(v: number): number {
  const y = (v * ATLAS_SIZE) % CELL;
  return THREE.MathUtils.clamp((y - 1.5) / (CELL - 3), 0, 1);
}

/** Paint a UV points at (tint comes from the `_tint` attribute). */
export function uvToCell(u: number, v: number): number {
  const col = Math.min(COLS - 1, Math.floor(u * COLS));
  const row = Math.min(COLS - 1, Math.floor(v * COLS));
  return row * COLS + col;
}
