// The local camera, microphone and screen. Every change produces a new track that the session sends with
// RTCRtpSender.replaceTrack, so switching devices or sound modes is seamless for the other side.

import { effect, signal } from '@preact/signals';
import { PictureWatch } from './picture.ts';
import { engine } from './engine.ts';
import { audioConstraints, videoConstraints, type SoundMode, type VideoQuality } from './constraints.ts';
import type { Slot } from '../net/peer.ts';

export type MediaProblem = 'denied' | 'none' | 'busy' | 'insecure' | 'unsupported' | 'other';

function problemOf(e: unknown): MediaProblem {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'other';
}

export class LocalMedia {
  readonly audio = signal<MediaStreamTrack | null>(null);
  readonly video = signal<MediaStreamTrack | null>(null);
  readonly extra = signal<MediaStreamTrack | null>(null);
  readonly extraKind = signal<'screen' | 'camera' | null>(null);
  readonly micOn = signal(true);
  readonly camOn = signal(true);
  /** sound mode of the current microphone track */
  readonly mode = signal<SoundMode>('pure');
  /** the speakers' echo is cancelled in what is sent (by the engine, or by the browser where it cannot run) */
  readonly echo = signal(false);
  /** the browser's own echo cancelling is on in the current track (voice mode; pure mode where the engine
   * cannot run) */
  private trackEcho = false;
  /** the sound plays on headphones, as far as the output's name tells (no echo to cancel then) */
  readonly headphones = signal(false);
  /** cancel echo in pure mode (voice mode always does) */
  private wantEcho = true;
  /** the music-safe echo canceller (the engine's, linear: never ducks, may leave some echo) rather than the
   * browser's (robust, made for speech: ducks what is played here while the others play) */
  private musicEcho = false;
  /** the automatic level for music, in pure mode */
  private autoLevel = true;
  private speakerId = '';
  readonly audioProblem = signal<MediaProblem | null>(null);
  readonly videoProblem = signal<MediaProblem | null>(null);
  /** the microphone delivers stereo */
  readonly stereo = signal(false);
  readonly facing = signal<'user' | 'environment'>('user');
  /** waiting for the browser's permission prompt (or the devices) to answer */
  readonly asking = signal(false);
  /** the microphone as sent: through the engine's echo canceller when it runs */
  readonly sentAudio = signal<MediaStreamTrack | null>(null);
  private emitting = 0;
  private emitQueue: Promise<void> = Promise.resolve();
  /** whether the camera shows a picture (black behind a shutter, none when switched off by a key) */
  readonly picture = new PictureWatch();
  constructor() {
    // the engine's audio context started (a tap): process what is sent, if anything should be
    effect(() => {
      if (engine.running.value) void this.emitAudio();
    });
    // the engine cannot cancel echo here: the browser's echo cancelling instead (the microphone reopens)
    effect(() => {
      if (engine.aecUnavailable.value && this.mode.peek() === 'pure' && this.wantEcho) void this.restartAudio('pure');
    });
  }

  /** a track the peers should send now changed */
  onTrack: (slot: Slot, track: MediaStreamTrack | null) => void = () => {};

  private micId = '';
  private camId = '';
  /** the camera last used, still shown in the list while it is off */
  private lastCamId: string | undefined;
  private quality: VideoQuality = 'hd';
  private busy = Promise.resolve();

