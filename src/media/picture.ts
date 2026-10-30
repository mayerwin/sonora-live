// Is the camera really showing something? A laptop camera behind a closed privacy shutter, or switched off by a
// key, still "works" for the browser: it sends black frames, or none at all. People then think the app is broken.
// Windows, when the camera is blocked (privacy settings, a camera key, another app), sends a picture of its own
// instead: a camera with a red cross, moving frames of a still image. A few tiny samples a second tell:
// 'dark' (black picture), 'frozen' (the same picture over and over: a real camera always has some noise) or
// 'none' (no frames), so the preview can say why.

import { signal } from '@preact/signals';

export type Picture = 'ok' | 'dark' | 'frozen' | 'none' | 'unknown';

const W = 32;
const H = 18;
/** the centre patch compared from one sample to the next, at the camera's own resolution */
const PATCH = 48;

export class PictureWatch {
  readonly state = signal<Picture>('unknown');
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dark = 0;
  private still = 0;
  private stale = 0;
  private prev: Uint8ClampedArray | null = null;
  private lastTime = -1;

  watch(track: MediaStreamTrack | null): void {
    this.stop();
    if (!track || typeof document === 'undefined') return;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([track]);
    void v.play().catch(() => {});
    this.video = v;
    const canvas = document.createElement('canvas');
    canvas.width = PATCH;
    canvas.height = PATCH;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    this.timer = setInterval(() => {
      if (!g || track.readyState === 'ended') return;
      // no new frame for a while: nothing comes from the camera
      if (!v.videoWidth || v.currentTime === this.lastTime || track.muted) this.stale++;
      else this.stale = 0;
      this.lastTime = v.currentTime;
      if (v.videoWidth && !document.hidden) {
        g.drawImage(v, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        this.dark = sum / (W * H) < 8 ? this.dark + 1 : 0;
        // stillness from a patch at full resolution: shrinking the picture would average away a real
        // camera's noise, while Windows' substitute picture is the same down to the pixel
        const cw = Math.min(PATCH, v.videoWidth);
        const ch = Math.min(PATCH, v.videoHeight);
        g.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, cw, ch);
        const p = g.getImageData(0, 0, cw, ch).data;
        if (this.prev && this.prev.length === p.length) {
          let diff = 0;
          for (let i = 0; i < p.length; i += 4) diff += Math.abs(p[i + 1] - this.prev[i + 1]);
          this.still = diff / (p.length / 4) < 0.08 ? this.still + 1 : 0;
        }
        this.prev = Uint8ClampedArray.from(p);
      }
      const next: Picture =
        this.stale >= 4
          ? 'none'
          : this.dark >= 3
            ? 'dark'
            : this.still >= 5
              ? 'frozen'
              : v.videoWidth
                ? 'ok'
                : 'unknown';
      if (next !== this.state.peek()) this.state.value = next;
    }, 700);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.dark = 0;
    this.still = 0;
    this.stale = 0;
    this.prev = null;
    this.lastTime = -1;
    this.state.value = 'unknown';
  }
}
