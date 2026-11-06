// The automatic level for music (src/media/level-core.ts): brings a quiet microphone up, slowly; keeps a crescendo;
// holds in silence; never clips.

import { describe, expect, it } from 'vitest';
import { Leveler, limit } from '../../src/media/level-core.ts';

const SR = 48_000;
const N = 128;

/** Run `seconds` of a sine at `amp` through the leveler; the output's peak over the last half second. */
function run(l: Leveler, seconds: number, amp: (t: number) => number): number {
  let peak = 0;
  const blocks = Math.round((seconds * SR) / N);
  for (let b = 0; b < blocks; b++) {
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = (b * N + i) / SR;
      ch[i] = amp(t) * Math.sin(2 * Math.PI * 220 * t);
    }
    l.process([ch]);
    if (b >= blocks - (0.5 * SR) / N) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  }
  return peak;
}

describe('automatic level', () => {
  it('brings a quiet microphone up to a good level within seconds', () => {
    const l = new Leveler(SR);
    const out = run(l, 15, () => 0.03); // about −30 dBFS
    expect(out).toBeGreaterThan(0.25);
    expect(out).toBeLessThan(0.35);
  });

  it('keeps a crescendo (the gain moves slowly)', () => {
    const l = new Leveler(SR);
    run(l, 15, () => 0.06);
    const before = l.gain;
    // a crescendo over one second: ×2.5 in amplitude (+8 dB)
    run(l, 1, (t) => 0.06 * (1 + 1.5 * t));
    // the gain hardly moved: the crescendo arrives as played
    expect(l.gain).toBeGreaterThan(before / 1.5);
  });

  it('holds its gain through silence (no pumping up of the room noise)', () => {
    const l = new Leveler(SR);
    run(l, 15, () => 0.06);
    const g = l.gain;
    run(l, 10, () => 0.0005); // −66 dBFS: nothing playing
    expect(l.gain).toBeCloseTo(g, 1);
  });

  it('never clips, even on a sudden forte', () => {
    const l = new Leveler(SR);
    run(l, 15, () => 0.03);
    const out = run(l, 2, () => 0.95);
    expect(out).toBeLessThanOrEqual(1);
    expect(limit(3)).toBeLessThanOrEqual(1);
    expect(limit(0.95)).toBeLessThan(0.95);
    expect(limit(0.5)).toBe(0.5);
  });
});
