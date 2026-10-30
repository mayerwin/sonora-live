// Installing Sonora Live as an app (it then opens in its own window, works offline for the parts that can) and
// picking up new versions. Updates never interrupt a lesson: they are offered, and applied on the next start.

import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';
import { toast } from './notify.ts';
import { isStandalone, os } from './platform.ts';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;

/** The browser offers installation (Chromium), or the user can add it to the home screen by hand (iOS). */
export const installable = signal(false);
export const iosInstallHelp = signal(false);

export function setupPwa(inLesson: () => boolean): void {
  if (isStandalone()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    installable.value = true;
  });
  window.addEventListener('appinstalled', () => {
    installable.value = false;
    deferred = null;
    toast({ kind: 'success', title: 'Sonora Live installed', body: 'Open it from your home screen or apps.' });
  });
  if (os === 'ios') installable.value = true;
  if (import.meta.env.DEV) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (inLesson()) return; // next start
      toast({
        kind: 'info',
        title: 'A new version is ready',
        timeout: 0,
        action: { label: 'Update', run: () => void updateSW(true) },
      });
    },
  });
}

export async function promptInstall(): Promise<void> {
  if (deferred) {
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    installable.value = false;
    return;
  }
  if (os === 'ios') {
    toast({
      kind: 'info',
      title: 'Add to Home Screen',
      body: 'Tap the Share button in Safari, then “Add to Home Screen”.',
      timeout: 9000,
    });
  }
}
