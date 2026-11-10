// The audio worklet around the backing track's pitch shifter (src/media/backing-core.ts): one per channel.

import { PitchShifter } from './backing-core.ts';

// the AudioWorkletGlobalScope (not in TypeScript's DOM library)
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

class PitchProcessor extends AudioWorkletProcessor {
  private channels: PitchShifter[] = [];
  private ratio = 1;
  private alive = true;
  private silent = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ ratio?: number; stop?: boolean }>) => {
      if (e.data?.stop) this.alive = false;
      if (typeof e.data?.ratio === 'number' && e.data.ratio > 0) {
        this.ratio = e.data.ratio;
        for (const c of this.channels) c.ratio = this.ratio;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false;
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0];
      let s = this.channels[c];
      if (!s) {
        s = this.channels[c] = new PitchShifter(sampleRate);
        s.ratio = this.ratio;
      }
      if (!src) {
        // nothing comes in (paused): the delay line still empties
        if (this.silent.length !== output[c].length) this.silent = new Float32Array(output[c].length);
        s.process(this.silent, output[c]);
        continue;
      }
      s.process(src, output[c]);
    }
    return true;
  }
}

registerProcessor('sonora-pitch', PitchProcessor);
