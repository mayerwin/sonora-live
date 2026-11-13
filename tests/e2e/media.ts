// The permissions a test's browser context starts with: Chromium takes camera and microphone; Firefox knows no
// such permissions (its fake devices and prefs, playwright.config.ts, stand in for them).

import { test } from '@playwright/test';

export function media(...names: ('camera' | 'microphone')[]): string[] {
  const list = names.length ? names : ['camera', 'microphone'];
  return test.info().project.name === 'firefox' ? [] : list;
}
