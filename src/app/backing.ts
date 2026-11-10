// The backing track: an audio file (MP3, WAV, FLAC…) that everyone in the lesson plays on their own device, in
// time, while they keep talking and playing over the call.
//
// The file itself travels once, over the file channel, so each side plays the original at full quality (it never
// goes through the microphone or the call's codec). What travels after that is only the transport: play, pause,
// position, speed, key, loop, and who plays along. One person plays or sings along (the reference); everyone else
// hears the track later by how long that person's sound takes to reach them, so the voice or instrument they hear
// lands in time with the track (src/media/backing-core.ts).
//
// The track plays through the audio engine, so the music-safe echo canceller knows it and keeps it out of what the
// microphone sends; with headphones there is nothing to cancel. Each person sets their own volume.
//
// Who may change it: musicians. Observers hear it and set their own volume.

import { signal } from '@preact/signals';
import { engine } from '../media/engine.ts';
import pitchWorkletUrl from '../media/pitch.worklet.ts?worker&url';
import {
  cleanLoop,
  correction,
  localTarget,
  MAX_SEMITONES,
  pitchLatency,
  timelinePos,
  type Loop,
  type Timeline,
} from '../media/backing-core.ts';
import { newId } from './chat.ts';
import { toast } from './notify.ts';
import { settings, update } from './settings.ts';
import { t } from './i18n.ts';
import type { PeerView } from './participants.ts';

/** larger than chat files: a few minutes of WAV */
export const MAX_TRACK_BYTES = 100 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|wav|wave|flac|ogg|oga|opus|m4a|aac|webm|aif|aiff)$/i;
/** a play command starts this long after it is given, so it starts everywhere at the same moment */
const LEAD_MS = 150;
const TICK_MS = 100;
/** how often the reference tells the others where its track is */
const REPORT_MS = 2000;

export interface TrackMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

/** What everyone agrees on (the newest version wins). */
export interface Shared {
  /** the track it is about (null: no track) */
  id: string | null;
  playing: boolean;
  /** position at `anchor` (seconds) */
  pos: number;
  /** this side's performance.now() when the timeline is at `pos` */
  anchor: number;
  rate: number;
  /** transposition, semitones */
  semis: number;
  loop: Loop | null;
  /** who plays or sings along: the others hear the track in time with them */
  ref: string;
  ver: number;
  by: string;
}

/** What the backing track needs of the lesson (the session in the app). */
export interface BackingHost {
  selfId(): string;
  /** this side only listens */
  observer(): boolean;
  peers(): PeerView[];
  /** a control message to everyone, or to one person */
  send(msg: Record<string, unknown>, to?: string): void;
  /** the file, over the file channel, to everyone or to one person */
  sendFile(meta: TrackMeta, blob: Blob, to?: string): void;
  /** a line in the chat */
  note(text: string): void;
}

interface Track extends TrackMeta {
  owner: string;
  blob: Blob;
  url: string;
}

export class BackingTrack {
  /** the track loaded here */
  readonly track = signal<Track | null>(null);
  /** a track on its way from someone */
  readonly incoming = signal<{ name: string; progress: number; from: string } | null>(null);
  readonly shared = signal<Shared | null>(null);
  /** where this side's track is now (seconds), for the screen */
  readonly position = signal(0);
  readonly duration = signal(0);
  /** this side is playing it now (the lead-in and the delay included) */
  readonly sounding = signal(false);
  /** this side hears the track this much after the reference (ms) */
  readonly delay = signal(0);
  /** this browser cannot play the file */
  readonly failed = signal(false);

  private el: HTMLAudioElement | null = null;
  private ready = false;
  private graph: {
    src: MediaElementAudioSourceNode;
    gain: GainNode;
    pitch: AudioWorkletNode | null;
    /** the pitch ratio last told to the shifter */
    ratio: number;
  } | null = null;
  private pitchLoaded: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReport = 0;
  /** the reference's output latency, as it said (ms) */
  private refOut = 0;

