// Sound lab analysis (src/lab/analyze.ts): echo removed, levels, near end kept while the speakers play.

import { describe, expect, it } from 'vitest';
import { analyze, SR, wav } from '../../src/lab/analyze.ts';

const sine = (f: number, a: number, s: number, from = 0, to = s) =>
  Float32Array.from({ length: s * SR }, (_, i) =>
    i >= from * SR && i < to * SR ? a * Math.sin((2 * Math.PI * f * i) / SR) : 0,
  );
const add = (...xs: Float32Array[]) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const scale = (x: Float32Array, g: number) => x.map((v) => v * g);

describe('sound lab analysis', () => {
  // 0-2 s quiet, 2-6 s the speakers (echo), 6-9 s the near end alone, 9-13 s both
  const seg = {
    noise: [0, 2] as [number, number],
    echoPiano: [2, 4] as [number, number],
    echoVoice: [4, 6] as [number, number],
    near: [6, 9] as [number, number],
    both: [9, 13] as [number, number],
  };
  const echo = add(sine(440, 0.2, 13, 2, 6), sine(440, 0.2, 13, 9, 13));
  const near = add(sine(220, 0.1, 13, 6, 9), sine(220, 0.1, 13, 9, 13));
  const raw = add(echo, near);

  it('reports echo removed and near end kept: a canceller that only removes echo', () => {
    const perfect = add(scale(echo, 0.1), near); // 20 dB of echo removed, the near end untouched
    const r = analyze(raw, { perfect }, seg);
    expect(r.echoRemovedPiano.perfect).toBeCloseTo(20, 0);
    expect(r.echoRemovedPiano.raw).toBe(0);
    expect(Math.abs(r.nearKeptWhileOthersPlay!.perfect)).toBeLessThan(0.5);
  });

  it('sees a canceller that ducks the near end while the others play', () => {
    // the near end pulled down by 10 dB while both play
    const ducking = add(scale(echo, 0.1), sine(220, 0.1, 13, 6, 9), sine(220, 0.1 / 3.16, 13, 9, 13));
    const r = analyze(raw, { ducking }, seg);
    expect(r.nearKeptWhileOthersPlay!.ducking).toBeLessThan(-8);
  });

  it('measures levels', () => {
    const r = analyze(raw, {}, seg);
    expect(r.nearPeak!.raw).toBeCloseTo(-20, 0);
  });

  it('writes a WAV file', async () => {
    const b = wav([new Float32Array(480), new Float32Array(480)]);
    expect(b.size).toBe(44 + 480 * 2 * 2);
  });
});
