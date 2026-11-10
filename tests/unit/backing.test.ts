import { describe, expect, it } from 'vitest';
import {
  cleanLoop,
  clockOf,
  correction,
  localTarget,
  MAX_NUDGE,
  pitchLatency,
  PitchShifter,
  stepRate,
  timelinePos,
  wrap,
  type Timeline,
} from '../../src/media/backing-core.ts';

const tl = (o: Partial<Timeline> = {}): Timeline => ({
  playing: true,
  pos: 10,
  anchor: 1000,
  rate: 1,
  loop: null,
  duration: 120,
  ...o,
});

describe('backing track timeline', () => {
  it('advances with time and speed', () => {
    expect(timelinePos(tl(), 3000)).toBeCloseTo(12);
    expect(timelinePos(tl({ rate: 0.5 }), 3000)).toBeCloseTo(11);
    expect(timelinePos(tl({ playing: false }), 3000)).toBe(10);
  });

  it('plays behind the reference by the delay', () => {
    const t = localTarget(tl(), 3000, 250);
    expect(t.pos).toBeCloseTo(11.75);
    expect(t.wait).toBe(0);
  });

  it('waits for a lead-in, and for the delay at the start', () => {
    expect(localTarget(tl({ anchor: 1150 }), 1000, 0)).toEqual({ pos: 10, wait: 150, ended: false });
    expect(localTarget(tl(), 1000, 120)).toEqual({ pos: 10, wait: 120, ended: false });
  });

  it('repeats the loop, and ends without one', () => {
    const loop = { a: 10, b: 14 };
    expect(localTarget(tl({ loop }), 1000 + 5000, 0).pos).toBeCloseTo(11);
    expect(wrap(13, loop)).toBe(13);
    expect(wrap(9, loop)).toBe(9);
    const end = localTarget(tl({ duration: 12 }), 1000 + 5000, 0);
    expect(end.ended).toBe(true);
    expect(end.pos).toBe(12);
  });

  it('keeps only loops that make sense', () => {
    expect(cleanLoop({ a: 20, b: 5 }, 60)).toEqual({ a: 5, b: 20 });
    expect(cleanLoop({ a: 5, b: 5.1 }, 60)).toBeNull();
    expect(cleanLoop({ a: 50, b: 90 }, 60)).toEqual({ a: 50, b: 60 });
    expect(cleanLoop({ a: NaN, b: 3 }, 60)).toBeNull();
    expect(cleanLoop(null, 60)).toBeNull();
  });

  it('jumps when far, nudges the speed when close, leaves it in time', () => {
    expect(correction(0.5, 1)).toEqual({ seek: true, rate: 1 });
    expect(correction(0.005, 1)).toEqual({ seek: false, rate: 1 });
    const behind = correction(0.05, 1);
    expect(behind.seek).toBe(false);
    expect(behind.rate).toBeGreaterThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1 + MAX_NUDGE);
    expect(correction(-0.05, 0.8).rate).toBeLessThan(0.8);
  });

  it('steps through the offered speeds', () => {
    expect(stepRate(1, 1)).toBe(1.05);
    expect(stepRate(1, -1)).toBe(0.95);
    expect(stepRate(0.5, -1)).toBe(0.5);
    expect(stepRate(1.5, 1)).toBe(1.5);
    expect(stepRate(0.97, 1)).toBe(1);
  });

  it('shows times as m:ss', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(65.9)).toBe('1:05');
    expect(clockOf(NaN)).toBe('0:00');
  });
});

describe('pitch shifter', () => {
  const sr = 48000;
  const sine = (f: number, n: number) =>
    Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));
  /** frequency from zero crossings */
  const freq = (x: Float32Array) => {
    let c = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++;
    return (c * sr) / x.length;
  };

  it('keeps the sound unchanged at ratio 1 (delayed only)', () => {
    const p = new PitchShifter(sr);
    const out = new Float32Array(sr);
    p.process(sine(440, sr), out);
    expect(freq(out.subarray(sr / 2))).toBeCloseTo(440, -1);
  });

  it('moves the pitch by the ratio, keeping the level', () => {
    const p = new PitchShifter(sr);
    p.ratio = 2 ** (7 / 12);
    const out = new Float32Array(sr);
    p.process(sine(440, sr), out);
    const tail = out.subarray(sr / 2);
    expect(Math.abs(freq(tail) - 440 * 2 ** (7 / 12))).toBeLessThan(15);
    const rms = Math.sqrt(tail.reduce((a, v) => a + v * v, 0) / tail.length);
    expect(rms).toBeGreaterThan(0.5);
    expect(rms).toBeLessThan(0.9);
  });

  it('adds about 30 ms', () => {
    expect(pitchLatency(sr)).toBeCloseTo(0.03, 3);
  });
});
