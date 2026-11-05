// One audio engine for the lesson: a single audio context where everything this device plays out loud goes
// through (the others' sound, the built-in piano), and where the microphone is processed before it is sent.
//
// Why one: the echo canceller (src/media/aec.worklet.ts) must know exactly what the speakers play, on the same
// clock as the microphone. Browsers' own echo cancelling is made for speech and pulls the near-end piano down
// whenever the others play; this one is linear (it only subtracts the echo it has learned), so the piano played
// here keeps every note.
//
//   others' sound ──┐
//   built-in piano ─┴─► out ─► speakers
//                        └──► (reference) ─┐
//   microphone ───────────────────────────► echo canceller ─► steady-noise reduction ─► sent
//
// The others' sound goes through the engine only while echo cancelling runs; otherwise it plays from plain audio
// elements, the shortest path. Each stage of the microphone's chain is there only when it is on: with nothing on,
// the microphone is sent as it comes.

import { signal } from '@preact/signals';
import aecWorkletUrl from './aec.worklet.ts?worker&url';
import denoiseWorkletUrl from './denoise.worklet.ts?worker&url';
import aecWasmUrl from './aec.wasm?url';

export interface MicChain {
  /** cancel the speakers' echo */
  aec: boolean;
  /** steady background noise reduction */
  denoise: boolean;
}

export interface EchoStats {
  /** microphone level drop from the cancelling while the speakers play (dB), null before enough playing */
  reductionDb: number | null;
  /** share of the last second during which the speakers played */
  playing: number;
  /** the reference's delay, as measured (output + input latency, minus a margin) */
  delayMs: number;
}

/** the filter's length: the room's echo after the latencies (a medium room, a laptop or phone at a piano) */
const TAIL_S = 0.3;

class AudioEngine {
  ctx: AudioContext | null = null;
  /** everything played out loud goes here */
  out: GainNode | null = null;
  /** worklets loaded (both), or false when this browser cannot run them */
  private ready: Promise<boolean> | null = null;
  wasm: ArrayBuffer | null = null;
  /** the context started running (after a tap): the microphone chain can be built again */
  readonly running = signal(false);
  readonly echo = signal<EchoStats | null>(null);
  /** the echo canceller is in the microphone's chain: the others' sound must play through the engine */
  readonly aecOn = signal(false);
  /** the echo canceller cannot run here (no AudioWorklet or WebAssembly): fall back to the browser's */
  readonly aecUnavailable = signal(false);

  private chain: {
    track: MediaStreamTrack;
    want: MicChain;
    src: MediaStreamAudioSourceNode;
    nodes: AudioNode[];
    aec: AudioWorkletNode | null;
    output: MediaStreamTrack;
  } | null = null;
  private remote = new Map<string, { src: MediaStreamAudioSourceNode; gain: GainNode }>();
  private sinkId = '';

  /** Create the context (in a tap the first time: Safari starts audio only then) and wake it. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC({ latencyHint: 'interactive', sampleRate: 48_000 });
      } catch {
        // a device that cannot run at 48 kHz: its own rate
        this.ctx = new AC({ latencyHint: 'interactive' });
      }
      const ctx = this.ctx;
      this.out = ctx.createGain();
      this.out.connect(ctx.destination);
      ctx.addEventListener('statechange', () => (this.running.value = ctx.state === 'running'));
      this.running.value = ctx.state === 'running';
      if (this.sinkId) void this.setSink(this.sinkId);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private load(): Promise<boolean> {
    if (!this.ready) {
      const ctx = this.ensure();
      this.ready = (async () => {
        if (!ctx || typeof AudioWorkletNode === 'undefined' || typeof WebAssembly === 'undefined') {
          this.aecUnavailable.value = true;
          return false;
        }
        try {
          const [, , bytes] = await Promise.all([
            ctx.audioWorklet.addModule(aecWorkletUrl),
            ctx.audioWorklet.addModule(denoiseWorkletUrl),
            fetch(aecWasmUrl).then((r) => {
              if (!r.ok) throw new Error(`aec.wasm: ${r.status}`);
              return r.arrayBuffer();
            }),
          ]);
          // checked here, so a browser that cannot compile it falls back at once
          new WebAssembly.Module(bytes);
          this.wasm = bytes;
          return true;
        } catch (e) {
          console.warn('[sonora] audio processing unavailable', e);
          this.aecUnavailable.value = true;
          return false;
        }
      })();
    }
    return this.ready;
  }

  /** Can the echo canceller run here? (loads it) */
  async canCancelEcho(): Promise<boolean> {
    return (await this.load()) && !!this.wasm;
  }