  get supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  /** Serialise device operations (a second request while one is pending would race). */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn);
    this.busy = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  /** Ask for camera and microphone together (one permission prompt). */
  start(opts: {
    mode: SoundMode;
    micId: string;
    camId: string;
    quality: VideoQuality;
    wantVideo: boolean;
  }): Promise<void> {
    return this.run(async () => {
      if (!this.supported) {
        const secure = window.isSecureContext;
        this.audioProblem.value = secure ? 'unsupported' : 'insecure';
        this.videoProblem.value = secure ? 'unsupported' : 'insecure';
        return;
      }
      this.micId = opts.micId;
      this.camId = opts.camId;
      this.quality = opts.quality;
      // headphones or speakers decide the echo cancelling (names are known when permission was given before)
      await this.checkOutput();
      const audio = audioConstraints(opts.mode, opts.micId || undefined, this.browserEcho(opts.mode));
      const video = opts.wantVideo ? videoConstraints(opts.quality, opts.camId || undefined, this.facing.value) : false;
      let stream: MediaStream | null = null;
      this.asking.value = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      } catch (e) {
        // a saved device that is gone, or one kind missing: try each kind on its own, with defaults
        // one of them refused (a blocked camera, a missing microphone) must not cost the other: ask separately
        stream = new MediaStream();
        try {
          const a = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints(opts.mode, undefined, this.browserEcho(opts.mode)),
          });
          a.getAudioTracks().forEach((t) => stream!.addTrack(t));
        } catch (ea) {
          this.audioProblem.value = problemOf(ea);
        }
        if (opts.wantVideo) {
          try {
            const v = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints(opts.quality, undefined, this.facing.value),
            });
            v.getVideoTracks().forEach((t) => stream!.addTrack(t));
          } catch (ev) {
            this.videoProblem.value = problemOf(ev);
          }
        }
      }
      this.asking.value = false;
      const a = stream.getAudioTracks()[0] ?? null;
      const v = stream.getVideoTracks()[0] ?? null;
      if (a) this.setAudioTrack(a, opts.mode);
      if (v) this.setVideoTrack(v);
      if (!opts.wantVideo) this.camOn.value = false;
      // device names are known once permission is given
      void this.checkOutput();
    });
  }

  private setAudioTrack(t: MediaStreamTrack, mode: SoundMode): void {
    const old = this.audio.value;
    t.contentHint = mode === 'pure' ? 'music' : 'speech';
    t.enabled = this.micOn.value;
    const st = t.getSettings();
    this.stereo.value = (st.channelCount ?? 1) >= 2;
    this.mode.value = mode;
    // what the browser applied (newer ones say 'all' or 'remote-only' instead of true)
    const ec = st.echoCancellation as boolean | string | undefined;
    this.trackEcho = ec === undefined ? this.browserEcho(mode) : ec !== false;
    this.echo.value = this.trackEcho;
    this.audioProblem.value = null;
    t.addEventListener('ended', () => {
      // unplugged: fall back to the default microphone
      if (this.audio.value === t) void this.restartAudio(mode, '');
    });
    this.audio.value = t;
    void this.emitAudio();
    if (old && old !== t) old.stop();
  }

  private setVideoTrack(t: MediaStreamTrack): void {
    const old = this.video.value;
    t.contentHint = 'motion';
    this.videoProblem.value = null;
    this.camOn.value = true;
    t.addEventListener('ended', () => {
      if (this.video.value === t && this.camOn.value) void this.restartVideo('');
    });
    this.video.value = t;
    this.lastCamId = t.getSettings().deviceId;
    this.picture.watch(t);
    this.onTrack('video', t);
    if (old && old !== t) old.stop();
  }

  /** New microphone track (another mode or device). */
  restartAudio(mode: SoundMode, micId = this.micId): Promise<void> {
    return this.run(async () => {
      this.micId = micId;
      // Other processing: close the microphone first. While it is open, a browser may hand the new request
      // the same capture, with the old processing (no echo cancelling), and phones capture once at a time.
      const old = this.audio.peek();
      if (old && (mode !== this.mode.peek() || this.browserEcho(mode) !== this.trackEcho)) {
        // every copy of it too (the level's frame path holds one): one still open keeps the old processing
        engine.release();
        old.stop();
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(mode, micId || undefined, this.browserEcho(mode)),
        });
        this.setAudioTrack(s.getAudioTracks()[0], mode);
      } catch (e) {
        if (micId) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints(mode, undefined, this.browserEcho(mode)),
            });
            this.setAudioTrack(s.getAudioTracks()[0], mode);
            return;
          } catch {
            // report the first problem
          }
        }
        this.audioProblem.value = problemOf(e);
      }
    });
  }

  /**
   * The browser's own echo cancelling in the capture: always in voice mode (with its noise suppression and
   * automatic volume: made for speech); in pure mode when echo cancelling is wanted, unless the music-safe one
   * runs instead (and can run here). Noise suppression and automatic volume stay off in pure mode either way.
   */
  private browserEcho(mode: SoundMode): boolean {
    return mode === 'voice' || (this.wantEcho && (!this.musicEcho || engine.aecUnavailable.peek()));
  }

  /** The engine's music-safe echo cancelling on what is sent (pure mode: the capture is untouched). */
  private engineEcho(): boolean {
    return (
      this.mode.peek() === 'pure' && this.wantEcho && this.musicEcho && !this.trackEcho && !engine.aecUnavailable.peek()
    );
  }

  /** Which echo canceller in pure mode: the music-safe one (true) or the browser's. */
  setMusicEcho(on: boolean): Promise<void> {
    this.musicEcho = on;
    return this.setEcho(this.wantEcho);
  }

  /** The automatic level for music, in pure mode. */
  setAutoLevel(on: boolean): Promise<void> {
    this.autoLevel = on;
    return this.emitAudio();
  }

  setSoundMode(mode: SoundMode): Promise<void> {
    const t = this.audio.value;
    if (mode === this.mode.value && this.browserEcho(mode) === this.trackEcho && t?.readyState === 'live')
      return Promise.resolve();
    return this.restartAudio(mode);
  }

  /** Echo cancelling in pure mode on or off: the engine's chain changes (the microphone reopens only where the
   * browser's echo cancelling stands in). */
  setEcho(on: boolean): Promise<void> {
    this.wantEcho = on;
    const t = this.audio.peek();
    if (!t || t.readyState !== 'live') return Promise.resolve();
    if (this.browserEcho(this.mode.peek()) !== this.trackEcho) return this.restartAudio(this.mode.peek());
    return this.emitAudio();
  }

  /** The output in use ('' = the system's default): are those headphones? */
  setSpeaker(id: string): Promise<void> {
    this.speakerId = id;
    return this.checkOutput();
  }

  /** Read the output's name again (after permission, a device plugged in or out). */
  async checkOutput(): Promise<void> {
    const { speakers } = await listDevices();
    const out =
      speakers.find((d) => d.deviceId === this.speakerId) ??
      speakers.find((d) => d.deviceId === 'default') ??
      speakers[0];
    this.headphones.value = !!out && looksLikeHeadphones(out.label);
  }

  restartVideo(camId = this.camId, quality = this.quality): Promise<void> {
    return this.run(async () => {
      this.camId = camId;
      this.quality = quality;
      if (!this.camOn.value) return;
      // release the current camera first: phones cannot open two at once
      const old = this.video.value;
      if (old) old.stop();
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(quality, camId || undefined, this.facing.value),
        });
        this.setVideoTrack(s.getVideoTracks()[0]);
      } catch (e) {
        this.videoProblem.value = problemOf(e);
        this.video.value = null;
        this.picture.stop();
        this.onTrack('video', null);
      }
    });
  }

  /** Hand the peers the microphone as it should be sent (as captured, or through the echo canceller). */
  /**
   * Hand the peers the microphone as it should be sent. One change at a time, and only the latest pending one: two
   * running together would both rebuild the engine's chain, and an older one still waiting for the audio context
   * could finish last and put its stale chain back.
   */
  private emitAudio(): Promise<void> {
    const n = ++this.emitting;
    this.emitQueue = this.emitQueue.then(() => (n === this.emitting ? this.doEmit() : undefined));
    return this.emitQueue;
  }

  private async doEmit(): Promise<void> {
    const raw = this.audio.peek();
    let out = raw;
    const want = { aec: !!raw && this.engineEcho(), level: !!raw && this.autoLevel && this.mode.peek() === 'pure' };
    try {
      if (raw) out = await engine.process(raw, want);
    } catch (e) {
      console.warn('[sonora] microphone processing failed', e);
      out = raw;
    }
    this.echo.value = this.trackEcho || (want.aec && out !== raw && engine.cancelling);
    this.sentAudio.value = out;
    this.onTrack('audio', out);
  }

  /** From any tap: wake the audio engine. When echo cancelling was on but could not start (no tap yet), it starts
   * now. */
  unlockAudio(): void {
    if (engine.ctx || this.engineEcho() || (this.autoLevel && this.mode.peek() === 'pure')) engine.ensure();
  }

  setMicOn(on: boolean): void {
    this.micOn.value = on;
    const t = this.audio.value;
    if (t) t.enabled = on;
  }

  /** Camera off releases the camera (its light goes off); on opens it again. */
  setCamOn(on: boolean): Promise<void> {
    return this.run(async () => {
      this.camOn.value = on;
      if (!on) {
        const t = this.video.value;
        this.video.value = null;
        this.picture.stop();
        this.onTrack('video', null);
        t?.stop();
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(this.quality, this.camId || undefined, this.facing.value),
        });
        this.setVideoTrack(s.getVideoTracks()[0]);
      } catch (e) {
        this.camOn.value = false;
        this.videoProblem.value = problemOf(e);
      }
    });
  }

  /** Front / back camera on phones and tablets. */
  flipCamera(): Promise<void> {
    this.facing.value = this.facing.value === 'user' ? 'environment' : 'user';
    this.camId = '';
    return this.restartVideo('');
  }

  get canShareScreen(): boolean {
    return (
      !!navigator.mediaDevices &&
      'getDisplayMedia' in navigator.mediaDevices &&
      !/Android|iPhone|iPad/i.test(navigator.userAgent)
    );
  }

  /** Share a screen or window (sheet music, a score editor) on the extra video slot. */
  async shareScreen(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const t = s.getVideoTracks()[0];
      t.contentHint = 'detail';
      this.setExtra(t, 'screen');
      return true;
    } catch {
      return false;
    }
  }

  /** A second camera (e.g. a webcam above the keyboard) on the extra video slot. */
  async addCamera(deviceId: string): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(this.quality, deviceId) });
      const t = s.getVideoTracks()[0];
      t.contentHint = 'motion';
      this.setExtra(t, 'camera');
      return true;
    } catch (e) {
      this.videoProblem.value = problemOf(e);
      return false;
    }
  }

  private setExtra(t: MediaStreamTrack, kind: 'screen' | 'camera'): void {
    const old = this.extra.value;
    t.addEventListener('ended', () => {
      if (this.extra.value === t) this.stopExtra();
    });
    this.extra.value = t;
    this.extraKind.value = kind;
    this.onTrack('extra', t);
    old?.stop();
  }

  stopExtra(): void {
    const t = this.extra.value;
    this.extra.value = null;
    this.extraKind.value = null;
    this.onTrack('extra', null);
    t?.stop();
  }

  get cameraId(): string {
    return this.video.value?.getSettings().deviceId ?? this.lastCamId ?? this.camId;
  }

  get microphoneId(): string {
    return this.audio.value?.getSettings().deviceId ?? this.micId;
  }

  stopAll(): void {
    engine.release();
    for (const t of [this.audio.value, this.video.value, this.extra.value]) t?.stop();
    this.audio.value = null;
    this.video.value = null;
    this.picture.stop();
    this.extra.value = null;
    this.extraKind.value = null;
  }
}

export interface DeviceLists {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export async function listDevices(): Promise<DeviceLists> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const real = (d: MediaDeviceInfo) => d.deviceId && d.deviceId !== 'communications';
    return {
      mics: all.filter((d) => d.kind === 'audioinput' && real(d)),
      cams: all.filter((d) => d.kind === 'videoinput' && real(d)),
      speakers: all.filter((d) => d.kind === 'audiooutput' && real(d)),
    };
  } catch {
    return { mics: [], cams: [], speakers: [] };
  }
}

/** Can audio elements be sent to another output device (Chromium, Firefox)? */
export const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Names that say the output is headphones. Strict: a speaker taken for headphones would turn echo cancelling
 * off, while headphones taken for a speaker only keep it on (it does little harm there). A Bluetooth name
 * alone does not tell (speakers have them too).
 */
export function looksLikeHeadphones(label: string): boolean {
  return /head ?phone|headset|ear ?phone|earbud|in-ear|airpods|buds\d*\b|casque|[ée]couteur|kopfh[öo]rer|auricular|cuffie/i.test(
    label,
  );
}
