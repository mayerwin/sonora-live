// Is the camera really showing something? A laptop camera behind a closed privacy shutter, or switched off by a
// key, still "works" for the browser: it sends black frames, or none at all. People then think the app is broken.
// A few tiny samples a second tell: 'dark' (black picture) or 'none' (no frames), so the preview can say why.

import { signal } from '@preact/signals';

export type Picture = 'ok' | 'dark' | 'none' | 'unknown';

const W = 32;
const H = 18;

export class PictureWatch {
  readonly state = signal<Picture>('unknown');
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dark = 0;
  private stale = 0;
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
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    this.timer = setInterval(() => {
      if (!g || track.readyState === 'ended') return;
      // no new frame for a while: nothing comes from the camera
      if (!v.videoWidth || v.currentTime === this.lastTime || track.muted) this.stale++;
      else this.stale = 0;
      this.lastTime = v.currentTime;
      if (v.videoWidth) {
        g.drawImage(v, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        const luma = sum / (W * H);
        this.dark = luma < 8 ? this.dark + 1 : 0;
      }
      const next: Picture = this.stale >= 4 ? 'none' : this.dark >= 3 ? 'dark' : v.videoWidth ? 'ok' : 'unknown';
      if (next !== this.state.peek()) this.state.value = next;
    }, 700);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.dark = 0;
    this.stale = 0;
    this.lastTime = -1;
    this.state.value = 'unknown';
  }
}
