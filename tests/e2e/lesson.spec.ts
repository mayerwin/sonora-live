// Real browsers, real WebRTC: two or three Chromium instances meet in a room through the local relay of the
// development server (the public MQTT brokers are replaced by server/relay.ts), with fake camera and microphone.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { openTool } from './sim.ts';

/** who someone is in a test: musicians all join alike; an observer comes with the observer's link */
type Role = 'student' | 'teacher' | 'observer';

/** the local relay of the dev/preview server, and the session on window (also in a production build) */
const Q = '?relay=local&debug';

/** The address a person opens: an observer gets the observer's link (`watch`). */
const urlFor = (role: Role, hash = '') => `/${Q}${role === 'observer' ? '&watch' : ''}${hash ? `#${hash}` : ''}`;

async function person(browser: Browser, name: string, role: Role, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
    const s = (
      window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack } } } }
    ).sonora.media.audio.value.getSettings();
    return { ec: s.echoCancellation, ns: s.noiseSuppression, agc: s.autoGainControl };
  });
  // pure: no noise suppression, no automatic volume (the app's own, music-friendly level runs instead); on
  // speakers, the browser's echo cancelling
  expect(settings).toEqual({ ec: true, ns: false, agc: false });

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

  const ec = () =>
    a.evaluate(
      () =>
        (
          window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack } } } }
        ).sonora.media.audio.value.getSettings().noiseSuppression,
    );
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
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
    permissions: ['camera', 'microphone'],
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
  await page.getByRole('button', { name: 'English', exact: true }).click();
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
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
    permissions: ['camera', 'microphone'],
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
  await expect(q).toContainText('Guessed');
  await q.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await now()).listening).toBe('headphones');
  await expect(q).not.toContainText('Guessed');
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
