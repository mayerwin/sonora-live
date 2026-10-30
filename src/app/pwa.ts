// Installing Sonora Live as an app (it then opens in its own window and works offline for the parts that can).
// New versions: src/app/update.ts.

import { signal } from '@preact/signals';
import { toast } from './notify.ts';
import { isStandalone, os } from './platform.ts';
import { t } from './i18n.ts';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;

/** The browser offers installation (Chromium), or the user can add it to the home screen by hand (iOS). */
export const installable = signal(false);
export const iosInstallHelp = signal(false);

export function setupPwa(): void {
  if (isStandalone()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    installable.value = true;
  });
  window.addEventListener('appinstalled', () => {
    installable.value = false;
    deferred = null;
    toast({ kind: 'success', title: t('Sonora Live installed'), body: t('Open it from your home screen or apps.') });
  });
  if (os === 'ios') installable.value = true;
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
      title: t('Add to Home Screen'),
      body: t('Tap the Share button in Safari, then “Add to Home Screen”.'),
      timeout: 9000,
    });
  }
}
