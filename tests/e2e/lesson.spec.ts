// Real browsers, real WebRTC: two or three Chromium instances meet in a room through the local relay of the
// development server (the public MQTT brokers are replaced by server/relay.ts), with fake camera and microphone.

import { expect, test, type Browser, type Page } from '@playwright/test';

type Role = 'student' | 'teacher' | 'observer';

/** the local relay of the dev/preview server, and the session on window (also in a production build) */
const Q = '?relay=local&debug';

async function person(browser: Browser, name: string, role: Role, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`/${Q}${hash ? `#${hash}` : ''}`);
  await page.getByPlaceholder('e.g. Clara').fill(name);
  await page.locator(`button.role[data-role=${role}]`).click();
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
  expect(settings).toEqual({ ec: false, ns: false, agc: false });

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

  // the emoji picker opens and inserts
  await a.getByRole('button', { name: 'Emoji' }).click();
  await expect(a.locator('emoji-picker')).toBeVisible();

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

  await a.getByTestId('btn-keys').click();
  await b.getByTestId('btn-keys').click();
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

test('reloading the page rejoins the same lesson', async ({ browser }) => {
  const a = await person(browser, 'Clara', 'teacher');
  await enter(a);
  const code = await codeOf(a);
  const b = await person(browser, 'Leo', 'student', code);
  await enter(b);
  await connected(a, 1);

  await b.reload();
  // name and role are remembered; the room code is in the address
  await expect(b.locator('.join-card')).toContainText('Joining room');
  await expect(b.getByPlaceholder('e.g. Clara')).toHaveValue('Leo');
  await enter(b);
  await connected(b, 1);
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
        ).sonora.media.audio.value.getSettings().echoCancellation,
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
  await expect(a.getByTestId('btn-sound')).toContainText('Voice');
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
    await page.goto(`/${Q}${hash ? `#${hash}` : ''}`);
    await page.getByPlaceholder('e.g. Clara').fill(name);
    await page.locator(`button.role[data-role=${role}]`).click();
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
  await expect(a.getByTestId('btn-sound')).toContainText('Voice');
  await expect(b.getByTestId('btn-sound')).toContainText('Voice');

  await a.context().close();
  await b.context().close();
});

test('a duplicated tab (same session storage) gets its own identity and connects', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctx.newPage();
  await a.goto(`/${Q}`);
  await a.getByPlaceholder('e.g. Clara').fill('Clara');
  await a.locator('button.role[data-role=teacher]').click();
  await enter(a);
  const code = await codeOf(a);
  const id = await a.evaluate(() => sessionStorage.getItem('sonora.tab'));
  // "Duplicate tab" copies sessionStorage, so the copy starts with the same id
  const b = await ctx.newPage();
  await b.addInitScript((tab) => sessionStorage.setItem('sonora.tab', tab), id!);
  await b.goto(`/${Q}#${code}`);
  await b.getByPlaceholder('e.g. Clara').fill('Leo');
  await b.locator('button.role[data-role=student]').click();
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
  await a.locator('button.role[data-role=teacher]').click();
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
  await a.locator('button.role[data-role=teacher]').click();
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
    await page.goto(`/${Q}${hash ? `#${hash}` : ''}`);
    await page.getByPlaceholder('e.g. Clara').fill(name);
    await page.locator(`button.role[data-role=${role}]`).click();
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

test('speaks French when the browser does, shows reactions with animations reduced, and switches language', async ({
  browser,
}) => {
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
  await page.locator('button.role[data-role=teacher]').click();
  await page.locator('.join-card .btn-primary').click();
  await expect(page.getByTestId('waiting')).toContainText('En attente des autres');
  await expect(page.getByTestId('waiting')).toContainText('Invitez votre élève');

  // alone in the room, a reaction still shows (it used to jump straight to its faded-out end)
  await page.getByRole('button', { name: 'Réagir', exact: true }).click();
  await page.getByRole('button', { name: 'Réagir 👏' }).click();
  await expect
    .poll(() => page.locator('.reaction').evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.9);
  // and nothing loops at a flickering speed
  const loops = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => (a as CSSAnimation).animationName),
  );
  expect(loops.every((n) => n === 'spin')).toBe(true);

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
  await page.getByTestId('btn-keys').click();
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
