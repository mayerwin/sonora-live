// Test helpers for real lessons under simulated conditions: a network with delay, jitter and loss (the TURN
// relay of server/netsim.ts), and a microphone the test feeds (a singer, a piano, the echo of the speakers),
// recorded and compared in the page.

import { expect, type Browser, type Page } from '@playwright/test';
import { usernameOf, type LinkProfile } from '../../server/netsim.ts';

export interface SimOptions {
  /** this person's link to the relay (ms each way, jitter, loss) */
  net?: Partial<LinkProfile>;
  /** the relay (startNetsim().url) */
  turn: string;
  /** settings saved before the page opens */
  settings?: Record<string, unknown>;
  hash?: string;
}

/**
 * Someone opening the app on a simulated network, with a simulated microphone: `window.__sim.mic` is a gain node
 * in the app's audio context whose sound is what the microphone captures (nothing until the test connects
 * something to it).
 */
export async function simPerson(browser: Browser, name: string, o: SimOptions): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(
    ({ turn, user, extra }) => {
      try {
        const key = 'sonora.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
        localStorage.setItem(
          key,
          JSON.stringify({ ...cur, ...extra, turn: { urls: turn, username: user, credential: 'sim' } }),
        );
      } catch {
        // no storage
      }
      const md = navigator.mediaDevices;
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        const out = new MediaStream();
        if (c?.video) (await real({ video: c.video })).getVideoTracks().forEach((t) => out.addTrack(t));
        if (c?.audio) {
          type W = { sonora: { engine: { ensure(): AudioContext } }; __sim?: { mic: GainNode; ctx: AudioContext } };
          const w = window as unknown as W;
          let sim = w.__sim;
          if (!sim) {
            const ac = w.sonora.engine.ensure();
            const mic = ac.createGain();
            // a real microphone's own noise (−80 dBFS): it always delivers sound. With nothing playing into it, the
            // browser would stop producing frames, and the other side would hear the call drop out
            const len = ac.sampleRate;
            const noise = ac.createBuffer(1, len, ac.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 1e-4;
            const floor = ac.createBufferSource();
            floor.buffer = noise;
            floor.loop = true;
            floor.connect(mic);
            floor.start();
            sim = w.__sim = { mic, ctx: ac };
          }
          const dest = sim.ctx.createMediaStreamDestination();
          dest.channelCount = 1;
          sim.mic.connect(dest);
          out.addTrack(dest.stream.getAudioTracks()[0]);
        }
        return out;
      };
    },
    { turn: o.turn, user: usernameOf(o.net ?? {}), extra: o.settings ?? {} },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`/?relay=local&debug&nodirect${o.hash ? `#${o.hash}` : ''}`);
  await page.getByPlaceholder('e.g. Clara').fill(name);
  await page.locator('.join-card .btn-primary').click();
  await expect(page.getByTestId('room')).toBeVisible();
  return page;
}

export const codeOf = (page: Page) => page.evaluate(() => location.hash.slice(1));

type PeerStats = { link: string; remote: unknown; stats: { rtt: number | null; relayed: boolean } | null };

/** Connected to `n` others, with a round trip measured. */
export async function linked(page: Page, n: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { sonora: { peers: { value: PeerStats[] } } }).sonora.peers.value.filter(
              (p) => p.link === 'connected' && p.remote && p.stats?.rtt != null,
            ).length,
        ),
      { timeout: 30_000 },
    )
    .toBe(n);
}

export function stats(page: Page) {
  return page.evaluate(
    () => (window as unknown as { sonora: { peers: { value: PeerStats[] } } }).sonora.peers.value[0]?.stats,
  );
}

/** A WAV file (16-bit mono, 48 kHz) of noise bursts at irregular moments: easy to find again in a recording. */
export function burstsWav(seconds: number, seed = 7): Buffer {
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
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  let i = 0;
  while (i < n) {
    const gap = Math.floor(sr * (0.08 + rand() * 0.25));
    const len = Math.floor(sr * (0.03 + rand() * 0.06));
    for (let k = 0; k < len && i + gap + k < n; k++) {
      const env = Math.sin((Math.PI * k) / len);
      b.writeInt16LE(Math.round((rand() * 2 - 1) * env * 12000), 44 + (i + gap + k) * 2);
    }
    i += gap + len;
  }
  return b;
}

/**
 * In the page: record two sounds side by side for `seconds` (each a function returning a node of the app's audio
 * context), and find how much later the second is than the first (ms), from their loudness envelopes. Also how
 * well they match (0..1).
 */
export async function lagBetween(
  page: Page,
  seconds: number,
  a: string,
  b: string,
): Promise<{ lagMs: number; match: number; rmsA: number; rmsB: number }> {
  return page.evaluate(
    async ({ seconds, a, b }) => {
      type W = { sonora: Record<string, unknown> & { engine: { ctx: AudioContext } } };
      const w = window as unknown as W;
      const ctx = w.sonora.engine.ctx;
      const nodeA = new Function('sonora', 'ctx', `return (${a})`)(w.sonora, ctx) as AudioNode;
      const nodeB = new Function('sonora', 'ctx', `return (${b})`)(w.sonora, ctx) as AudioNode;
      const merge = ctx.createChannelMerger(2);
      const monoA = ctx.createGain();
      monoA.channelCount = 1;
      monoA.channelCountMode = 'explicit';
      const monoB = ctx.createGain();
      monoB.channelCount = 1;
      monoB.channelCountMode = 'explicit';
      nodeA.connect(monoA).connect(merge, 0, 0);
      nodeB.connect(monoB).connect(merge, 0, 1);
      const proc = ctx.createScriptProcessor(4096, 2, 2);
      const hop = Math.round(ctx.sampleRate * 0.002);
      const envA: number[] = [];
      const envB: number[] = [];
      let accA = 0;
      let accB = 0;
      let k = 0;
      proc.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0);
        const y = e.inputBuffer.getChannelData(1);
        for (let i = 0; i < x.length; i++) {
          accA += x[i] * x[i];
          accB += y[i] * y[i];
          if (++k === hop) {
            envA.push(Math.sqrt(accA / hop));
            envB.push(Math.sqrt(accB / hop));
            accA = accB = 0;
            k = 0;
          }
        }
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      merge.connect(proc).connect(sink).connect(ctx.destination);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      proc.disconnect();
      monoA.disconnect();
      monoB.disconnect();
      // normalised cross-correlation of the envelopes, −600..+600 ms
      const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
      const ma = mean(envA);
      const mb = mean(envB);
      const A = envA.map((v) => v - ma);
      const B = envB.map((v) => v - mb);
      const norm = Math.sqrt(A.reduce((s, x) => s + x * x, 0) * B.reduce((s, x) => s + x * x, 0)) || 1;
      let best = 0;
      let bestLag = 0;
      const max = Math.round(600 / 2);
      for (let lag = -max; lag <= max; lag++) {
        let sum = 0;
        for (let i = Math.max(0, -lag); i < A.length && i + lag < B.length; i++) sum += A[i] * B[i + lag];
        if (sum > best) {
          best = sum;
          bestLag = lag;
        }
      }
      return { lagMs: bestLag * 2, match: best / norm, rmsA: ma, rmsB: mb };
    },
    { seconds, a, b },
  );
}
