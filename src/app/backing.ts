// The backing track: an audio file (MP3, WAV, FLAC…) that everyone in the lesson plays on their own device, in
// time, while they keep talking and playing over the call.
//
// The file itself travels once, over the file channel, so each side plays the original at full quality (it never
// goes through the microphone or the call's codec). What travels after that is only the transport: play, pause,
// position, speed, key, loop, and who plays along. One person plays or sings along (the reference); everyone else
// hears the track later by how long that person's sound takes to reach them, so the voice or instrument they hear
// lands in time with the track (src/media/backing-core.ts).
//
// Each side plays it with Signalsmith Stretch (src/media/stretch.ts): any speed with the pitch kept, any key with
// the speed kept, each change scheduled at an exact time of the audio clock. It plays into the audio engine's
// track bus, which the echo canceller takes as its reference: on speakers, the track is taken out of what the
// microphone sends (src/media/engine.ts). Each person sets their own volume.
//
// Who may change it: musicians. Observers hear it and set their own volume.

import { signal } from '@preact/signals';
import { engine } from '../media/engine.ts';
import { StretchPlayer } from '../media/stretch.ts';
import {
  cleanLoop,
  correction,
  localTarget,
  MAX_SEMITONES,
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
const LEAD_MS = 300;
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

  /** this side's player, once the file is decoded */
  private player: StretchPlayer | null = null;
  /** the version of the shared state the player's schedule follows (-1: none) */
  private plannedVer = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReport = 0;

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
    // whoever presses Play is about to sing or play along: the others hear the track in time with them (the
    // selector stays to change it by hand)
    this.change({ playing: true, pos: from, anchor: performance.now() + LEAD_MS, ref: this.host.selfId() });
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

  /** Who plays along until someone presses Play (who then does): someone else (a teacher loads the track their
   * student sings to). */
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
    // a report from before the last change (it crossed it on the way) is not taken
    if (Number(msg.ver) !== s.ver) return;
    const now = performance.now();
    const next = { ...s, pos, anchor: now - this.oneWay(from) };
    // a few ms of difference is the network's wobble, not drift
    if (Math.abs(timelinePos(this.timeline(next), now) - timelinePos(this.timeline(s), now)) > 0.015)
      this.shared.value = next;
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
    const ctx = engine.ensure();
    const fail = (e?: unknown) => {
      if (this.track.peek() !== tr) return;
      if (e) console.warn('[sonora] backing track', e);
      this.failed.value = true;
      toast({
        kind: 'warn',
        title: t('This browser cannot play {file}', { file: tr.name }),
        body: t('Try an MP3 or WAV file.'),
      });
    };
    if (!ctx || !engine.trackBus) return fail();
    void tr.blob
      .arrayBuffer()
      .then((data) => StretchPlayer.create(ctx, data, engine.trackBus!))
      .then((player) => {
        if (this.track.peek() !== tr) return player.dispose();
        this.player = player;
        this.duration.value = player.duration;
        this.applyVolume();
        this.reconcile();
      }, fail);
    if (!this.timer) this.timer = setInterval(() => this.reconcile(), TICK_MS);
  }

  private unload(): void {
    this.player?.dispose();
    this.player = null;
    this.plannedVer = -1;
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
   * How long the reference's sound takes to reach this side's ears (ms): their microphone's way out (as they said),
   * the network, this side's jitter buffer and its speakers. Their own speakers do not count: each side's track is
   * scheduled for the moment it is heard. 0 for the reference itself, or when the reference is not here.
   */
  private refDelay(s: Shared): number {
    if (s.ref === this.host.selfId()) return 0;
    const p = this.host.peers().find((x) => x.id === s.ref && x.link === 'connected');
    if (!p?.stats || p.stats.rtt === null) return 0;
    const want = (p.remote?.sendMs ?? 20) + p.stats.rtt / 2 + p.stats.bufferMs + engine.outputLatencyMs;
    // kept steady: changed only when it moves by more than a few ms
    const cur = this.delay.peek();
    if (Math.abs(want - cur) > 12 || cur === 0) this.delay.value = Math.round(want);
    return this.delay.peek();
  }

  /** Bring this side's track to where it should be now. */
  private reconcile(): void {
    const p = this.player;
    const s = this.shared.peek();
    if (!p || !s || this.track.peek()?.id !== s.id) return;
    const now = performance.now();
    const isRef = s.ref === this.host.selfId();
    const delay = s.playing ? this.refDelay(s) : 0;
    if (isRef) this.delay.value = 0;
    const target = localTarget(this.timeline(s), now, delay);

    if (!s.playing || target.ended) {
      p.stop();
      this.plannedVer = -1;
      this.sounding.value = false;
      this.position.value = target.pos;
      // at the end: everyone stops by themselves, at the start of the next play
      if (target.ended && s.playing) this.shared.value = { ...s, playing: false, pos: target.pos, anchor: now };
      return;
    }
    const heard = p.positionAt(now);
    this.position.value = heard ?? target.pos;
    this.sounding.value = p.playing;
    const cur = p.current;
    // a command (play, seek, speed, key, loop): scheduled as soon as the player can, on the timeline
    if (!cur || heard === null || this.plannedVer !== s.ver) return this.plan(p, s, delay);
    // not heard yet (scheduled a moment ahead, as the player needs): nothing to correct, nothing to report
    // (reporting the waiting position as playing would put the others' tracks late)
    if (target.wait > 0 || p.toPerf(cur.at) > now) return;
    let ahead = target.pos - heard;
    // across the loop's end, the short way round
    if (s.loop) {
      const len = s.loop.b - s.loop.a;
      if (ahead > len / 2) ahead -= len;
      else if (ahead < -len / 2) ahead += len;
    }
    const c = correction(ahead, s.rate);
    if (c.seek) return this.plan(p, s, delay);
    // a little faster or slower for a moment (or back to the speed), from where it is
    if (Math.abs(c.rate - cur.rate) > 1e-4) {
      const at = p.earliest();
      p.play(at, p.positionAt(at) ?? target.pos, c.rate, s.semis, s.loop);
    }
    if (isRef) this.report(s, heard);
  }

  /** Schedule the track on the timeline: heard from the first moment the player can, or when it starts here. */
  private plan(p: StretchPlayer, s: Shared, delay: number): void {
    const tl = this.timeline(s);
    const now = performance.now();
    const at = Math.max(p.earliest(), now + localTarget(tl, now, delay).wait);
    p.play(at, localTarget(tl, at, delay).pos, s.rate, s.semis, s.loop);
    this.plannedVer = s.ver;
    this.sounding.value = true;
  }

  /** The reference: where its track is heard, to everyone (every few seconds). */
  private report(s: Shared, pos: number): void {
    const t0 = performance.now();
    if (t0 - this.lastReport < REPORT_MS) return;
    this.lastReport = t0;
    this.host.send({ t: 'bt-at', id: s.id, ver: s.ver, pos });
  }

  private applyVolume(): void {
    const v = settings.peek().backingVolume;
    // a perceived volume: the slider's middle is about −12 dB
    this.player?.setVolume(v * v);
  }

  /** For tests: where this side's track is heard at a moment of the shared wall clock (ms since 1970), or null. */
  heardAt(epochMs: number): number | null {
    return this.player?.positionAt(epochMs - performance.timeOrigin) ?? null;
  }
}
