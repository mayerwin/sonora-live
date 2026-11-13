// The shared metronome. Tempo, beats per bar, subdivisions and the accent are the same for everyone; each person sets
// their own volume. Whoever starts it is the one it is in time with: they hear it on time, the others later by how
// long that person's sound takes to reach them, so the playing they hear lands on the clicks (as for the backing
// track, src/app/backing.ts). Clicks are made here (src/media/clicks.ts), scheduled a little ahead at exact times
// of the audio clock, and played into the track bus: on speakers they are kept out of the microphone too.

import { signal } from '@preact/signals';
import { engine } from '../media/engine.ts';
import { ClickVoice } from '../media/clicks.ts';
import { ctxTimeAt } from '../media/clock.ts';
import { timelinePos } from '../media/backing-core.ts';
import { beatTimeline, clampBpm, clicksBetween, type ClickKind, type MetronomeSetup } from '../media/metronome-core.ts';
import type { BackingHost } from './backing.ts';
import { settings, update } from './settings.ts';
import { oneWay, soundDelayFrom } from './sync.ts';

/** a start begins this long after it is given, so it begins everywhere together */
const LEAD_MS = 200;
/** clicks are scheduled this far ahead */
const LOOKAHEAD_MS = 160;
const TICK_MS = 25;

export interface MetroShared extends MetronomeSetup {
  running: boolean;
  /** the beat at `anchor` */
  beat: number;
  /** this side's performance.now() when the timeline is at `beat` */
  anchor: number;
  /** who it is in time with */
  ref: string;
  ver: number;
  by: string;
}

export class Metronome {
  readonly shared = signal<MetroShared>(this.initial());
  /** the beat of the bar heard last (for the lights), and when */
  readonly lit = signal<{ beat: number; kind: ClickKind; at: number } | null>(null);
  /** this side hears it this much after the one it is in time with (ms) */
  readonly delay = signal(0);

