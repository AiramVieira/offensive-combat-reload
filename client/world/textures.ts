// Procedural hand-painted placeholder textures for the surface library (section 2: "texturas pintadas à mão").
// Painted mostly in light values so the per-vertex tint supplies the hue: one brick texture serves red,
// yellow or white brick walls. Every painter tiles seamlessly. Real art replaces these through
// public/textures/manifest.json without touching code (see docs/MAPAS.md).
import * as THREE from 'three';

export type Painter = (g: CanvasRenderingContext2D, size: number, rand: () => number) => void;

const SIZE = 512;

/** Deterministic PRNG so textures look the same every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gray = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

// One small tileable noise canvas, reused as a pattern: per-pixel ImageData loops over every 512x512
// texture cost ~10 ms each, the pattern costs almost nothing.
let noiseTile: HTMLCanvasElement | null = null;
function noisePattern(g: CanvasRenderingContext2D, rand: () => number): CanvasPattern {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 128;
    const ng = noiseTile.getContext('2d')!;
    const img = ng.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rand() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ng.putImageData(img, 0, 0);
  }
  return g.createPattern(noiseTile, 'repeat')!;
}

/** Fine grain overlay; `amount` is roughly the +-brightness spread (0-60). */
function grain(g: CanvasRenderingContext2D, size: number, rand: () => number, amount: number) {
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = Math.min(1, amount / 60);
  g.fillStyle = noisePattern(g, rand);
  g.fillRect(0, 0, size, size);
  g.restore();
}

/** Draw a rect, repeating it across the tile edges so the texture wraps. */
function wrapRect(g: CanvasRenderingContext2D, size: number, x: number, y: number, w: number, h: number) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) g.fillRect(x + ox, y + oy, w, h);
}

