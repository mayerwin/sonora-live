// Real browsers, real WebRTC: two or three Chromium instances meet in a room through the local relay of the
// development server (the public MQTT brokers are replaced by server/relay.ts), with fake camera and microphone.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { media, closeAll } from './media.ts';
import { openTool } from './sim.ts';

test.afterEach(closeAll);

/** who someone is in a test: musicians all join alike; an observer comes with the observer's link */
type Role = 'student' | 'teacher' | 'observer';

/** the local relay of the dev/preview server, and the session on window (also in a production build) */
const Q = '?relay=local&debug';

/** The address a person opens: an observer gets the observer's link (`watch`). */
const urlFor = (role: Role, hash = '') => `/${Q}${role === 'observer' ? '&watch' : ''}${hash ? `#${hash}` : ''}`;

async function person(browser: Browser, name: string, role: Role, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: media() });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(urlFor(role, hash));
  await page.getByPlaceholder('e.g. Clara').fill(name);
  return page;
}

async function enter(page: Page): Promise<void> {
  await page.locator('.join-card .btn-primary').click();
  await expect(page.getByTestId('room')).toBeVisible();
}

const codeOf = (page: Page) => page.evaluate(() => location.hash.slice(1));

/** Peer views of the session (exposed on window.sonora in development). */
function peers(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        sonora: {
          peers: { value: { info: { name: string; role: string }; link: string; stats: unknown; remote: unknown }[] };
        };
      }
    ).sonora.peers.value.map((p) => ({
      name: p.info.name,
      role: p.info.role,
      link: p.link,
      stats: p.stats as Record<string, unknown> | null,
      remote: p.remote,
    })),
  );
}

async function connected(page: Page, n: number): Promise<void> {
  await expect
    .poll(async () => (await peers(page)).filter((p) => p.link === 'connected' && p.remote).length, { timeout: 20_000 })
    .toBe(n);
}

test('teacher and student meet, with pure stereo Opus in 10 ms frames', async ({ browser }) => {
  const teacher = await person(browser, 'Clara', 'teacher');
  await enter(teacher);
  await expect(teacher.getByTestId('waiting')).toBeVisible();
  const code = await codeOf(teacher);

  const student = await person(browser, 'Leo', 'student', code);
  await expect(student.locator('.join-card')).toContainText('Joining room');
  await enter(student);

  await connected(teacher, 1);
  await connected(student, 1);
  await expect(teacher.getByTestId('tile')).toContainText('Leo');
  await expect(student.getByTestId('tile')).toContainText('Clara');
  await expect(teacher.locator('.toast.join')).toContainText('Leo joined');

  // the remote video plays
  await expect
    .poll(() =>
      teacher.evaluate(
        () => (document.querySelector('[data-testid=tile] video') as HTMLVideoElement | null)?.videoWidth ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  // pure sound: no processing on the microphone
  const settings = await teacher.evaluate(() => {
    const t = (window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack } } } }).sonora.media.audio
      .value;
    const s = t.getSettings();
    const caps = t.getCapabilities?.().echoCancellation as unknown as boolean[] | undefined;
    return {
      ec: s.echoCancellation,
      ns: s.noiseSuppression,
      agc: s.autoGainControl,
      canEc: caps?.includes?.(true) ?? true,
    };
  });
  // pure: no noise suppression, no automatic volume (the app's own, music-friendly level runs instead); on
  // speakers, the browser's echo cancelling (a microphone that cannot: the music-safe one, tested in echo.spec.ts)
  expect(settings).toEqual({ ec: settings.canEc, ns: false, agc: false, canEc: settings.canEc });

  // stereo Opus, ~192 kbps, 100 packets per second (10 ms frames), direct path
  await expect
    .poll(
      async () => {
        const s = (await peers(teacher))[0].stats;
        return s
          ? {
              ch: s.audioChannels,
              pps: Number(s.audioOutPps) >= 90,
              kbps: Number(s.audioOutKbps) > 120,
              direct: !s.relayed,
            }
          : null;
      },
      { timeout: 20_000 },
    )
    .toEqual({ ch: 2, pps: true, kbps: true, direct: true });

  await teacher.context().close();
  await student.context().close();
});

test('chat with emoji reaches the other side', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);

  await a.getByRole('textbox', { name: 'Message' }).fill('Lovely legato! 🎹');
  await a.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(b.getByTestId('chat')).toContainText('Lovely legato! 🎹');
  await expect(b.getByTestId('chat')).toContainText('Clara');

  // emoji-only messages are shown large
  await b.getByRole('textbox', { name: 'Message' }).fill('👏👏');
  await b.getByTestId('chat-send').click();
  await expect(a.locator('.bubble.emoji')).toHaveText('👏👏');

  // the emoji picker opens and inserts several in a row, after what was typed (each one used to replace the last)
  const box = a.getByRole('textbox', { name: 'Message' });
  await box.fill('Bravo ');
  await a.getByRole('button', { name: 'Emoji' }).click();
  await expect(a.locator('emoji-picker')).toBeVisible();
  const pick = a.locator('emoji-picker').locator('[role=tabpanel] button.emoji');
  await expect(pick.first()).toBeVisible();
  for (const i of [0, 1, 2]) await pick.nth(i).click();
  const added = async () => {
    const value = await box.inputValue();
    return value.startsWith('Bravo ') ? [...new Intl.Segmenter().segment(value.slice('Bravo '.length))].length : -1;
  };
  await expect.poll(added).toBe(3);

  await a.context().close();
  await b.context().close();
});

test('MIDI played on the on-screen keys lights up and sounds on the other side', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);

  await openTool(a, 'keys');
  await openTool(b, 'keys');
  const key = a.locator('[data-note="60"]');
  const box = (await key.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await a.mouse.down();
  // the student's keyboard shows the teacher's note, in the teacher's colour
  await expect(b.locator('[data-note="60"]')).toHaveAttribute('data-on', 'true');
  await expect
    .poll(() =>
      b.evaluate(
        () =>
          (
            window as unknown as { sonora: { midi: { holder(n: number): { remote: string | null } } } }
          ).sonora.midi.holder(60).remote,
      ),
    )
    .not.toBeNull();
  // lit in the other musician's colour (jade) on b, in one's own (gold) on a: never left dark
  const lit = (p: typeof a) => p.locator('[data-note="60"]').evaluate((el) => getComputedStyle(el).backgroundImage);
  await expect.poll(() => lit(b)).toContain('rgb(82, 214, 180)');
  await expect.poll(() => lit(a)).toContain('rgb(245, 181, 68)');
  await a.mouse.up();
  await expect(b.locator('[data-note="60"]')).not.toHaveAttribute('data-on', 'true');

  await a.context().close();
  await b.context().close();
});

test('a locked room makes a third person knock; letting them in works', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);
  await expect(a.getByTestId('lock-chip')).toContainText('2/2');

  const c = await person(browser, 'Mum', 'observer', code);
  // the observer's link says so before anything else
  await expect(c.getByTestId('watching')).toBeVisible();
  await enter(c);
  await expect(c.getByTestId('knocking')).toBeVisible({ timeout: 20_000 });
  await expect(a.getByTestId('knock')).toContainText('Mum (Observer) is knocking');

  await a.getByTestId('knock').getByRole('button', { name: 'Let in' }).click();
  await connected(c, 2);
  await connected(a, 2);
  await connected(b, 2);
  await expect(a.getByTestId('lock-chip')).toContainText('3/3');

  for (const p of [a, b, c]) await p.context().close();
});

test('reloading the page goes straight back into the same lesson', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);

  await b.reload();
  // straight back into the lesson (a reload, or a phone closing the tab in the background), as the same person
  await expect(b.getByTestId('room')).toBeVisible();
  await connected(b, 1);
  // for the teacher, nothing happened: no "left" then "joined" again
  await a.waitForTimeout(3500);
  await expect(a.locator('.toast.leave')).toHaveCount(0);
  await connected(a, 1);
  expect((await peers(a)).length).toBe(1);

  await a.context().close();
  await b.context().close();
});

test('two people opening the same link at the same moment find each other', async ({ browser }) => {
  const code = 'K7Q2MX';
  const a = await person(browser, 'Clara', 'teacher', code);
  const b = await person(browser, 'Leo', 'student', code);
  await Promise.all([enter(a), enter(b)]);
  await connected(a, 1);
  await connected(b, 1);
  await a.context().close();
  await b.context().close();
});

