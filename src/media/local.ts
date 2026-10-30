// The local camera, microphone and screen. Every change produces a new track that the session sends with
// RTCRtpSender.replaceTrack, so switching devices or sound modes is seamless for the other side.

import { signal } from '@preact/signals';
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
  readonly audioProblem = signal<MediaProblem | null>(null);
  readonly videoProblem = signal<MediaProblem | null>(null);
  /** the microphone delivers stereo */
  readonly stereo = signal(false);
  readonly facing = signal<'user' | 'environment'>('user');
  /** a track the peers should send now changed */
  onTrack: (slot: Slot, track: MediaStreamTrack | null) => void = () => {};

  private micId = '';
  private camId = '';
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
  start(opts: { mode: SoundMode; micId: string; camId: string; quality: VideoQuality; wantVideo: boolean }): Promise<void> {
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
      const audio = audioConstraints(opts.mode, opts.micId || undefined);
      const video = opts.wantVideo ? videoConstraints(opts.quality, opts.camId || undefined, this.facing.value) : false;
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      } catch (e) {
        // a saved device that is gone, or one kind missing: try each kind on its own, with defaults
        const p = problemOf(e);
        if (p === 'denied') {
          this.audioProblem.value = 'denied';
          if (opts.wantVideo) this.videoProblem.value = 'denied';
          return;
        }
        stream = new MediaStream();
        try {
          const a = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(opts.mode) });
          a.getAudioTracks().forEach((t) => stream!.addTrack(t));
        } catch (ea) {
          this.audioProblem.value = problemOf(ea);
        }
        if (opts.wantVideo) {
          try {
            const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(opts.quality, undefined, this.facing.value) });
            v.getVideoTracks().forEach((t) => stream!.addTrack(t));
          } catch (ev) {
            this.videoProblem.value = problemOf(ev);
          }
        }
      }
      const a = stream.getAudioTracks()[0] ?? null;
      const v = stream.getVideoTracks()[0] ?? null;
      if (a) this.setAudioTrack(a, opts.mode);
      if (v) this.setVideoTrack(v);
      if (!opts.wantVideo) this.camOn.value = false;
    });
  }

  private setAudioTrack(t: MediaStreamTrack, mode: SoundMode): void {
    const old = this.audio.value;
    t.contentHint = mode === 'pure' ? 'music' : 'speech';
    t.enabled = this.micOn.value;
    this.stereo.value = (t.getSettings().channelCount ?? 1) >= 2;
    this.mode.value = mode;
    this.audioProblem.value = null;
    t.addEventListener('ended', () => {
      // unplugged: fall back to the default microphone
      if (this.audio.value === t) void this.restartAudio(mode, '');
    });
    this.audio.value = t;
    this.onTrack('audio', t);
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
    this.onTrack('video', t);
    if (old && old !== t) old.stop();
  }

  /** New microphone track (another mode or device). */
  restartAudio(mode: SoundMode, micId = this.micId): Promise<void> {
    return this.run(async () => {
      this.micId = micId;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode, micId || undefined) });
        this.setAudioTrack(s.getAudioTracks()[0], mode);
      } catch (e) {
        if (micId) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode) });
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

  setSoundMode(mode: SoundMode): Promise<void> {
    if (mode === this.mode.value && this.audio.value?.readyState === 'live') return Promise.resolve();
    return this.restartAudio(mode);
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
        this.onTrack('video', null);
      }
    });
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
    return !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && !/Android|iPhone|iPad/i.test(navigator.userAgent);
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
    return this.video.value?.getSettings().deviceId ?? this.camId;
  }

  get microphoneId(): string {
    return this.audio.value?.getSettings().deviceId ?? this.micId;
  }

  stopAll(): void {
    for (const t of [this.audio.value, this.video.value, this.extra.value]) t?.stop();
    this.audio.value = null;
    this.video.value = null;
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

/** Labels that suggest the output is headphones (pure sound needs them to avoid echo). */
export function looksLikeHeadphones(label: string): boolean {
  return /head|ear|airpods|buds|casque|kopfh|auricular|cuffie|bluetooth|bt|wh-|wf-|bose|sony|jabra|beats/i.test(label);
}
