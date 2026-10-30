// The built-in piano: plays the other side's MIDI when no instrument is connected here (and the on-screen keys).
//
// Sound: the Splendid Grand Piano, a Steinway D sampled by Akai and released into the public domain, as
// remastered by the SFZ Instruments project: 4 velocity layers, a sample every one or two semitones (226 samples).
// Served by this site (Opus for Chromium and Firefox, AAC for Apple devices) and cached for offline use.
//
// Playing: what makes a sampled piano feel like an instrument rather than a sample player:
//   • velocity picks the layer (the tone colour changes with touch, not only the loudness), with equal-power
//     crossfades between layers, so no step is audible when playing softer or louder;
//   • a loudness curve over a 30 dB range and a gentle darkening of very soft notes;
//   • dampers: a released key is damped like a real string (longer in the bass), the top octave and a half has
//     no dampers and rings on, as on a real grand;
//   • sustain (CC 64, with half-pedalling), sostenuto (CC 66) and una corda (CC 67), per player;
//   • re-striking a ringing note damps the previous strike, as the hammer does;
//   • a small concert-room reverb, a little richer while the sustain pedal is down (sympathetic resonance);
//   • a soft limiter, so a fortissimo chord with the pedal down never distorts.
// Latency: notes start immediately on an "interactive" audio context, at the sample's first sample.

import { signal } from '@preact/signals';

/** Sampled notes per layer (MIDI numbers), from public/piano. */
const SAMPLES: Record<LayerName, number[]> = {
  pp: [23, 27, 29, 31, 33, 35, 37, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 56, 57, 58, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 80, 81, 82, 83, 85, 86, 87, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108],
  mp: [23, 27, 29, 31, 33, 35, 37, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 56, 57, 58, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 80, 81, 82, 83, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 101, 102, 103, 104, 105, 106],
  mf: [23, 27, 29, 31, 33, 35, 37, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 56, 57, 58, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 80, 81, 82, 83, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108],
  ff: [23, 27, 29, 31, 33, 35, 37, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 56, 57, 58, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 80, 81, 82, 83, 85, 86, 88, 89, 91, 93],
};

type LayerName = 'pp' | 'mp' | 'mf' | 'ff';

/** Velocity zones: [from, to, layer]. The softest zone uses the pp samples, darkened. */
const ZONES: [number, number, LayerName][] = [
  [1, 67, 'pp'],
  [68, 84, 'mp'],
  [85, 100, 'mf'],
  [101, 127, 'ff'],
];
const XFADE = 4;
const LOAD_ORDER: LayerName[] = ['mf', 'mp', 'pp', 'ff'];
/** first undamped key on a grand piano (F#6) */
const FIRST_UNDAMPED = 90;
const MAX_VOICES = 96;

const PCS = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];

/** File name of a sample: the set names middle C "C3". */
export function sampleName(layer: LayerName, midi: number): string {
  const oct = Math.floor(midi / 12) - 2;
  return `${layer}-${PCS[midi % 12]}${oct < 0 ? `m${-oct}` : oct}`;
}

/** Nearest sampled note in a layer (ties: the higher one, pitched down, sounds more natural). */
export function nearestSample(layer: LayerName, note: number): { sample: number; dist: number } {
  let best = SAMPLES[layer][0];
  for (const s of SAMPLES[layer]) {
    const d = Math.abs(s - note);
    const bd = Math.abs(best - note);
    if (d < bd || (d === bd && s > best)) best = s;
  }
  return { sample: best, dist: Math.abs(best - note) };
}

/** Layers to sound for a velocity, with their gains (equal-power crossfade at zone edges). */
export function layersFor(vel: number): { layer: LayerName; gain: number }[] {
  for (let z = 0; z < ZONES.length; z++) {
    const [lo, hi, layer] = ZONES[z];
    if (vel < lo || vel > hi) continue;
    const next = ZONES[z + 1];
    if (next && vel > hi - XFADE) {
      const x = (vel - (hi - XFADE)) / (2 * XFADE); // 0..0.5 within this zone
      return [
        { layer, gain: Math.cos((x * Math.PI) / 2) },
        { layer: next[2], gain: Math.sin((x * Math.PI) / 2) },
      ];
    }
    const prev = ZONES[z - 1];
    if (prev && vel < lo + XFADE) {
      const x = 0.5 + (vel - lo) / (2 * XFADE); // 0.5..1 from the previous zone
      return [
        { layer: prev[2], gain: Math.cos((x * Math.PI) / 2) },
        { layer, gain: Math.sin((x * Math.PI) / 2) },
      ];
    }
    return [{ layer, gain: 1 }];
  }
  return [{ layer: 'pp', gain: 1 }];
}

