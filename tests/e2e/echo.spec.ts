// Echo cancelling in a real browser: the audio engine (src/media/engine.ts) with its worklet and WebAssembly.
// A simulated room sends what the speakers play back into a "microphone"; the canceller must take it out. And in
// a lesson, pure sound on speakers: the microphone is captured untouched, cancelled by the engine, the others'
// sound plays through it, and still reaches the other side.

import { expect, test, type Browser, type Page } from '@playwright/test';

const Q = '?relay=local&debug';

async function person(browser: Browser, name: string, hash = ''): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
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
      process(t: MediaStreamTrack, w: { aec: boolean; denoise: boolean }): Promise<MediaStreamTrack>;
      cancelling: boolean;
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
    const sent = await eng.process(mic, { aec: true, denoise: false });
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
    return { reduction: 10 * Math.log10(mIn.get() / mOut.get()), cancelling: eng.cancelling };
  });
  console.log(`echo removed in the browser: ${result.reduction.toFixed(1)} dB`);
  expect(result.cancelling).toBe(true);
  expect(result.reduction).toBeGreaterThan(10);
  expect(errors).toEqual([]);
  await a.context().close();
});

test('in a lesson on speakers: pure capture, cancelled by the engine, the others heard through it', async ({
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
      engine: { cancelling: boolean; echo: { value: { delayMs: number } | null } };
      peers: { value: { stats: { audioInKbps: number } | null }[] };
    };
  };
  const state = () =>
    a.evaluate(() => {
      const s = (window as unknown as S).sonora;
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return {
        // the capture itself is untouched (no browser echo cancelling, no noise suppression)
        captureEcho: s.media.audio.value.getSettings().echoCancellation,
        // what is sent is the engine's output, with echo cancelling running
        processed: s.media.sentAudio.value !== s.media.audio.value,
        cancelling: s.engine.cancelling,
        echo: s.media.echo.value,
        // the other's sound plays through the engine (its element muted)
        routed: !!el && el.muted,
      };
    });
  await expect
    .poll(state, { timeout: 15_000 })
    .toEqual({ captureEcho: false, processed: true, cancelling: true, echo: true, routed: true });
  // the canceller reports
  await expect
    .poll(() => a.evaluate(() => (window as unknown as S).sonora.engine.echo.value !== null), { timeout: 5000 })
    .toBe(true);
  // and the other side hears it
  await expect
    .poll(() => b.evaluate(() => (window as unknown as S).sonora.peers.value[0]?.stats?.audioInKbps ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(20);
  // the sound check shows it
  await a.getByTestId('btn-settings').click();
  await expect(a.getByTestId('soundcheck')).toContainText(/Echo cancelling \(music\)\s*running/);
  await expect(a.getByTestId('soundcheck')).toContainText(/echo off · noise off · volume off/);
  // headphones: no cancelling, the plain path again
  await a.getByRole('group', { name: 'Echo cancelling' }).getByRole('button', { name: 'Off (headphones)' }).click();
  await expect
    .poll(state)
    .toEqual({ captureEcho: false, processed: false, cancelling: false, echo: false, routed: false });
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});
