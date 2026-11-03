// New releases reach everyone without a forced refresh (after Boom Buds). Two caches stand between a release
// and a browser: GitHub Pages serves every file with a 10-minute HTTP cache, and the service worker keeps a copy
// for offline use. So:
//  - every URL changes with its content (tools/versioning.ts): a page always gets files that match it;
//  - the service worker fetches pages from the network first (its copy is only for offline use), and a new
//    service worker takes over at once;
//  - the build id written into index.html is compared with version.json on the server at start-up, every
//    5 minutes and whenever the app comes back to the foreground or online. A newer build is loaded at once in
//    the lobby; never during a lesson, where it waits for the lobby (after leaving, rejoining or a new room).

import { effect } from '@preact/signals';

const CHECK_MS = 5 * 60_000;
const TRIED_KEY = 'sonora.update.tried';
const RETRY_SAME_BUILD_MS = 10 * 60_000;
/** in the lobby, an update waits until nobody has touched the page for this long */
const IDLE_MS = 20_000;

let ready = false;
/** loads the waiting build (and remembers it was tried) */
let installer: () => Promise<void> = installUpdate;
let checking = false;
let lastTouch = 0;

/** The build this page belongs to (empty in development). */
export function buildId(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="sonora-build"]')?.content ?? '';
}

async function onlineBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.json()) as { build?: unknown };
    return typeof v.build === 'string' ? v.build : null;
  } catch {
    return null;
  }
}

/** Load the newest build now: refresh the service worker and the page's HTTP cache entry first, then reload. */
export async function installUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // no service worker, or offline: the page itself is enough
  }
  try {
    await fetch(location.href.split('#')[0], { cache: 'reload' });
  } catch {
    // offline: the reload will tell
  }
  location.reload();
}

async function check(startup: boolean, inLesson: () => boolean): Promise<void> {
  if (ready || checking) return;
  checking = true;
  const online = await onlineBuild();
  checking = false;
  if (!online || online === buildId()) return;
  // once per new build: a reload that still brings the old page (something between us and the server, a cache
  // that has not expired) is not tried again for that build in this tab: no reload loop
  // (GitHub Pages' cache lasts 10 minutes: after that, the same build is worth another try)
  let tried: { build?: string; at?: number } = {};
  try {
    tried = JSON.parse(sessionStorage.getItem(TRIED_KEY) ?? '{}') ?? {};
  } catch {
    // no storage, or an old value: one try per page load
  }
  if (tried.build === online && Date.now() - (tried.at ?? 0) < RETRY_SAME_BUILD_MS) return;
  const attempt = () => {
    try {
      sessionStorage.setItem(TRIED_KEY, JSON.stringify({ build: online, at: Date.now() }));
    } catch {
      // no storage
    }
    return installUpdate();
  };
  if (startup && !inLesson()) return attempt();
  ready = true;
  installer = attempt;
  tryInstall(inLesson);
}

function tryInstall(inLesson: () => boolean): void {
  if (!ready || inLesson()) return;
  if (Date.now() - lastTouch < IDLE_MS) {
    setTimeout(() => tryInstall(inLesson), IDLE_MS);
    return;
  }
  void installer();
}

/** The service worker: offline copy of the app, the piano and the emoji names. */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
    .then((reg) => {
      setInterval(() => void reg.update().catch(() => {}), CHECK_MS);
    })
    .catch(() => {});
}

/** Watch for new builds (production builds only). `phase`: where the person is; only 'lobby' may reload. */
export function watchForUpdates(phase: () => string): void {
  if (!buildId()) return;
  registerServiceWorker();
  const inLesson = () => phase() !== 'lobby';
  for (const ev of ['pointerdown', 'keydown'])
    window.addEventListener(ev, () => (lastTouch = Date.now()), { capture: true, passive: true });
  void check(true, inLesson);
  setInterval(() => void check(false, inLesson), CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check(false, inLesson);
  });
  window.addEventListener('online', () => void check(false, inLesson));
  // back in the lobby after a lesson: the waiting update goes in
  effect(() => {
    if (phase() === 'lobby') tryInstall(inLesson);
  });
}
