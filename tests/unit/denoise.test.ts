import { describe, expect, it } from 'vitest';
import { ChannelDenoiser, DENOISE_DELAY, fft } from '../../src/media/denoise-core.ts';

const RATE = 48_000;

/** Feeds a signal through in 128-sample blocks, as an AudioWorklet does. */
function run(d: ChannelDenoiser, x: Float32Array): Float32Array {
  const y = new Float32Array(x.length);
  for (let i = 0; i + 128 <= x.length; i += 128) d.process(x.subarray(i, i + 128), y.subarray(i, i + 128));
  return y;
}

function noise(n: number, rms: number, seed = 1): Float32Array {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = ((s / 4294967296) * 2 - 1) * rms * Math.sqrt(3);
  }
  return out;
}

function tone(n: number, freq: number, amp: number, decay = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.exp(-decay * (i / RATE)) * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

describe('steady noise reduction', () => {
  it('has an exact FFT', () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) + i * 0.1);
    const im = new Float64Array(16);
    const orig = Float64Array.from(re);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 16; i++) expect(re[i] / 16).toBeCloseTo(orig[i], 10);
  });

  it('lowers steady hiss by more than 10 dB, within a second', () => {
    const x = noise(RATE * 8, 0.01);
    const y = run(new ChannelDenoiser(), x);
    for (const from of [1, 3, 6]) {
      expect(
        db(
          rms(y, RATE * from + DENOISE_DELAY, RATE * (from + 1)),
          rms(x, RATE * from, RATE * (from + 1) - DENOISE_DELAY),
        ),
      ).toBeLessThan(-10);
    }
  });

  it('adds 8 ms of delay at most', () => {
    expect(DENOISE_DELAY / RATE).toBeLessThanOrEqual(0.008);
  });

  it('leaves a note held for many seconds as it is', () => {
    const x = tone(RATE * 10, 440, 0.2);
    const d = new ChannelDenoiser();
    const y = run(d, x);
    const lag = DENOISE_DELAY;
    // the last seconds of a 10 s note: within 0.5 dB, the same waveform
    expect(Math.abs(db(rms(y, RATE * 8 + lag, RATE * 10), rms(x, RATE * 8, RATE * 10 - lag)))).toBeLessThan(0.5);
  });

  it('keeps a piano-like note over steady noise, and lowers the noise around it', () => {
    const n = RATE * 8;
    const hiss = noise(n, 0.005, 7);
    // the noise alone first, then notes struck every 1.5 s, decaying
    const notes = new Float32Array(n);
    for (let start = RATE * 3; start + RATE < n; start += RATE * 1.5) {
      const t = tone(RATE, 523.25, 0.3, 2.5);
      for (let i = 0; i < t.length; i++) notes[start + i] += t[i];
    }
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = notes[i] + hiss[i];
    const d = new ChannelDenoiser();
    const y = run(d, x);
    const lag = DENOISE_DELAY;
    // the struck note's first 300 ms: within 1 dB of the clean note
    const s = RATE * 6;
    let err = 0;
    let sig = 0;
    for (let i = s; i < s + RATE * 0.3; i++) {
      err += (y[i + lag] - notes[i]) ** 2;
      sig += notes[i] ** 2;
    }
    expect(10 * Math.log10(sig / err)).toBeGreaterThan(15); // the output is the note, not the note plus hiss
    expect(Math.abs(db(rms(y, s + lag, s + lag + RATE * 0.3), rms(notes, s, s + RATE * 0.3)))).toBeLessThan(1);
  });

  it('does nothing when its amount is zero, apart from the delay', () => {
    const x = noise(RATE * 2, 0.05, 3);
    const d = new ChannelDenoiser();
    d.amount = 0;
    const y = run(d, x);
    const lag = DENOISE_DELAY;
    let err = 0;
    for (let i = RATE / 2; i < RATE; i++) err = Math.max(err, Math.abs(y[i + lag] - x[i]));
    expect(err).toBeLessThan(1e-6);
  });
});
