import { describe, expect, it } from 'vitest';
import { layout } from '../../src/media/compositor.ts';
import { extensionOf, fileName } from '../../src/app/recorder.ts';

const inside = (r: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.01 && r.y + r.h <= h + 0.01 && r.w > 0 && r.h > 0;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('recording layout', () => {
  it('fits everyone in the frame without overlap, from one to nine people', () => {
    for (let n = 1; n <= 9; n++) {
      const rects = layout(n, -1, 1280, 720);
      expect(rects).toHaveLength(n);
      for (const r of rects) expect(inside(r, 1280, 720)).toBe(true);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rects[i], rects[j])).toBe(false);
    }
  });

  it('a shared screen large, the cameras in a column beside it', () => {
    const rects = layout(4, 1, 1920, 1080);
    expect(rects[1].w).toBeGreaterThan(1300);
    for (const i of [0, 2, 3]) {
      expect(rects[i].x).toBeGreaterThan(rects[1].x + rects[1].w);
      expect(inside(rects[i], 1920, 1080)).toBe(true);
    }
  });

  it('a short last row is centred', () => {
    const rects = layout(3, -1, 1280, 720);
    const last = rects[2];
    expect(Math.abs(last.x + last.w / 2 - 640)).toBeLessThan(1);
  });
});

describe('recording files', () => {
  it('are named by date, and by person for a voice', () => {
    const started = new Date(2026, 10, 13, 18, 5).getTime();
    expect(fileName({ id: 'a', started, mime: 'video/mp4;codecs=avc1', kind: 'lesson', done: true })).toBe(
      'Lesson 2026-11-13 18.05.mp4',
    );
    expect(
      fileName({ id: 'b', started, mime: 'audio/webm;codecs=opus', kind: 'voice', name: 'Clara/Leo', done: true }),
    ).toBe('Lesson 2026-11-13 18.05 - ClaraLeo.webm');
    expect(extensionOf('audio/mp4')).toBe('m4a');
    expect(extensionOf('video/webm;codecs=vp9,opus')).toBe('webm');
  });
});