/** Loudness of a velocity (30 dB range, slightly expanded at the top). */
export function velocityGain(vel: number): number {
  const v = Math.max(1, Math.min(127, vel)) / 127;
  return Math.pow(10, (-30 * (1 - Math.pow(v, 0.8))) / 20);
}

function isAppleWebKit(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true; // iPadOS
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(ua);
}

interface Voice {
  note: number;
  src: AudioBufferSourceNode | OscillatorNode;
  out: GainNode;
  player: string;
  started: number;
  /** key still down */
  keyDown: boolean;
  /** held by the sostenuto pedal */
  sostenuto: boolean;
  releasing: boolean;
}

interface PlayerPedals {
  sustain: number;
  sostenuto: boolean;
  soft: boolean;
}

export class Piano {
  readonly loaded = signal(0);
  readonly total = signal(0);
  /** at least one layer can play */
  readonly ready = signal(false);
  readonly failed = signal(false);
  private ctx: AudioContext | null = null;
  private bus!: GainNode;
  private reverbSend!: GainNode;
  private master!: GainNode;
  private buffers = new Map<string, { buf: AudioBuffer; offset: number }>();
  private voices: Voice[] = [];
  private pedals = new Map<string, PlayerPedals>();
  private format: 'ogg' | 'm4a' = 'ogg';
  private loading: Promise<void> | null = null;
  private volume = 0.8;
  private reverbOn = true;
  private wave: PeriodicWave | null = null;
  private base: string;

  constructor(base = `${import.meta.env?.BASE_URL ?? './'}piano/`) {
    this.base = base;
  }

  /** Create (or resume) the audio context. Call from a click or key press the first time (autoplay rules). */
  context(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private build(ctx: AudioContext): void {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.6;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.bus.connect(limiter);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this.reverbOn ? 0.16 : 0;
    const conv = ctx.createConvolver();
    conv.buffer = roomImpulse(ctx);
    this.bus.connect(this.reverbSend);
    this.reverbSend.connect(conv);
    conv.connect(limiter);
    limiter.connect(this.master);
    this.master.connect(ctx.destination);
    // a piano-like tone for the seconds before the samples are in (or if they cannot load)
    const n = 24;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let h = 1; h < n; h++) im[h] = (1 / Math.pow(h, 1.35)) * (h % 7 === 0 ? 0.2 : 1);
    this.wave = ctx.createPeriodicWave(re, im);
  }

  /** Start loading the samples (most used layer first). Light connections only get one layer. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.context();
    if (!ctx) return Promise.resolve();
    this.format = isAppleWebKit() ? 'm4a' : 'ogg';
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const light = !!conn?.saveData || /(^|-)2g|3g/.test(conn?.effectiveType ?? '');
    const layers = light ? LOAD_ORDER.slice(0, 1) : LOAD_ORDER;
    const jobs: [LayerName, number][] = [];
    for (const l of layers) for (const n of SAMPLES[l]) jobs.push([l, n]);
    this.total.value = jobs.length;
    this.loading = (async () => {
      let i = 0;
      const worker = async () => {
        while (i < jobs.length) {
          const [layer, note] = jobs[i++];
          await this.fetchSample(ctx, layer, note);
          this.loaded.value++;
          if (!this.ready.peek() && this.layerComplete('mf')) this.ready.value = true;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (!this.buffers.size) this.failed.value = true;
      else this.ready.value = true;
    })();
    return this.loading;
  }

  private layerComplete(layer: LayerName): boolean {
    return SAMPLES[layer].every((n) => this.buffers.has(sampleName(layer, n)));
  }

  private async fetchSample(ctx: AudioContext, layer: LayerName, note: number, retry = true): Promise<void> {
    const name = sampleName(layer, note);
    try {
      const r = await fetch(`${this.base}${this.format}/${name}.${this.format}`);
      if (!r.ok) throw new Error(String(r.status));
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(name, { buf, offset: onsetOf(buf) });
    } catch {
      if (retry && this.format === 'ogg') {
        // this browser cannot decode Opus in Ogg: AAC from here on
        this.format = 'm4a';
        return this.fetchSample(ctx, layer, note, false);
      }
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setReverb(on: boolean): void {
    this.reverbOn = on;
    if (this.reverbSend && this.ctx) this.reverbSend.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.05);
  }

  /** Send the sound to another output device (Chromium). */
  async setSink(id: string): Promise<void> {
    const c = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (c?.setSinkId) await c.setSinkId(id).catch(() => {});
  }

