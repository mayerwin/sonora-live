// Which system and browser this is, for the help we show (MIDI and Bluetooth support differ a lot).

import { t } from './i18n.ts';

export type OS = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'chromeos' | 'other';
export type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'opera' | 'other';

interface UAData {
  platform?: string;
  brands?: { brand: string }[];
}

export function detectOS(): OS {
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const p = (nav.userAgentData?.platform ?? '').toLowerCase();
  const ua = navigator.userAgent;
  if (p) {
    if (p.includes('windows')) return 'windows';
    if (p.includes('android')) return 'android';
    if (p.includes('chrome os') || p.includes('chromeos')) return 'chromeos';
    if (p.includes('mac')) return 'macos';
    if (p.includes('linux')) return 'linux';
  }
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

export function detectBrowser(): Browser {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Firefox|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome|CriOS/.test(ua)) return 'chrome';
  if (/Safari/.test(ua)) return 'safari';
  return 'other';
}

export const os = typeof navigator === 'undefined' ? 'other' : detectOS();
export const browser = typeof navigator === 'undefined' ? 'other' : detectBrowser();
export const isTouch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const isMobile = os === 'ios' || os === 'android';

const BROWSER_NAMES: Record<Browser, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  samsung: 'Samsung Internet',
  opera: 'Opera',
  other: '',
};

/** This browser's name, for sentences ("this browser" when unknown). */
export function browserName(): string {
  return BROWSER_NAMES[browser] || t('this browser');
}

/** Running as an installed app (home screen / desktop PWA)? */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export const PERFECT_BT_MIDI = 'https://github.com/mayerwin/Perfect-Bluetooth-MIDI-For-Windows';
export const WEB_MIDI_BROWSER_IOS = 'https://apps.apple.com/app/id953846217';
export const BLUEFY_IOS = 'https://apps.apple.com/app/id1492822055';
export const REPO_URL = 'https://github.com/mayerwin/sonora-live';
