// MIDI and the microphone (no backing track) over simulated networks (server/netsim.ts): jitter, loss, uneven
// links. What is measured is what a person hears or plays: note timing on the other side, notes lost or held,
// the other side's sound coming back as echo, and the delay the app shows against the real one.

import { expect, test, type Page } from '@playwright/test';
import { startNetsim, usernameOf, type LinkProfile, type Netsim } from '../../server/netsim.ts';
import { codeOf, lagBetween, linked, simPerson } from './sim.ts';

let sim: Netsim;
test.beforeAll(async () => {
  sim = await startNetsim(0);
});
test.afterAll(async () => {
  await sim.close();
});

type W = {
  sonora: {
    engine: { ctx: AudioContext; out: GainNode };
    midi: {
      fromScreen(m: number[]): void;
      piano: { load(): Promise<void>; midi(m: number[], id?: string): void };
      remote: Map<string, { heldCount: number }>;
      delayOf(id: string): number;
    };
    peers: {
      value: { id: string; stats: { latencyMs: number | null; bufferMs: number; rtt: number | null } | null }[];
    };
  };
  __sim: { mic: GainNode; ctx: AudioContext };
  __notesIn?: { note: number; at: number }[];
};

/** A teacher and a student, MIDI from him to her built-in piano, both on headphones. */
async function lesson(net: { a: Partial<LinkProfile>; b: Partial<LinkProfile> }) {
  const a = await simPerson(browser!, 'Clara', {
    turn: sim.url,
    net: net.a,
    settings: { echo: 'off', midi: { playOn: 'piano', keyboard: false } },
  });
  const b = await simPerson(browser!, 'Leo', {
    turn: sim.url,
    net: net.b,
    settings: { echo: 'off', sound: 'pure', midi: { keyboard: false } },
    hash: await codeOf(a),
  });
  await linked(a, 1);
  await linked(b, 1);
  await a.evaluate(async () => {
    const w = window as unknown as W;
    await w.sonora.midi.piano.load();
    // every note-on her piano plays, on the shared wall clock
    const piano = w.sonora.midi.piano;
    const orig = piano.midi.bind(piano);
    w.__notesIn = [];
    piano.midi = (m, id) => {
      if ((m[0] & 0xf0) === 0x90 && m[2] > 0)
        w.__notesIn!.push({ note: m[1], at: performance.timeOrigin + performance.now() });
      orig(m, id);
    };
  });
  return { a, b };
}
let browser: import('@playwright/test').Browser | undefined;
test.beforeEach(({ browser: b }) => {
  browser = b;
});

/** He plays `count` notes, one every `everyMs`, each held `holdMs`; when each note left, on the wall clock. */
function play(b: Page, count: number, everyMs: number, holdMs: number) {
  return b.evaluate(
    async ({ count, everyMs, holdMs }) => {
      const hub = (window as unknown as W).sonora.midi;
      const sent: { note: number; at: number }[] = [];
      const t0 = performance.now() + 200;
      for (let i = 0; i < count; i++) {
        const note = 36 + (i % 60);
        const due = t0 + i * everyMs;
        while (performance.now() < due - 2) await new Promise((r) => setTimeout(r, 1));
        while (performance.now() < due) {
          // the last ms, exactly
        }
        sent.push({ note, at: performance.timeOrigin + performance.now() });
        hub.fromScreen([0x90, note, 90]);
        setTimeout(() => hub.fromScreen([0x80, note, 0]), holdMs);
      }
      await new Promise((r) => setTimeout(r, holdMs + 50));
      return sent;
    },
    { count, everyMs, holdMs },
  );
}

/**
 * How evenly his notes reach her. `rhythm`: how far each gap between two notes differs from the gap he played
 * (95th percentile, ms): the rhythm as heard. `spread`: the range of (arrival − departure), which also counts a
 * one-time shift (the delay following his sound's buffer).
 */
