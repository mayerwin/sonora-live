// Recording the lesson, on the device of whoever presses Record. The picture is drawn as the lesson looks (src/
// media/compositor.ts), the sound is everything this device hears mixed with its own microphone (the others, the
// built-in piano, the backing track and the metronome), and MediaRecorder encodes both. Each second goes straight
// into this browser's storage (src/media/recstore.ts): a closed tab or a crash loses at most that second, and the
// next visit offers what was saved. Optionally, each person's sound in a file of its own too (for editing later).
// Nothing is uploaded: the file is saved on this device when the recording stops.

import { batch, effect, signal } from '@preact/signals';
import fixWebmDuration from 'fix-webm-duration';
import { Compositor, type CompSource } from '../media/compositor.ts';
import {
  assemble,
  listRecordings,
  markDone,
  RecWriter,
  removeRecording,
  storageLeft,
  type RecMeta,
} from '../media/recstore.ts';
import type { PeerView } from './participants.ts';
import { settings } from './settings.ts';
import { t } from './i18n.ts';
import { log } from './log.ts';

export interface RecorderHost {
  selfId(): string;
  selfName(): string;
  peers(): PeerView[];
  /** this side's camera, its second picture (a shared screen or a second camera), and the sound it sends */
  camera(): MediaStreamTrack | null;
  extra(): { track: MediaStreamTrack; kind: 'screen' | 'camera' } | null;
  mic(): MediaStreamTrack | null;
  /** this side's shared screen's sound, when it does not already play through the engine */
  screenSound(): MediaStreamTrack | null;
  /** the audio context and what it plays besides the others' sound (the piano; the track and metronome) */
  context(): AudioContext | null;
  localSources(): AudioNode[];
  /** tell everyone (a 'rec' control message) */
  send(msg: Record<string, unknown>): void;
  note(text: string): void;
  /** someone other than this side may not start a recording now (the host's lock) */
  allowed(): boolean;
}

export const QUALITY = {
  '720p': { w: 1280, h: 720, video: 2_500_000 },
  '1080p': { w: 1920, h: 1080, video: 5_000_000 },
} as const;
const AUDIO_BPS = 160_000;
const VOICE_BPS = 128_000;
const FPS = 30;
const SLICE_MS = 1000;
/** under this much room left, recording warns first (about 20 minutes of 720p) */
const LOW_SPACE = 400 * 1024 * 1024;
const SAVED_DAYS = 14;

