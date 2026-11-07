// The audio worklet around src/media/denoise-core.ts: one denoiser per channel, on the audio thread.

import { ChannelDenoiser } from './denoise-core.ts';

// the AudioWorkletGlobalScope (not in TypeScript's DOM library)
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class DenoiseProcessor extends AudioWorkletProcessor {
  private channels: ChannelDenoiser[] = [];
  private amount = 1;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ amount?: number; stop?: boolean }>) => {
      if (e.data?.stop) this.alive = false;
      if (typeof e.data?.amount === 'number') {
        this.amount = e.data.amount;
        for (const c of this.channels) c.amount = this.amount;
      }
    };
  }

  private alive = true;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false;
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0];
      if (!src) {
        output[c].fill(0);
        continue;
      }
      let d = this.channels[c];
      if (!d) {
        d = this.channels[c] = new ChannelDenoiser();
        d.amount = this.amount;
      }
      d.process(src, output[c]);
    }
    return true;
  }
}

registerProcessor('sonora-denoise', DenoiseProcessor);