  /**
   * The track to send for microphone `track` with `want` on. The microphone itself when nothing is on, or when
   * the engine cannot run yet (no tap so far: call again once `running`), or at all.
   */
  async process(track: MediaStreamTrack, want: MicChain): Promise<MediaStreamTrack> {
    if (!want.aec && !want.denoise) {
      this.dropChain();
      return track;
    }
    if (!(await this.load()) || !this.ctx) return track;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return track;
    const c = this.chain;
    if (c && c.track === track && c.want.aec === want.aec && c.want.denoise === want.denoise) return c.output;
    this.dropChain();

    const channels = Math.min(2, Math.max(1, track.getSettings().channelCount ?? 1));
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const nodes: AudioNode[] = [];
    let aec: AudioWorkletNode | null = null;
    let head: AudioNode = src;
    if (want.aec && this.wasm && this.out) {
      aec = new AudioWorkletNode(ctx, 'sonora-aec', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCount: channels,
        channelCountMode: 'explicit',
        processorOptions: { bytes: this.wasm.slice(0), tail: TAIL_S },
      });
      aec.port.onmessage = (e: MessageEvent<EchoStats & { failed?: string }>) => {
        if (e.data.failed) {
          console.warn('[sonora] echo canceller failed', e.data.failed);
          this.aecUnavailable.value = true;
          return;
        }
        this.echo.value = e.data;
      };
      head.connect(aec, 0, 0);
      // the reference: what goes to the speakers, mixed to mono
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      this.out.connect(mono);
      mono.connect(aec, 0, 1);
      nodes.push(mono, aec);
      head = aec;
    }
    if (want.denoise) {
      const dn = new AudioWorkletNode(ctx, 'sonora-denoise', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCount: channels,
        channelCountMode: 'explicit',
      });
      head.connect(dn);
      nodes.push(dn);
      head = dn;
    }
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = channels;
    head.connect(dest);
    nodes.push(dest);
    const output = dest.stream.getAudioTracks()[0];
    output.contentHint = 'music';
    this.chain = { track, want: { ...want }, src, nodes, aec, output };
    this.aecOn.value = !!aec;
    return output;
  }

  /** Stop processing the microphone (it was released). */
  release(): void {
    this.dropChain();
  }

  private dropChain(): void {
    const c = this.chain;
    if (!c) return;
    this.chain = null;
    for (const n of [c.src, ...c.nodes]) {
      try {
        n.disconnect();
      } catch {
        // already
      }
    }
    try {
      this.out?.disconnect(c.nodes[0]);
    } catch {
      // not connected
    }
    c.output.stop();
    this.echo.value = null;
    this.aecOn.value = false;
  }

  /** the microphone chain runs (what is sent is processed) */
  get processing(): boolean {
    return !!this.chain && this.ctx?.state === 'running';
  }

  /** the echo canceller runs on what is sent */
  get cancelling(): boolean {
    return this.processing && !!this.chain?.aec;
  }

  /**
   * Play `stream` (someone's sound) through the engine, or stop (null). Its audio element keeps playing it,
   * muted by the caller: Chrome delivers a remote stream to an audio context only while an element plays it.
   */
  playRemote(id: string, stream: MediaStream | null): boolean {
    const old = this.remote.get(id);
    if (old) {
      try {
        old.src.disconnect();
        old.gain.disconnect();
      } catch {
        // already
      }
      this.remote.delete(id);
    }
    if (!stream || !stream.getAudioTracks().length) return false;
    const ctx = this.ensure();
    if (!ctx || !this.out || ctx.state !== 'running') return false;
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    src.connect(gain).connect(this.out);
    this.remote.set(id, { src, gain });
    return true;
  }

  /** Output device for everything played through the engine (Chromium). */
  async setSink(id: string): Promise<void> {
    this.sinkId = id;
    const c = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (c?.setSinkId) await c.setSinkId(id).catch(() => {});
  }

  /** what the engine adds before sound reaches the speakers (ms) */
  get outputLatencyMs(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!c) return 0;
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000);
  }
}

export const engine = new AudioEngine();
