// Lessons over a long-distance link: both browsers go through the simulated network of server/netsim.ts (a TURN
// relay that delays each one's packets), so sound, video, MIDI and the data channels all take the delay, as
// between two cities. Up to 200 ms each way (400 ms round trip), a little jitter.

import { expect, test } from '@playwright/test';
import { startNetsim, type Netsim } from '../../server/netsim.ts';
import { burstsWav, codeOf, lagBetween, linked, simPerson, stats } from './sim.ts';

let sim: Netsim;
test.beforeAll(async () => {
  sim = await startNetsim(0);
});
test.afterAll(async () => {
  await sim.close();
});

test('a 200 ms round trip: everything goes through the simulated network, and the app measures it', async ({
  browser,
}) => {
  const net = { up: 50, down: 50, jitter: 4 };
  const a = await simPerson(browser, 'Clara', { turn: sim.url, net });
  const b = await simPerson(browser, 'Leo', { turn: sim.url, net, hash: await codeOf(a) });
  await linked(a, 1);
  await linked(b, 1);
  await expect.poll(async () => (await stats(a))?.relayed).toBe(true);
  await expect.poll(async () => (await stats(a))?.rtt ?? 0, { timeout: 15_000 }).toBeGreaterThan(190);
  expect((await stats(a))!.rtt!).toBeLessThan(260);
  expect(sim.relayed).toBeGreaterThan(100);
  await a.context().close();
  await b.context().close();
});

type W = {
  sonora: {
    engine: { ctx: AudioContext; trackBus: GainNode; out: GainNode };
    backing: { duration: { value: number }; delay: { value: number }; sounding: { value: boolean } };
    midi: { fromScreen(m: number[]): void; piano: { load(): Promise<void>; ready: { value: boolean } } };
  };
  __sim: { mic: GainNode; ctx: AudioContext };
};

/** In the page: what this side hears (`node`) reaches its simulated microphone, as a singer or a piano would. */
async function micHears(
  page: import('@playwright/test').Page,
  node: 'trackBus' | 'out',
  echo?: { ms: number; gain: number },
) {
  await page.evaluate(
    ({ node, echo }) => {
      const w = window as unknown as W;
      const ctx = w.sonora.engine.ctx as AudioContext & { outputLatency?: number };
      const d = ctx.createDelay(1);
      // heard after the speakers' delay (or the room's echo path)
      d.delayTime.value = echo ? echo.ms / 1000 : (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0);
      const g = ctx.createGain();
      g.gain.value = echo?.gain ?? 1;
      w.sonora.engine[node].connect(d).connect(g).connect(w.__sim.mic);
    },
    { node, echo },
  );
}

const theirSound = 'ctx.createMediaStreamSource(sonora.peers.value[0].audio)';

test('backing track at 200 ms each way: the teacher hears the student sing in time with her track', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const net = { up: 100, down: 100, jitter: 5 };
  // both on headphones: nothing to cancel, the singer's microphone carries the voice alone
  const settings = { echo: 'off' };
  const a = await simPerson(browser, 'Clara', { turn: sim.url, net, settings });
  const b = await simPerson(browser, 'Leo', { turn: sim.url, net, settings, hash: await codeOf(a) });
  await linked(a, 1);
  await linked(b, 1);
  await a.getByTestId('btn-track').click();
  await a
    .getByTestId('backing-track')
    .locator('input[type=file]')
    .setInputFiles({ name: 'bursts.wav', mimeType: 'audio/wav', buffer: burstsWav(40) });
  // loaded on both sides
  // 4 MB over a 400 ms round trip: about 20 s
  for (const p of [a, b])
    await expect
      .poll(() => p.evaluate(() => (window as unknown as W).sonora.backing.duration.value), { timeout: 60_000 })
      .toBeGreaterThan(30);
  // the student sings exactly what he hears; he presses Play, so the track is in time with him
  await micHears(b, 'trackBus');
  await b.getByTestId('backing-track').getByTestId('track-play').click();
  await expect.poll(() => b.evaluate(() => (window as unknown as W).sonora.backing.sounding.value)).toBe(true);
  // the jitter buffer and the delay estimate settle
  await a.waitForTimeout(5000);
  const delay = await a.evaluate(() => (window as unknown as W).sonora.backing.delay.value);
  const r = await lagBetween(a, 8, 'sonora.engine.trackBus', theirSound);
  console.log(
    `teacher: track delayed ${delay} ms; his voice vs her track: ${r.lagMs} ms (match ${r.match.toFixed(2)})`,
  );
  expect(delay).toBeGreaterThan(200);
  expect(r.match).toBeGreaterThan(0.5);
  // measured 12 to 26 ms (his voice a little after her track: a constant offset not yet explained, the same at
  // any network delay); about the time sound takes to cross a room
  expect(Math.abs(r.lagMs)).toBeLessThanOrEqual(40);
  await a.context().close();
  await b.context().close();
});

