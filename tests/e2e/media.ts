// The permissions a test's browser context starts with: Chromium takes camera and microphone; Firefox knows no
// such permissions (its fake devices and prefs, playwright.config.ts, stand in for them).

import { test } from '@playwright/test';

export function media(...names: ('camera' | 'microphone')[]): string[] {
  const list = names.length ? names : ['camera', 'microphone'];
  return test.info().project.name === 'firefox' ? [] : list;
}

/**
 * Closes every page a test opened (the tests make their own contexts, which Playwright leaves open): without it,
 * the people of earlier tests stay in their lessons, cameras and microphones running, and slow down the next ones.
 */
export async function closeAll({ browser }: { browser: import('@playwright/test').Browser }): Promise<void> {
  await Promise.all(browser.contexts().map((c) => c.close().catch(() => {})));
}