async function timing(a: Page, sent: { note: number; at: number }[]) {
  await a.waitForTimeout(1500);
  const got = await a.evaluate(() => (window as unknown as W).__notesIn ?? []);
  const transit: number[] = [];
  let j = 0;
  for (const s of sent) {
    while (j < got.length && got[j].note !== s.note) j++;
    if (j >= got.length) break;
    transit.push(got[j].at - s.at);
    j++;
  }
  const gaps = transit
    .slice(1)
    .map((v, i) => Math.abs(v - transit[i]))
    .sort((x, y) => x - y);
  const rhythm = gaps[Math.floor(gaps.length * 0.95)] ?? 0;
  const mean = transit.reduce((x, y) => x + y, 0) / Math.max(1, transit.length);
  const sd = Math.sqrt(transit.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, transit.length));
  const sorted = [...transit].sort((x, y) => x - y);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const held = await a.evaluate(() =>
    [...(window as unknown as W).sonora.midi.remote.values()].reduce((n, s) => n + s.heldCount, 0),
  );
  return { arrived: got.length, matched: transit.length, mean, sd, spread: p(0.98) - p(0.02), rhythm, held };
}

for (const jitter of [0, 10, 30]) {
  test(`MIDI rhythm with ${jitter} ms of network jitter: notes keep their spacing`, async () => {
    const net = { up: 40, down: 40, jitter };
    const { a, b } = await lesson({ a: net, b: net });
    // the jitter buffer settles
    await a.waitForTimeout(4000);
    const sent = await play(b, 80, 110, 60);
    const r = await timing(a, sent);
    const delay = await a.evaluate(() => {
      const w = window as unknown as W;
      return w.sonora.midi.delayOf(w.sonora.peers.value[0].id);
    });
    console.log(
      `jitter ${jitter}: ${r.matched}/${sent.length} notes, transit ${r.mean.toFixed(0)} ms (delay ${delay}), rhythm ±${r.rhythm.toFixed(1)} ms (95%), spread ±${(r.spread / 2).toFixed(1)} ms, held after ${r.held}`,
    );
    expect(r.matched).toBe(sent.length);
    expect(r.held).toBe(0);
    // a steady rhythm: each gap within a few ms of the one played, whatever the network's jitter (it was ±13 ms
    // at 10 ms of jitter and ±22 ms at 30 ms, before the sender's clock was used; the rest is the test machine)
    expect(r.rhythm).toBeLessThan(8);
    await a.context().close();
    await b.context().close();
  });
}

test('MIDI with 3% packet loss and jitter: no note lost, none left hanging', async () => {
  const net = { up: 60, down: 60, jitter: 10, loss: 0.03 };
  const { a, b } = await lesson({ a: net, b: net });
  await a.waitForTimeout(3000);
  const sent = await play(b, 120, 90, 50);
  const r = await timing(a, sent);
  console.log(
    `loss 3%: ${r.matched}/${sent.length} notes, rhythm ±${r.rhythm.toFixed(1)} ms (95%), held after ${r.held}`,
  );
  expect(r.matched).toBe(sent.length);
  expect(r.held).toBe(0);
  expect(r.rhythm).toBeLessThan(8);
  await a.context().close();
  await b.context().close();
});

test('an uneven link (fast one way, slow the other): his notes still land with his microphone', async () => {
  // her side: a fast line; his: a slow uplink (a phone on mobile data)
  const { a, b } = await lesson({ a: { up: 10, down: 10, jitter: 2 }, b: { up: 150, down: 20, jitter: 8 } });
  await b.evaluate(() => {
    const w = window as unknown as W;
    w.sonora.engine.out.connect(w.__sim.mic);
  });
  await b.evaluate(() => (window as unknown as W).sonora.midi.piano.load());
  const playing = play(b, 110, 130, 70);
  await a.waitForTimeout(5000);
  const r = await lagBetween(a, 7, 'sonora.engine.out', 'ctx.createMediaStreamSource(sonora.peers.value[0].audio)');
  await playing;
  console.log(`uneven link: his MIDI on her piano vs his microphone: ${r.lagMs} ms (match ${r.match.toFixed(2)})`);
  expect(r.match).toBeGreaterThan(0.4);
  expect(Math.abs(r.lagMs)).toBeLessThanOrEqual(20);
  await a.context().close();
  await b.context().close();
});

