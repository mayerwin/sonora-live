// Echo cancelling in a real browser: the audio engine (src/media/engine.ts) with its worklet and WebAssembly.
// A simulated room sends what the speakers play back into a "microphone"; the canceller must take it out. And in
// a lesson, pure sound on speakers: the microphone is captured untouched, cancelled by the engine, the others'
// sound plays through it, and still reaches the other side.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { media } from './media.ts';

const Q = '?relay=local&debug';

async function person(browser: Browser, name: string, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: media() });
  const page = await ctx.newPage();
  await page.goto(`/${Q}${hash ? `#${hash}` : ''}`);
  await page.getByPlaceholder('e.g. Clara').fill(name);
  return page;
}

async function enter(page: Page): Promise<void> {
  await page.locator('.join-card .btn-primary').click();
  await expect(page.getByTestId('room')).toBeVisible();
}

test('the echo of what the speakers play is taken out of the microphone', async ({ browser }) => {
  const a = await person(browser, 'Clara');
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await enter(a);
  const result = await a.evaluate(async () => {
    type Engine = {
      ensure(): AudioContext;
      out: GainNode;
      load(): Promise<boolean>;
      wasm: ArrayBuffer | null;
    };
    const eng = (window as unknown as { sonora: { engine: Engine } }).sonora.engine;
    const ac = eng.ensure();
    await ac.resume();
    // the room: what the speakers play reaches a "microphone" 60 ms later, quieter, with a reflection
    const dest = ac.createMediaStreamDestination();
    const d1 = ac.createDelay(1);
    d1.delayTime.value = 0.06;
    const g1 = ac.createGain();
    g1.gain.value = 0.5;
    const d2 = ac.createDelay(1);
    d2.delayTime.value = 0.075;
    const g2 = ac.createGain();
    g2.gain.value = 0.2;
    eng.out.connect(d1).connect(g1).connect(dest);
    eng.out.connect(d2).connect(g2).connect(dest);
    const mic = dest.stream.getAudioTracks()[0];
    // the canceller as the engine builds it (its own here: the app's microphone keeps the engine's chain)
    await eng.load();
    const aec = new AudioWorkletNode(ac, 'sonora-aec', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { bytes: eng.wasm!.slice(0), tail: 0.3 },
    });
    let running = false;
    aec.port.onmessage = () => (running = true);
    ac.createMediaStreamSource(new MediaStream([mic])).connect(aec, 0, 0);
    const ref = ac.createGain();
    ref.channelCount = 1;
    ref.channelCountMode = 'explicit';
    eng.out.connect(ref).connect(aec, 0, 1);
    const sentDest = ac.createMediaStreamDestination();
    aec.connect(sentDest);
    const sent = sentDest.stream.getAudioTracks()[0];
    const meter = (t: MediaStreamTrack) => {
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      ac.createMediaStreamSource(new MediaStream([t])).connect(an);
      const buf = new Float32Array(an.fftSize);
      let sum = 0;
      return {
        take: () => {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) sum += v * v;
        },
        get: () => sum,
      };
    };
    const mIn = meter(mic);
    const mOut = meter(sent);
    // notes from the speakers (the others playing), for 9 s
    const t0 = ac.currentTime + 0.1;
    for (let k = 0; k < 36; k++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 110 * 2 ** (((k * 7) % 29) / 12);
      const env = ac.createGain();
      const at = t0 + k * 0.25;
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.15, at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      o.connect(env).connect(eng.out);
      o.start(at);
      o.stop(at + 0.65);
    }
    // measured over the last 3 s (after time to learn)
    await new Promise((r) => setTimeout(r, 6000));
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      mIn.take();
      mOut.take();
      await new Promise((r) => setTimeout(r, 20));
    }
    return { reduction: 10 * Math.log10(mIn.get() / mOut.get()), cancelling: running };
  });
  console.log(`echo removed in the browser: ${result.reduction.toFixed(1)} dB`);
  expect(result.cancelling).toBe(true);
  expect(result.reduction).toBeGreaterThan(10);
  expect(errors).toEqual([]);
  await a.context().close();
});

