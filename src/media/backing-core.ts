// The backing track's shared timeline, without the browser: where the track should be at a given moment on each
// side, and how a side that drifted gets back in time. Used by src/app/backing.ts; tested in
// tests/unit/backing.test.ts.
//
// One timeline for everyone: the one heard by the person who plays or sings along (the "reference"). Everyone else
// plays the same timeline later, by how long the reference's sound takes to reach them: so what reaches their ears
// from the reference (voice, instrument) is in time with the track they hear. The reference hears the others late,
// as in any call; the one who plays along is the one who must be in time.

export interface Loop {
  /** start and end, seconds of the track */
  a: number;
  b: number;
}

export interface Timeline {
  playing: boolean;
  /** position (seconds of the track) at `anchor` */
  pos: number;
  /** when (this side's performance.now(), ms) the timeline is at `pos`; may be in the future (a lead-in) */
  anchor: number;
  /** playback speed (1 = as recorded); the pitch is kept */
  rate: number;
  loop: Loop | null;
  /** the track's length, seconds (0: not known yet) */
  duration: number;
}

/** the shortest loop that can be set (seconds) */
export const MIN_LOOP_S = 0.5;
/** further than this from where it should be: jump there; closer: catch up by changing speed slightly */
export const SEEK_ABOVE_S = 0.25;
/** closer than this: in time */
export const IN_TIME_S = 0.012;
/** the largest speed change used to catch up (inaudible with the pitch kept) */
export const MAX_NUDGE = 0.04;

/** A loop that makes sense for a track of `duration` seconds, or null. */
export function cleanLoop(loop: Loop | null | undefined, duration: number): Loop | null {
  if (!loop || !Number.isFinite(loop.a) || !Number.isFinite(loop.b)) return null;
  let a = Math.max(0, Math.min(loop.a, loop.b));
  let b = Math.max(loop.a, loop.b);
  if (duration > 0) {
    a = Math.min(a, duration);
    b = Math.min(b, duration);
  }
  return b - a >= MIN_LOOP_S ? { a, b } : null;
}

/** A position folded into the loop once past its end (positions before the loop's end are left as they are). */
export function wrap(pos: number, loop: Loop | null): number {
  if (!loop || pos < loop.b) return pos;
  const len = loop.b - loop.a;
  return loop.a + ((pos - loop.a) % len);
}

/**
 * Where the track should be on this side at `now` (ms), `delayMs` behind the reference's timeline. `wait`: ms
 * until it starts (a lead-in, or the delay at the start); `ended`: past the end (no loop).
 */
export function localTarget(tl: Timeline, now: number, delayMs: number): { pos: number; wait: number; ended: boolean } {
  if (!tl.playing) return { pos: tl.pos, wait: 0, ended: false };
  const at = now - delayMs;
  if (at < tl.anchor) return { pos: tl.pos, wait: tl.anchor - at, ended: false };
  const pos = wrap(tl.pos + ((at - tl.anchor) / 1000) * tl.rate, tl.loop);
  const ended = !tl.loop && tl.duration > 0 && pos >= tl.duration;
  return { pos: ended ? tl.duration : pos, wait: 0, ended };
}

/** The timeline's own position at `now` (the reference's: no delay). */
export function timelinePos(tl: Timeline, now: number): number {
  return localTarget(tl, now, 0).pos;
}

/**
 * How to get a playing track back in time: `ahead` is how far the wanted position is past the played one
 * (seconds; negative when the track is ahead). Jump when far, otherwise a slightly faster or slower speed for a
 * moment (seconds of difference caught up in about two seconds).
 */
export function correction(ahead: number, rate: number): { seek: boolean; rate: number } {
  if (Math.abs(ahead) > SEEK_ABOVE_S) return { seek: true, rate };
  if (Math.abs(ahead) <= IN_TIME_S) return { seek: false, rate };
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, ahead / 2));
  return { seek: false, rate: rate * (1 + nudge) };
}

/** Speeds offered (the pitch is kept). */
export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.25, 1.5];
/** transposition range, semitones */
export const MAX_SEMITONES = 12;

/** The next speed up (+1) or down (−1) from `rate`. */
export function stepRate(rate: number, dir: 1 | -1): number {
  if (dir > 0) return RATES.find((r) => r > rate + 1e-6) ?? RATES[RATES.length - 1];
  return [...RATES].reverse().find((r) => r < rate - 1e-6) ?? RATES[0];
}

/** mm:ss */
export function clockOf(s: number): string {
  const v = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