test('on speakers, at 200 ms each way with jitter, the student does not hear himself come back', async () => {
  const net = { up: 100, down: 100, jitter: 10 };
  // she is on speakers with the music-safe canceller (the browser's cannot run on a simulated microphone)
  const a = await simPerson(browser!, 'Clara', {
    turn: sim.url,
    net,
    settings: { echo: 'on', musicEcho: true, autoLevel: false },
  });
  const b = await simPerson(browser!, 'Leo', {
    turn: sim.url,
    net,
    settings: { echo: 'off', autoLevel: false },
    hash: await codeOf(a),
  });
  await linked(a, 1);
  await linked(b, 1);
  // her room: her speakers reach her microphone 15 ms later at half the level, with a reflection
  await a.evaluate(() => {
    const w = window as unknown as W;
    const ctx = w.sonora.engine.ctx;
    for (const [ms, g] of [
      [15, 0.5],
      [32, 0.2],
    ]) {
      const d = ctx.createDelay(1);
      d.delayTime.value = ms / 1000;
      const gain = ctx.createGain();
      gain.gain.value = g;
      w.sonora.engine.out.connect(d).connect(gain).connect(w.__sim.mic);
    }
  });
  // he plays: noise bursts at irregular moments into his microphone
  await b.evaluate(() => {
    const w = window as unknown as W;
    const ctx = w.__sim.ctx;
    const src = ctx.createBufferSource();
    const len = ctx.sampleRate * 30;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 11;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < len; ) {
      const gap = Math.floor(ctx.sampleRate * (0.1 + rand() * 0.3));
      const n = Math.floor(ctx.sampleRate * (0.04 + rand() * 0.08));
      for (let k = 0; k < n && i + gap + k < len; k++)
        d[i + gap + k] = (rand() * 2 - 1) * Math.sin((Math.PI * k) / n) * 0.4;
      i += gap + n;
    }
    src.buffer = buf;
    src.connect(w.__sim.mic);
    src.start();
    (w as unknown as { __src: AudioNode }).__src = src;
  });
  // time for her canceller to learn the room
  await a.waitForTimeout(8000);
  // at his side: his own playing against what comes back from her
  const r = await lagBetween(b, 6, 'window.__src', 'ctx.createMediaStreamSource(sonora.peers.value[0].audio)');
  // the same at her side before cancelling: what her microphone picks up of him
  const raw = await lagBetween(a, 4, 'ctx.createMediaStreamSource(sonora.peers.value[0].audio)', 'window.__sim.mic');
  const returnLoss = 20 * Math.log10(r.rmsA / Math.max(1e-9, r.rmsB));
  console.log(
    `his sound comes back ${returnLoss.toFixed(1)} dB down (correlation ${r.match.toFixed(2)} at ${r.lagMs} ms); in her room before cancelling: ${(20 * Math.log10(raw.rmsA / Math.max(1e-9, raw.rmsB))).toFixed(1)} dB`,
  );
  expect(returnLoss).toBeGreaterThan(20);
  await a.context().close();
  await b.context().close();
});

