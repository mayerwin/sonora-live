// Input level meter for the microphone. In pure mode nothing adjusts the gain, so the meter also warns when the
// input clips (a forte chord too loud for the microphone setting) or stays very quiet.

import { signal } from '@preact/signals';

let ctx: AudioContext | null = null;

/** One shared context for analysis (never used for playback, so its latency does not matter). */
export function meterContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function resumeMeters(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

export class Meter {
  /** 0..1, perceptual (from -60 dBFS to 0 dBFS) */
  readonly level = signal(0);
  /** recently clipped (peaks at full scale) */
  readonly clipping = signal(false);
  private src: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private raf = 0;
  private clipAt = 0;
  private track: MediaStreamTrack | null = null;

  attach(track: MediaStreamTrack | null): void {
    if (track === this.track) return;
    this.detach();
    this.track = track;
    if (!track) return;
    const c = meterContext();
    if (!c) return;
    try {
      this.src = c.createMediaStreamSource(new MediaStream([track]));
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 1024;
      this.src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.loop();
    } catch {
      this.detach();
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.analyser || !this.buf || document.hidden) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = this.buf[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const lvl = Math.max(0, Math.min(1, (db + 60) / 60));
    // smooth the fall, not the rise
    const prev = this.level.peek();
    this.level.value = lvl > prev ? lvl : prev * 0.85 + lvl * 0.15;
    const now = performance.now();
    if (peak >= 0.985) this.clipAt = now;
    const clipping = now - this.clipAt < 1500;
    if (clipping !== this.clipping.peek()) this.clipping.value = clipping;
  };

  detach(): void {
    cancelAnimationFrame(this.raf);
    try {
      this.src?.disconnect();
    } catch {
      // ignore
    }
    this.src = null;
    this.analyser = null;
    this.buf = null;
    this.track = null;
    this.level.value = 0;
    this.clipping.value = false;
  }
}
