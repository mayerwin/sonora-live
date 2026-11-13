// The metronome, without the browser: which clicks fall in a window of time, and how they sound. The shared
// timeline is the backing track's (src/media/backing-core.ts), counted in beats instead of seconds: `pos` is the
// beat at `anchor`, `rate` is beats per second. So the metronome is in time with whoever started it, exactly as the
// track is, and the others hear it later, in time with that person.

import { localTarget, type Timeline } from './backing-core.ts';

/** slowest and fastest tempo offered (beats per minute) */
export const MIN_BPM = 20;
export const MAX_BPM = 300;

export interface MetronomeSetup {
  bpm: number;
  /** beats in a bar (1: no bar, every beat the same) */
  beats: number;
  /** clicks per beat: 1 (quarter notes), 2 (eighths), 3 (triplets), 4 (sixteenths) */
  sub: 1 | 2 | 3 | 4;
  /** the first beat of the bar sounds different */
  accent: boolean;
}

export type ClickKind = 'bar' | 'beat' | 'sub';

export interface Click {
  /** when it is heard here (the clock of `now`, ms) */
  at: number;
  kind: ClickKind;
  /** which beat of the bar (0-based) */
  beat: number;
}

export const clampBpm = (bpm: number): number =>
  Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(Number.isFinite(bpm) ? bpm : 100)));

/** The timeline of a metronome counted in beats. */
export function beatTimeline(playing: boolean, beat: number, anchor: number, bpm: number): Timeline {
  return { playing, pos: beat, anchor, rate: clampBpm(bpm) / 60, loop: null, duration: 0 };
}

/**
 * The clicks heard here between `from` and `to` (ms, this side's clock), `delayMs` behind the timeline. Clicks are
 * on every subdivision of the timeline's beats from beat 0; a timeline that starts later (a lead-in) has none
 * before its start.
 */
export function clicksBetween(tl: Timeline, setup: MetronomeSetup, from: number, to: number, delayMs: number): Click[] {
  if (!tl.playing || to <= from) return [];
  const sub = setup.sub;
  const step = 1 / sub;
  const msPerBeat = 1000 / tl.rate;
  // the timeline's beat heard at `from`: before its start, nothing sounds until the start
  const start = localTarget(tl, from, delayMs);
  let t0 = from;
  let b0 = start.pos;
  if (start.wait > 0) {
    t0 = from + start.wait;
    b0 = tl.pos;
  }
  // the first subdivision at or after b0 (with a little tolerance so one exactly on time is kept)
  let k = Math.ceil(b0 / step - 1e-6);
  const out: Click[] = [];
  for (;;) {
    const b = k * step;
    const at = t0 + (b - b0) * msPerBeat;
    if (at >= to) break;
    if (at >= from) {
      const whole = Math.abs(b - Math.round(b)) < 1e-6;
      const beatIndex = Math.floor(b + 1e-6);
      const inBar = setup.beats > 0 ? ((beatIndex % setup.beats) + setup.beats) % setup.beats : 0;
      const kind: ClickKind = !whole ? 'sub' : inBar === 0 && setup.accent && setup.beats > 1 ? 'bar' : 'beat';
      out.push({ at, kind, beat: inBar });
    }
    k++;
    if (out.length > 512) break;
  }
  return out;
}

/** Tap tempo: the tempo from the last taps (ms), or null with too few or too irregular ones. */
export function tapTempo(taps: number[]): number | null {
  const recent = taps.slice(-6);
  if (recent.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(recent[i] - recent[i - 1]);
  // a pause of more than two seconds starts over
  const kept: number[] = [];
  for (let i = gaps.length - 1; i >= 0 && gaps[i] < 2000; i--) kept.unshift(gaps[i]);
  if (!kept.length) return null;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  return clampBpm(60000 / mean);
}

/** The beat the timeline reaches at `now`, rounded down to a whole bar: where to restart after a tempo change. */
export function nextBarBeat(beat: number, beats: number): number {
  const b = Math.max(1, beats);
  return Math.ceil(beat / b - 1e-6) * b;
}
