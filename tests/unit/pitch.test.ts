import { describe, expect, it } from 'vitest';
import { detectPitch, nearestNote } from '../../src/media/pitch.ts';

const rate = 48000;
/** A tone with harmonics (like an instrument), `n` samples. */
function tone(hz: number, n = 2048, harmonics = [1, 0.6, 0.4, 0.25]): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((g, k) => (v += g * Math.sin((2 * Math.PI * hz * (k + 1) * i) / rate)));
    out[i] = v * 0.3;
  }
  return out;
}

describe('pitch detection', () => {
  for (const hz of [82.41, 110, 196, 261.63, 440, 880, 1318.5]) {
    it(`finds ${hz} Hz within a cent, harmonics and all`, () => {
      const n = hz < 100 ? 4096 : 2048;
      const p = detectPitch(tone(hz, n), rate)!;
      expect(p).not.toBeNull();
      expect(Math.abs(1200 * Math.log2(p.hz / hz))).toBeLessThan(1);
      expect(p.clarity).toBeGreaterThan(0.85);
    });
  }

  it('does not jump an octave down on a strong second harmonic', () => {
    const p = detectPitch(tone(220, 2048, [0.5, 1, 0.3]), rate)!;
    expect(Math.abs(p.hz - 220)).toBeLessThan(1);
  });

  it('says nothing about silence or noise', () => {
    expect(detectPitch(new Float32Array(2048), rate)).toBeNull();
    let s = 1;
    const noise = Float32Array.from({ length: 2048 }, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
    expect(detectPitch(noise, rate)).toBeNull();
  });
});

describe('nearest note', () => {
  it('names the note and the cents', () => {
    expect(nearestNote(440)).toEqual({ midi: 69, cents: 0 });
    expect(nearestNote(445)).toEqual({ midi: 69, cents: 19.6 });
    expect(nearestNote(261.63).midi).toBe(60);
    expect(nearestNote(442, 442)).toEqual({ midi: 69, cents: 0 });
  });
});
