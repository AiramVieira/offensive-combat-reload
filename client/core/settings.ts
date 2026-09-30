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
}

const KEY = 'oc.settings.v1';
const DEFAULTS: Settings = { sensitivity: 2.5, adsSensitivity: 0.85, fov: 75, invertY: false, volume: 0.7, quality: 'auto' };

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