test('the delay the app shows follows the real mouth-to-ear delay as the network gets worse', async () => {
  test.setTimeout(180_000);
  // both start on a perfect link (the reference: what the browsers themselves add), then it worsens mid-lesson
  const user = usernameOf({});
  const a = await simPerson(browser!, 'Clara', { turn: sim.url, settings: { echo: 'off' } });
  const b = await simPerson(browser!, 'Leo', {
    turn: sim.url,
    settings: { echo: 'off', autoLevel: false },
    hash: await codeOf(a),
  });
  await linked(a, 1);
  await linked(b, 1);
  const rows: { net: string; measured: number; shown: number; midi: number }[] = [];
  for (const net of [
    { up: 0, down: 0, jitter: 0 },
    { up: 20, down: 20, jitter: 2 },
    { up: 60, down: 60, jitter: 10 },
    { up: 100, down: 100, jitter: 25 },
  ]) {
    const before = await audioIn(a);
    sim.retune(user, net);
    // the jitter buffer and the round-trip estimate settle (longer at first: a new call's buffer starts high)
    await a.waitForTimeout(rows.length ? 6000 : 12_000);
    const lag = await mouthToEar(a, b);
    const shown = await a.evaluate(() => (window as unknown as W).sonora.peers.value[0].stats?.latencyMs ?? 0);
    const midi = await a.evaluate(() => {
      const w = window as unknown as W;
      return w.sonora.midi.delayOf(w.sonora.peers.value[0].id);
    });
    if (process.env.NETSIM_DEBUG)
      console.log(
        'stats',
        JSON.stringify(
          await a.evaluate(async () => {
            const w = window as unknown as { sonora: { parts: { links(): { pc: RTCPeerConnection }[] } } };
            const r = await w.sonora.parts.links()[0].pc.getStats();
            const out: Record<string, unknown> = {};
            r.forEach((v: Record<string, unknown>) => {
              if (v.type === 'inbound-rtp' && v.kind === 'audio')
                Object.assign(out, {
                  jbd: v.jitterBufferDelay,
                  jbt: v.jitterBufferTargetDelay,
                  jbm: v.jitterBufferMinimumDelay,
                  jbe: v.jitterBufferEmittedCount,
                  ins: v.insertedSamplesForDeceleration,
                  rem: v.removedSamplesForAcceleration,
                  conceal: v.concealedSamples,
                });
              if (v.type === 'media-playout')
                Object.assign(out, { tpd: v.totalPlayoutDelay, tsc: v.totalSamplesCount });
              if (v.type === 'remote-inbound-rtp' && v.kind === 'audio') Object.assign(out, { artt: v.roundTripTime });
              if (v.type === 'candidate-pair' && v.nominated) Object.assign(out, { crtt: v.currentRoundTripTime });
            });
            return out;
          }),
        ),
      );
    const after = await audioIn(a);
    const concealed = (after.concealed - before.concealed) / Math.max(1, after.samples - before.samples);
    console.log(`${net.up + net.down} ms ±${net.jitter}: ${(concealed * 100).toFixed(2)}% of his sound concealed`);
    rows.push({ net: `${net.up + net.down} ms ±${net.jitter}`, measured: lag, shown, midi });
  }
  // the two pages' clocks are compared through the wall clock, which may be offset by a constant: compare what
  // each network adds to the perfect link's delay
  const base = rows[0];
  // it rises with each step the network gets worse
  for (let i = 1; i < rows.length; i++) expect(rows[i].shown).toBeGreaterThan(rows[i - 1].shown);
  for (const r of rows) {
    const real = r.measured - base.measured;
    const shown = r.shown - base.shown;
    console.log(`${r.net} each way: adds ${real} ms measured, ${shown} ms shown; MIDI waits ${r.midi} ms`);
    // within some 40 ms here (the real delay moves while the jitter buffer adapts to each change); room for slower
    // CI machines. What musicians feel is checked precisely elsewhere (MIDI and track against the sound).
    expect(Math.abs(shown - real)).toBeLessThan(100);
  }
  await a.context().close();
  await b.context().close();
});

/** Her side's counters of his sound: samples received and samples the jitter buffer had to invent. */
function audioIn(a: Page): Promise<{ samples: number; concealed: number }> {
  return a.evaluate(async () => {
    const w = window as unknown as { sonora: { parts: { links(): { pc: RTCPeerConnection }[] } } };
    const r = await w.sonora.parts.links()[0].pc.getStats();
    let out = { samples: 0, concealed: 0 };
    r.forEach((v: Record<string, unknown>) => {
      if (v.type === 'inbound-rtp' && v.kind === 'audio')
        out = { samples: Number(v.totalSamplesReceived ?? 0), concealed: Number(v.concealedSamples ?? 0) };
    });
    return out;
  });
}

/** His sound's delay to her ears (ms, up to a constant): the same bursts at the same wall-clock moment, into his
 * microphone and as a reference heard at her side. */
