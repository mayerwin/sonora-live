// The echo canceller (src/media/aec.wasm, SpeexDSP MDF): removes the echo of what the speakers play, and leaves
// what is played here untouched. Synthetic signals; tools/aec-eval.mjs measures it on real piano recordings.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SR = 48_000;
const FRAME = 128;
const wasm = readFileSync(new URL('../../src/media/aec.wasm', import.meta.url));

function canceller(tail = 0.25) {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
    env: { cos: Math.cos, sin: Math.sin, exp: Math.exp },
  });
  const e = inst.exports as unknown as {
    memory: WebAssembly.Memory;
    aec_init(frame: number, tail: number, mics: number, rate: number): number;
    aec_mic(): number;
    aec_ref(): number;
    aec_out(): number;
    aec_process(): void;
  };
  expect(e.aec_init(FRAME, Math.round(tail * SR), 1, SR)).toBe(1);
  return (mic: Float32Array, ref: Float32Array) => {
    const out = new Float32Array(mic.length);
    for (let at = 0; at + FRAME <= mic.length; at += FRAME) {
      const m = new Float32Array(e.memory.buffer);
      m.set(mic.subarray(at, at + FRAME), e.aec_mic() / 4);
      m.set(ref.subarray(at, at + FRAME), e.aec_ref() / 4);
      e.aec_process();
      out.set(new Float32Array(e.memory.buffer).subarray(e.aec_out() / 4, e.aec_out() / 4 + FRAME), at);
    }
    return out;
  };
}

let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
const power = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += x[i] * x[i];
  return s + 1e-20;
};
const db = (x: number) => 10 * Math.log10(x);

/** SpeexDSP's DC filter on the microphone (third_party/speexdsp/mdf.c, filter_dc_notch16). */
function dcNotch(x: Float32Array, r = 0.9987): Float32Array {
  const den2 = r * r + 0.7 * (1 - r) * (1 - r);
  let m0 = 0;
  let m1 = 0;
  return x.map((vin) => {
    const vout = m0 + vin;
    m0 = m1 + 2 * (-vin + r * vout);
    m1 = vin - den2 * vout;
    return r * vout;
  });
}

/** A piano-like tone: harmonics with a decay. */
function tones(seconds: number, gain: number): Float32Array {
  const x = new Float32Array(seconds * SR);
  for (let t = 0; t < seconds - 0.5; t += 0.25) {
    const f = 110 * 2 ** (Math.floor(Math.abs(rnd()) * 36) / 12);
    const at = Math.round(t * SR);
    for (let i = 0; i < SR && at + i < x.length; i++)
      for (let h = 1; h <= 6; h++)
        x[at + i] += ((gain / h) * Math.sin((2 * Math.PI * f * h * i) / SR) * Math.exp((-3 * i) / SR)) / 2;
  }
  return x;
}

describe('echo canceller', () => {
  it('removes the echo of what the speakers play (delay, reflections)', () => {
    const far = tones(12, 0.3);
    const echo = new Float32Array(far.length);
    const delay = Math.round(0.04 * SR);
    const taps = [0.5, -0.2, 0.12, 0.08, -0.05];
    for (let i = 0; i < far.length; i++)
      taps.forEach((g, k) => {
        const j = i - delay - k * 97;
        if (j >= 0) echo[i] += g * far[j];
      });
    const out = canceller()(echo, far);
    // after a few seconds of learning, the echo is down by more than 15 dB (tonal sounds: it learns each frequency
    // once played; it keeps improving over a lesson)
    expect(db(power(echo, 8, 12) / power(out, 8, 12))).toBeGreaterThan(15);
  });

  it('leaves what is played here untouched (nothing playing from the speakers)', () => {
    const near = tones(4, 0.4);
    const out = canceller()(near, new Float32Array(near.length));
    // compared with the input through the same DC filter (around 10 Hz; it shifts the phase of the lowest notes)
    const ref = dcNotch(near);
    let err = 0;
    for (let i = SR; i < 3 * SR; i++) err += (out[i] - ref[i]) ** 2;
    expect(db(power(near, 1, 3) / err)).toBeGreaterThan(40);
  });

  it('keeps the near-end piano while the others play too (no ducking)', () => {
    const far = tones(12, 0.3);
    const near = tones(12, 0.3);
    for (let i = 0; i < 6 * SR; i++) near[i] = 0; // joins at 6 s
    const echo = new Float32Array(far.length);
    for (let i = 2000; i < far.length; i++) echo[i] = 0.5 * far[i - 2000];
    const mic = echo.map((v, i) => v + near[i]);
    const out = canceller()(mic, far);
    // the near end's level is kept (a suppressor would pull it down while the others play)
    expect(Math.abs(db(power(out, 8, 12) / power(near, 8, 12)))).toBeLessThan(1);
  });
});
