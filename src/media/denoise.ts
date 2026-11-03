// The microphone through the steady-noise reduction (src/media/denoise-core.ts), as a track to send. Its own audio
// context at 48 kHz, "interactive" latency; the reduction itself adds 8 ms. Used only in pure mode: in voice
// mode the browser's speech processing already removes noise.

import workletUrl from './denoise.worklet.ts?worker&url';

export class Denoise {
  private ctx: AudioContext | null = null;
  private ready: Promise<boolean> | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private input: MediaStreamTrack | null = null;
  private output: MediaStreamTrack | null = null;

  private load(): Promise<boolean> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          const AC = window.AudioContext;
          if (!AC || typeof AudioWorkletNode === 'undefined') return false;
          this.ctx = new AC({ sampleRate: 48_000, latencyHint: 'interactive' });
          await this.ctx.audioWorklet.addModule(workletUrl);
          return true;
        } catch (e) {
          console.warn('[sonora] noise reduction unavailable', e);
          return false;
        }
      })();
    }
    return this.ready;
  }

  /**
   * The track to send for microphone track `t`: `t` through the noise reduction, or `t` itself when it cannot run
   * (no AudioWorklet, or an audio context the browser keeps suspended until a click: then call again after one).
   */
  async process(t: MediaStreamTrack): Promise<MediaStreamTrack> {
    if (!(await this.load()) || !this.ctx) return t;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    if (this.ctx.state !== 'running') return t;
    if (this.input === t && this.output) return this.output;
    this.disconnect();
    const channels = Math.min(2, Math.max(1, t.getSettings().channelCount ?? 1));
    this.src = this.ctx.createMediaStreamSource(new MediaStream([t]));
    this.node = new AudioWorkletNode(this.ctx, 'sonora-denoise', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels,
      channelCountMode: 'explicit',
    });
    this.dest = this.ctx.createMediaStreamDestination();
    this.dest.channelCount = channels;
    this.src.connect(this.node).connect(this.dest);
    this.input = t;
    this.output = this.dest.stream.getAudioTracks()[0];
    this.output.contentHint = 'music';
    return this.output;
  }

  private disconnect(): void {
    for (const n of [this.src, this.node, this.dest]) {
      try {
        n?.disconnect();
      } catch {
        // already
      }
    }
    this.output?.stop();
    this.src = this.node = this.dest = null;
    this.input = this.output = null;
  }

  /** Stop processing (the caller sends the raw microphone again). */
  stop(): void {
    this.disconnect();
  }
}
