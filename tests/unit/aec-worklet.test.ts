// The echo canceller's audio-thread processor (src/media/aec.worklet.ts), run here block by block: it finds the
// echo's delay by itself and removes the echo, and passes the microphone through when there is nothing to do.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const SR = 48_000;
const FRAME = 128;
type Proc = {
  process(i: Float32Array[][], o: Float32Array[][]): boolean;
  port: { onmessage: unknown; postMessage(m: unknown): void };
};
let Processor: new (o: { processorOptions?: unknown }) => Proc;
const messages: unknown[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.AudioWorkletProcessor = class {
    port = { onmessage: null as unknown, postMessage: (m: unknown) => messages.push(m) };
  };
  g.registerProcessor = (_: string, ctor: typeof Processor) => (Processor = ctor);
  await import('../../src/media/aec.worklet.ts');
});

let seed = 9;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;

/** Notes with sharp onsets (harmonics, decaying), irregular timing. */
function notes(seconds: number, gain: number): Float32Array {
  const x = new Float32Array(seconds * SR);
  for (let t = 0.1; t < seconds - 0.5; t += 0.18 + Math.abs(rnd()) * 0.3) {
    const f = 130 * 2 ** (Math.floor(Math.abs(rnd()) * 30) / 12);
    const at = Math.round(t * SR);
    for (let i = 0; i < 0.8 * SR && at + i < x.length; i++)
      for (let h = 1; h <= 5; h++)
        x[at + i] += ((gain / h) * Math.sin((2 * Math.PI * f * h * i) / SR) * Math.exp((-4 * i) / SR)) / 2;
  }
  return x;
}

function run(p: Proc, mic: Float32Array, ref: Float32Array): Float32Array {
  const out = new Float32Array(mic.length);
  const o = [[new Float32Array(FRAME)]];
  for (let at = 0; at + FRAME <= mic.length; at += FRAME) {
    p.process([[mic.subarray(at, at + FRAME)], [ref.subarray(at, at + FRAME)]], o);
    out.set(o[0][0], at);
  }
  return out;
}

const power = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += x[i] * x[i];
  return s + 1e-20;
};

describe('echo canceller worklet', () => {
  it('finds a long echo delay (slow output, Bluetooth speaker) and removes the echo', () => {
    const bytes = readFileSync(new URL('../../src/media/aec.wasm', import.meta.url));
    const p = new Processor({
      processorOptions: { bytes: bytes.buffer.slice(0), tail: 0.3, search: !process.env.AEC_NOSEARCH },
    });
    const far = notes(14, 0.3);
    // 400 ms of latencies (longer than the filter), then a small room
    const d = Math.round(0.4 * SR);
    const echo = new Float32Array(far.length);
    for (let i = d + 400; i < far.length; i++) echo[i] = 0.5 * far[i - d] + 0.15 * far[i - d - 400];
    messages.length = 0;
    const out = run(p, echo, far);
    const stats = messages.filter((m) => (m as { delayMs?: number }).delayMs !== undefined) as {
      delayMs: number;
      reductionDb: number | null;
    }[];
    const last = stats[stats.length - 1];
    if (process.env.AEC_DEBUG)
      console.log(stats.map((s) => `${s.delayMs.toFixed(0)}ms/${s.reductionDb?.toFixed(1)}dB`).join(' '));
    // measured: the 400 ms, less the margin kept for the filter
    expect(last.delayMs).toBeGreaterThan(360);
    expect(last.delayMs).toBeLessThan(401);
    const erle = 10 * Math.log10(power(echo, 10, 14) / power(out, 10, 14));
    if (process.env.AEC_DEBUG) console.log('echo removed 10-14 s:', erle.toFixed(1), 'dB');
    expect(erle).toBeGreaterThan(10);
  });

  it('passes the microphone through untouched in level when the speakers are silent', () => {
    const bytes = readFileSync(new URL('../../src/media/aec.wasm', import.meta.url));
    const p = new Processor({ processorOptions: { bytes: bytes.buffer.slice(0), tail: 0.3 } });
    const near = notes(3, 0.3);
    const out = run(p, near, new Float32Array(near.length));
    const ratio = power(out, 1, 3) / power(near, 1, 3);
    expect(Math.abs(10 * Math.log10(ratio))).toBeLessThan(0.2);
  });
});