  /** Play a MIDI message from `player` (a peer id, or 'local' for the on-screen keys). */
  midi(m: number[], player: string): void {
    const type = m[0] & 0xf0;
    if (type === 0x90 && m[2] > 0) this.noteOn(m[1], m[2], player);
    else if (type === 0x80 || type === 0x90) this.noteOff(m[1], player);
    else if (type === 0xb0) {
      if (m[1] === 64) this.sustain(player, m[2]);
      else if (m[1] === 66) this.sostenuto(player, m[2] >= 64);
      else if (m[1] === 67) this.pedal(player).soft = m[2] >= 64;
      else if (m[1] === 120 || m[1] === 123) this.allOff(player);
    }
  }

  private pedal(player: string): PlayerPedals {
    let p = this.pedals.get(player);
    if (!p) this.pedals.set(player, (p = { sustain: 0, sostenuto: false, soft: false }));
    return p;
  }

  noteOn(note: number, vel: number, player = 'local'): void {
    const ctx = this.context();
    if (!ctx || note < 21 || note > 108) return;
    const now = ctx.currentTime;
    const pedals = this.pedal(player);
    if (pedals.soft) vel = Math.max(1, Math.round(vel * 0.82));
    // the hammer re-strikes the same string: damp what it was still sounding
    for (const v of this.voices) if (v.note === note && !v.releasing) this.release(v, now, 0.04);
    const gain = velocityGain(vel);
    // very soft playing is also darker
    const cutoff = vel < 56 ? 900 + Math.pow(vel / 56, 1.6) * 9000 : pedals.soft ? 6500 : 0;
    let played = false;
    for (const { layer, gain: lg } of layersFor(vel)) {
      const pick = this.pickBuffer(layer, note);
      if (!pick) continue;
      played = true;
      const src = ctx.createBufferSource();
      src.buffer = pick.buf;
      src.playbackRate.value = Math.pow(2, (note - pick.sample) / 12);
      const out = ctx.createGain();
      out.gain.value = gain * lg;
      let head: AudioNode = src;
      if (cutoff) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        f.Q.value = 0.5;
        src.connect(f);
        head = f;
      }
      head.connect(out);
      out.connect(this.bus);
      src.start(now, pick.offset);
      this.track({ note, src, out, player, started: now, keyDown: true, sostenuto: false, releasing: false });
    }
    if (!played) this.fallbackNote(ctx, note, gain, player);
  }

  private pickBuffer(layer: LayerName, note: number): { buf: AudioBuffer; offset: number; sample: number } | null {
    // the wanted layer, else the closest loaded one
    const order: LayerName[] = [layer, ...LOAD_ORDER.filter((l) => l !== layer)];
    for (const l of order) {
      const { sample, dist } = nearestSample(l, note);
      const b = this.buffers.get(sampleName(l, sample));
      if (b && dist <= 3) return { ...b, sample };
    }
    return null;
  }

  private fallbackNote(ctx: AudioContext, note: number, gain: number, player: string): void {
    if (!this.wave) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(Math.min(12000, 600 + gain * 8000), now);
    f.frequency.exponentialRampToValueAtTime(400, now + 2.5);
    const out = ctx.createGain();
    const decay = 0.6 + (108 - note) / 30;
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(gain * 0.5, now + 0.004);
    out.gain.setTargetAtTime(0, now + 0.004, decay);
    osc.connect(f).connect(out).connect(this.bus);
    osc.start(now);
    osc.stop(now + decay * 6);
    this.track({ note, src: osc, out, player, started: now, keyDown: true, sostenuto: false, releasing: false });
  }

  private track(v: Voice): void {
    this.voices.push(v);
    v.src.onended = () => {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
      try {
        v.out.disconnect();
      } catch {
        // ignore
      }
    };
    if (this.voices.length > MAX_VOICES) {
      // steal the oldest, preferring voices already released
      const victim = this.voices.find((x) => x.releasing) ?? this.voices[0];
      this.release(victim, this.ctx!.currentTime, 0.02);
    }
  }

  noteOff(note: number, player = 'local'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pedals = this.pedal(player);
    for (const v of this.voices) {
      if (v.note !== note || v.player !== player || !v.keyDown) continue;
      v.keyDown = false;
      if (pedals.sustain >= 64 || v.sostenuto || v.note >= FIRST_UNDAMPED) continue;
      if (pedals.sustain > 20) v.out.gain.setTargetAtTime(0, ctx.currentTime, halfPedalTau(pedals.sustain));
      else this.damp(v, ctx.currentTime);
    }
  }

  /** The damper falls on the string (none in the top octave and a half). */
  private damp(v: Voice, now: number): void {
    if (v.note >= FIRST_UNDAMPED) return;
    const tau = 0.05 + 0.22 * Math.pow(1 - (v.note - 21) / 69, 1.5);
    this.release(v, now, tau);
  }

  private release(v: Voice, now: number, tau: number): void {
    if (v.releasing) return;
    v.releasing = true;
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setValueAtTime(v.out.gain.value, now);
      v.out.gain.setTargetAtTime(0, now, tau);
      v.src.stop(now + tau * 7);
    } catch {
      // already stopped
    }
  }

  private sustain(player: string, value: number): void {
    const p = this.pedal(player);
    p.sustain = value;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // a little more room while the strings resonate freely
    if (this.reverbOn && this.reverbSend) this.reverbSend.gain.setTargetAtTime(value >= 64 ? 0.22 : 0.16, now, 0.3);
    for (const v of this.voices) {
      if (v.player !== player || v.keyDown || v.releasing || v.sostenuto || v.note >= FIRST_UNDAMPED) continue;
      if (value <= 20) {
        this.damp(v, now);
      } else {
        // dampers lifted (the strings keep what they have) or touching lightly (half pedal)
        v.out.gain.cancelScheduledValues(now);
        v.out.gain.setValueAtTime(v.out.gain.value, now);
        if (value < 64) v.out.gain.setTargetAtTime(0, now, halfPedalTau(value));
      }
    }
  }

  private sostenuto(player: string, down: boolean): void {
    const p = this.pedal(player);
    if (down === p.sostenuto) return;
    p.sostenuto = down;
    const ctx = this.ctx;
    for (const v of this.voices) {
      if (v.player !== player) continue;
      if (down && v.keyDown) v.sostenuto = true;
      if (!down && v.sostenuto) {
        v.sostenuto = false;
        if (!v.keyDown && p.sustain < 64 && ctx) this.damp(v, ctx.currentTime);
      }
    }
  }

  /** Silence everything one player sounds (or everybody). */
  allOff(player?: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const v of [...this.voices]) if (!player || v.player === player) this.release(v, ctx.currentTime, 0.08);
    if (player) this.pedals.delete(player);
    else this.pedals.clear();
  }

  get latencyMs(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!c) return 0;
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000);
  }
}