  private voice: ClickVoice | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** clicks are scheduled up to here (this side's clock) */
  private until = 0;
  private flashes: ReturnType<typeof setTimeout>[] = [];

  constructor(private host: BackingHost) {}

  private initial(): MetroShared {
    const m = settings.peek().metronome;
    return {
      running: false,
      beat: 0,
      anchor: 0,
      bpm: clampBpm(m.bpm),
      beats: m.beats,
      sub: m.sub,
      accent: m.accent,
      ref: '',
      ver: 0,
      by: '',
    };
  }

  get canControl(): boolean {
    return !this.host.observer();
  }

  // ============================================================================================ commands

  /** Start it: whoever starts it is the one it is in time with. */
  start(): void {
    if (this.shared.peek().running) return;
    this.change({ running: true, beat: 0, anchor: performance.now() + LEAD_MS, ref: this.host.selfId() });
  }

  stop(): void {
    if (!this.shared.peek().running) return;
    this.change({ running: false });
  }

  toggle(): void {
    if (this.shared.peek().running) this.stop();
    else this.start();
  }

  /** A new tempo: while it runs, it carries on from the beat it is at, at the new speed. */
  setBpm(bpm: number): void {
    const s = this.shared.peek();
    const v = clampBpm(bpm);
    if (v === s.bpm) return;
    this.remember({ bpm: v });
    if (!s.running) return this.change({ bpm: v });
    const now = performance.now();
    if (s.anchor > now) return this.change({ bpm: v });
    this.change({ bpm: v, beat: timelinePos(beatTimeline(true, s.beat, s.anchor, s.bpm), now), anchor: now });
  }

  setBeats(beats: number): void {
    const v = Math.max(1, Math.min(12, Math.round(beats)));
    this.remember({ beats: v });
    this.change({ beats: v });
  }

  setSub(sub: MetronomeSetup['sub']): void {
    this.remember({ sub });
    this.change({ sub });
  }

  setAccent(accent: boolean): void {
    this.remember({ accent });
    this.change({ accent });
  }

  setReference(id: string): void {
    const s = this.shared.peek();
    if (s.ref === id) return;
    this.change({ ref: id });
  }

  /** This side's volume (not shared). */
  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v));
    this.remember({ volume: vol });
    this.voice?.setVolume(vol * vol);
  }

  /** The tempo, beats and accent this device starts with next time. */
  private remember(patch: Partial<ReturnType<typeof settings.peek>['metronome']>): void {
    update({ metronome: { ...settings.peek().metronome, ...patch } });
  }

  private change(patch: Partial<MetroShared>): void {
    if (!this.canControl) return;
    const s = this.shared.peek();
    this.apply({ ...s, ...patch, ver: s.ver + 1, by: this.host.selfId() });
    this.broadcast();
  }

  // ============================================================================================ messages

  private message(s: MetroShared): Record<string, unknown> {
    const now = performance.now();
    const lead = s.running ? Math.max(0, s.anchor - now) : 0;
    const beat = s.running && lead === 0 ? timelinePos(beatTimeline(true, s.beat, s.anchor, s.bpm), now) : s.beat;
    return {
      t: 'mt',
      running: s.running,
      beat,
      lead: Math.round(lead),
      bpm: s.bpm,
      beats: s.beats,
      sub: s.sub,
      accent: s.accent,
      ref: s.ref,
      ver: s.ver,
      by: s.by,
    };
  }

  private broadcast(to?: string): void {
    this.host.send(this.message(this.shared.peek()), to);
  }

  onControl(from: string, msg: Record<string, unknown>): void {
    const peer = this.host.peers().find((p) => p.id === from);
    if (!peer || peer.info.role === 'observer') return;
    const ver = Number(msg.ver);
    const by = typeof msg.by === 'string' ? msg.by : '';
    if (!Number.isFinite(ver) || !by) return;
    const cur = this.shared.peek();
    if (ver < cur.ver || (ver === cur.ver && by <= cur.by)) return;
    const sub = Number(msg.sub);
    const lead = Math.max(0, Math.min(5000, Number(msg.lead) || 0));
    const beat = Number(msg.beat);
    this.apply({
      running: msg.running === true,
      beat: Number.isFinite(beat) ? beat : 0,
      anchor: performance.now() + lead - oneWay(this.host.peers(), from),
      bpm: clampBpm(Number(msg.bpm)),
      beats: Math.max(1, Math.min(12, Math.round(Number(msg.beats)) || 4)),
      sub: sub === 2 || sub === 3 || sub === 4 ? sub : 1,
      accent: msg.accent !== false,
      ref: typeof msg.ref === 'string' ? msg.ref : by,
      ver,
      by,
    });
  }

  /** Someone joined or connected again: they get where it is. */
  onConnected(id: string): void {
    if (this.shared.peek().ver > 0) this.broadcast(id);
  }

  /** Leaving the lesson. */
  clear(): void {
    this.apply({ ...this.initial(), ver: 0 });
    this.voice?.dispose();
    this.voice = null;
  }

  // ============================================================================================ playing

  private apply(next: MetroShared): void {
    const before = this.shared.peek();
    this.shared.value = next;
    // anything about the beat changed: what was scheduled ahead is redone from now
    if (
      before.running !== next.running ||
      before.anchor !== next.anchor ||
      before.beat !== next.beat ||
      before.bpm !== next.bpm ||
      before.sub !== next.sub ||
      before.beats !== next.beats ||
      before.accent !== next.accent ||
      before.ref !== next.ref
    ) {
      this.voice?.cancel();
      for (const f of this.flashes.splice(0)) clearTimeout(f);
      this.until = 0;
    }
    if (next.running && !this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    } else if (!next.running && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.lit.value = null;
    }
  }

  private delayNow(s: MetroShared): number {
    const want = soundDelayFrom(this.host.peers(), this.host.selfId(), s.ref);
    const cur = this.delay.peek();
    if (want === 0 || Math.abs(want - cur) > 12) this.delay.value = Math.round(want);
    return this.delay.peek();
  }

  private ensureVoice(): ClickVoice | null {
    const ctx = engine.ensure();
    if (!ctx || !engine.trackBus) return null;
    if (!this.voice) {
      this.voice = new ClickVoice(ctx, engine.trackBus);
      const v = settings.peek().metronome.volume;
      this.voice.setVolume(v * v);
    }
    return this.voice;
  }

  /** Schedule the clicks of the next moment. */
  private tick(): void {
    const s = this.shared.peek();
    if (!s.running) return;
    const voice = this.ensureVoice();
    const ctx = engine.ctx;
    if (!voice || !ctx) return;
    const now = performance.now();
    const from = Math.max(this.until, now);
    const to = now + LOOKAHEAD_MS;
    const delay = this.delayNow(s);
    const clicks = clicksBetween(beatTimeline(true, s.beat, s.anchor, s.bpm), s, from, to, delay);
    for (const c of clicks) {
      voice.play(c.kind, ctxTimeAt(ctx, c.at));
      if (c.kind !== 'sub') {
        this.flashes.push(
          setTimeout(() => (this.lit.value = { beat: c.beat, kind: c.kind, at: c.at }), Math.max(0, c.at - now)),
        );
      }
    }
    if (this.flashes.length > 64) this.flashes.splice(0, this.flashes.length - 64);
    this.until = to;
  }

  /** For tests: the clicks this side will hear between two moments of the shared wall clock (ms since 1970). */
  heardBetween(fromEpoch: number, toEpoch: number): { at: number; kind: ClickKind }[] {
    const s = this.shared.peek();
    const o = performance.timeOrigin;
    return clicksBetween(
      beatTimeline(s.running, s.beat, s.anchor, s.bpm),
      s,
      fromEpoch - o,
      toEpoch - o,
      this.delay.peek(),
    ).map((c) => ({ at: c.at + o, kind: c.kind }));
  }
}