test('in a lesson on speakers: the browser’s echo cancelling by default, the music-safe one by choice', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara');
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await enter(a);
  const code = await a.evaluate(() => location.hash.slice(1));
  const b = await person(browser, 'Leo', code);
  await enter(b);
  type S = {
    sonora: {
      media: { audio: { value: MediaStreamTrack }; sentAudio: { value: MediaStreamTrack }; echo: { value: boolean } };
      engine: { cancelling: boolean; echo: { value: { delayMs: number } | null }; levelDb: { value: number | null } };
      peers: { value: { stats: { audioInKbps: number } | null }[] };
    };
  };
  const state = () =>
    a.evaluate(() => {
      const s = (window as unknown as S).sonora;
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return {
        captureEcho: s.media.audio.value.getSettings().echoCancellation,
        // what is sent goes through the engine (the automatic level, and the music-safe canceller when chosen)
        processed: s.media.sentAudio.value !== s.media.audio.value,
        cancelling: s.engine.cancelling,
        echo: s.media.echo.value,
        // the other's sound plays through the engine only for the music-safe canceller
        routed: !!el && el.muted,
      };
    });
  // by default: the browser's echo cancelling in the capture, the automatic level on what is sent
  await expect
    .poll(state, { timeout: 15_000 })
    .toEqual({ captureEcho: true, processed: true, cancelling: false, echo: true, routed: false });
  await expect
    .poll(() => a.evaluate(() => (window as unknown as S).sonora.engine.levelDb.value !== null), { timeout: 5000 })
    .toBe(true);
  // the level runs on the microphone's own frames (Chromium): no audio context in the way, no added delay
  expect(
    await a.evaluate(
      () => (window as unknown as { sonora: { engine: { path: { value: string } } } }).sonora.engine.path.value,
    ),
  ).toBe('frames');
  await expect
    .poll(() => b.evaluate(() => (window as unknown as S).sonora.peers.value[0]?.stats?.audioInKbps ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(20);
  // the music-safe one: the capture untouched, cancelled by the engine, the other's sound through it
  await a.getByTestId('btn-settings').click();
  await a
    .getByRole('group', { name: 'Echo cancelling on speakers' })
    .getByRole('button', { name: 'Music-safe (experimental)' })
    .click();
  await expect
    .poll(state, { timeout: 15_000 })
    .toEqual({ captureEcho: false, processed: true, cancelling: true, echo: true, routed: true });
  await expect
    .poll(() => a.evaluate(() => (window as unknown as S).sonora.engine.echo.value !== null), { timeout: 5000 })
    .toBe(true);
  await expect(a.getByTestId('soundcheck')).toContainText(/Echo cancelling\s*running/);
  // and the other side hears it
  await expect
    .poll(() => b.evaluate(() => (window as unknown as S).sonora.peers.value[0]?.stats?.audioInKbps ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(20);
  // headphones: nothing processed at all (no cancelling, no automatic level)
  await a.getByRole('group', { name: 'Listening on' }).getByRole('button', { name: 'Headphones' }).click();
  await expect
    .poll(state)
    .toEqual({ captureEcho: false, processed: false, cancelling: false, echo: false, routed: false });
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test('mute silences what is sent; joining muted then unmuting brings the sound back (processed microphone)', async ({
  browser,
}) => {
  const a = await person(browser, 'Clara');
  // muted in the lobby, before the processing starts
  await a.getByRole('button', { name: 'Mute microphone' }).click();
  await enter(a);
  const code = await a.evaluate(() => location.hash.slice(1));
  const b = await person(browser, 'Leo', code);
  await enter(b);
  // the loudest the student hears from the teacher over two seconds (the fake microphone beeps)
  const heard = () =>
    b.evaluate(async () => {
      const s = (window as unknown as { sonora: { parts: { links(): { audioLevel(): number }[] } } }).sonora;
      let max = 0;
      for (let i = 0; i < 40; i++) {
        for (const l of s.parts.links()) max = Math.max(max, l.audioLevel());
        await new Promise((r) => setTimeout(r, 50));
      }
      return max;
    });
  await expect.poll(() => b.evaluate(() => document.querySelectorAll('audio').length), { timeout: 15_000 }).toBe(1);
  await b.waitForTimeout(1500);
  expect(await heard()).toBeLessThan(0.002);
  // unmute: heard
  await a.getByTestId('btn-mic').click();
  await expect.poll(heard, { timeout: 10_000 }).toBeGreaterThan(0.01);
  // mute again: silent, though the microphone keeps feeding the processing
  await a.getByTestId('btn-mic').click();
  await b.waitForTimeout(800);
  await expect.poll(heard, { timeout: 10_000 }).toBeLessThan(0.002);
  await a.context().close();
  await b.context().close();
});
