// The echo canceller on the audio thread: src/media/aec.wasm (SpeexDSP MDF, third_party/speexdsp) on each block.
//
// Input 0: the microphone (1 or 2 channels). Input 1: what the speakers play (the reference, mono). Output: the
// microphone without the echo of the speakers. Blocks of 128 samples, the audio thread's own: no added delay.
//
// The reference is delayed first: the echo reaches the microphone after the output and input latencies, and the
// filter's length is better spent on the room than on that wait. The delay is measured here, not taken from the
// latencies browsers report (they can be off, and a reference later than its echo cannot be cancelled at all): the
// onsets in what the speakers play are matched with the onsets the microphone hears (block energies, cross-
// correlated over the last second), the way WebRTC's own echo canceller finds it. Until then: no delay, which the
// filter's length covers.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;
declare const sampleRate: number;

interface Exports {
  memory: WebAssembly.Memory;
  aec_init(frame: number, tail: number, mics: number, rate: number): number;
  aec_mic(): number;
  aec_ref(): number;
  aec_out(): number;
  aec_process(): void;
  aec_reset(): void;
}

const FRAME = 128;
const MAX_DELAY = 48_000; // 1 s
/** delay search: block energy history and the lags tried (blocks of 128 samples, 2.7 ms at 48 kHz) */
const HIST = 640;
const WINDOW = 375;
const MAX_LAG = 240;
/** keep this much of the measured delay for the filter (the direct sound must not fall before it) */
const MARGIN = 8;

class AecProcessor extends AudioWorkletProcessor {
  private e: Exports | null = null;
  private mics = 0;
  private readonly tail: number;
  private readonly wasm: WebAssembly.Module | null;
  // reference delay line
  private ring = new Float32Array(MAX_DELAY + FRAME);
  private w = 0;
  private delay = 0;
  // statistics, sent every second: microphone and output power while the speakers play
  private micPow = 0;
  private outPow = 0;
  private refPow = 0;
  private blocks = 0;
  private active = 0;
  private failed = false;
  // delay search
  private eRef = new Float32Array(HIST);
  private eMic = new Float32Array(HIST);
  private h = 0;
  private filled = 0;
  private sinceSearch = 0;
  private lastLag = -1;
  private agree = 0;
  private found = false;
  private alive = true;
  private readonly search$: boolean;

  constructor(options: { processorOptions?: unknown }) {
    super(options);
    const o = (options.processorOptions ?? {}) as {
      module?: WebAssembly.Module;
      bytes?: ArrayBuffer;
      tail?: number;
      search?: boolean;
    };
    this.search$ = o.search !== false;
    this.tail = Math.round((o.tail ?? 0.3) * sampleRate);
    this.delay = 0;
    let mod: WebAssembly.Module | null = null;
    try {
      // compiled on the main thread when handed over (compiling here would stall the audio thread)
      mod = o.module instanceof WebAssembly.Module ? o.module : o.bytes ? new WebAssembly.Module(o.bytes) : null;
    } catch {
      mod = null;
    }
    this.wasm = mod;
    this.port.onmessage = (ev: MessageEvent<{ reset?: boolean; stop?: boolean }>) => {
      if (ev.data?.reset) this.e?.aec_reset();
      if (ev.data?.stop) this.alive = false;
    };
  }

  private start(mics: number): boolean {
    if (!this.wasm || this.failed) return false;
    try {
      const inst = new WebAssembly.Instance(this.wasm, { env: { cos: Math.cos, sin: Math.sin, exp: Math.exp } });
      this.e = inst.exports as unknown as Exports;
      if (!this.e.aec_init(FRAME, this.tail, mics, sampleRate)) throw new Error('init');
      this.mics = mics;
      return true;
    } catch (err) {
      this.failed = true;
      this.e = null;
      this.port.postMessage({ failed: String(err) });
      return false;
    }
  }

  /** Block energies, and from time to time a new delay estimate. */
  private track(ref: number, mic: number): void {
    this.eRef[this.h] = Math.log(ref + 1e-9);
    this.eMic[this.h] = Math.log(mic + 1e-9);
    this.h = (this.h + 1) % HIST;
    if (this.filled < HIST) this.filled++;
    // one search a second: each over its own second of sound (overlapping ones would agree with each other)
    if (!this.search$ || ++this.sinceSearch < WINDOW || this.filled < HIST) return;
    this.sinceSearch = 0;
    const lag = this.search();
    if (lag < 0) return;
    // searches in a row that agree (within a few blocks): two for the first estimate, three to change one in use
    // (each change costs what the filter learned)
    if (this.lastLag >= 0 && Math.abs(lag - this.lastLag) <= 2) this.agree++;
    else this.agree = 0;
    this.lastLag = lag;
    if (this.agree < (this.found ? 2 : 1)) return;
    this.found = true;
    const delay = Math.max(0, lag - MARGIN) * FRAME;
    // only a big change: a delay well inside the filter's length costs little, and each change costs what the
    // filter learned (seconds of echo while it learns again)
    if (Math.abs(delay - this.delay) > 45 * FRAME) {
      this.delay = delay;
      // a different alignment: what was learned is shifted; learn again
      this.e?.aec_reset();
    }
  }

