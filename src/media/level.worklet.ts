// The automatic level (src/media/level-core.ts) on the audio thread, for the microphone as sent.

import { Leveler } from './level-core.ts';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

class LevelProcessor extends AudioWorkletProcessor {
  private lev = new Leveler(sampleRate);
  private blocks = 0;
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ far?: boolean; stop?: boolean }>) => {
      if (typeof e.data?.far === 'boolean') this.lev.far = e.data.far;
      if (e.data?.stop) this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false;
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!input.length) {
      for (const o of output) o.fill(0);
      return true;
    }
    for (let c = 0; c < output.length; c++) output[c].set(input[c] ?? input[0]);
    this.lev.process(output);
    if (++this.blocks >= sampleRate / 128) {
      this.blocks = 0;
      this.port.postMessage({ gainDb: 20 * Math.log10(this.lev.gain) });
    }
    return true;
  }
}

registerProcessor('sonora-level', LevelProcessor);
