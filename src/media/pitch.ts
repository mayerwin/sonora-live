// The tuner's pitch detection: YIN (de Cheveigné and Kawahara, 2002), the classic for monophonic instruments and
// voices. It finds the period where the signal best matches itself, with the "cumulative mean normalised
// difference" that keeps it from jumping an octave down, then refines the period between samples.

export interface Pitch {
  /** fundamental frequency (Hz) */
  hz: number;
  /** how clear the pitch is, 0..1 (1: a pure periodic sound) */
  clarity: number;
}

/** The pitch of `buf` (one channel at `rate` Hz), between `minHz` and `maxHz`, or null when there is none. */
export function detectPitch(buf: Float32Array, rate: number, minHz = 50, maxHz = 2000, threshold = 0.12): Pitch | null {
  const maxLag = Math.min(Math.floor(rate / minHz), Math.floor(buf.length / 2));
  const minLag = Math.max(2, Math.floor(rate / maxHz));
  if (maxLag <= minLag + 2) return null;
  // too quiet: nothing to tune
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / buf.length) < 0.004) return null;

  const w = buf.length - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + lag];
      sum += x * x;
    }
    d[lag] = sum;
  }
  // cumulative mean normalised difference
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag];
    cmnd[lag] = running > 0 ? (d[lag] * lag) / running : 1;
  }
  // the first dip under the threshold, followed to its bottom
  let lag = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      lag = t;
      break;
    }
  }
  if (lag < 0) return null;
  // parabolic interpolation around the dip
  let period = lag;
  if (lag > 1 && lag < maxLag) {
    const a = cmnd[lag - 1];
    const b = cmnd[lag];
    const c = cmnd[lag + 1];
    const den = a - 2 * b + c;
    if (den !== 0) period = lag + (a - c) / (2 * den);
  }
  return { hz: rate / period, clarity: Math.max(0, Math.min(1, 1 - cmnd[lag])) };
}

/** The nearest note to `hz` for the reference `a4` (MIDI number), and how far off it is (cents, −50..50). */
export function nearestNote(hz: number, a4 = 440): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return { midi, cents: Math.round((exact - midi) * 1000) / 10 };
}