  /** The lag (blocks) at which the microphone's onsets best follow the speakers', or -1 when unsure. */
  private search(): number {
    // onsets: rises in log energy (falls and steady parts say little about timing)
    const at = (k: number) => (this.h - 1 - k + 2 * HIST) % HIST;
    const onset = (e: Float32Array, k: number) => Math.max(0, e[at(k)] - e[at(k + 1)]);
    const mic = new Float32Array(WINDOW);
    const ref = new Float32Array(WINDOW + MAX_LAG);
    let active = 0;
    for (let k = 0; k < WINDOW; k++) mic[k] = onset(this.eMic, k);
    for (let k = 0; k < WINDOW + MAX_LAG && k + 1 < HIST; k++) {
      ref[k] = onset(this.eRef, k);
      if (this.eRef[at(k)] > Math.log(FRAME * 1e-6)) active++;
    }
    if (active < WINDOW / 4) return -1; // the speakers hardly played
    let best = -1;
    let bestC = 0;
    let sum = 0;
    let sum2 = 0;
    for (let lag = 0; lag < MAX_LAG; lag++) {
      let c = 0;
      for (let k = 0; k < WINDOW; k++) c += mic[k] * ref[k + lag];
      sum += c;
      sum2 += c * c;
      if (c > bestC) [bestC, best] = [c, lag];
    }
    const mean = sum / MAX_LAG;
    const sd = Math.sqrt(Math.max(0, sum2 / MAX_LAG - mean * mean));
    // a clear peak only
    return best >= 0 && bestC > mean + 4 * sd ? best : -1;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // dropped: let the browser release this node (and its WebAssembly memory)
    if (!this.alive) return false;
    const mic = inputs[0] ?? [];
    const ref = inputs[1]?.[0];
    const out = outputs[0] ?? [];
    const n = out[0]?.length ?? 0;
    const mics = Math.min(2, Math.max(1, mic.length));
    // pass through when there is nothing to do or it cannot run
    if (!mic.length || n !== FRAME || (this.mics !== mics && !this.start(mics)) || !this.e) {
      for (let c = 0; c < out.length; c++) {
        const src = mic[c] ?? mic[0];
        if (src) out[c].set(src);
        else out[c].fill(0);
      }
      return true;
    }
    const e = this.e;
    // the reference, delayed
    const ring = this.ring;
    const size = ring.length;
    let rawRef = 0;
    let rawMic = 0;
    const m0 = mic[0];
    for (let i = 0; i < FRAME; i++) {
      const v = ref ? ref[i] : 0;
      ring[(this.w + i) % size] = v;
      rawRef += v * v;
      rawMic += m0[i] * m0[i];
    }
    this.track(rawRef, rawMic);
    let r = (this.w - this.delay + size) % size;
    this.w = (this.w + FRAME) % size;

    const heap = new Float32Array(e.memory.buffer);
    const pm = e.aec_mic() >> 2;
    const pr = e.aec_ref() >> 2;
    const po = e.aec_out() >> 2;
    let rp = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = ring[r];
      heap[pr + i] = v;
      rp += v * v;
      if (++r === size) r = 0;
    }
    for (let c = 0; c < mics; c++) heap.set(mic[c] ?? mic[0], pm + c * FRAME);
    e.aec_process();
    let mp = 0;
    let op = 0;
    for (let c = 0; c < out.length; c++) {
      const k = Math.min(c, mics - 1);
      const o = heap.subarray(po + k * FRAME, po + (k + 1) * FRAME);
      out[c].set(o);
      if (c === 0) {
        const m = mic[0];
        for (let i = 0; i < FRAME; i++) {
          mp += m[i] * m[i];
          op += o[i] * o[i];
        }
      }
    }
    // the speakers are playing: count it for the echo statistics
    if (rp > FRAME * 1e-6) {
      this.micPow += mp;
      this.outPow += op;
      this.refPow += rp;
      this.active++;
    }
    if (++this.blocks >= sampleRate / FRAME) {
      this.port.postMessage({
        // how much quieter the microphone is after cancelling, while the speakers play (echo + what is played here)
        reductionDb: this.active > 10 ? 10 * Math.log10((this.micPow + 1e-12) / (this.outPow + 1e-12)) : null,
        playing: this.active / this.blocks,
        delayMs: (this.delay / sampleRate) * 1000,
      });
      this.blocks = this.active = 0;
      this.micPow = this.outPow = this.refPow = 0;
    }
    return true;
  }
}

registerProcessor('sonora-aec', AecProcessor);

export {}; // a module (the audio worklet loads it as one)
