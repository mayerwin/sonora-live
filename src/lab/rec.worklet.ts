// Sound lab recorder: N mono inputs recorded on the same clock (the same moments, sample for sample), sent to
// the page in chunks.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;

const CHUNK = 32; // blocks of 128 samples

class RecProcessor extends AudioWorkletProcessor {
  private bufs: Float32Array[] = [];
  private at = 0;
  private on = true;

  constructor(options: { processorOptions?: unknown }) {
    super(options);
    this.port.onmessage = (e: MessageEvent<{ stop?: boolean }>) => {
      if (e.data?.stop) this.on = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    if (!this.bufs.length) this.bufs = inputs.map(() => new Float32Array(CHUNK * 128));
    for (let k = 0; k < inputs.length; k++) {
      const src = inputs[k]?.[0];
      if (src) this.bufs[k].set(src, this.at);
      else this.bufs[k].fill(0, this.at, this.at + 128);
    }
    this.at += 128;
    if (this.at >= CHUNK * 128) {
      this.port.postMessage(
        this.bufs,
        this.bufs.map((b) => b.buffer),
      );
      this.bufs = inputs.map(() => new Float32Array(CHUNK * 128));
      this.at = 0;
    }
    return true;
  }
}

registerProcessor('sonora-rec', RecProcessor);

export {};