  constructor(private host: BackingHost) {}

  // =========================================================================================== commands

  /** Can this side change the track (musicians)? */
  get canControl(): boolean {
    return !this.host.observer();
  }

  /** Load a file from this device and share it with everyone. */
  load(file: File): void {
    if (!this.canControl) return;
    if (file.size > MAX_TRACK_BYTES) {
      toast({ kind: 'warn', title: t('File too large'), body: t('Backing tracks can be up to 100 MB.') });
      return;
    }
    if (!/^audio\//.test(file.type) && !AUDIO_EXT.test(file.name)) {
      toast({ kind: 'warn', title: t('Not an audio file'), body: t('Choose an MP3, WAV, FLAC, M4A or OGG file.') });
      return;
    }
    engine.ensure();
    const meta: TrackMeta = { id: newId(), name: file.name.slice(0, 120), size: file.size, mime: file.type };
    this.setTrack({ ...meta, owner: this.host.selfId(), blob: file, url: URL.createObjectURL(file) });
    const prev = this.shared.peek();
    this.shared.value = {
      id: meta.id,
      playing: false,
      pos: 0,
      anchor: performance.now(),
      rate: 1,
      semis: 0,
      loop: null,
      ref: this.defaultRef(),
      ver: (prev?.ver ?? 0) + 1,
      by: this.host.selfId(),
    };
    this.broadcast();
    this.host.sendFile(meta, file);
  }

  /** Take the track away, for everyone. */
  remove(): void {
    if (!this.canControl) return;
    const prev = this.shared.peek();
    this.unload();
    this.shared.value = {
      id: null,
      playing: false,
      pos: 0,
      anchor: performance.now(),
      rate: 1,
      semis: 0,
      loop: null,
      ref: this.host.selfId(),
      ver: (prev?.ver ?? 0) + 1,
      by: this.host.selfId(),
    };
    this.broadcast();
  }

  play(): void {
    const s = this.shared.peek();
    if (!s || s.playing || !this.canControl) return;
    const dur = this.duration.peek();
    // from the start again once at the end
    const from = dur > 0 && s.pos >= dur - 0.05 ? (s.loop?.a ?? 0) : s.pos;
    this.change({ playing: true, pos: from, anchor: performance.now() + LEAD_MS });
  }

  pause(): void {
    const s = this.shared.peek();
    if (!s || !s.playing) return;
    const now = performance.now();
    this.change({ playing: false, pos: Math.max(0, timelinePos(this.timeline(s), now)), anchor: now });
  }

  /** Pause and back to the start (of the loop, when there is one). */
  stop(): void {
    const s = this.shared.peek();
    if (!s) return;
    this.change({ playing: false, pos: s.loop?.a ?? 0, anchor: performance.now() });
  }

  seek(pos: number): void {
    const s = this.shared.peek();
    if (!s) return;
    const dur = this.duration.peek();
    const p = Math.max(0, dur > 0 ? Math.min(pos, dur) : pos);
    this.change({ pos: p, anchor: performance.now() + (s.playing ? LEAD_MS : 0) });
  }

  setRate(rate: number): void {
    const s = this.shared.peek();
    if (!s || !(rate > 0.2 && rate <= 4)) return;
    this.change({ ...this.here(s), rate });
  }

