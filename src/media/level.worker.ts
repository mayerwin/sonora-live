// The automatic level (src/media/level-core.ts) on the microphone's own frames, in a worker: frames come from a
// MediaStreamTrackProcessor and go to a MediaStreamTrackGenerator as they are captured (10 ms each), with no
// audio context in between, so nothing waits for a sound card's buffers (an audio context adds 10 to 40 ms).

import { Leveler } from './level-core.ts';

declare class AudioData {
  constructor(init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: BufferSource;
  });
  readonly format: string;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly timestamp: number;
  copyTo(dest: BufferSource, opts: { planeIndex: number; format?: string }): void;
  close(): void;
}

interface Start {
  readable: ReadableStream<AudioData>;
  writable: WritableStream<AudioData>;
}

let lev: Leveler | null = null;
let lastReport = 0;
let far = false;

self.onmessage = (e: MessageEvent<Start | { far: boolean }>) => {
  if ('far' in e.data) {
    far = e.data.far;
    if (lev) lev.far = far;
    return;
  }
  if (!('readable' in e.data)) return;
  const { readable, writable } = e.data;
  const t = new TransformStream<AudioData, AudioData>({
    transform(frame, out) {
      const n = frame.numberOfFrames;
      const c = frame.numberOfChannels;
      if (!lev) {
        lev = new Leveler(frame.sampleRate);
        lev.far = far;
      }
      const planes: Float32Array[] = [];
      for (let k = 0; k < c; k++) {
        const p = new Float32Array(n);
        frame.copyTo(p, { planeIndex: k, format: 'f32-planar' });
        planes.push(p);
      }
      lev.process(planes);
      const data = new Float32Array(n * c);
      planes.forEach((p, k) => data.set(p, k * n));
      const next = new AudioData({
        format: 'f32-planar',
        sampleRate: frame.sampleRate,
        numberOfFrames: n,
        numberOfChannels: c,
        timestamp: frame.timestamp,
        data,
      });
      frame.close();
      out.enqueue(next);
      const now = performance.now();
      if (now - lastReport > 1000) {
        lastReport = now;
        (self as unknown as Worker).postMessage({ gainDb: 20 * Math.log10(lev.gain) });
      }
    },
  });
  readable
    .pipeThrough(t)
    .pipeTo(writable)
    .catch(() => {
      // the track ended
    });
};

export {};