test('auto sound switches the microphone to voice while MIDI carries the instrument', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);

  // voice processing on the microphone: its noise suppression on, where the microphone has any (Firefox's fake
  // one has none: then the app's own mode says it)
  const ec = () =>
    a.evaluate(() => {
      const m = (
        window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack }; mode: { value: string } } } }
      ).sonora.media;
      const caps = m.audio.value.getCapabilities?.().noiseSuppression as unknown as boolean[] | undefined;
      return caps?.includes?.(true) === false ? m.mode.value === 'voice' : m.audio.value.getSettings().noiseSuppression;
    });
  expect(await ec()).toBe(false);
  // pretend an instrument is plugged in (no MIDI hardware in CI)
  await a.evaluate(() => {
    (
      window as unknown as {
        sonora: { midi: { devices: { connected: { value: boolean }; currentName: { value: string } } } };
      }
    ).sonora.midi.devices.currentName.value = 'Test Piano';
    (
      window as unknown as { sonora: { midi: { devices: { connected: { value: boolean } } } } }
    ).sonora.midi.devices.connected.value = true;
  });
  await expect.poll(ec, { timeout: 10_000 }).toBe(true);
  await expect(a.getByTestId('btn-sound')).toContainText('voice');
  // and the student sees the teacher's instrument
  await expect(b.getByTestId('tile')).toContainText('Test Piano');

  await a.context().close();
  await b.context().close();
});

test('leaving tells the others', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);
  await b.getByTestId('btn-leave').click();
  await b.getByTestId('confirm-leave').click();
  await expect(b.getByText('You left the lesson')).toBeVisible();
  await expect(a.locator('.toast.leave')).toContainText('Leo left');
  await expect(a.getByTestId('waiting')).toBeVisible();
  await a.context().close();
  await b.context().close();
});

test('a MIDI instrument plays on the other side’s instrument, without echoing back', async ({ browser }) => {
  const { fakeMidiScript } = await import('./fake-midi.ts');
  const mk = async (name: string, role: Role, piano: string, thru: boolean, hash = '') => {
    const ctx = await browser.newContext({ permissions: media() });
    await ctx.addInitScript(fakeMidiScript(piano, thru));
    const page = await ctx.newPage();
    await page.goto(urlFor(role, hash));
    await page.getByPlaceholder('e.g. Clara').fill(name);
    return page;
  };
  const a = await mk('Clara', 'teacher', 'Roland FP-30X', false);
  await enter(a);
  const code = await codeOf(a);
  // the student's piano has MIDI thru on: whatever it receives, it sends back
  const b = await mk('Leo', 'student', 'MIDIIN2 (Yamaha P-125)', true, code);
  await enter(b);
  await connected(a, 1);

  // tap MIDI, pick the instrument: done
  for (const [p, name] of [
    [a, 'Roland FP-30X'],
    [b, 'Yamaha P-125'],
  ] as const) {
    await p.getByTestId('btn-midi').click();
    await p.getByTestId('midi-instrument').filter({ hasText: name }).click();
    await expect(p.getByTestId('midi-instrument').filter({ hasText: name })).toHaveAttribute('aria-checked', 'true');
    await p.keyboard.press('Escape');
  }
  await expect(b.getByTestId('tile')).toContainText('Roland FP-30X');

  // the teacher plays: the student's piano plays it
  await a.evaluate(() => (window as unknown as { __midiPlay(m: number[]): void }).__midiPlay([0x90, 64, 100]));
  await expect
    .poll(() => b.evaluate(() => (window as unknown as { __midiOut: number[][] }).__midiOut))
    .toContainEqual([0x90, 64, 100]);
  await a.evaluate(() => (window as unknown as { __midiPlay(m: number[]): void }).__midiPlay([0x80, 64, 0]));
  await expect
    .poll(() => b.evaluate(() => (window as unknown as { __midiOut: number[][] }).__midiOut))
    .toContainEqual([0x80, 64, 0]);
  // ...and the echo from the student's piano never comes back to the teacher
  await a.waitForTimeout(800);
  expect(await a.evaluate(() => (window as unknown as { __midiOut: number[][] }).__midiOut)).toEqual([]);

  // the student plays: the teacher hears it on their instrument
  await b.evaluate(() => (window as unknown as { __midiPlay(m: number[]): void }).__midiPlay([0x90, 48, 70]));
  await expect
    .poll(() => a.evaluate(() => (window as unknown as { __midiOut: number[][] }).__midiOut))
    .toContainEqual([0x90, 48, 70]);

  // both pianos travel as MIDI now: microphones switch to voice mode (Auto)
  await expect(a.getByTestId('btn-sound')).toContainText('voice');
  await expect(b.getByTestId('btn-sound')).toContainText('voice');

  await a.context().close();
  await b.context().close();
});

test('a duplicated tab (same session storage) gets its own identity and connects', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: media() });
  const a = await ctx.newPage();
  await a.goto(`/${Q}`);
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const code = await codeOf(a);
  const id = await a.evaluate(() => sessionStorage.getItem('sonora.tab'));
  // "Duplicate tab" copies sessionStorage, so the copy starts with the same id
  const b = await ctx.newPage();
  await b.addInitScript((tab) => sessionStorage.setItem('sonora.tab', tab), id!);
  await b.goto(`/${Q}#${code}`);
  await b.getByPlaceholder('e.g. Clara').fill('Leo');
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  expect(await b.evaluate(() => sessionStorage.getItem('sonora.tab'))).not.toBe(id);
  await ctx.close();
});

test('unplugging the instrument mid-note releases it on the other side', async ({ browser }) => {
  const { fakeMidiScript } = await import('./fake-midi.ts');
  const ctx = await browser.newContext({ permissions: media() });
  await ctx.addInitScript(fakeMidiScript('Kawai ES920'));
  const a = await ctx.newPage();
  await a.goto(`/${Q}`);
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);
  await a.getByTestId('btn-midi').click();
  await a.getByTestId('midi-instrument').first().click();
  await a.keyboard.press('Escape');
  await a.evaluate(() => {
    const play = (window as unknown as { __midiPlay(m: number[]): void }).__midiPlay;
    play([0xb0, 64, 127]);
    play([0x90, 62, 90]);
  });
  const held = () =>
    b.evaluate(
      () =>
        (
          window as unknown as { sonora: { midi: { holder(n: number): { remote: string | null } } } }
        ).sonora.midi.holder(62).remote,
    );
  await expect.poll(held).not.toBeNull();
  // the instrument disappears (cable pulled) while the key and pedal are down
  await a.evaluate(() =>
    (
      window as unknown as { sonora: { midi: { devices: { select(k: string | null): void } } } }
    ).sonora.midi.devices.select(null),
  );
  await expect.poll(held).toBeNull();
  await expect
    .poll(() =>
      b.evaluate(
        () =>
          (window as unknown as { sonora: { midi: { sustainHeld(): { remote: boolean } } } }).sonora.midi.sustainHeld()
            .remote,
      ),
    )
    .toBe(false);
  await ctx.close();
  await b.context().close();
});

test('the room keeps its rules when someone with other defaults joins', async ({ browser }) => {
  // the teacher saved "4 people"; the student has the defaults (2)
  const ctx = await browser.newContext({ permissions: media() });
  await ctx.addInitScript(() =>
    localStorage.setItem('sonora.settings.v1', JSON.stringify({ roomLimit: 4, lockRooms: true })),
  );
  const a = await ctx.newPage();
  await a.goto(`/${Q}`);
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const code = await codeOf(a);
  for (let i = 0; i < 3; i++) {
    // ids are random: whichever is larger, the room's rules must win
    const b = await person(browser, `Leo${i}`, 'student', code);
    await enter(b);
    await connected(a, 1);
    await expect(b.getByTestId('lock-chip')).toContainText('2/4');
    await a.waitForTimeout(500);
    await expect(a.getByTestId('lock-chip')).toContainText('2/4');
    // leave the way a person does (a closed laptop would be waited for, in case it comes back)
    await b.getByTestId('btn-leave').click();
    await b.getByTestId('confirm-leave').click();
    await expect.poll(async () => (await peers(a)).length).toBe(0);
    await b.context().close();
  }
  await ctx.close();
});

