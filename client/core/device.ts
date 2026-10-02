// What the game runs on: a computer (keyboard and mouse, pointer lock) or a phone/tablet browser (touch
// controls, fullscreen, landscape). Detected once at startup; `?mobile=1` / `?mobile=0` forces it (tests, or a
// tablet with a keyboard).

const ua = navigator.userAgent;
/** iPadOS reports itself as a Mac; it's the only "Mac" with a touch screen. */
const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

function detectMobile(): boolean {
  const forced = new URLSearchParams(location.search).get('mobile');
  if (forced === '1') return true;
  if (forced === '0') return false;
  // Touch as the main input (a laptop with a touch screen still has a fine pointer as primary), or a phone or
  // tablet user agent.
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const touch = navigator.maxTouchPoints > 0;
  return (coarse && touch) || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || iPadOS;
}

export const IS_MOBILE = detectMobile();
export const IS_IOS = /iPhone|iPad|iPod/.test(ua) || iPadOS;
document.documentElement.classList.toggle('mobile', IS_MOBILE);
// iOS Safari ignores user-scalable=no: block the pinch zoom gestures (the game uses two fingers).
if (IS_MOBILE) for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

type FsDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

/** The browser can put the page in fullscreen (not on iPhone Safari: only "Add to Home Screen" does). */
export const CAN_FULLSCREEN = !!(document.documentElement.requestFullscreen || (document.documentElement as FsElement).webkitRequestFullscreen);

/** Opened from the home screen icon (PWA): already fullscreen, nothing to request. */
export const STANDALONE = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDocument).webkitFullscreenElement);

/**
 * Fullscreen and landscape lock (must run inside a tap). Fails quietly where the browser refuses: the game
 * still plays in the page.
 */
export async function enterFullscreen() {
  const el = document.documentElement as FsElement;
  try {
    if (!isFullscreen()) await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
  } catch {
    /* refused (no gesture, iframe, iOS) */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* only in fullscreen, and not everywhere */
  }
}

export async function exitFullscreen() {
  const d = document as FsDocument;
  try {
    if (isFullscreen()) await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
  } catch {
    /* already out */
  }
}

/** Portrait: the match asks to turn the phone. */
export const isPortrait = () => window.innerHeight > window.innerWidth;