  setSemitones(semis: number): void {
    const s = this.shared.peek();
    if (!s) return;
    const v = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, Math.round(semis)));
    this.change({ ...this.here(s), semis: v });
  }

  setLoop(loop: Loop | null): void {
    const s = this.shared.peek();
    if (!s) return;
    this.change({ ...this.here(s), loop: cleanLoop(loop, this.duration.peek()) });
  }

  /** Who plays or sings along (the others hear the track in time with them). */
  setReference(id: string): void {
    const s = this.shared.peek();
    if (!s) return;
    this.change({ ...this.here(s), ref: id });
  }

  /** This side's volume (not shared). */
  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v));
    update({ backingVolume: vol });
    this.applyVolume();
  }

  /** The position now, as the base of a change that keeps playing from there. */
  private here(s: Shared): { pos: number; anchor: number } {
    const now = performance.now();
    if (s.playing && s.anchor > now) return { pos: s.pos, anchor: s.anchor };
    return { pos: timelinePos(this.timeline(s), now), anchor: now };
  }

  private change(patch: Partial<Shared>): void {
    const s = this.shared.peek();
    if (!s || !this.canControl) return;
    this.shared.value = { ...s, ...patch, ver: s.ver + 1, by: this.host.selfId() };
    this.broadcast();
    this.reconcile();
  }

  /** Who plays along by default: someone else (a teacher loads the track their student sings to). */
  private defaultRef(): string {
    const other = this.host
      .peers()
      .find((p) => p.link === 'connected' && p.info.role === 'player' && p.id !== this.host.selfId());
    return other?.id ?? this.host.selfId();
  }

  // =========================================================================================== messages

  private message(s: Shared): Record<string, unknown> {
    const now = performance.now();
    const lead = s.playing ? Math.max(0, s.anchor - now) : 0;
    const pos = lead > 0 || !s.playing ? s.pos : timelinePos(this.timeline(s), now);
    return {
      t: 'bt',
      id: s.id,
      playing: s.playing,
      pos,
      lead: Math.round(lead),
      rate: s.rate,
      semis: s.semis,
      loop: s.loop,
      ref: s.ref,
      ver: s.ver,
      by: s.by,
    };
  }

  private broadcast(to?: string): void {
    const s = this.shared.peek();
    if (s) this.host.send(this.message(s), to);
  }

  /** A transport message from someone. */
  onControl(from: string, msg: Record<string, unknown>): void {
    const peer = this.host.peers().find((p) => p.id === from);
    if (!peer || peer.info.role === 'observer') return;
    if (msg.t === 'bt-at') return this.onReport(from, msg);
    const id = msg.id === null ? null : typeof msg.id === 'string' ? msg.id.slice(0, 40) : undefined;
    const ver = Number(msg.ver);
    const by = typeof msg.by === 'string' ? msg.by : '';
    if (id === undefined || !Number.isFinite(ver) || !by) return;
    const cur = this.shared.peek();
    if (cur && (ver < cur.ver || (ver === cur.ver && by <= cur.by))) return;
    const rate = Number(msg.rate);
    const semis = Number(msg.semis);
    const pos = Number(msg.pos);
    const lead = Math.max(0, Math.min(5000, Number(msg.lead) || 0));
    const loop = msg.loop as Loop | null;
    const next: Shared = {
      id,
      playing: msg.playing === true,
      pos: Number.isFinite(pos) && pos >= 0 ? pos : 0,
      anchor: performance.now() + lead - this.oneWay(from),
      rate: rate > 0.2 && rate <= 4 ? rate : 1,
      semis: Number.isFinite(semis) ? Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, Math.round(semis))) : 0,
      loop: loop && typeof loop === 'object' ? cleanLoop({ a: Number(loop.a), b: Number(loop.b) }, 0) : null,
      ref: typeof msg.ref === 'string' ? msg.ref : by,
      ver,
      by,
    };
    const had = this.track.peek();
    this.shared.value = next;
    if (id === null) {
      if (had) {
        this.unload();
        this.host.note(t('{name} removed the backing track', { name: peer.info.name }));
      }
      return;
    }
    // another track is coming: the one here is over
    if (had && had.id !== id) this.unload();
    this.reconcile();
  }

  /** The reference says where its track is: the timeline follows it (its track is the one in time). */
  private onReport(from: string, msg: Record<string, unknown>): void {
    const s = this.shared.peek();
    if (!s || !s.playing || s.ref !== from || msg.id !== s.id) return;
    const pos = Number(msg.pos);
    if (!Number.isFinite(pos) || pos < 0) return;
    const out = Number(msg.out);
    if (Number.isFinite(out) && out >= 0 && out < 500) this.refOut = out;
    // a report from before the last change (it crossed it on the way) is not taken
    if (Number(msg.ver) !== s.ver) return;
    this.shared.value = { ...s, pos, anchor: performance.now() - this.oneWay(from) };
  }

  /** Someone joined, or connected again: they get the track and where it is. */
  onConnected(id: string): void {
    const s = this.shared.peek();
    if (!s || s.id === null) return;
    const tr = this.track.peek();
    if (tr && tr.id === s.id && this.sendsTo(tr)) this.host.sendFile(tr, tr.blob, id);
    this.broadcast(id);
  }

  /** One holder sends the file to newcomers: the one who loaded it, or, when they are gone, the smallest id. */
  private sendsTo(tr: Track): boolean {
    const self = this.host.selfId();
    if (tr.owner === self) return true;
    const present = this.host.peers().filter((p) => p.link === 'connected');
    if (present.some((p) => p.id === tr.owner)) return false;
    return present.every((p) => p.id > self);
  }

  // =========================================================================================== the file

  /** A track starts arriving (the file channel). */
  receiving(from: string, meta: TrackMeta): void {
    this.incoming.value = { name: meta.name, progress: 0, from };
  }

  progress(from: string, progress: number): void {
    const cur = this.incoming.peek();
    if (cur && cur.from === from) this.incoming.value = { ...cur, progress };
  }

  /** A track arrived complete (or not: `ok` false). */
  received(from: string, meta: TrackMeta, blob: Blob | null): void {
    const cur = this.incoming.peek();
    if (cur?.from === from) this.incoming.value = null;
    if (!blob) return;
    const s = this.shared.peek();
    // a track replaced (or removed) since it was sent
    if (s && s.id !== meta.id) return;
    if (this.track.peek()?.id === meta.id) return;
    const peer = this.host.peers().find((p) => p.id === from);
    this.setTrack({ ...meta, owner: from, blob, url: URL.createObjectURL(blob) });
    if (!s) {
      this.shared.value = {
        id: meta.id,
        playing: false,
        pos: 0,
        anchor: performance.now(),
        rate: 1,
        semis: 0,
        loop: null,
        ref: from,
        ver: 0,
        by: from,
      };
    }
    const name = peer?.info.name ?? t('Someone');
    this.host.note(t('{name} shared a backing track: {file}', { name, file: meta.name }));
    toast({
      kind: 'info',
      title: t('Backing track from {name}', { name }),
      body: t('{file} plays here in time with the lesson. Set your own volume in the player.', {
        file: meta.name,
      }),
    });
  }

  private setTrack(tr: Track): void {
    this.unload();
    this.failed.value = false;
    this.track.value = tr;
    const el = new Audio();
    el.preload = 'auto';
    // the speed changes, the pitch stays
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    el.setAttribute('playsinline', '');
    el.addEventListener('loadedmetadata', () => {
      if (this.el !== el) return;
      this.duration.value = Number.isFinite(el.duration) ? el.duration : 0;
      this.ready = true;
      this.reconcile();
    });
    el.addEventListener('error', () => {
      if (this.el !== el) return;
      this.failed.value = true;
      toast({
        kind: 'warn',
        title: t('This browser cannot play {file}', { file: tr.name }),
        body: t('Try an MP3 or WAV file.'),
      });
    });
    el.src = tr.url;
    this.el = el;
    this.applyVolume();
    if (!this.timer) this.timer = setInterval(() => this.reconcile(), TICK_MS);
  }

  private unload(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    const el = this.el;
    this.el = null;
    this.ready = false;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (this.graph) {
      for (const n of [this.graph.src, this.graph.pitch, this.graph.gain]) {
        if (!n) continue;
        if (n instanceof AudioWorkletNode) n.port.postMessage({ stop: true });
        try {
          n.disconnect();
        } catch {
          // already
        }
      }
      this.graph = null;
    }
    const tr = this.track.peek();
    if (tr) URL.revokeObjectURL(tr.url);
    this.track.value = null;
    this.duration.value = 0;
    this.position.value = 0;
    this.sounding.value = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Leaving the lesson: nothing is kept. */
  clear(): void {
    this.unload();
    this.shared.value = null;
    this.incoming.value = null;
  }

  /** Someone left: a file they were sending will not finish. */
  peerGone(id: string): void {
    if (this.incoming.peek()?.from === id) this.incoming.value = null;
  }

  // =========================================================================================== playing

  private timeline(s: Shared): Timeline {
    return {
      playing: s.playing,
      pos: s.pos,
      anchor: s.anchor,
      rate: s.rate,
      loop: s.loop,
      duration: this.duration.peek(),
    };
  }

  /** half the round trip to someone (ms) */
  private oneWay(id: string): number {
    const rtt = this.host.peers().find((p) => p.id === id)?.stats?.rtt;
    return typeof rtt === 'number' ? rtt / 2 : 0;
  }

  /**
   * How long the reference's sound takes to reach this side's ears (ms): their speakers (as they said), their
   * microphone's way out, the network, this side's jitter buffer. 0 for the reference itself, or when the
   * reference is not here.
   */
  private refDelay(s: Shared): number {
    if (s.ref === this.host.selfId()) return 0;
    const p = this.host.peers().find((x) => x.id === s.ref && x.link === 'connected');
    if (!p?.stats || p.stats.rtt === null) return 0;
    const want = this.refOut + (p.remote?.sendMs ?? 20) + p.stats.rtt / 2 + p.stats.bufferMs;
    // kept steady: changed only when it moves by more than a few ms
    const cur = this.delay.peek();
    if (Math.abs(want - cur) > 12 || cur === 0) this.delay.value = Math.round(want);
    return this.delay.peek();
  }

  /** the pitch shifter's own delay (seconds): the element runs that much ahead */
  private pitchLead(): number {
    const ctx = engine.ctx;
    if (!this.graph?.pitch || !ctx) return 0;
    return pitchLatency(ctx.sampleRate);
  }

  /** Bring this side's track to where it should be now. */
  private reconcile(): void {
    const el = this.el;
    const s = this.shared.peek();
    if (!el || !s || !this.ready || this.track.peek()?.id !== s.id) return;
    this.wire(s);
    const now = performance.now();
    const isRef = s.ref === this.host.selfId();
    const delay = s.playing ? this.refDelay(s) : 0;
    if (isRef) this.delay.value = 0;
    const lead = this.pitchLead();
    const target = localTarget(this.timeline(s), now, delay);
    this.position.value = s.playing && !el.paused ? Math.max(0, el.currentTime - lead) : target.pos;

    if (!s.playing || target.ended) {
      if (!el.paused) el.pause();
      if (this.startTimer) clearTimeout(this.startTimer);
      this.startTimer = null;
      if (Math.abs(el.currentTime - target.pos) > 0.05) el.currentTime = target.pos;
      this.sounding.value = false;
      // at the end: everyone stops by themselves, at the start of the next play
      if (target.ended && s.playing) this.shared.value = { ...s, playing: false, pos: target.pos, anchor: now };
      return;
    }
    if (target.wait > 0) {
      // not yet (the lead-in, or the delay behind the reference): ready at the start, then started on time
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - (target.pos + lead)) > 0.02) el.currentTime = target.pos + lead;
      if (!this.startTimer && target.wait < TICK_MS * 1.5) {
        this.startTimer = setTimeout(() => {
          this.startTimer = null;
          this.reconcile();
        }, target.wait);
      }
      return;
    }
    const loop = s.loop;
    if (el.paused) {
      el.currentTime = target.pos + lead;
      el.playbackRate = s.rate;
      void el.play().then(
        () => (this.sounding.value = true),
        () => {
          // the browser wants a tap first (autoplay rules): the next tap or command starts it
          this.sounding.value = false;
        },
      );
      return;
    }
    // the loop's end, here: back to its start
    if (loop && el.currentTime - lead >= loop.b) {
      el.currentTime = loop.a + (el.currentTime - lead - loop.b) + lead;
      if (isRef) this.report(s, true);
      return;
    }
    if (isRef) {
      // the reference's track is the clock: it plays at the chosen speed and tells the others where it is
      el.playbackRate = s.rate;
      this.report(s);
      return;
    }
    const c = correction(target.pos + lead - el.currentTime, s.rate);
    if (c.seek) el.currentTime = target.pos + lead;
    if (Math.abs(el.playbackRate - c.rate) > 1e-4) el.playbackRate = c.rate;
  }

  /** The reference: where its track is, to everyone (every few seconds, and at once after a jump). */
  private report(s: Shared, now = false): void {
    const el = this.el;
    if (!el || el.paused) return;
    const t0 = performance.now();
    if (!now && t0 - this.lastReport < REPORT_MS) return;
    this.lastReport = t0;
    const pos = Math.max(0, el.currentTime - this.pitchLead());
    // this side's timeline follows its own track (it is the clock)
    this.shared.value = { ...s, pos, anchor: t0 };
    this.host.send({ t: 'bt-at', id: s.id, ver: s.ver, pos, out: engine.outputLatencyMs });
  }

  /** The element plays through the audio engine (the echo canceller hears it), with the pitch shifter when needed. */
  private wire(s: Shared): void {
    const el = this.el;
    if (!el) return;
    const ctx = engine.ctx;
    if (!this.graph) {
      if (!ctx || ctx.state !== 'running' || !engine.out) return;
      try {
        const src = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        src.connect(gain).connect(engine.out);
        this.graph = { src, gain, pitch: null, ratio: 1 };
        this.applyVolume();
      } catch (e) {
        console.warn('[sonora] backing track through the engine', e);
        return;
      }
    }
    const g = this.graph;
    const want = s.semis !== 0;
    if (want && !g.pitch && ctx) {
      if (!this.pitchLoaded)
        this.pitchLoaded = ctx.audioWorklet.addModule(pitchWorkletUrl).then(
          () => true,
          () => false,
        );
      void this.pitchLoaded.then((ok) => {
        if (!ok || this.graph !== g || g.pitch || this.shared.peek()?.semis === 0) return;
        const node = new AudioWorkletNode(ctx, 'sonora-pitch', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        g.src.disconnect();
        g.src.connect(node).connect(g.gain);
        g.pitch = node;
        g.ratio = 2 ** ((this.shared.peek()?.semis ?? 0) / 12);
        node.port.postMessage({ ratio: g.ratio });
        // the element now runs ahead of the shifter's delay
        const e2 = this.el;
        if (e2 && !e2.paused) e2.currentTime += this.pitchLead();
      });
    } else if (!want && g.pitch) {
      const lead = this.pitchLead();
      g.pitch.port.postMessage({ stop: true });
      g.src.disconnect();
      g.pitch.disconnect();
      g.pitch = null;
      g.src.connect(g.gain);
      if (!el.paused) el.currentTime = Math.max(0, el.currentTime - lead);
    } else if (g.pitch && g.ratio !== 2 ** (s.semis / 12)) {
      g.ratio = 2 ** (s.semis / 12);
      g.pitch.port.postMessage({ ratio: g.ratio });
    }
  }

  private applyVolume(): void {
    const v = settings.peek().backingVolume;
    // a perceived volume: the slider's middle is about −12 dB
    const gain = v * v;
    if (this.graph) {
      this.graph.gain.gain.value = gain;
      if (this.el) this.el.volume = 1;
    } else if (this.el) {
      this.el.volume = gain;
    }
  }
}