async function mouthToEar(a: Page, b: Page): Promise<number> {
  const start = Date.now() + 1500;
  const bursts = (page: Page, as: 'mic' | 'ref') =>
    page.evaluate(
      ({ start, as }) => {
        const w = window as unknown as W & { __ref?: AudioNode };
        const ctx = w.sonora.engine.ctx as AudioContext & { outputLatency?: number };
        const ts = ctx.getOutputTimestamp();
        const heard = (epoch: number) =>
          ts.contextTime! + (epoch - performance.timeOrigin - ts.performanceTime!) / 1000;
        const len = ctx.sampleRate * 10;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let s = 5;
        const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let i = 0; i < len; ) {
          const gap = Math.floor(ctx.sampleRate * (0.1 + rand() * 0.3));
          const n = Math.floor(ctx.sampleRate * (0.03 + rand() * 0.05));
          for (let k = 0; k < n && i + gap + k < len; k++) d[i + gap + k] = (rand() * 2 - 1) * 0.5;
          i += gap + n;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        // his microphone captures it at `start`; her reference is heard at `start`
        const lead = as === 'mic' ? (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) : 0;
        src.start(heard(start) - lead);
        if (as === 'mic') src.connect(w.__sim.mic);
        else w.__ref = src;
      },
      { start, as },
    );
  await bursts(b, 'mic');
  await bursts(a, 'ref');
  await a.waitForTimeout(1600);
  const r = await lagBetween(a, 7, 'window.__ref', 'ctx.createMediaStreamSource(sonora.peers.value[0].audio)');
  expect(r.match).toBeGreaterThan(0.5);
  await a.waitForTimeout(1500);
  return r.lagMs;
}

test('the sound never drops out while the built-in piano loads (entering a lesson, then someone starts playing)', async () => {
  test.setTimeout(90_000);
  // a perfect link: any drop is this side's own doing
  const a = await simPerson(browser!, 'Clara', { turn: sim.url, settings: { echo: 'off' } });
  const b = await simPerson(browser!, 'Leo', {
    turn: sim.url,
    settings: { echo: 'off', autoLevel: false },
    hash: await codeOf(a),
  });
  await linked(a, 1);
  await linked(b, 1);
  // he plays a steady sound
  await b.evaluate(() => {
    const w = window as unknown as W;
    const o = w.__sim.ctx.createOscillator();
    const g = w.__sim.ctx.createGain();
    g.gain.value = 0.2;
    o.connect(g).connect(w.__sim.mic);
    o.start();
  });
  const buffer = async () => {
    const s = await a.evaluate(() => (window as unknown as W).sonora.peers.value[0].stats);
    return s?.bufferMs ?? 0;
  };
  const start = await audioIn(a);
  // the first seconds: his piano loads in the background (from 3 s in)
  await a.waitForTimeout(12_000);
  const early = await buffer();
  // then notes are about to be played on his side: his piano loads at once
  // (it takes longer than the test watches: the page closes before it ends)
  b.evaluate(() => (window as unknown as W).sonora.midi.piano.load()).catch(() => {});
  await a.waitForTimeout(10_000);
  const end = await audioIn(a);
  const concealed = (end.concealed - start.concealed) / Math.max(1, end.samples - start.samples);
  const late = await buffer();
  console.log(
    `piano loading: ${(concealed * 100).toFixed(2)}% of his sound concealed; her buffer ${early} ms, then ${late} ms`,
  );
  // decoding in bursts starved the audio: 1% to 4% concealed, then a jitter buffer of 150 to 200 ms
  expect(concealed).toBeLessThan(0.005);
  expect(late).toBeLessThan(110);
  await a.context().close();
  await b.context().close();
});

