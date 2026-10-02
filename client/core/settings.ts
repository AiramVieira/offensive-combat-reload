import type { Quality } from '../render/quality';

export interface Settings {
  /** Degrees per mouse count = sensitivity * 0.022 (Source-style). */
  sensitivity: number;
  adsSensitivity: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
  volume: number;
  quality: Quality;
  // Touch (phones and tablets).
  /** Look speed of the touch drag (1 = default, ~0.18° per pixel). */
  touchSensitivity: number;
  /** Size of the touch buttons (1 = default). */
  touchScale: number;
  /** Opacity of the touch buttons. */
  touchOpacity: number;
  /** Button positions moved by the player: id → center as a fraction of the screen (x, y). */
  touchLayout: Record<string, [number, number]>;
  /** Light aim assist on touch: the aim slows down over an enemy (never pulls). Off by default. */
  aimAssist: boolean;
  /** Go fullscreen (and landscape) when starting to play on a phone. */
  fullscreen: boolean;
  /** Touch aim button: hold to aim (true) or tap to toggle (false, CoD Mobile's default). */
  adsHold: boolean;
  /** Controller look speed (1 = default, 220°/s at full tilt). */
  padSensitivity: number;
}

const KEY = 'oc.settings.v1';
const DEFAULTS: Settings = {
  sensitivity: 2.5,
  adsSensitivity: 0.85,
  fov: 75,
  invertY: false,
  volume: 0.7,
  quality: 'auto',
  touchSensitivity: 1,
  touchScale: 1,
  touchOpacity: 0.55,
  touchLayout: {},
  aimAssist: false,
  fullscreen: true,
  adsHold: false,
  padSensitivity: 1,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