test('MIDI at 200 ms each way: the student’s notes on the teacher’s piano land with his microphone', async ({
  browser,
}) => {
  const net = { up: 100, down: 100, jitter: 5 };
  // his microphone carries the piano (pure sound); both on headphones
  const a = await simPerson(browser, 'Clara', {
    turn: sim.url,
    net,
    settings: { echo: 'off', midi: { playOn: 'piano', keyboard: false } },
  });
  const b = await simPerson(browser, 'Leo', {
    turn: sim.url,
    net,
    settings: { echo: 'off', sound: 'pure', midi: { keyboard: false } },
    hash: await codeOf(a),
  });
  await linked(a, 1);
  await linked(b, 1);
  for (const p of [a, b])
    await p.evaluate(async () => {
      const piano = (window as unknown as W).sonora.midi.piano;
      await piano.load();
    });
  // his piano reaches his microphone the moment he plays (the built-in one stands in for an acoustic one: its
  // sound as made, not after the speakers)
  await micHears(b, 'out', { ms: 0, gain: 1 });
  // he plays: notes at irregular moments, for 14 s
  const playing = b.evaluate(async () => {
    const hub = (window as unknown as W).sonora.midi;
    let s = 3;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const end = Date.now() + 14_000;
    while (Date.now() < end) {
      const note = 48 + Math.floor(rand() * 24);
      hub.fromScreen([0x90, note, 100]);
      await new Promise((r) => setTimeout(r, 60 + rand() * 120));
      hub.fromScreen([0x80, note, 0]);
      await new Promise((r) => setTimeout(r, 80 + rand() * 250));
    }
  });
  await a.waitForTimeout(5000);
  const r = await lagBetween(a, 7, 'sonora.engine.out', theirSound);
  console.log(`teacher: his MIDI on her piano vs his microphone: ${r.lagMs} ms (match ${r.match.toFixed(2)})`);
  await playing;
  expect(r.match).toBeGreaterThan(0.4);
  expect(Math.abs(r.lagMs)).toBeLessThanOrEqual(30);
  await a.context().close();
  await b.context().close();
});

for (const musicEcho of [false, true]) {
  test(`on speakers, the backing track is taken out of the microphone (${musicEcho ? 'music-safe' : 'standard'} echo cancelling)`, async ({
    browser,
  }) => {
    const net = { up: 40, down: 40 };
    const a = await simPerson(browser, 'Clara', {
      turn: sim.url,
      net,
      settings: { echo: 'on', musicEcho, autoLevel: false },
    });
    const b = await simPerson(browser, 'Leo', { turn: sim.url, net, settings: { echo: 'off' }, hash: await codeOf(a) });
    await linked(a, 1);
    await linked(b, 1);
    // the room: her speakers reach her microphone 20 ms later, at half the level
    await micHears(a, 'out', { ms: 20, gain: 0.5 });
    await a.getByTestId('btn-track').click();
    await a
      .getByTestId('backing-track')
      .locator('input[type=file]')
      .setInputFiles({ name: 'bursts.wav', mimeType: 'audio/wav', buffer: burstsWav(40) });
    await expect
      .poll(() => a.evaluate(() => (window as unknown as W).sonora.backing.duration.value), { timeout: 30_000 })
      .toBeGreaterThan(30);
    await a.getByTestId('track-play').click();
    // time to learn the room
    await a.waitForTimeout(6000);
    const r = await lagBetween(
      a,
      4,
      'window.__sim.mic',
      'ctx.createMediaStreamSource(new MediaStream([sonora.media.sentAudio.value]))',
    );
    const reduction = 20 * Math.log10(r.rmsA / Math.max(1e-9, r.rmsB));
    console.log(`track echo removed: ${reduction.toFixed(1)} dB`);
    expect(reduction).toBeGreaterThan(15);
    await a.context().close();
    await b.context().close();
  });
}
