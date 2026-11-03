import { describe, expect, it } from 'vitest';
import { LatencyGuard, MIN_VIDEO_BPS, QUEUE_MS } from '../../src/net/guard.ts';

const WANT = 2_000_000;

describe('latency guard', () => {
  it('leaves the video alone while the round trip stays near its usual value', () => {
    const g = new LatencyGuard();
    for (let t = 0; t < 60_000; t += 1000) g.sample(20 + (t % 3000 === 0 ? 15 : 0), t, WANT);
    expect(g.cap).toBe(Infinity);
  });

  it('cuts the video at once when a queue builds, down to a floor', () => {
    const g = new LatencyGuard();
    for (let t = 0; t < 10_000; t += 1000) g.sample(20, t, WANT);
    expect(g.sample(20 + QUEUE_MS + 100, 10_000, WANT)).toBe(true);
    expect(g.cap).toBe(WANT / 2);
    for (let t = 11_000; t < 20_000; t += 1000) g.sample(900, t, WANT);
    expect(g.cap).toBe(MIN_VIDEO_BPS);
  });

  it('gives the video its room back gently once the queue is gone', () => {
    const g = new LatencyGuard();
    for (let t = 0; t < 5000; t += 1000) g.sample(20, t, WANT);
    for (let t = 5000; t < 9000; t += 1000) g.sample(500, t, WANT);
    const low = g.cap;
    let t = 9000;
    const steps: number[] = [];
    while (g.cap !== Infinity && t < 200_000) {
      g.sample(22, t, WANT);
      steps.push(g.cap);
      t += 1000;
    }
    expect(g.cap).toBe(Infinity);
    // several seconds of calm between raises, never a jump back in one go
    expect(t - 9000).toBeGreaterThan(20_000);
    expect(steps.find((c) => c > low)).toBeCloseTo(low * 1.25);
  });

  it('a slow but steady path (a relay) is its own baseline, not a queue', () => {
    const g = new LatencyGuard();
    for (let t = 0; t < 60_000; t += 1000) g.sample(180 + ((t / 1000) % 5) * 6, t, WANT);
    expect(g.cap).toBe(Infinity);
  });
});

describe('latency guard timing', () => {
  it('one spike costs one halving, and recovery takes the same time whether measurements come every 1 s or 5 s', () => {
    for (const every of [1000, 5000]) {
      const g = new LatencyGuard();
      let t = 0;
      for (; t < 30_000; t += every) g.sample(20, t, WANT);
      g.sample(200, t, WANT);
      expect(g.cap).toBe(WANT / 2);
      const start = t;
      while (g.cap !== Infinity && t < start + 120_000) {
        t += every;
        g.sample(20, t, WANT);
      }
      expect(g.cap).toBe(Infinity);
      expect(t - start).toBeLessThanOrEqual(20_000);
    }
  });
});
