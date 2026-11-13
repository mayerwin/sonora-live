// The sound lab (?lab) runs its whole sequence and reports, in a browser (no room here: the fake microphone is a
// beep, so the numbers mean nothing; what is checked is that every stage runs and the report is complete).

import { expect, test } from '@playwright/test';
import { media } from './media.ts';

test('the sound lab measures each processing in its own pass and reports', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ permissions: media('microphone') });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // echo only (no pianist here)
  await p.goto('/?lab&auto&near=skip');
  await expect(p.getByTestId('lab-results')).toBeVisible({ timeout: 150_000 });
  const s = await p.evaluate(
    () =>
      (
        window as unknown as {
          __labResult: {
            report: Record<string, Record<string, number> | null>;
            settings: Record<string, { echoCancellation: boolean; noiseSuppression: boolean }>;
          };
        }
      ).__labResult,
  );
  for (const key of ['noise', 'echoRemovedPiano', 'echoRemovedVoice', 'echoLeftPiano'])
    expect(Object.keys(s.report[key] ?? {})).toEqual(['raw', 'browserEcho', 'voice', 'musicSafe']);
  // each pass really had its own processing
  expect(s.settings.raw.echoCancellation).toBe(false);
  // (Firefox's fake microphone cannot cancel echo at all: its capabilities say so)
  expect(s.settings.browserEcho.noiseSuppression).toBe(false);
  if (test.info().project.name !== 'firefox') {
    expect(s.settings.browserEcho.echoCancellation).toBe(true);
    expect(s.settings.voice.noiseSuppression).toBe(true);
  }
  expect(errors).toEqual([]);
  await ctx.close();
});