test('the sound check tells speakers from headphones, and measures Bluetooth headphones for the others', async () => {
  const a = await simPerson(browser!, 'Clara', { turn: sim.url, settings: { echo: 'auto' } });
  const b = await simPerson(browser!, 'Leo', { turn: sim.url, settings: { echo: 'off' }, hash: await codeOf(a) });
  await linked(a, 1);
  await linked(b, 1);
  type L = { sonora: { listening: { value: string } } };
  const listening = () => a.evaluate(() => (window as unknown as L).sonora.listening.value);
  /** What her speakers or headphones play reaches her microphone `ms` later (null: nothing does). */
  const path = (ms: number | null) =>
    a.evaluate((ms) => {
      const w = window as unknown as W & { __path?: GainNode };
      w.__path?.disconnect();
      w.__path = undefined;
      if (ms === null) return;
      const ctx = w.sonora.engine.ctx;
      const d = ctx.createDelay(1);
      d.delayTime.value = ms / 1000;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      w.sonora.engine.out.connect(d).connect(g).connect(w.__sim.mic);
      w.__path = g;
    }, ms);
  await a.getByTestId('btn-settings').click();
  const check = a.getByTestId('sound-check');
  // headphones: nothing she plays reaches her microphone
  await check.getByTestId('check-run').click();
  await expect(check).toContainText('Headphones: nothing reaches your microphone', { timeout: 10_000 });
  expect(await listening()).toBe('headphones');
  // Bluetooth headphones, one earcup held against the microphone: 200 ms late
  await path(200);
  await check.getByTestId('check-measure').click();
  await expect(check).toContainText(/Headphones: \d+ ms more than the browser says/, { timeout: 10_000 });
  const extra = Number(/(\d+) ms more/.exec((await check.textContent()) ?? '')?.[1]);
  console.log(`headphones measured: ${extra} ms more than the browser says (200 ms simulated)`);
  expect(extra).toBeGreaterThan(150);
  expect(await listening()).toBe('headphones');
  // he learns it: what he plays in time with her waits for it
  await expect
    .poll(() =>
      b.evaluate(
        () =>
          (window as unknown as { sonora: { peers: { value: { remote: { hearExtra?: number } | null }[] } } }).sonora
            .peers.value[0].remote?.hearExtra ?? 0,
      ),
    )
    .toBeGreaterThan(150);
  // speakers: the room brings them back 40 ms later
  await path(40);
  await check.getByTestId('check-run').click();
  await expect(check).toContainText('Speakers: your microphone hears them', { timeout: 10_000 });
  expect(await listening()).toBe('speakers');
  const rt = Number(/Round trip (\d+) ms/.exec((await check.textContent()) ?? '')?.[1]);
  console.log(`sound check: round trip ${rt} ms (40 ms of room)`);
  expect(rt).toBeGreaterThanOrEqual(40);
  expect(rt).toBeLessThan(140);
  await a.context().close();
  await b.context().close();
});

for (const kbps of [1500, 700]) {
  test(`a narrow link (${kbps} kbit/s each way): the picture gives way, his sound stays whole`, async () => {
    test.setTimeout(120_000);
    const a = await simPerson(browser!, 'Clara', { turn: sim.url, settings: { echo: 'off' } });
    const b = await simPerson(browser!, 'Leo', {
      turn: sim.url,
      net: { up: 20, down: 20, jitter: 2, kbps },
      settings: { echo: 'off', autoLevel: false },
      hash: await codeOf(a),
    });
    await linked(a, 1);
    await linked(b, 1);
    // he plays: a steady tone into his microphone (sound that must arrive whole)
    await b.evaluate(() => {
      const s = (window as unknown as W).__sim;
      const o = s.ctx.createOscillator();
      o.frequency.value = 330;
      const g = s.ctx.createGain();
      g.gain.value = 0.2;
      o.connect(g).connect(s.mic);
      o.start();
    });
    // the congestion control finds the link's size
    await a.waitForTimeout(15_000);
    const before = await audioIn(a);
    await a.waitForTimeout(10_000);
    const after = await audioIn(a);
    const concealed = (after.concealed - before.concealed) / Math.max(1, after.samples - before.samples);
    type S = { stats: { videoIn: { kbps: number; fps: number; h: number } | null; audioInKbps: number } | null };
    const stats = await a.evaluate(
      () => (window as unknown as { sonora: { peers: { value: S[] } } }).sonora.peers.value[0].stats,
    );
    console.log(
      `${kbps} kbit/s: ${(concealed * 100).toFixed(2)}% of his sound concealed; his sound ${stats?.audioInKbps} kbit/s, his picture ${stats?.videoIn?.kbps} kbit/s at ${stats?.videoIn?.fps} fps, ${stats?.videoIn?.h}p`,
    );
    // the sound first: (almost) nothing invented by the jitter buffer
    expect(concealed).toBeLessThan(0.01);
    // the picture fits in what is left, and still moves
    expect(stats?.videoIn?.kbps ?? 0).toBeLessThan(kbps);
    expect(stats?.videoIn?.fps ?? 0).toBeGreaterThan(4);
    await a.context().close();
    await b.context().close();
  });
}
