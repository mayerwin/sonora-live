import { describe, expect, it } from 'vitest';
import { layersFor, nearestSample, sampleName, velocityGain } from '../../src/midi/piano.ts';
import { existsSync } from 'node:fs';

describe('built-in piano', () => {
  it('names samples like the sample set (middle C is C3)', () => {
    expect(sampleName('mf', 60)).toBe('mf-c3');
    expect(sampleName('pp', 23)).toBe('pp-bm1');
    expect(sampleName('ff', 61)).toBe('ff-cs3');
  });

  it('has every sample file it may ask for, in both formats', () => {
    for (const layer of ['pp', 'mp', 'mf', 'ff'] as const) {
      for (let n = 21; n <= 108; n++) {
        const { sample, dist } = nearestSample(layer, n);
        if (dist > 3) continue;
        for (const fmt of ['ogg', 'm4a']) {
          expect(existsSync(`public/piano/${fmt}/${sampleName(layer, sample)}.${fmt}`), `${layer} ${n} ${fmt}`).toBe(true);
        }
      }
    }
  });

  it('never pitches a sample by more than 2 semitones in the main layer', () => {
    for (let n = 21; n <= 108; n++) expect(nearestSample('mf', n).dist).toBeLessThanOrEqual(2);
  });

  it('crossfades layers with constant power', () => {
    for (let v = 1; v <= 127; v++) {
      const ls = layersFor(v);
      const power = ls.reduce((s, l) => s + l.gain * l.gain, 0);
      expect(power).toBeCloseTo(1, 5);
      expect(ls.length).toBeLessThanOrEqual(2);
    }
    expect(layersFor(30)).toEqual([{ layer: 'pp', gain: 1 }]);
    expect(layersFor(120)).toEqual([{ layer: 'ff', gain: 1 }]);
    expect(layersFor(84).map((l) => l.layer)).toEqual(['mp', 'mf']);
  });

  it('gets louder with velocity over about 30 dB', () => {
    let prev = 0;
    for (let v = 1; v <= 127; v++) {
      const g = velocityGain(v);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    expect(velocityGain(127)).toBeCloseTo(1, 5);
    expect(20 * Math.log10(velocityGain(1))).toBeLessThan(-28);
  });
});
