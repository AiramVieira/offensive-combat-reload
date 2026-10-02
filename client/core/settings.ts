import type { Quality } from '../render/quality';
import { IS_MOBILE } from './device';
import { mergeKeybinds, type Keybinds } from './keybinds';

export interface Settings {
  /** Degrees per mouse count = sensitivity * 0.022 (Source-style). */
  sensitivity: number;
  adsSensitivity: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
  volume: number;
  /** Spatial sound: 3D for headphones (HRTF), plain stereo for speakers, or automatic by device. */
  spatialAudio: 'auto' | 'hrtf' | 'stereo';
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
  /**
   * Go fullscreen when starting to play: landscape on a phone; on a computer, where the browser allows it,
   * the game keeps Esc there (device.ts keepEscape), so the menu opens and closes exactly.
   */
  fullscreen: boolean;
  /** Touch aim button: hold to aim (true) or tap to toggle (false, CoD Mobile's default). */
  adsHold: boolean;
  /** Controller look speed (1 = default, 220°/s at full tilt). */
  padSensitivity: number;
  /** Keys per action, primary and alternate (keybinds.ts). */
  keybinds: Keybinds;
  /**
   * What is printed on each key the player bound, learned from the key press (key code → character): names the
   * keys on layouts other than QWERTY where the browser has no layout map (Firefox).
   */
  keyLabels: Record<string, string>;
}

const KEY = 'oc.settings.v1';
const DEFAULTS: Settings = {
  sensitivity: 2.5,
  adsSensitivity: 0.85,
  fov: 75,
  invertY: false,
  volume: 0.7,
  spatialAudio: 'auto',
  quality: 'auto',
  touchSensitivity: 1,
  touchScale: 1,
  touchOpacity: 0.55,
  touchLayout: {},
  aimAssist: false,
  fullscreen: true,
  adsHold: false,
  padSensitivity: 1,
  keybinds: mergeKeybinds(undefined),
  keyLabels: {},
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Keybinds merge action by action (a plain spread would drop the defaults of actions added later).
      return { ...DEFAULTS, ...saved, keybinds: mergeKeybinds(saved?.keybinds), keyLabels: cleanLabels(saved?.keyLabels) };
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS, keybinds: mergeKeybinds(undefined), keyLabels: {} };
}

/** Learned key names from storage: single printable characters only. */
function cleanLabels(saved: unknown): Record<string, string> {
  if (typeof saved !== 'object' || saved === null) return {};
  return Object.fromEntries(
    Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim().length === 1),
  );
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** 'auto': 3D on computers, plain stereo on phones (lighter, and often played on the speaker). */
export function spatialMode(s: Settings): 'hrtf' | 'stereo' {
  if (s.spatialAudio === 'auto') return IS_MOBILE ? 'stereo' : 'hrtf';
  return s.spatialAudio;
}
