// The backing track's player: Signalsmith Stretch (MIT; a WebAssembly time-stretcher and pitch-shifter in an
// AudioWorklet, https://signalsmith-audio.co.uk/code/stretch/) plays the decoded file at any speed and in any key,
// with each change scheduled at an exact time of the audio context. This module only keeps track of what was
// scheduled, so where the track is at any moment is known exactly (no polling of the worklet).
//
// Times: the worklet's `output` time is the audio context time at which a sample leaves the node; the context's
// output timestamp says when that is heard (performance.now() of the moment), which is the clock the lesson's
// timeline is on (src/media/backing-core.ts).

import { wrap, type Loop } from './backing-core.ts';

interface StretchNode extends AudioWorkletNode {
  schedule(o: {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    loopStart?: number;
    loopEnd?: number;
  }): Promise<unknown>;
  addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  latency(): Promise<number>;
}

/** One stretch of playing at a steady speed, as scheduled. */
interface Segment {
  /** context time (s) at which `input` is heard */
  at: number;
  input: number;
  rate: number;
  semis: number;
  loop: Loop | null;
}

/** the library, loaded the first time a track plays (it is mostly its WebAssembly) */
let lib: Promise<(ctx: BaseAudioContext, o?: AudioWorkletNodeOptions) => Promise<StretchNode>> | null = null;
const load = () => (lib ??= import('signalsmith-stretch').then((m) => m.default as never));

export class StretchPlayer {
  readonly duration: number;
  /** the node's own delay (s): changes are scheduled at least this far ahead */
  readonly latency: number;
  private seg: Segment | null = null;

  private constructor(
    private ctx: AudioContext,
    private node: StretchNode,
    readonly gain: GainNode,
    buffer: AudioBuffer,
    latency: number,
  ) {
    this.duration = buffer.duration;
    this.latency = latency;
  }

  /** Decode `data` and get it ready to play into `dest`. */
  static async create(ctx: AudioContext, data: ArrayBuffer, dest: AudioNode): Promise<StretchPlayer> {
    const [buffer, make] = await Promise.all([ctx.decodeAudioData(data), load()]);
    const channels = Math.min(2, buffer.numberOfChannels);
    // its usual layout (one input, unused here: it plays from its buffers; without one it stays silent)
    const node = await make(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const bufs = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c).slice());
    await node.addBuffers(
      bufs,
      bufs.map((b) => b.buffer),
    );
    const gain = ctx.createGain();
    node.connect(gain).connect(dest);
    const latency = await node.latency();
    return new StretchPlayer(ctx, node, gain, buffer, latency);
  }

  /** When (performance.now(), ms) context time `t` is heard, and the other way round. */
  private clock(): { ctx: number; perf: number } {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0)
      return { ctx: ts.contextTime, perf: ts.performanceTime };
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return {
      ctx: this.ctx.currentTime - (c.baseLatency ?? 0) - (c.outputLatency ?? 0),
      perf: performance.now(),
    };
  }

  toCtx(perf: number): number {
    const c = this.clock();
    return c.ctx + (perf - c.perf) / 1000;
  }

  toPerf(ctxTime: number): number {
    const c = this.clock();
    return c.perf + (ctxTime - c.ctx) * 1000;
  }

  /** the earliest moment (performance.now(), ms) a change can be heard with the node fully caught up */
  earliest(): number {
    return this.toPerf(this.ctx.currentTime + this.latency + 0.03);
  }

  get playing(): boolean {
    return !!this.seg;
  }

  /** what is scheduled now: speed, key, loop */
  get current(): Segment | null {
    return this.seg;
  }

  /** Where the track is heard at `perf` (performance.now(), ms), or null when stopped. */
  positionAt(perf: number): number | null {
    const s = this.seg;
    if (!s) return null;
    const t = this.toCtx(perf);
    if (t < s.at) return s.input;
    return wrap(s.input + (t - s.at) * s.rate, s.loop);
  }

  /** Play from `input` (seconds of the track), heard at `perf`, at `rate`, `semis` semitones away, with `loop`. */
  play(perf: number, input: number, rate: number, semis: number, loop: Loop | null): void {
    const at = this.toCtx(perf);
    this.seg = { at, input, rate, semis, loop };
    void this.node.schedule({
      output: at,
      active: true,
      input,
      rate,
      semitones: semis,
      loopStart: loop?.a ?? 0,
      loopEnd: loop?.b ?? 0,
    });
  }

  stop(): void {
    if (!this.seg) return;
    this.seg = null;
    void this.node.schedule({ output: this.ctx.currentTime, active: false });
  }

  setVolume(gain: number): void {
    this.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  dispose(): void {
    this.stop();
    try {
      this.node.disconnect();
      this.gain.disconnect();
    } catch {
      // already
    }
    void this.node.dropBuffers();
  }
}