/** The best format this browser records in: MP4 (H.264/AAC) plays everywhere, WebM where it is not offered. */
export function pickMime(audioOnly = false): string {
  const can = (m: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m);
  const list = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/mp4;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm']
    : [
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
  return list.find(can) ?? '';
}

export function extensionOf(mime: string): string {
  return mime.startsWith('audio/webm')
    ? 'webm'
    : mime.startsWith('audio/mp4')
      ? 'm4a'
      : mime.includes('mp4')
        ? 'mp4'
        : 'webm';
}

/** "Lesson 2026-11-13 18.05.mp4", or "Lesson 2026-11-13 18.05 - Clara.webm" for one person's sound */
export function fileName(meta: RecMeta): string {
  const d = new Date(meta.started);
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
  const who = meta.kind === 'voice' && meta.name ? ` - ${meta.name.replace(/[\\/:*?"<>|]/g, '')}` : '';
  return `${t('Lesson')} ${when}${who}.${extensionOf(meta.mime)}`;
}

interface Track {
  rec: MediaRecorder;
  writer: RecWriter;
  /** sources feeding it (a voice's own) */
  stop?: () => void;
  done: Promise<void>;
}

export interface Recording {
  id: string;
  started: number;
}

/** someone else recording: who, since when (their clock: shown as elapsed from when it was heard) */
export interface OtherRecording {
  id: string;
  name: string;
  since: number;
}

export class Recorder {
  /** this side's recording */
  readonly state = signal<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  readonly elapsed = signal(0);
  readonly bytes = signal(0);
  /** others recording (everyone is told: nobody is recorded without knowing) */
  readonly others = signal<OtherRecording[]>([]);
  /** recordings kept on this device: interrupted ones to recover, finished ones to save again */
  readonly kept = signal<RecMeta[]>([]);
  readonly error = signal<string | null>(null);

  private comp: Compositor | null = null;
  private main: Track | null = null;
  private voices = new Map<string, Track>();
  /** voices being opened, and the promises to wait for at the end */
  private opening = new Set<string>();
  private pending: Promise<void>[] = [];
  private voiceCount = 0;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private feeds = new Map<string, { node: AudioNode; src?: MediaStreamAudioSourceNode; key: unknown }>();
  private videos = new Map<MediaStream | MediaStreamTrack, HTMLVideoElement>();
  private videoHost: HTMLElement | null = null;
  private startedAt = 0;
  private group = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopEffect: (() => void) | null = null;

  /** a large picture besides the cameras (the shared score), set by its view */
  extraPicture: (() => HTMLCanvasElement | null) | null = null;

  constructor(private host: RecorderHost) {}

  get recording(): boolean {
    return this.state.peek() === 'recording';
  }

  /** What is kept on this device (and drop finished recordings older than two weeks). */
  async refresh(): Promise<void> {
    try {
      const all = await listRecordings();
      const old = Date.now() - SAVED_DAYS * 86400_000;
      for (const m of all) if (m.done && m.started < old) await removeRecording(m.id);
      this.kept.value = all.filter((m) => !m.done || m.started >= old);
    } catch (e) {
      log('recordings: storage unavailable', e);
    }
  }

  /** Interrupted recordings (the tab closed while recording): one per lesson, voices aside. */
  interrupted(): RecMeta[] {
    return this.kept.value.filter((m) => !m.done && m.kind === 'lesson' && m.id !== this.group);
  }

  async start(): Promise<boolean> {
    if (this.state.peek() !== 'idle') return false;
    if (!this.host.allowed()) {
      this.error.value = t('The host has locked recording.');
      return false;
    }
    const mime = pickMime();
    const ctx = this.host.context();
    if (!mime || !ctx) {
      this.error.value = t('This browser cannot record.');
      return false;
    }
    this.error.value = null;
    this.state.value = 'starting';
    try {
      const left = await storageLeft();
      if (left !== null && left < LOW_SPACE) {
        this.error.value = t('Little space left on this device: the recording may stop early.');
      }
      const q = QUALITY[settings.peek().record.quality];
      this.startedAt = Date.now();
      this.group = `rec-${this.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this.comp = new Compositor(q.w, q.h, FPS, () => this.pictures());
      this.mix = ctx.createMediaStreamDestination();
      this.mix.channelCount = 2;
      this.wireSound();
      // the picture's own frame rate, whatever the tab does: started before the recorder takes its first frame
      this.comp.start();
      const stream = new MediaStream([...this.comp.stream.getVideoTracks(), ...this.mix.stream.getAudioTracks()]);
      this.main = await this.begin(
        stream,
        { id: this.group, started: this.startedAt, mime, kind: 'lesson', done: false },
        { videoBitsPerSecond: q.video, audioBitsPerSecond: AUDIO_BPS },
      );
      if (settings.peek().record.voices) this.syncVoices();
      // the others come and go, the microphone and camera change: the mix and the voices follow
      let first = true;
      this.stopEffect = effect(() => {
        void this.host.peers();
        void this.host.mic();
        if (first) {
          first = false;
          return;
        }
        this.wireSound();
        if (settings.peek().record.voices) this.syncVoices();
      });
      this.timer = setInterval(() => this.tick(), 500);
      this.state.value = 'recording';
      this.host.send({ t: 'rec', on: true, since: this.startedAt });
      this.host.note(t('You started recording. Everyone is told.'));
      log('recording', mime, q);
      return true;
    } catch (e) {
      log('recording failed to start', e);
      this.error.value = t('The recording could not start.');
      this.teardown();
      this.state.value = 'idle';
      return false;
    }
  }

  /** Stop, close the files, and save them on this device. */
  async stop(): Promise<void> {
    if (this.state.peek() !== 'recording') return;
    this.state.value = 'saving';
    const durationMs = Date.now() - this.startedAt;
    await Promise.all(this.pending);
    const tracks = [this.main!, ...this.voices.values()];
    for (const tr of tracks) if (tr.rec.state !== 'inactive') tr.rec.stop();
    await Promise.all(tracks.map((tr) => tr.done));
    const metas = tracks.map((tr) => tr.writer.meta);
    await Promise.all(tracks.map((tr) => tr.writer.close(durationMs - (tr.writer.meta.offsetMs ?? 0))));
    const failed = tracks.some((tr) => tr.writer.failed);
    this.teardown();
    this.host.send({ t: 'rec', on: false });
    if (failed) this.error.value = t('Storage ran out: the recording was kept up to that point.');
    for (const m of metas) await this.save(m);
    await this.refresh();
    batch(() => {
      this.state.value = 'idle';
      this.elapsed.value = 0;
      this.bytes.value = 0;
    });
  }

  /** Save a kept recording as a file (again, or after an interruption). */
  async save(meta: RecMeta): Promise<void> {
    const got = await assemble(meta);
    let blob = got.blob;
    if (!blob.size) return;
    // interrupted: its length was noted every few seconds, and each stored piece is a second
    const duration = meta.done
      ? (meta.durationMs ?? 0)
      : Math.max(meta.durationMs ?? 0, got.pieces * SLICE_MS - SLICE_MS / 2);
    if (meta.mime.includes('webm') && duration > 0) {
      // MediaRecorder writes WebM without its length: players would show no duration and could not seek
      blob = await fixWebmDuration(blob, duration, { logger: false });
    }
    download(blob, fileName(meta));
    // recovered: complete now, as far as it goes
    if (!meta.done) await markDone(meta, duration);
  }

  async remove(meta: RecMeta): Promise<void> {
    await removeRecording(meta.id);
    // a lesson's voices go with it
    for (const m of this.kept.peek()) if (m.id.startsWith(`${meta.id}-v`)) await removeRecording(m.id);
    await this.refresh();
  }

  /** Recover an interrupted recording: the lesson and any voices recorded with it. */
  async recover(meta: RecMeta): Promise<void> {
    for (const m of this.kept.peek()) if (m.id === meta.id || m.id.startsWith(`${meta.id}-v`)) await this.save(m);
    await this.refresh();
  }

  // ------------------------------------------------------------------------------------------- the others

  /** A 'rec' message: someone started or stopped recording. */
  onControl(from: string, msg: Record<string, unknown>): void {
    const name = this.host.peers().find((p) => p.id === from)?.info.name ?? t('Someone');
    const list = this.others.peek().filter((o) => o.id !== from);
    if (msg.on === true) {
      const was = this.others.peek().some((o) => o.id === from);
      this.others.value = [...list, { id: from, name, since: Date.now() }];
      if (!was) this.host.note(t('{name} started recording.', { name }));
    } else if (list.length !== this.others.peek().length) {
      this.others.value = list;
      this.host.note(t('{name} stopped recording.', { name }));
    }
  }

  /** Someone new: tell them this side records. */
  onConnected(send: (msg: Record<string, unknown>) => void): void {
    if (this.recording) send({ t: 'rec', on: true, since: this.startedAt });
  }

  peerGone(id: string): void {
    if (this.others.peek().some((o) => o.id === id)) this.others.value = this.others.peek().filter((o) => o.id !== id);
  }

  // ------------------------------------------------------------------------------------------- inside

  private async begin(stream: MediaStream, meta: RecMeta, opts: MediaRecorderOptions): Promise<Track> {
    const writer = new RecWriter(meta);
    await writer.open();
    const rec = new MediaRecorder(stream, { mimeType: meta.mime, ...opts });
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    rec.ondataavailable = (e) => {
      void writer.write(e.data).then(() => {
        if (writer.failed && this.recording) void this.stop();
      });
    };
    rec.onstop = () => resolveDone();
    rec.onerror = (e) => {
      log('recorder error', e);
      if (this.recording) void this.stop();
    };
    rec.start(SLICE_MS);
    return { rec, writer, done };
  }

  private tick(): void {
    this.elapsed.value = Date.now() - this.startedAt;
    let b = this.main?.writer.bytes ?? 0;
    for (const v of this.voices.values()) b += v.writer.bytes;
    this.bytes.value = b;
    // the length so far, every two seconds: what an interrupted recording is known to last
    const s = Math.floor(this.elapsed.peek() / 2000);
    if (this.main && this.lastNoted !== s) {
      this.lastNoted = s;
      for (const tr of [this.main, ...this.voices.values()]) void tr.writer.note(this.elapsed.peek());
    }
  }
  private lastNoted = -1;

  /** What the picture shows: the others (and what they share, large), then this side. */
  private pictures(): CompSource[] {
    const out: CompSource[] = [];
    const used = new Set<MediaStream | MediaStreamTrack>();
    const peers = this.host.peers().filter((p) => p.link === 'connected' || p.link === 'reconnecting');
    for (const p of peers) {
      if (p.remote?.extra && p.extra) {
        used.add(p.extra);
        out.push({ el: this.video(p.extra), label: t("{name}'s screen", { name: p.info.name }), main: true });
      }
      const cam = p.video && p.remote?.cam !== false ? p.video : null;
      if (cam) used.add(cam);
      // a phone used as someone's camera: only when it shows something
      if (p.info.of && !cam) continue;
      out.push({
        el: cam ? this.video(cam) : null,
        label: p.info.of ? `${p.info.name} · ${t('phone')}` : p.info.name,
        color: roleColor(p.info.role),
      });
    }
    const sheet = this.extraPicture?.();
    if (sheet) out.push({ el: sheet, label: '', main: true });
    const extra = this.host.extra();
    if (extra) {
      used.add(extra.track);
      out.push({ el: this.video(extra.track), label: extra.kind === 'screen' ? t('Your screen') : '', main: true });
    }
    const cam = this.host.camera();
    if (cam) used.add(cam);
    out.push({
      el: cam ? this.video(cam) : null,
      // as the others see it, not mirrored as in one's own preview: a score or a word held up reads right
      label: this.host.selfName(),
      color: '#f5b544',
    });
    for (const [k, el] of this.videos) {
      if (!used.has(k)) {
        el.srcObject = null;
        el.remove();
        this.videos.delete(k);
      }
    }
    return out;
  }

  /** A playing (hidden) video element for a stream or track: what the compositor draws from. */
  private video(src: MediaStream | MediaStreamTrack): HTMLVideoElement {
    let el = this.videos.get(src);
    if (!el) {
      if (!this.videoHost) {
        // in the page but out of sight: a detached or hidden element may stop decoding frames
        this.videoHost = document.createElement('div');
        this.videoHost.style.cssText =
          'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none';
        this.videoHost.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.videoHost);
      }
      el = document.createElement('video');
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
      el.srcObject = src instanceof MediaStream ? src : new MediaStream([src]);
      this.videoHost.appendChild(el);
      void el.play().catch(() => {});
      this.videos.set(src, el);
    }
    return el;
  }

  /** The mix: this side's microphone, the others' sound, the piano, the track and the metronome. */
  private wireSound(): void {
    const ctx = this.host.context();
    const dest = this.mix;
    if (!ctx || !dest) return;
    const want = new Map<string, { make: () => { node: AudioNode; src?: MediaStreamAudioSourceNode }; key: unknown }>();
    const mic = this.host.mic();
    if (mic && mic.readyState === 'live') {
      want.set('self', {
        key: mic,
        make: () => {
          const src = ctx.createMediaStreamSource(new MediaStream([mic]));
          return { node: src, src };
        },
      });
    }
    const stream = (key: string, a: MediaStream | null, same: unknown = a) => {
      if (!a || !a.getAudioTracks().length) return;
      want.set(key, {
        key: same,
        make: () => {
          const src = ctx.createMediaStreamSource(a);
          return { node: src, src };
        },
      });
    };
    for (const p of this.host.peers()) {
      stream(p.id, p.audio);
      // what their shared screen plays
      stream(`${p.id}:screen`, p.remote?.screenSound ? p.screenAudio : null);
    }
    const mine = this.host.screenSound();
    if (mine && mine.readyState === 'live') stream('self:screen', new MediaStream([mine]), mine);
    this.host.localSources().forEach((n, i) => want.set(`local${i}`, { key: n, make: () => ({ node: n }) }));
    for (const [k, f] of this.feeds) {
      if (want.get(k)?.key === f.key) continue;
      try {
        f.node.disconnect(dest);
      } catch {
        // already
      }
      this.feeds.delete(k);
    }
    for (const [k, w] of want) {
      if (this.feeds.has(k)) continue;
      const { node, src } = w.make();
      node.connect(dest);
      this.feeds.set(k, { node, src, key: w.key });
    }
  }

  /** One file per person's sound (when chosen): those who arrive later start later (their file says when). */
  private syncVoices(): void {
    const want = new Map<string, { name: string; stream: MediaStream }>();
    const mic = this.host.mic();
    if (mic && mic.readyState === 'live')
      want.set(this.host.selfId(), { name: this.host.selfName(), stream: new MediaStream([mic]) });
    for (const p of this.host.peers()) {
      if (p.audio?.getAudioTracks().length) want.set(p.id, { name: p.info.name, stream: p.audio });
    }
    for (const [id, v] of this.voices) {
      if (want.has(id)) continue;
      if (v.rec.state !== 'inactive') v.rec.stop();
    }
    const mime = pickMime(true);
    if (!mime) return;
    for (const [id, w] of want) {
      // a voice already recorded, or stopped (they left: their file ends there; a return gets no second file)
      if (this.voices.has(id) || this.opening.has(id)) continue;
      this.opening.add(id);
      const meta: RecMeta = {
        id: `${this.group}-v${++this.voiceCount}`,
        started: this.startedAt,
        mime,
        kind: 'voice',
        name: w.name,
        done: false,
        offsetMs: Date.now() - this.startedAt,
      };
      const p = this.begin(w.stream, meta, { audioBitsPerSecond: VOICE_BPS }).then(
        (tr) => {
          this.opening.delete(id);
          this.voices.set(id, tr);
          if (!this.recording) tr.rec.stop();
        },
        (e) => {
          this.opening.delete(id);
          log('voice recording failed', e);
        },
      );
      this.pending.push(p);
    }
  }

  private teardown(): void {
    this.stopEffect?.();
    this.stopEffect = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.comp?.stop();
    this.comp = null;
    for (const f of this.feeds.values()) {
      try {
        f.node.disconnect(this.mix!);
      } catch {
        // already
      }
    }
    this.feeds.clear();
    this.mix = null;
    for (const el of this.videos.values()) {
      el.srcObject = null;
      el.remove();
    }
    this.videos.clear();
    this.main = null;
    this.voices.clear();
    this.opening.clear();
    this.pending = [];
    this.voiceCount = 0;
  }
}

function roleColor(role: string): string {
  return role === 'observer' ? '#ab9dff' : '#52d6b4';
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