function blotches(g: CanvasRenderingContext2D, size: number, rand: () => number, count: number, rMin: number, rMax: number, light: number, dark: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rMin + rand() * (rMax - rMin);
    g.fillStyle = gray(rand() < 0.5 ? light : dark, alpha);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

export const PAINTERS: Record<string, Painter> = {
  /** Running-bond brick, 8 courses per tile. */
  tijolo(g, s, rand) {
    g.fillStyle = gray(236);
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const cols = 4;
    const bh = s / rows;
    const bw = s / cols;
    const mortar = s / 90;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < cols; c++) {
        g.fillStyle = gray(170 + rand() * 50);
        wrapRect(g, s, c * bw + off + mortar / 2, r * bh + mortar / 2, bw - mortar, bh - mortar);
        g.fillStyle = gray(255, 0.18);
        wrapRect(g, s, c * bw + off + mortar / 2, r * bh + mortar / 2, bw - mortar, bh * 0.18);
      }
    }
    grain(g, s, rand, 26);
  },

  /** Horizontal lap siding (suburban houses). */
  reboco(g, s, rand) {
    g.fillStyle = gray(238);
    g.fillRect(0, 0, s, s);
    const boards = 8;
    const bh = s / boards;
    for (let i = 0; i < boards; i++) {
      const grd = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
      grd.addColorStop(0, gray(250));
      grd.addColorStop(0.85, gray(222 + rand() * 10));
      grd.addColorStop(1, gray(170));
      g.fillStyle = grd;
      g.fillRect(0, i * bh, s, bh);
    }
    grain(g, s, rand, 10);
  },

  /** Vertical planks with gaps and grain (fences, stairs, tree house). */
  madeira(g, s, rand) {
    g.fillStyle = gray(150);
    g.fillRect(0, 0, s, s);
    const planks = 5;
    const pw = s / planks;
    for (let i = 0; i < planks; i++) {
      g.fillStyle = gray(205 + rand() * 35);
      g.fillRect(i * pw + 3, 0, pw - 6, s);
      g.strokeStyle = gray(150, 0.35);
      g.lineWidth = 2;
      for (let k = 0; k < 7; k++) {
        const x = i * pw + 8 + rand() * (pw - 16);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + (rand() - 0.5) * 14, s * 0.33, x + (rand() - 0.5) * 14, s * 0.66, x, s);
        g.stroke();
      }
      // Knot.
      if (rand() < 0.7) {
        g.fillStyle = gray(140, 0.6);
        g.beginPath();
        g.ellipse(i * pw + pw / 2 + (rand() - 0.5) * pw * 0.4, rand() * s, 5, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    grain(g, s, rand, 14);
  },

  /** Floor boards: staggered horizontal planks. */
  piso(g, s, rand) {
    g.fillStyle = gray(150);
    g.fillRect(0, 0, s, s);
    const rows = 6;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const cut = rand() * s;
      for (const [x0, x1] of [[cut - s, cut], [cut, cut + s]]) {
        g.fillStyle = gray(200 + rand() * 40);
        wrapRect(g, s, x0 + 2, r * rh + 2, x1 - x0 - 4, rh - 4);
      }
    }
    grain(g, s, rand, 16);
  },

  /** Rounded roof shingles in offset rows. */
  telhado(g, s, rand) {
    g.fillStyle = gray(120);
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const cols = 8;
    const rh = s / rows;
    const cw = s / cols;
    for (let r = rows - 1; r >= -1; r--) {
      const off = r % 2 ? cw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + off;
        const y = r * rh;
        g.fillStyle = gray(190 + rand() * 45);
        for (const oy of [0, s]) {
          g.beginPath();
          g.moveTo(x + 2, y + oy);
          g.lineTo(x + cw - 2, y + oy);
          g.lineTo(x + cw - 2, y + rh * 0.9 + oy);
          g.quadraticCurveTo(x + cw / 2, y + rh * 1.35 + oy, x + 2, y + rh * 0.9 + oy);
          g.closePath();
          g.fill();
        }
      }
    }
    grain(g, s, rand, 14);
  },

  concreto(g, s, rand) {
    g.fillStyle = gray(222);
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 60, 10, 50, 240, 200, 0.12);
    g.fillStyle = gray(160, 0.6);
    wrapRect(g, s, 0, 0, s, 2);
    wrapRect(g, s, 0, 0, 2, s);
    grain(g, s, rand, 22);
  },

  /** Sidewalk slabs: 2x2 per tile with joints and a crack. */
  calcada(g, s, rand) {
    g.fillStyle = gray(228);
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 40, 8, 40, 245, 205, 0.12);
    g.fillStyle = gray(150);
    for (const p of [0, s / 2]) {
      wrapRect(g, s, p - 2, 0, 4, s);
      wrapRect(g, s, 0, p - 2, s, 4);
    }
    g.strokeStyle = gray(150, 0.6);
    g.lineWidth = 2;
    g.beginPath();
    let x = s * 0.6;
    let y = s * 0.55;
    g.moveTo(x, y);
    for (let i = 0; i < 6; i++) {
      x += 10 + rand() * 20;
      y += (rand() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
    grain(g, s, rand, 20);
  },

  asfalto(g, s, rand) {
    g.fillStyle = gray(205);
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 50, 20, 70, 225, 180, 0.12);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = gray(rand() < 0.5 ? 255 : 120, 0.5);
      g.fillRect(rand() * s, rand() * s, 2, 2);
    }
    grain(g, s, rand, 30);
  },

  /** Grass: mottled patches plus short blade strokes. */
  grama(g, s, rand) {
    g.fillStyle = gray(215);
    g.fillRect(0, 0, s, s);
    blotches(g, s, rand, 70, 20, 60, 240, 185, 0.18);
    for (let i = 0; i < 1800; i++) {
      const x = rand() * s;
      const y = rand() * s;
      g.strokeStyle = gray(rand() < 0.5 ? 255 : 150, 0.35);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 4, y - 5 - rand() * 6);
      g.stroke();
    }
    grain(g, s, rand, 18);
  },

  /** Small square pool tiles with grout. */
  azulejo(g, s, rand) {
    g.fillStyle = gray(255);
    g.fillRect(0, 0, s, s);
    const n = 8;
    const t = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = gray(212 + rand() * 30);
        g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        g.fillStyle = gray(255, 0.35);
        g.fillRect(i * t + 6, j * t + 6, t * 0.35, 4);
      }
    }
  },

  /** Painted metal panels with rivets (cars, truck, hydrants). */
  metal(g, s, rand) {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, gray(250));
    grd.addColorStop(0.5, gray(226));
    grd.addColorStop(1, gray(240));
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.fillStyle = gray(170, 0.7);
    wrapRect(g, s, 0, 0, s, 3);
    wrapRect(g, s, 0, 0, 3, s);
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14], [s / 2, 14], [s / 2, s - 14]]) {
      g.fillStyle = gray(180);
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, s, rand, 8);
  },

  /**
   * Glossy car paint. One tile = 2 m of height (v = 0 at the ground): dark rocker, a soft lower gradient,
   * the dark-then-bright horizon reflection just under the beltline (~0.85 m), bright upper panels; roofs
   * and hoods sample the top band.
   */
  lataria(g, s, rand) {
    const stops: [v: number, value: number][] = [
      [1, 250], [0.8, 250], [0.52, 244], [0.47, 236], [0.452, 255], [0.438, 255], [0.432, 176], [0.4, 196],
      [0.2, 222], [0.16, 205], [0.145, 150], [0, 140],
    ];
    const grd = g.createLinearGradient(0, 0, 0, s);
    for (const [v, value] of stops) grd.addColorStop(1 - v, gray(value));
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    grain(g, s, rand, 3);
  },

  vidro(g, s) {
    g.fillStyle = gray(225);
    g.fillRect(0, 0, s, s);
    g.fillStyle = gray(255, 0.55);
    g.beginPath();
    g.moveTo(s * 0.1, s);
    g.lineTo(s * 0.35, s);
    g.lineTo(s * 0.75, 0);
    g.lineTo(s * 0.5, 0);
    g.fill();
  },
};

const cache = new Map<string, THREE.CanvasTexture>();

export function paintTexture(key: string, painter: Painter): THREE.CanvasTexture {
  let tex = cache.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  painter(g, SIZE, mulberry32(seed));
  tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}