/** Decay time constant with the sustain pedal half down (21..63): the deeper, the longer. */
function halfPedalTau(value: number): number {
  return 0.15 + ((value - 20) / 44) * 1.5;
}

/** Where the note starts (the files may have a little silence before the hammer). */
function onsetOf(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const max = Math.min(d.length, Math.floor(buf.sampleRate * 0.05));
  for (let i = 0; i < max; i++) if (Math.abs(d[i]) > 0.003) return Math.max(0, (i - 16) / buf.sampleRate);
  return 0;
}

/** A medium room: early reflections and a darkening 1.7 s tail, generated (no file to load). */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 2.2);
  const ir = ctx.createBuffer(2, len, rate);
  const rt60 = 1.7;
  const pre = Math.floor(rate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    let seed = c ? 0x9e3779b9 : 0x7f4a7c15;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) / 0xffffffff) * 2 - 1;
    };
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const env = Math.pow(10, (-3 * t) / rt60);
      // the tail loses its highs as it decays
      const a = 0.25 + 0.7 * Math.min(1, t / 1.2);
      lp = lp * a + rnd() * (1 - a);
      d[i] = lp * env * 2.2;
    }
    // a few early reflections, different on each side
    const refl = c ? [0.017, 0.029, 0.041, 0.063] : [0.013, 0.023, 0.037, 0.055];
    refl.forEach((s, k) => {
      const i = pre + Math.floor(s * rate);
      if (i < len) d[i] += (0.5 / (k + 1)) * (k % 2 ? -1 : 1);
    });
  }
  return ir;
}
