// The metronome's sound: short woodblock-like clicks, made once per audio context (no file to load). The bar's first
// beat is higher, subdivisions softer. Scheduled at exact context times; whatever is still waiting can be cancelled.

import type { ClickKind } from './metronome-core.ts';

const SPEC: Record<ClickKind, { hz: number; gain: number }> = {
  bar: { hz: 1760, gain: 1 },
  beat: { hz: 1175, gain: 0.8 },
  sub: { hz: 880, gain: 0.42 },
};

export class ClickVoice {
  private buffers: Record<ClickKind, AudioBuffer>;
  readonly out: GainNode;
  private waiting: { src: AudioBufferSourceNode; at: number }[] = [];

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.buffers = { bar: make(ctx, 'bar'), beat: make(ctx, 'beat'), sub: make(ctx, 'sub') };
  }

  /** A click heard at context time `t`. */
  play(kind: ClickKind, t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[kind];
    src.connect(this.out);
    src.start(Math.max(this.ctx.currentTime, t));
    const item = { src, at: t };
    this.waiting.push(item);
    src.onended = () => {
      const i = this.waiting.indexOf(item);
      if (i >= 0) this.waiting.splice(i, 1);
    };
  }

  /** Cancel the clicks not yet sounding. */
  cancel(): void {
    const now = this.ctx.currentTime;
    for (const w of this.waiting.splice(0)) {
      if (w.at > now) {
        try {
          w.src.stop();
        } catch {
          // already
        }
      }
    }
  }

  setVolume(gain: number): void {
    this.out.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  dispose(): void {
    this.cancel();
    this.out.disconnect();
  }
}

/** A click: a pitched ping with a short noise transient, decaying in ~40 ms. */
function make(ctx: BaseAudioContext, kind: ClickKind): AudioBuffer {
  const { hz, gain } = SPEC[kind];
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 0.06);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let seed = kind === 'bar' ? 7 : kind === 'beat' ? 11 : 13;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const body =
      Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / 0.012) +
      0.35 * Math.sin(4 * Math.PI * hz * t) * Math.exp(-t / 0.006);
    const tick = rand() * Math.exp(-t / 0.0015) * 0.5;
    // a 1 ms fade in: no click from the click
    const fade = Math.min(1, t / 0.001);
    d[i] = (body + tick) * gain * 0.55 * fade;
  }
  return buf;
}
