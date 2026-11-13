import { describe, expect, it } from 'vitest';
import {
  beatTimeline,
  clampBpm,
  clicksBetween,
  nextBarBeat,
  tapTempo,
  type MetronomeSetup,
} from '../../src/media/metronome-core.ts';

const setup = (o: Partial<MetronomeSetup> = {}): MetronomeSetup => ({ bpm: 120, beats: 4, sub: 1, accent: true, ...o });

describe('metronome clicks', () => {
  it('clicks every beat at the tempo, the first of each bar accented', () => {
    // 120 bpm: a beat every 500 ms, from beat 0 at t = 1000
    const tl = beatTimeline(true, 0, 1000, 120);
    const c = clicksBetween(tl, setup(), 1000, 3000, 0);
    expect(c.map((x) => Math.round(x.at))).toEqual([1000, 1500, 2000, 2500]);
    expect(c.map((x) => x.kind)).toEqual(['bar', 'beat', 'beat', 'beat']);
    expect(c.map((x) => x.beat)).toEqual([0, 1, 2, 3]);
    const next = clicksBetween(tl, setup(), 3000, 3600, 0);
    expect(next[0]).toMatchObject({ at: 3000, kind: 'bar', beat: 0 });
  });

  it('subdivides beats, quieter clicks between them', () => {
    const tl = beatTimeline(true, 0, 0, 60);
    const c = clicksBetween(tl, setup({ sub: 3, beats: 2 }), 0, 2000, 0);
    expect(c.map((x) => Math.round(x.at))).toEqual([0, 333, 667, 1000, 1333, 1667]);
    expect(c.map((x) => x.kind)).toEqual(['bar', 'sub', 'sub', 'beat', 'sub', 'sub']);
  });

  it('without an accent, or one beat per bar, every beat is the same', () => {
    const tl = beatTimeline(true, 0, 0, 120);
    expect(clicksBetween(tl, setup({ accent: false }), 0, 1000, 0).map((x) => x.kind)).toEqual(['beat', 'beat']);
    expect(clicksBetween(tl, setup({ beats: 1 }), 0, 1000, 0).map((x) => x.kind)).toEqual(['beat', 'beat']);
  });

  it('plays later by the delay behind the one who started it', () => {
    const tl = beatTimeline(true, 0, 1000, 120);
    const c = clicksBetween(tl, setup(), 1000, 2000, 120);
    expect(c.map((x) => Math.round(x.at))).toEqual([1120, 1620]);
  });

  it('waits for a lead-in, and never clicks twice across windows', () => {
    const tl = beatTimeline(true, 0, 1300, 120);
    expect(clicksBetween(tl, setup(), 1000, 1200, 0)).toEqual([]);
    const a = clicksBetween(tl, setup(), 1000, 1550, 0);
    const b = clicksBetween(tl, setup(), 1550, 2000, 0);
    expect([...a, ...b].map((x) => Math.round(x.at))).toEqual([1300, 1800]);
  });

  it('continues from a beat after a tempo change', () => {
    // re-anchored at beat 5 (a bar's second beat) at t = 0, now 60 bpm
    const tl = beatTimeline(true, 5, 0, 60);
    const c = clicksBetween(tl, setup(), 0, 3000, 0);
    expect(c.map((x) => [Math.round(x.at), x.beat])).toEqual([
      [0, 1],
      [1000, 2],
      [2000, 3],
    ]);
  });

  it('is silent when stopped', () => {
    expect(clicksBetween(beatTimeline(false, 0, 0, 120), setup(), 0, 5000, 0)).toEqual([]);
  });
});

describe('tempo', () => {
  it('stays in range', () => {
    expect(clampBpm(5)).toBe(20);
    expect(clampBpm(999)).toBe(300);
    expect(clampBpm(NaN)).toBe(100);
  });

  it('taps a tempo, starting over after a pause', () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 500, 1000, 5000, 5600])).toBe(100);
  });

  it('finds the next bar line', () => {
    expect(nextBarBeat(5.2, 4)).toBe(8);
    expect(nextBarBeat(8, 4)).toBe(8);
    expect(nextBarBeat(0.1, 3)).toBe(3);
  });
});