test('playing in unison: a release on the student’s piano is not mistaken for an echo', async ({ browser }) => {
  const { fakeMidiScript } = await import('./fake-midi.ts');
  const mk = async (name: string, role: Role, piano: string, hash = '') => {
    const ctx = await browser.newContext({ permissions: media() });
    await ctx.addInitScript(fakeMidiScript(piano));
    const page = await ctx.newPage();
    await page.goto(urlFor(role, hash));
    await page.getByPlaceholder('e.g. Clara').fill(name);
    return page;
  };
  const a = await mk('Clara', 'teacher', 'Roland FP-30X');
  await enter(a);
  const b = await mk('Leo', 'student', 'Yamaha P-125', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  for (const p of [a, b]) {
    await p.getByTestId('btn-midi').click();
    await p.getByTestId('midi-instrument').first().click();
    await p.keyboard.press('Escape');
  }
  type W = { __midiPlay(m: number[]): void; __midiOut: number[][] };
  // both hold middle C
  await a.evaluate(() => (window as unknown as W).__midiPlay([0x90, 60, 90]));
  await b.evaluate(() => (window as unknown as W).__midiPlay([0x90, 60, 70]));
  await expect.poll(() => b.evaluate(() => (window as unknown as W).__midiOut)).toContainEqual([0x90, 60, 90]);
  // the teacher releases; the student releases a moment later (inside the echo window)
  await a.evaluate(() => (window as unknown as W).__midiPlay([0x80, 60, 64]));
  await expect.poll(() => b.evaluate(() => (window as unknown as W).__midiOut)).toContainEqual([0x80, 60, 64]);
  await b.evaluate(() => (window as unknown as W).__midiPlay([0x80, 60, 64]));
  // the student's release reaches the teacher's piano: nothing stays held
  await expect.poll(() => a.evaluate(() => (window as unknown as W).__midiOut)).toContainEqual([0x80, 60, 64]);
  await expect
    .poll(() =>
      a.evaluate(
        () =>
          (
            window as unknown as { sonora: { midi: { holder(n: number): { remote: string | null } } } }
          ).sonora.midi.holder(60).remote,
      ),
    )
    .toBeNull();
  await a.context().close();
  await b.context().close();
});

test('speaks French when the browser does, animates normally, and switches language', async ({ browser }) => {
  const ctx = await browser.newContext({
    locale: 'fr-FR',
    permissions: media(),
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(`/${Q}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.join-card')).toContainText('Votre salle est prête');
  await page.getByPlaceholder('ex. Clara').fill('Clara');
  await page.locator('.join-card .btn-primary').click();
  await expect(page.getByTestId('waiting')).toContainText('En attente des autres');
  await expect(page.getByTestId('waiting')).toContainText('Invitez votre élève');

  // alone in the room, a reaction shows, whatever the system's motion setting (it is not followed)
  // (from the chat panel's reactions row)
  await page.locator('.react-row').getByRole('button', { name: 'Réagir 👏' }).click();
  await expect
    .poll(() => page.locator('.reaction').evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.9);
  // and every looping animation runs at its own pace, never at a flickering speed
  const loops = await page.evaluate(() =>
    document
      .getAnimations()
      .map((a) => a.effect?.getComputedTiming())
      .filter((tm) => tm?.iterations === Infinity)
      .map((tm) => Number(tm!.duration)),
  );
  expect(loops.length).toBeGreaterThan(0);
  for (const d of loops) expect(d).toBeGreaterThanOrEqual(500);

  // Settings → General → English
  await page.getByTestId('btn-settings').click();
  await page.getByRole('tab', { name: 'Général' }).click();
  await page.getByTestId('language').selectOption('en');
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
  // and German: loaded when chosen, the whole page at once
  await page.getByTestId('language').selectOption('de');
  await expect(page.getByRole('tab', { name: 'Allgemein' })).toBeVisible();
  await page.getByTestId('language').selectOption('en');
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('btn-leave')).toContainText('Leave');
  await expect(page.getByTestId('waiting')).toContainText('Waiting for others');
  await ctx.close();
});

test('the on-screen keys play the sampled grand piano', async ({ browser }) => {
  const page = await person(browser, 'Clara', 'teacher');
  await enter(page);
  await openTool(page, 'keys');
  await expect(page.getByTestId('keyboard')).toBeVisible();
  type P = {
    sonora: {
      midi: {
        piano: { ready: { value: boolean }; failed: { value: boolean }; voices: { note: number; src: AudioNode }[] };
      };
    };
  };
  // opening the keys loads the piano
  await expect
    .poll(() => page.evaluate(() => (window as unknown as P).sonora.midi.piano.ready.value), { timeout: 20_000 })
    .toBe(true);
  await page.locator('[data-note="64"]').click();
  const voices = await page.evaluate(() =>
    (window as unknown as P).sonora.midi.piano.voices.filter((v) => v.note === 64).map((v) => v.src.constructor.name),
  );
  expect(voices.length).toBeGreaterThan(0);
  expect(voices.every((n) => n === 'AudioBufferSourceNode')).toBe(true);
  await page.context().close();
});

test('when the networks block a direct path, the tile explains it calmly and connects once a path exists', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const blocked = async (name: string, role: Role, hash = '') => {
    const ctx = await browser.newContext({ permissions: media() });
    await ctx.addInitScript(() => ((window as unknown as { sonoraNoDirect: boolean }).sonoraNoDirect = true));
    const page = await ctx.newPage();
    await page.goto(urlFor(role, hash));
    await page.getByPlaceholder('e.g. Clara').fill(name);
    await enter(page);
    return page;
  };
  const a = await blocked('Clara', 'teacher');
  const b = await blocked('Leo', 'student', await codeOf(a));
  for (const p of [a, b]) await expect(p.getByTestId('no-direct-path')).toBeVisible({ timeout: 45_000 });
  await expect(a.getByTestId('no-direct-path')).toContainText('Leo');
  // it stays: no flashing back to a spinner, no "left" or "lost" messages, while it keeps trying
  for (let i = 0; i < 15; i++) {
    await a.waitForTimeout(2000);
    await expect(a.getByTestId('no-direct-path')).toBeVisible();
    await expect(a.locator('.toast')).toHaveCount(0);
  }
  // the network allows it now (both on the same Wi-Fi): the retries connect
  for (const p of [a, b])
    await p.evaluate(() => ((window as unknown as { sonoraNoDirect: boolean }).sonoraNoDirect = false));
  await connected(a, 1);
  await connected(b, 1);
  await expect(a.getByTestId('no-direct-path')).toHaveCount(0);
  await a.context().close();
  await b.context().close();
});

test('back from a long time in the background (a phone switching apps), the lesson reconnects at once', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type S = {
    sonora: {
      parts: { lost(l: unknown): void; link(id: string): unknown };
      resume(ms: number): void;
      peers: { value: { id: string }[] };
    };
  };
  // the teacher's side gave up on the phone long ago; the phone still holds its old, dead connection
  await a.evaluate(() => {
    const s = (window as unknown as S).sonora;
    s.parts.lost(s.parts.link(s.peers.value[0].id));
  });
  const t0 = Date.now();
  await b.evaluate(() => (window as unknown as S).sonora.resume(90_000));
  await connected(a, 1);
  await connected(b, 1);
  expect(Date.now() - t0).toBeLessThan(10_000);
  // the phone's side says nothing: it never left
  await expect(b.locator('.toast.join, .toast.leave')).toHaveCount(0);
  await a.context().close();
  await b.context().close();
});

test('noise reduction is the listener’s: the student cleans what they hear from the teacher, the teacher can change the student’s microphone', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type S = {
    sonora: {
      engine: { remoteRoute(id: string): { engine: boolean; denoise: boolean } };
      peers: { value: { id: string; stats: { audioInKbps: number } | null }[] };
      media: { mode: { value: string } };
    };
  };
  const route = (p: typeof a) =>
    p.evaluate(() => {
      const s = (window as unknown as S).sonora;
      return s.engine.remoteRoute(s.peers.value[0].id).denoise;
    });
  // the student opens the teacher's sound (the label on her picture) and removes the steady noise
  await b.getByTestId('peer-sound').click();
  await expect(b.getByRole('dialog')).toContainText('Sound from Clara');
  await b.getByRole('switch', { name: 'Remove steady background noise' }).click();
  await expect.poll(() => route(b)).toBe(true);
  // for the student only: the teacher's own hearing is untouched
  expect(await route(a)).toBe(false);
  // and the student still hears her
  const audioIn = () => b.evaluate(() => (window as unknown as S).sonora.peers.value[0]?.stats?.audioInKbps ?? 0);
  await expect.poll(audioIn, { timeout: 10_000 }).toBeGreaterThan(20);

  // the teacher sets the student's microphone to voice only: applied on his side, and he is told
  await a.getByTestId('peer-sound').click();
  await a.getByRole('group', { name: 'Their microphone' }).getByRole('button', { name: 'Voice only' }).click();
  await expect.poll(() => b.evaluate(() => (window as unknown as S).sonora.media.mode.value)).toBe('voice');
  await expect(b.locator('.toast', { hasText: 'Clara set your microphone to voice only' })).toBeVisible();
  // her sheet shows his new state
  await expect(
    a.getByRole('group', { name: 'Their microphone' }).getByRole('button', { name: 'Voice only' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // and back
  await a
    .getByRole('group', { name: 'Their microphone' })
    .getByRole('button', { name: 'Instrument and voice' })
    .click();
  await expect.poll(() => b.evaluate(() => (window as unknown as S).sonora.media.mode.value)).toBe('pure');
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test('an observer only changes what they hear', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const o = await person(browser, 'Mum', 'observer', await codeOf(a));
  await enter(o);
  await connected(o, 1);
  await o.getByTestId('peer-sound').first().click();
  await expect(
    o.getByRole('group', { name: 'Their microphone' }).getByRole('button', { name: 'Voice only' }),
  ).toBeDisabled();
  await expect(o.getByRole('switch', { name: 'Remove steady background noise' })).toBeEnabled();
  await a.context().close();
  await o.context().close();
});

test('echo cancelling: on in pure sound on speakers, off by choice, and the sound still reaches the other side', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  type M = {
    sonora: {
      media: { audio: { value: MediaStreamTrack | null }; mode: { value: string }; echo: { value: boolean } };
    };
  };
  const mic = () =>
    a.evaluate(() => {
      const m = (window as unknown as M).sonora.media;
      const t = m.audio.value;
      return { mode: m.mode.value, live: t?.readyState === 'live', echo: m.echo.value };
    });
  // pure sound (no MIDI), and no headphones in sight: the speakers' echo is cancelled
  await expect.poll(mic).toEqual({ mode: 'pure', live: true, echo: true });
  // the musician says they wear headphones: no cancelling
  await a.getByTestId('btn-settings').click();
  await a.getByRole('group', { name: 'Listening on' }).getByRole('button', { name: 'Headphones' }).click();
  await expect.poll(mic).toEqual({ mode: 'pure', live: true, echo: false });
  await expect(a.getByText('Echo cancelling is off: wear headphones')).toBeVisible();
  // and back on
  await a.getByRole('group', { name: 'Listening on' }).getByRole('button', { name: 'Speakers' }).click();
  await expect.poll(mic).toEqual({ mode: 'pure', live: true, echo: true });
  // the other side still hears it
  const audioIn = () =>
    b.evaluate(
      () =>
        (window as unknown as { sonora: { peers: { value: { stats: { audioInKbps: number } | null }[] } } }).sonora
          .peers.value[0]?.stats?.audioInKbps ?? 0,
    );
  await expect.poll(audioIn, { timeout: 10_000 }).toBeGreaterThan(20);
  await a.context().close();
  await b.context().close();
});

test('both sides opening a connection at the same moment still carry picture and sound both ways', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type P = { sonora: { parts: { people: Map<string, unknown>; replace(p: unknown, reconnect: boolean): void } } };
  // each side replaces its connection with a new one of its own, at once: two offers cross
  const collide = () => {
    const parts = (window as unknown as P).sonora.parts;
    for (const p of parts.people.values()) parts.replace(p, true);
  };
  await Promise.all([a.evaluate(collide), b.evaluate(collide)]);
  await connected(a, 1);
  await connected(b, 1);
  for (const p of [a, b]) {
    await expect
      .poll(
        () =>
          p.evaluate(
            () => (document.querySelector('[data-testid=tile] video') as HTMLVideoElement | null)?.videoWidth ?? 0,
          ),
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          p.evaluate(
            () =>
              (window as unknown as { sonora: { peers: { value: { stats: { audioInKbps: number } | null }[] } } })
                .sonora.peers.value[0]?.stats?.audioInKbps ?? 0,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(10);
  }
  await a.context().close();
  await b.context().close();
});

test('on a phone, the sound menu opens once (from More)', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: media(),
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  });
  const a = await ctx.newPage();
  await a.goto(urlFor('teacher'));
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  await a.getByTestId('btn-more').click();
  await a.locator('.menu-item', { hasText: 'Sound:' }).click();
  await expect(a.getByRole('menuitemradio', { name: /Voice only/ })).toHaveCount(1);
  await expect(a.locator('.menu')).toHaveCount(1);
  await ctx.close();
});

test('settings are kept on this device: a rejoin finds the lesson as it was left, a new lesson starts unmuted', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: media() });
  const a = await ctx.newPage();
  await a.goto(urlFor('teacher'));
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const code = await codeOf(a);
  type W = { sonora: { media: { micOn: { value: boolean }; mode: { value: string }; echo: { value: boolean } } } };
  const state = () =>
    a.evaluate(() => {
      const m = (window as unknown as W).sonora.media;
      return { mic: m.micOn.value, mode: m.mode.value, echo: m.echo.value };
    });
  // voice only, echo cancelling off for pure sound, muted, keys open
  await a.getByTestId('btn-settings').click();
  await a.getByRole('group', { name: 'Listening on' }).getByRole('button', { name: 'Headphones' }).click();
  await a.getByRole('group', { name: 'Your microphone' }).getByRole('button', { name: 'Voice only' }).click();
  await a.keyboard.press('Escape');
  await a.getByTestId('btn-mic').click();
  await openTool(a, 'keys');
  await expect.poll(state).toEqual({ mic: false, mode: 'voice', echo: true });

  // leave, then come back to the same lesson (a new page load, as after closing the tab)
  await a.getByTestId('btn-leave').click(); // alone: no confirmation
  await expect(a.getByText('You left the lesson')).toBeVisible();
  await a.goto(urlFor('teacher', code));
  await a.reload();
  await enter(a);
  await expect.poll(state).toEqual({ mic: false, mode: 'voice', echo: true });
  await expect(a.getByTestId('keyboard')).toBeVisible();
  await a.getByTestId('btn-settings').click();
  await expect(
    a.getByRole('group', { name: 'Listening on' }).getByRole('button', { name: 'Headphones' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await a.keyboard.press('Escape');

  // a new lesson: same settings, but unmuted
  await a.getByTestId('btn-leave').click(); // alone: no confirmation
  await expect(a.getByText('You left the lesson')).toBeVisible();
  await a.goto(urlFor('teacher'));
  await a.reload();
  await enter(a);
  expect(await codeOf(a)).not.toBe(code);
  await expect.poll(state).toEqual({ mic: true, mode: 'voice', echo: true });
  await expect(a.getByTestId('keyboard')).toBeVisible();
  await ctx.close();
});

test('the Sound tab: everyone’s settings at a glance; the teacher turns off the student’s MIDI playback from there', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  // the side panel (wide screens open it by default), Sound tab
  if (!(await a.getByTestId('tab-sound').isVisible())) await a.getByTestId('btn-chat').click();
  await a.getByTestId('tab-sound').click();
  const panel = a.getByTestId('sound-panel');
  await expect(panel.getByTestId('sp-me')).toBeVisible();
  const leo = panel.getByTestId('sp-peer');
  await expect(leo).toContainText('Leo');
  // his settings, as he has them
  await expect(
    leo.getByRole('group', { name: 'Others’ notes on' }).getByRole('button', { name: 'Auto' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // a short label explains itself on hover
  await expect(leo.getByText('Automatic level')).toHaveAttribute('title', /crescendo/);
  // turn off his MIDI playback: changed on his side, and he is told
  await leo.getByRole('group', { name: 'Others’ notes on' }).getByRole('button', { name: 'Off' }).click();
  type W = { sonora: { midi: { playOn: { value: string } } } };
  await expect.poll(() => b.evaluate(() => (window as unknown as W).sonora.midi.playOn.value)).toBe('off');
  await expect(b.locator('.toast', { hasText: 'Clara turned off the others’ MIDI notes on your side' })).toBeVisible();
  await expect(
    leo.getByRole('group', { name: 'Others’ notes on' }).getByRole('button', { name: 'Off' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // his MIDI waits for his sound on her side: his send time plus her buffer
  await expect(leo.locator('.sp-info')).toContainText(/their notes wait \d+ ms/, { timeout: 10_000 });
  // and back to the chat
  await a.getByTestId('tab-chat').click();
  await expect(a.getByTestId('chat')).toBeVisible();
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

/** A WAV file of `seconds` of a 440 Hz tone (16-bit mono, 48 kHz). */
function wav(seconds: number): Buffer {
  const sr = 48000;
  const n = sr * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000), 44 + i * 2);
  return b;
}

test('a backing track plays on both sides, in time, with shared speed and key', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  b.on('pageerror', (e) => errors.push(e.message));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);

  // the player opens from its button; nobody else sees it until a track is loaded
  await openTool(a, 'track');
  await expect(a.getByTestId('backing-track')).toBeVisible();
  await expect(b.getByTestId('backing-track')).toHaveCount(0);
  await a
    .getByTestId('backing-track')
    .locator('input[type=file]')
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav(20) });

  // the student gets the file, and the player opens by itself
  const playerB = b.getByTestId('backing-track');
  await expect(playerB).toContainText('tone.wav', { timeout: 20_000 });
  type W = {
    sonora: {
      backing: {
        position: { value: number };
        sounding: { value: boolean };
        delay: { value: number };
        shared: { value: { rate: number; semis: number; ref: string; playing: boolean } | null };
      };
      selfId: string;
    };
  };
  const state = (p: Page) =>
    p.evaluate(() => {
      const bk = (window as unknown as W).sonora.backing;
      return {
        pos: bk.position.value,
        sounding: bk.sounding.value,
        delay: bk.delay.value,
        shared: bk.shared.value,
      };
    });
  // by default the student plays along: the teacher hears it later
  const leoId = await b.evaluate(() => (window as unknown as W).sonora.selfId);
  expect((await state(a)).shared?.ref).toBe(leoId);

  // whoever presses Play plays along: she does, so the track is in time with her, for both
  await a.getByTestId('track-play').click();
  const claraId = await a.evaluate(() => (window as unknown as W).sonora.selfId);
  await expect.poll(async () => (await state(b)).shared?.ref).toBe(claraId);
  await expect(playerB.locator('select')).toHaveValue(claraId);
  await expect.poll(async () => (await state(a)).sounding).toBe(true);
  await expect.poll(async () => (await state(b)).sounding).toBe(true);
  await a.waitForTimeout(3000);
  const [sa, sb] = await Promise.all([state(a), state(b)]);
  expect(sa.pos).toBeGreaterThan(2);
  // the student is behind the teacher by about his delay (timing measured precisely in latency.spec.ts)
  expect(sa.delay).toBe(0);
  expect(Math.abs(sa.pos - sb.pos - sb.delay / 1000)).toBeLessThan(0.25);

  // speed and key are shared
  await a.getByRole('button', { name: 'Slower' }).click();
  await a.getByRole('button', { name: 'A semitone higher' }).click();
  await expect.poll(async () => (await state(b)).shared?.rate).toBe(0.95);
  await expect.poll(async () => (await state(b)).shared?.semis).toBe(1);
  await expect(playerB).toContainText('95%');

  // pause from the student's side reaches the teacher
  await playerB.getByTestId('track-play').click();
  await expect.poll(async () => (await state(a)).shared?.playing).toBe(false);
  await expect.poll(async () => (await state(a)).sounding).toBe(false);
  // he presses Play: now it is in time with him
  await playerB.getByTestId('track-play').click();
  await expect.poll(async () => (await state(a)).shared?.ref).toBe(leoId);
  await expect.poll(async () => (await state(a)).shared?.playing).toBe(true);

  // with a count-in: a bar of clicks, then the track (a bar of 4 at 120 BPM: 2 s)
  await a.getByTestId('backing-track').getByRole('checkbox', { name: 'Count-in' }).check();
  await openTool(a, 'metronome');
  const tempo = a.getByTestId('metronome').getByRole('spinbutton', { name: 'Tempo, beats per minute' });
  await tempo.fill('120');
  await tempo.press('Enter');
  await playerB.getByTestId('track-play').click(); // his Play pauses it
  await expect.poll(async () => (await state(a)).shared?.playing).toBe(false);
  const before = (await state(a)).pos;
  await a.getByTestId('backing-track').getByTestId('track-play').click();
  await a.waitForTimeout(1200);
  // still counting in: the track has not moved
  expect(Math.abs((await state(a)).pos - before)).toBeLessThan(0.05);
  await a.waitForTimeout(1800);
  expect((await state(a)).pos).toBeGreaterThan(before + 0.3);

  // removed for everyone
  await a.getByRole('button', { name: 'Remove the track for everyone' }).click();
  await expect(playerB).toHaveCount(0);
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test('headphones or speakers: asked in the lobby, one tap in the bar, remembered for that output', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  type S = {
    sonora: {
      listening: { value: string };
      media: {
        outputLabel: { value: string };
        sentAudio: { value: MediaStreamTrack | null };
        audio: { value: MediaStreamTrack | null };
      };
      engine: { path: { value: string } };
    };
  };
  const now = () =>
    a.evaluate(() => {
      const w = window as unknown as S;
      const m = w.sonora.media;
      return {
        listening: w.sonora.listening.value,
        processed: !!m.sentAudio.value && m.sentAudio.value !== m.audio.value,
      };
    });
  // the lobby asks (the fake output's name says nothing: speakers is the guess)
  const q = a.getByTestId('listen-q');
  await expect(q).toContainText('Wearing headphones?');
  await expect(q).toContainText('taken out of your microphone');
  await q.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await now()).listening).toBe('headphones');
  await expect(q).toContainText('Studio sound');
  // remembered for this output, by its name
  const saved = await a.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sonora.settings.v1')!);
    return { echo: s.echo, outputs: s.outputs };
  });
  const label = await a.evaluate(() => (window as unknown as S).sonora.media.outputLabel.value);
  expect(label).not.toBe('');
  expect(saved).toEqual({ echo: 'auto', outputs: { [label]: 'headphones' } });
  await enter(a);
  // in the lesson: the bar says so; nothing is processed (no echo cancelling, no automatic level)
  await expect(a.getByTestId('btn-sound')).toContainText('Headphones');
  await expect.poll(async () => (await now()).processed).toBe(false);
  // speakers: the echo is taken out, the level comes back
  await a.getByTestId('btn-sound').click();
  await expect(a.getByTestId('sound-menu')).toContainText(`Remembered for ${label}`);
  await a.getByRole('menuitemradio', { name: /Speakers/ }).click();
  await expect(a.getByTestId('btn-sound')).toContainText('Speakers');
  await expect.poll(async () => (await now()).processed).toBe(true);
  // voice only, and back
  await a.getByTestId('btn-sound').click();
  await a.getByRole('menuitemradio', { name: /Voice only/ }).click();
  await expect(a.getByTestId('btn-sound')).toContainText('Voice');
  await a.getByTestId('btn-sound').click();
  await a.getByRole('menuitemradio', { name: /Headphones/ }).click();
  await expect(a.getByTestId('btn-sound')).toContainText('Headphones');
  await expect.poll(async () => (await now()).processed).toBe(false);
  await a.context().close();
});

test('the Music strip: a shared metronome, started by one, heard and changed by both', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type M = {
    sonora: {
      selfId: string;
      metronome: {
        shared: { value: { running: boolean; bpm: number; beats: number; ref: string } };
        lit: { value: { beat: number } | null };
      };
    };
  };
  const metro = (p: Page) => p.evaluate(() => (window as unknown as M).sonora.metronome.shared.value);
  // nothing shows until it is opened or started
  await expect(b.getByTestId('metronome')).toHaveCount(0);
  await openTool(a, 'metronome');
  const panel = a.getByTestId('metronome');
  await panel.getByRole('spinbutton', { name: 'Tempo, beats per minute' }).fill('90');
  await panel.getByRole('spinbutton', { name: 'Tempo, beats per minute' }).press('Enter');
  await panel.getByRole('combobox', { name: 'Beats in a bar' }).selectOption('3');
  await a.getByTestId('metro-play').click();
  // started by her: in time with her, for both; it opens by itself on his side, with its tempo on the chip
  const claraId = await a.evaluate(() => (window as unknown as M).sonora.selfId);
  await expect.poll(async () => (await metro(b)).running).toBe(true);
  expect(await metro(b)).toMatchObject({ bpm: 90, beats: 3, ref: claraId });
  await expect(b.getByTestId('metronome')).toBeVisible();
  await expect(b.getByTestId('chip-metronome')).toContainText('90');
  // the beats light up on his side
  await expect
    .poll(() => b.evaluate(() => (window as unknown as M).sonora.metronome.lit.value?.beat ?? -1))
    .toBeGreaterThan(-1);
  // he speeds it up: for her too, without stopping
  await b.getByTestId('metronome').getByRole('button', { name: 'Faster' }).click();
  await expect.poll(async () => (await metro(a)).bpm).toBe(91);
  expect((await metro(a)).running).toBe(true);
  // she stops it: for him too
  await a.getByTestId('metro-play').click();
  await expect.poll(async () => (await metro(b)).running).toBe(false);
  await a.context().close();
  await b.context().close();
});

/** A saved file, opened in the page: its length, picture size and how loud its sound is. */
async function probe(page: Page, file: string, mime: string) {
  const b64 = (await import('node:fs')).readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ b64, mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const el = document.createElement(mime.startsWith('audio') ? 'audio' : 'video') as HTMLVideoElement;
      el.muted = true;
      el.src = URL.createObjectURL(blob);
      await new Promise((r, j) => {
        el.onloadedmetadata = r;
        el.onerror = () => j(new Error('cannot open'));
      });
      let rms = -1;
      try {
        const ctx = new OfflineAudioContext(1, 48000, 48000);
        const buf = await Promise.race([
          ctx.decodeAudioData(bytes.buffer.slice(0)),
          new Promise<never>((_, j) => setTimeout(() => j(new Error('decode timeout')), 5000)),
        ]);
        const d = buf.getChannelData(0);
        let s = 0;
        for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        rms = Math.sqrt(s / d.length);
      } catch {
        // a video container the decoder does not open: the length and picture are checked
      }
      // a frame from the middle, to look at (test-results/recording-frame.jpg)
      let frame = '';
      if (el.videoWidth && Number.isFinite(el.duration)) {
        el.currentTime = Math.min(2, el.duration / 2);
        await Promise.race([new Promise((r) => (el.onseeked = r)), new Promise((r) => setTimeout(r, 3000))]);
        const c = document.createElement('canvas');
        c.width = el.videoWidth;
        c.height = el.videoHeight;
        c.getContext('2d')!.drawImage(el, 0, 0);
        frame = c.toDataURL('image/jpeg', 0.85);
      }
      return {
        duration: el.duration,
        width: el.videoWidth ?? 0,
        height: el.videoHeight ?? 0,
        rms,
        size: bytes.length,
        frame,
      };
    },
    { b64, mime },
  );
}

test('recording the lesson: everyone is told, the video and each voice are saved, an interrupted one is offered back', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const teacher = await person(browser, 'Clara', 'teacher');
  await enter(teacher);
  const student = await person(browser, 'Leo', 'student', await codeOf(teacher));
  await enter(student);
  await connected(teacher, 1);
  await connected(student, 1);

  await teacher.getByTestId('btn-rec').click();
  await expect(teacher.getByTestId('rec-menu')).toBeVisible();
  await teacher.getByTestId('rec-menu').locator('.row-toggle').click();
  await teacher.getByTestId('rec-start').click();
  await expect(teacher.getByTestId('rec-chip')).toBeVisible();
  // the student is told, in the top bar and the chat
  await expect(student.getByTestId('rec-chip')).toContainText('Clara is recording');
  await teacher.waitForTimeout(4500);

  const downloads: { name: string; path: string }[] = [];
  teacher.on('download', async (d) => downloads.push({ name: d.suggestedFilename(), path: (await d.path()) ?? '' }));
  await teacher.getByTestId('rec-chip').click();
  await expect.poll(() => downloads.filter((d) => d.path).length, { timeout: 20_000 }).toBe(3);
  await expect(student.getByTestId('rec-chip')).toHaveCount(0);
  // both are told in the chat that it stopped
  const said = (p: Page) =>
    p.evaluate(() =>
      (
        window as unknown as { sonora: { chat: { messages: { value: { kind: string; text?: string }[] } } } }
      ).sonora.chat.messages.value
        .filter((m) => m.kind === 'system')
        .map((m) => m.text ?? ''),
    );
  await expect
    .poll(async () => (await said(teacher)).some((x) => x.startsWith('You stopped recording: Lesson')))
    .toBe(true);
  await expect.poll(async () => (await said(student)).includes('Clara stopped recording.')).toBe(true);

  const lesson = downloads.find((d) => !d.name.includes(' - '))!;
  expect(lesson.name).toMatch(/^Lesson \d{4}-\d\d-\d\d \d\d\.\d\d\.(mp4|webm)$/);
  const v = await probe(teacher, lesson.path, lesson.name.endsWith('mp4') ? 'video/mp4' : 'video/webm');
  const fs = await import('node:fs');
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/recording-frame.jpg', Buffer.from(v.frame.split(',')[1], 'base64'));
  console.log('lesson file', { ...v, frame: undefined });
  expect(v.width).toBe(1280);
  // everyone's sound, mixed
  expect(v.rms).toBeGreaterThan(0.001);
  expect(v.height).toBe(720);
  // its length is written in the file (WebM from MediaRecorder has none until fixed)
  expect(v.duration).toBeGreaterThan(3.5);
  expect(v.duration).toBeLessThan(7);

  const voices = downloads.filter((d) => d.name.includes(' - ')).map((d) => d.name);
  expect(voices.some((n) => n.includes(' - Clara.'))).toBe(true);
  expect(voices.some((n) => n.includes(' - Leo.'))).toBe(true);
  for (const d of downloads.filter((x) => x.name.includes(' - '))) {
    const a = await probe(teacher, d.path, d.name.endsWith('m4a') ? 'audio/mp4' : 'audio/webm');
    console.log('voice file', d.name, { ...a, frame: undefined });
    expect(a.duration).toBeGreaterThan(3);
    // the fake microphones beep: each voice carries sound
    expect(a.rms).toBeGreaterThan(0.001);
  }

  // kept on this device, to save again
  await teacher.getByTestId('btn-settings').click();
  await teacher.getByRole('tab', { name: 'Room' }).click();
  await expect(teacher.getByTestId('rec-list').locator('li')).toHaveCount(1);
  await teacher.keyboard.press('Escape');

  // the tab closes in the middle of a recording: the next visit offers what was saved
  await student.getByTestId('btn-rec').click();
  await student.getByTestId('rec-start').click();
  await expect(teacher.getByTestId('rec-chip')).toContainText('Leo is recording');
  await student.waitForTimeout(5000);
  await student.reload();
  await expect(student.getByTestId('rec-recover')).toBeVisible({ timeout: 20_000 });
  const saved = student.waitForEvent('download');
  await student.getByTestId('rec-recover-save').click();
  const d = await saved;
  const r = await probe(student, (await d.path())!, d.suggestedFilename().endsWith('mp4') ? 'video/mp4' : 'video/webm');
  console.log('recovered file', { ...r, frame: undefined });
  expect(r.width).toBe(1280);
  expect(r.duration).toBeGreaterThan(2);
  await expect(student.getByTestId('rec-recover')).toHaveCount(0);
});

test('the host (who opened the room) can hold the shared controls; a reload keeps it, leaving releases it', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type M = { sonora: { metronome: { shared: { value: { running: boolean; bpm: number } } } } };
  const metro = (p: Page) => p.evaluate(() => (window as unknown as M).sonora.metronome.shared.value);

  // only the one who opened the room has the switch
  await b.getByTestId('lock-chip').click();
  await expect(b.getByTestId('host-section')).toContainText('Clara opened this room');
  await b.keyboard.press('Escape');
  await expect(b.locator('.scrim')).toHaveCount(0);
  await a.getByTestId('lock-chip').click();
  await a.getByTestId('host-section').getByRole('switch').click();
  await expect(a.getByTestId('host-section').getByRole('switch')).toBeChecked();
  await a.keyboard.press('Escape');
  await expect(a.locator('.scrim')).toHaveCount(0);
  await expect(b.locator('.toast.info')).toContainText('Clara holds the shared controls');

  // he cannot start the metronome, record or change her sound; she can
  await openTool(b, 'metronome');
  await expect(b.getByTestId('held-note')).toBeVisible();
  await expect(b.getByTestId('metro-play')).toBeDisabled();
  await b.getByTestId('btn-rec').click();
  await expect(b.getByTestId('rec-menu').getByTestId('held-note')).toBeVisible();
  await expect(b.getByTestId('rec-start')).toHaveCount(0);
  await b.keyboard.press('Escape');
  await openTool(a, 'metronome');
  await a.getByTestId('metro-play').click();
  await expect.poll(async () => (await metro(b)).running).toBe(true);

  // her reload: still the host, still holding them
  await a.reload();
  await expect(a.getByTestId('room')).toBeVisible({ timeout: 20_000 });
  await connected(a, 1);
  await expect(b.getByTestId('metro-play')).toBeDisabled();
  await a.getByTestId('lock-chip').click();
  await expect(a.getByTestId('host-section').getByRole('switch')).toBeChecked();
  await a.keyboard.press('Escape');
  await expect(a.locator('.scrim')).toHaveCount(0);

  // she leaves: released, he can use everything
  await a.getByTestId('btn-leave').click();
  await a.getByTestId('confirm-leave').click();
  await expect(b.getByTestId('metro-play')).toBeEnabled({ timeout: 20_000 });
  await b.getByTestId('metro-play').click();
  await expect.poll(async () => (await metro(b)).running).toBe(false);
});

test('a shared score: same page for everyone, ink seen by all, undo, and saved with the annotations', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { PDFDocument, PDFName, StandardFonts } = await import('pdf-lib');
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  for (const title of ['Page one', 'Page two'])
    src.addPage([595, 842]).drawText(title, { x: 60, y: 760, size: 28, font });
  const pdf = Buffer.from(await src.save());

  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type S = { sonora: { score: { ink: { value: { by: string; page: number }[] } }; selfId: string } };
  const ink = (p: Page) => p.evaluate(() => (window as unknown as S).sonora.score.ink.value.map((k) => k.page));

  await a.getByTestId('btn-music').click();
  await a.getByTestId('chip-score').click();
  const chooser = a.waitForEvent('filechooser');
  await a.getByTestId('score-open').click();
  await (await chooser).setFiles({ name: 'Etude.pdf', mimeType: 'application/pdf', buffer: pdf });
  // it opens by itself on his side, on the same page
  await expect(a.getByTestId('score-page')).toHaveText('1 of 2');
  await expect(b.getByTestId('score')).toBeVisible({ timeout: 20_000 });
  await expect(b.getByTestId('score-page')).toHaveText('1 of 2', { timeout: 20_000 });
  await a.getByRole('button', { name: 'Next page' }).click();
  await expect(b.getByTestId('score-page')).toHaveText('2 of 2');

  // he circles something: she sees it
  await b.getByTestId('ink-pen').click();
  const box = (await b.getByTestId('score-ink').boundingBox())!;
  await b.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await b.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    await b.mouse.move(
      box.x + box.width * (0.3 + 0.05 * Math.cos(ang)),
      box.y + box.height * (0.3 + 0.05 * Math.sin(ang)),
    );
  }
  await b.mouse.up();
  await expect.poll(() => ink(a)).toEqual([1]);
  // she writes a word
  await a.getByTestId('ink-text').click();
  const abox = (await a.getByTestId('score-ink').boundingBox())!;
  await a.mouse.click(abox.x + abox.width * 0.5, abox.y + abox.height * 0.6);
  await a.getByTestId('score-text').fill('rit.');
  await a.getByTestId('score-text').press('Enter');
  await expect.poll(() => ink(b)).toEqual([1, 1]);
  // his undo takes back his stroke only
  await b.getByTestId('ink-undo').click();
  await expect.poll(() => ink(a)).toEqual([1]);

  // saved: the same two pages, with the ink laid on the second
  const saved = a.waitForEvent('download');
  await a.getByTestId('score-save').click();
  const d = await saved;
  expect(d.suggestedFilename()).toBe('Etude (annotated).pdf');
  const out = await PDFDocument.load((await import('node:fs')).readFileSync((await d.path())!));
  expect(out.getPageCount()).toBe(2);
  // the ink is a picture laid on the page it was drawn on, and only there
  const images = (i: number) => out.getPage(i).node.Resources()?.lookup(PDFName.of('XObject'))?.toString() ?? '';
  expect(images(1)).toMatch(/Image|\d+ 0 R/);
  expect(images(0)).not.toMatch(/\d+ 0 R/);

  // closed for everyone by the one who opened it
  await a.getByTestId('score-close').click();
  await expect(b.getByTestId('score')).toHaveCount(0);
});

test('keyboard shortcuts: one key each, out of the way while typing or while the keys play the piano', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  type M = { sonora: { media: { micOn: { value: boolean } }; metronome: { shared: { value: { running: boolean } } } } };
  const mic = () => a.evaluate(() => (window as unknown as M).sonora.media.micOn.value);
  const metro = () => a.evaluate(() => (window as unknown as M).sonora.metronome.shared.value.running);
  await a.locator('body').click({ position: { x: 5, y: 300 } });
  await a.keyboard.press('m');
  expect(await mic()).toBe(false);
  await a.keyboard.press('m');
  expect(await mic()).toBe(true);
  await a.keyboard.press('t');
  await expect.poll(metro).toBe(true);
  await a.keyboard.press('t');
  await expect.poll(metro).toBe(false);
  // typing a message is typing
  if (!(await a.getByPlaceholder('Message').isVisible())) await a.getByTestId('btn-chat').click();
  await a.getByPlaceholder('Message').fill('');
  await a.getByPlaceholder('Message').press('m');
  expect(await mic()).toBe(true);
  await a.getByPlaceholder('Message').blur();
  // the list
  await a.keyboard.press('?');
  await expect(a.getByTestId('shortcuts')).toContainText('Start or stop the metronome');
  await a.keyboard.press('Escape');
  await expect(a.getByTestId('shortcuts')).toHaveCount(0);
  // the computer keyboard plays the piano: M is a note's neighbour, not the microphone
  await a.getByTestId('btn-music').click();
  await a.getByTestId('chip-keys').click();
  const qwerty = a.getByRole('button', { name: /computer keys/i });
  if ((await qwerty.getAttribute('class'))?.includes('btn-ghost')) await qwerty.click();
  await a.locator('body').click({ position: { x: 5, y: 300 } });
  await a.keyboard.press('m');
  expect(await mic()).toBe(true);
});

test('a shared screen carries its sound: heard on the other side, on a channel of its own', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  // a tab with a video playing: a picture and a 660 Hz tone, as getDisplayMedia would give them
  await a.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d')!;
      setInterval(() => {
        g.fillStyle = `hsl(${(Date.now() / 10) % 360} 60% 50%)`;
        g.fillRect(0, 0, 640, 360);
      }, 50);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 660;
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      return new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    };
  });
  await a.reload();
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  await a.getByRole('button', { name: 'Share', exact: true }).click();
  // his side: her screen's sound arrives as its own stream, and it is the tone
  type W = { sonora: { peers: { value: { screenAudio: MediaStream | null }[] } } };
  await expect
    .poll(() => b.evaluate(() => !!(window as unknown as W).sonora.peers.value[0]?.screenAudio), { timeout: 15_000 })
    .toBe(true);
  const hz = await b.evaluate(async () => {
    const s = (window as unknown as W).sonora.peers.value[0].screenAudio!;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 8192;
    ctx.createMediaStreamSource(s).connect(an);
    // Chrome delivers a remote stream to an audio context only while an element plays it (the app's does)
    await new Promise((r) => setTimeout(r, 1500));
    const bins = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(bins);
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
    return { hz: (best * ctx.sampleRate) / an.fftSize, db: bins[best] };
  });
  console.log('screen sound on the other side', hz);
  expect(Math.abs(hz.hz - 660)).toBeLessThan(15);
  expect(hz.db).toBeGreaterThan(-60);
  // stopping the share ends its sound too
  await a.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(() =>
      a.evaluate(
        () =>
          (window as unknown as { sonora: { media: { screenAudio: { value: unknown } } } }).sonora.media.screenAudio
            .value,
      ),
    )
    .toBeNull();
});

test('a phone as a camera: joins a full room as the teacher’s camera, no sound, shown next to her, taken away by her', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  // the room is full (two people): the phone still comes in, as hers
  await expect(a.getByTestId('lock-chip')).toContainText('2/2');
  await a.getByTestId('btn-settings').click();
  await a.getByRole('tab', { name: 'Video' }).click();
  await a.getByTestId('settings-phonecam').click();
  await expect(a.getByTestId('phonecam-sheet').locator('.qr')).toBeVisible();
  const id = await a.evaluate(() => (window as unknown as { sonora: { selfId: string } }).sonora.selfId);
  const ctx = await browser.newContext({
    permissions: media(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => console.log('[phone] error', e.message));
  await phone.goto(`/?relay=local&debug&cam=${id}&of=Clara#${code}`);
  await expect(phone.getByTestId('camera-mode')).toContainText('Live: a camera of Clara', { timeout: 25_000 });
  // on his side: a tile "Clara · phone" with a picture, and still two people
  const tile = b.locator('[data-testid=tile]', { hasText: 'Clara · phone' });
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => tile.evaluate((el) => el.querySelector('video')?.videoWidth ?? 0)).toBeGreaterThan(0);
  await expect(b.getByTestId('lock-chip')).toContainText('2/2');
  if (process.env.SHOTS) {
    await phone.screenshot({ path: `${process.env.SHOTS}/phonecam-phone.png` });
    await b.screenshot({ path: `${process.env.SHOTS}/phonecam-leo.png` });
    await a.screenshot({ path: `${process.env.SHOTS}/phonecam-sheet.png` });
  }
  // it sends no sound and plays none
  expect(await phone.evaluate(() => document.querySelectorAll('audio').length)).toBe(0);
  // she sees it in her list, and takes it away
  await expect(a.getByTestId('phonecam-list').locator('li')).toHaveCount(1);
  await a.getByTestId('phonecam-list').getByRole('button').click();
  await expect(phone.getByTestId('camera-mode')).toContainText('Clara took this camera away', { timeout: 15_000 });
  await expect(tile).toHaveCount(0, { timeout: 15_000 });
});

test('comforts: the library reopens last week’s track in one tap, the keys can be an organ for both, the lesson timer', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  type S = {
    sonora: {
      selfId: string;
      backing: { track: { value: { name: string } | null } };
      midi: { piano: { soundOf(id: string): string } };
    };
  };
  // a track used once is kept on her device
  await openTool(a, 'track');
  await a
    .getByTestId('backing-track')
    .locator('input[type=file]')
    .setInputFiles({ name: 'Autumn Leaves.wav', mimeType: 'audio/wav', buffer: wav(4) });
  await expect(b.getByTestId('backing-track')).toContainText('Autumn Leaves.wav', { timeout: 20_000 });
  await a.getByRole('button', { name: 'Remove the track for everyone' }).click();
  await expect(b.getByTestId('backing-track')).toHaveCount(0);
  // … and opened again, for both, with one tap
  await openTool(a, 'track');
  const recent = a.getByTestId('recent-track');
  await expect(recent).toContainText('Autumn Leaves');
  await recent.getByRole('button', { name: /Autumn Leaves/ }).click();
  await expect(b.getByTestId('backing-track')).toContainText('Autumn Leaves.wav', { timeout: 20_000 });
  // he received it: kept on his device too
  await b.getByTestId('btn-settings').click();
  await b.getByRole('tab', { name: 'General' }).click();
  await expect(b.getByTestId('library-list')).toContainText('Autumn Leaves.wav');
  await b.keyboard.press('Escape');

  // her keys as an organ: what she plays sounds as an organ on his side too
  // (in the MIDI sheet, with the built-in instrument's other options)
  await a.getByTestId('btn-midi').click();
  await a.getByRole('group', { name: 'Your playing sounds as' }).getByRole('button', { name: 'Organ' }).click();
  await a.keyboard.press('Escape');
  const claraId = await a.evaluate(() => (window as unknown as S).sonora.selfId);
  await expect
    .poll(() => b.evaluate((id) => (window as unknown as S).sonora.midi.piano.soundOf(id), claraId))
    .toBe('organ');
  expect(await a.evaluate(() => (window as unknown as S).sonora.midi.piano.soundOf('local'))).toBe('organ');

  // the lesson timer: off by default, then in the top bar
  await expect(a.getByTestId('lesson-timer')).toHaveCount(0);
  await a.getByTestId('btn-settings').click();
  await a.getByRole('tab', { name: 'Room' }).click();
  await a.getByTestId('timer-on').check();
  await expect(a.getByRole('button', { name: '45 min' })).toBeEnabled();
  await a.getByRole('button', { name: '45 min' }).click();
  await a.keyboard.press('Escape');
  await expect(a.getByTestId('lesson-timer')).toHaveText(/^4[45]:\d\d$/);
});

test('YouTube together: shared by one, playing in time on both sides', async ({ browser }) => {
  // YouTube's player, as its API gives it (no internet in tests): a clock that plays, pauses and seeks
  const fakeYouTube = () => {
    class Player {
      t = 0;
      at = 0;
      state = 2;
      rate = 1;
      constructor(el: HTMLElement, o: { events: { onReady: () => void } }) {
        el.textContent = 'video';
        setTimeout(() => o.events.onReady(), 50);
      }
      now() {
        return this.state === 1 ? this.t + ((performance.now() - this.at) / 1000) * this.rate : this.t;
      }
      playVideo() {
        this.t = this.now();
        this.at = performance.now();
        this.state = 1;
      }
      pauseVideo() {
        this.t = this.now();
        this.state = 2;
      }
      seekTo(s: number) {
        this.t = s;
        this.at = performance.now();
      }
      getCurrentTime() {
        return this.now();
      }
      getDuration() {
        return 300;
      }
      getPlayerState() {
        return this.state;
      }
      setPlaybackRate(r: number) {
        this.t = this.now();
        this.at = performance.now();
        this.rate = r;
      }
      mute() {}
      unMute() {}
      setVolume() {}
      destroy() {}
    }
    (window as unknown as { YT: unknown }).YT = { Player };
  };
  const a = await person(browser, 'Clara', 'teacher');
  await a.addInitScript(fakeYouTube);
  await a.reload();
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await b.addInitScript(fakeYouTube);
  await b.reload();
  await b.getByPlaceholder('e.g. Clara').fill('Leo');
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  await openTool(a, 'track');
  await a.getByTestId('yt-toggle').click();
  await a.getByTestId('yt-link').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10');
  await a.getByTestId('yt-open').click();
  await expect(b.getByTestId('youtube')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('yt-controls')).toBeVisible();
  await a.getByTestId('yt-play').click();
  type V = { sonora: { video: { currentTime(): number | null; delay: { value: number } } } };
  const pos = (p: Page) => p.evaluate(() => (window as unknown as V).sonora.video.currentTime() ?? -1);
  await expect.poll(() => pos(b), { timeout: 10_000 }).toBeGreaterThan(1);
  // both at the same place (within a seek's threshold and the way between them)
  await a.waitForTimeout(1500);
  const [pa, pb] = await Promise.all([pos(a), pos(b)]);
  // he plays it as late as her sound reaches him: in time with her, as he hears her
  const delay = await b.evaluate(() => (window as unknown as V).sonora.video.delay.value / 1000);
  console.log('youtube positions', pa, pb, 'his delay', delay);
  expect(Math.abs(pa - pb - delay)).toBeLessThan(0.12);
  // he seeks: for her too
  await b
    .getByTestId('yt-controls')
    .locator('input[type=range]')
    .evaluate((el: HTMLInputElement) => {
      el.value = '120';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await expect.poll(() => pos(a), { timeout: 10_000 }).toBeGreaterThan(119);
});

test('background blur: the picture sent is the blurred one, and it still reaches the other side', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const b = await person(browser, 'Leo', 'student', await codeOf(a));
  await enter(b);
  await connected(a, 1);
  await connected(b, 1);
  /** her picture as his side decodes it (frames a second, from the connection's statistics) */
  const fps = async () => ((await peers(b))[0].stats?.videoIn as { fps: number } | undefined)?.fps ?? 0;
  await expect.poll(fps, { timeout: 15_000 }).toBeGreaterThan(2);
  await a.getByTestId('btn-settings').click();
  await a.getByRole('tab', { name: 'Video' }).click();
  await a.getByText('Blur my background').click();
  await a.keyboard.press('Escape');
  type M = {
    sonora: {
      media: {
        video: { value: MediaStreamTrack | null };
        sentVideo: { value: MediaStreamTrack | null };
        blurFailed: { value: boolean };
        blurTooSlow: { value: boolean };
      };
    };
  };
  const state = () =>
    a.evaluate(() => {
      const m = (window as unknown as M).sonora.media;
      return {
        failed: m.blurFailed.value,
        slow: m.blurTooSlow.value,
        processed: !!m.sentVideo.value && m.sentVideo.value !== m.video.value,
      };
    });
  // the segmentation loads (served with the app), then the sent picture is the processed one
  await expect.poll(state, { timeout: 40_000 }).toMatchObject({ failed: false, processed: true });
  // a while blurring: on a machine too slow for it (a CI runner), it turns itself off rather than freeze the lesson
  await a.waitForTimeout(8000);
  const s = await state();
  console.log('blur after 8 s', s);
  expect(s.processed || s.slow).toBe(true);
  // either way the page answers at once, and his side keeps receiving her picture
  const t0 = Date.now();
  await a.evaluate(() => 1);
  const lag = Date.now() - t0;
  console.log('a round trip to her page while blurring (ms)', lag);
  expect(lag).toBeLessThan(2000);
  await expect.poll(fps, { timeout: 15_000 }).toBeGreaterThan(2);
  // off again: the camera itself
  if (s.processed) {
    await a.getByTestId('btn-settings').click();
    await a.getByRole('tab', { name: 'Video' }).click();
    await a.getByText('Blur my background').click();
  } else {
    // turned off by itself: Settings says why
    await a.getByTestId('btn-settings').click();
    await a.getByRole('tab', { name: 'Video' }).click();
    await expect(a.getByText('this device could not keep up')).toBeVisible();
  }
  await expect
    .poll(() =>
      a.evaluate(() => {
        const m = (window as unknown as M).sonora.media;
        return m.sentVideo.value === m.video.value;
      }),
    )
    .toBe(true);
});

test('the microphone and camera allowed after a refusal start at once, in the lesson, without reloading', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: media() });
  // the browser refuses (the person said no, or it was blocked) until the test allows it, as from the address bar
  await ctx.addInitScript(() => {
    type W = { __allow: () => void };
    let allowed = false;
    const statuses: (EventTarget & { state: string })[] = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) =>
      allowed ? real(c) : Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    (navigator.permissions as { query: (d: { name: string }) => Promise<unknown> }).query = async () => {
      const st = Object.assign(new EventTarget(), { state: allowed ? 'granted' : 'denied', onchange: null });
      statuses.push(st);
      return st;
    };
    (window as unknown as W).__allow = () => {
      allowed = true;
      for (const st of statuses) {
        st.state = 'granted';
        st.dispatchEvent(new Event('change'));
      }
    };
  });
  const a = await ctx.newPage();
  await a.goto(urlFor('teacher'));
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await enter(a);
  type M = {
    sonora: { media: { audio: { value: MediaStreamTrack | null }; video: { value: MediaStreamTrack | null } } };
  };
  const has = () =>
    a.evaluate(() => {
      const m = (window as unknown as M).sonora.media;
      return { mic: !!m.audio.value, cam: !!m.video.value };
    });
  expect(await has()).toEqual({ mic: false, cam: false });
  await a.evaluate(() => (window as unknown as { __allow: () => void }).__allow());
  await expect.poll(has, { timeout: 10_000 }).toEqual({ mic: true, cam: true });
});
