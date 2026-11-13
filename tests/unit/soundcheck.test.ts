import { describe, expect, it } from 'vitest';
import { findSweep, heard, makeSweep } from '../../src/media/soundcheck-core.ts';

const rate = 48000;
let seed = 3;
const noise = (a: number) => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * a;

/** A recording: `before` s of room noise, the sweep `delay` s after its start, at `gain`, with a reflection. */
function room(delay: number, gain: number, noiseLevel = 0.002, seconds = 1.5): { rec: Float32Array; start: number } {
  const sweep = makeSweep(rate);
  const start = Math.floor(0.2 * rate);
  const rec = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < rec.length; i++) rec[i] = noise(noiseLevel);
  const d = start + Math.floor(delay * rate);
  for (let i = 0; i < sweep.length; i++) {
    if (d + i < rec.length) rec[d + i] += sweep[i] * gain;
    const r = d + Math.floor(0.011 * rate) + i;
    if (r < rec.length) rec[r] += sweep[i] * gain * 0.4;
  }
  return { rec, start };
}

describe('sound check', () => {
  it('finds the sweep from speakers and its delay, to the sample', () => {
    const { rec, start } = room(0.0634, 0.2);
    const f = findSweep(makeSweep(rate), rec, start, rate);
    expect(heard(f)).toBe(true);
    expect(Math.abs(f.lag - 0.0634)).toBeLessThan(1.5 / rate);
  });

  it('measures a long Bluetooth delay too', () => {
    const { rec, start } = room(0.231, 0.05);
    const f = findSweep(makeSweep(rate), rec, start, rate);
    expect(heard(f)).toBe(true);
    expect(Math.abs(f.lag - 0.231)).toBeLessThan(1.5 / rate);
  });

  it('hears nothing with headphones: noise alone, or a faint leak below the noise', () => {
    const quiet = room(0.05, 0, 0.01);
    expect(heard(findSweep(makeSweep(rate), quiet.rec, quiet.start, rate))).toBe(false);
    const leak = room(0.05, 0.0005, 0.02);
    expect(heard(findSweep(makeSweep(rate), leak.rec, leak.start, rate))).toBe(false);
  });

  it('still finds it under music-like noise', () => {
    const { rec, start } = room(0.08, 0.05, 0.03);
    const f = findSweep(makeSweep(rate), rec, start, rate);
    expect(heard(f)).toBe(true);
    expect(Math.abs(f.lag - 0.08)).toBeLessThan(2 / rate);
  });
});
