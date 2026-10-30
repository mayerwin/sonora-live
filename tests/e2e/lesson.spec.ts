// Real browsers, real WebRTC: two or three Chromium instances meet in a room through the local relay of the
// development server (the public MQTT brokers are replaced by server/relay.ts), with fake camera and microphone.

import { expect, test, type Browser, type Page } from '@playwright/test';

type Role = 'student' | 'teacher' | 'observer';

async function person(browser: Browser, name: string, role: Role, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`/${hash ? `#${hash}` : ''}`);
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
    (window as unknown as { sonora: { peers: { value: { info: { name: string; role: string }; link: string; stats: unknown; remote: unknown }[] } } }).sonora.peers.value.map(
      (p) => ({ name: p.info.name, role: p.info.role, link: p.link, stats: p.stats as Record<string, unknown> | null, remote: p.remote }),
    ),
  );
}

async function connected(page: Page, n: number): Promise<void> {
  await expect.poll(async () => (await peers(page)).filter((p) => p.link === 'connected' && p.remote).length, { timeout: 20_000 }).toBe(n);
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
    .poll(() => teacher.evaluate(() => (document.querySelector('[data-testid=tile] video') as HTMLVideoElement | null)?.videoWidth ?? 0))
    .toBeGreaterThan(0);

  // pure sound: no processing on the microphone
  const settings = await teacher.evaluate(() => {
    const s = (window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack } } } }).sonora.media.audio.value.getSettings();
    return { ec: s.echoCancellation, ns: s.noiseSuppression, agc: s.autoGainControl };
  });
  expect(settings).toEqual({ ec: false, ns: false, agc: false });

  // stereo Opus, ~192 kbps, 100 packets per second (10 ms frames), direct path
  await expect
    .poll(async () => {
      const s = (await peers(teacher))[0].stats;
      return s ? { ch: s.audioChannels, pps: Number(s.audioOutPps) >= 90, kbps: Number(s.audioOutKbps) > 120, direct: !s.relayed } : null;
    }, { timeout: 20_000 })
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
  await expect.poll(() => b.evaluate(() => (window as unknown as { sonora: { midi: { holder(n: number): { remote: string | null } } } }).sonora.midi.holder(60).remote)).not.toBeNull();
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
    a.evaluate(() => (window as unknown as { sonora: { media: { audio: { value: MediaStreamTrack } } } }).sonora.media.audio.value.getSettings().echoCancellation);
  expect(await ec()).toBe(false);
  // pretend an instrument is plugged in (no MIDI hardware in CI)
  await a.evaluate(() => {
    (window as unknown as { sonora: { midi: { devices: { connected: { value: boolean }; currentName: { value: string } } } } }).sonora.midi.devices.currentName.value = 'Test Piano';
    (window as unknown as { sonora: { midi: { devices: { connected: { value: boolean } } } } }).sonora.midi.devices.connected.value = true;
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
