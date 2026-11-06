// One audio engine for the lesson: a single audio context where everything this device plays out loud goes
// through (the others' sound, the built-in piano), and where the microphone is processed before it is sent.
//
// Why one: the echo canceller (src/media/aec.worklet.ts) must know exactly what the speakers play, on the same
// clock as the microphone. Browsers' own echo cancelling is made for speech and pulls the near-end piano down
// whenever the others play; this one is linear (it only subtracts the echo it has learned), so the piano played
// here keeps every note.
//
//   someone's sound ─► (steady-noise reduction, if this listener wants it for them) ─┐
//   built-in piano ─────────────────────────────────────────────────────────────────┴─► out ─► speakers
//                                                                                        └──► (reference) ─┐
//   microphone ───────────────────────────────────────────────────────────────────────► echo canceller ─► sent
//
// Noise reduction is the listener's: whoever hears a sound decides how it is cleaned, for themselves only. The
// others' sound goes through the engine only while echo cancelling runs or noise is reduced for them; otherwise it
// plays from plain audio elements, the shortest path. Without echo cancelling, the microphone is sent as it comes.

import { signal } from '@preact/signals';
import aecWorkletUrl from './aec.worklet.ts?worker&url';
import denoiseWorkletUrl from './denoise.worklet.ts?worker&url';
import levelWorkletUrl from './level.worklet.ts?worker&url';
import aecWasmUrl from './aec.wasm?url';

export interface MicChain {
  /** cancel the speakers' echo (the music-safe canceller) */
  aec: boolean;
  /** automatic level for music (src/media/level-core.ts) */
  level: boolean;
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
  /** the automatic level's gain now (dB), null when it does not run */
  readonly levelDb = signal<number | null>(null);
  /** the echo canceller is in the microphone's chain: the others' sound must play through the engine */
  readonly aecOn = signal(false);
  /** the echo canceller cannot run here (no AudioWorklet or WebAssembly): fall back to the browser's */
  readonly aecUnavailable = signal(false);
  /** the worklets are loaded (noise reduction for someone's sound can be set up) */
  readonly loaded = signal(false);

  private chain: {
    track: MediaStreamTrack;
    want: MicChain;
    src: MediaStreamAudioSourceNode;
    nodes: AudioNode[];
    aec: AudioWorkletNode | null;
    output: MediaStreamTrack;
  } | null = null;
  private remote = new Map<
    string,
    { stream: MediaStream; src: MediaStreamAudioSourceNode; nodes: AudioNode[]; denoise: boolean }
  >();
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

  load(): Promise<boolean> {
    if (!this.ready) {
      const ctx = this.ensure();
      this.ready = (async () => {
        if (!ctx || typeof AudioWorkletNode === 'undefined' || typeof WebAssembly === 'undefined') {
          this.aecUnavailable.value = true;
          return false;
        }
        try {
          const [, , , bytes] = await Promise.all([
            ctx.audioWorklet.addModule(aecWorkletUrl),
            ctx.audioWorklet.addModule(denoiseWorkletUrl),
            ctx.audioWorklet.addModule(levelWorkletUrl),
            fetch(aecWasmUrl).then((r) => {
              if (!r.ok) throw new Error(`aec.wasm: ${r.status}`);
              return r.arrayBuffer();
            }),
          ]);
          // checked here, so a browser that cannot compile it falls back at once
          new WebAssembly.Module(bytes);
          this.wasm = bytes;
          this.loaded.value = true;
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
    if (!want.aec && !want.level) {
      this.dropChain();
      return track;
    }
    if (!(await this.load()) || !this.ctx) return track;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return track;
    const c = this.chain;
    if (c && c.track === track && c.want.aec === want.aec && c.want.level === want.level) return c.output;
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
    if (want.level) {
      const lv = new AudioWorkletNode(ctx, 'sonora-level', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCount: channels,
        channelCountMode: 'explicit',
      });
      lv.port.onmessage = (e: MessageEvent<{ gainDb: number }>) => (this.levelDb.value = e.data.gainDb);
      head.connect(lv);
      nodes.push(lv);
      head = lv;
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
    this.levelDb.value = null;
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
   * Play `stream` (someone's sound) through the engine, with steady-noise reduction when `denoise`; or stop
   * (null). True when it plays through the engine: its audio element keeps playing it, muted by the caller (Chrome
   * delivers a remote stream to an audio context only while an element plays it). False: play it from the element
   * (not possible yet: no tap so far, or the noise reduction still loading; call again on `running`, `loaded`).
   */
  playRemote(id: string, stream: MediaStream | null, denoise = false): boolean {
    const cur = this.remote.get(id);
    if (cur && stream && cur.stream === stream && cur.denoise === denoise) return true;
    if (cur) {
      for (const n of [cur.src, ...cur.nodes]) {
        try {
          n.disconnect();
        } catch {
          // already
        }
      }
      this.remote.delete(id);
    }
    if (!stream || !stream.getAudioTracks().length) return false;
    const ctx = this.ensure();
    if (!ctx || !this.out || ctx.state !== 'running') return false;
    if (denoise && !this.loaded.peek()) {
      void this.load();
      return false;
    }
    const src = ctx.createMediaStreamSource(stream);
    const nodes: AudioNode[] = [];
    let head: AudioNode = src;
    if (denoise) {
      const channels = Math.min(2, Math.max(1, stream.getAudioTracks()[0].getSettings().channelCount ?? 2));
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
    head.connect(this.out);
    this.remote.set(id, { stream, src, nodes, denoise });
    return true;
  }

  /** How someone's sound plays: through the engine (and cleaned) or not at all here. */
  remoteRoute(id: string): { engine: boolean; denoise: boolean } {
    const r = this.remote.get(id);
    return { engine: !!r, denoise: !!r?.denoise };
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
