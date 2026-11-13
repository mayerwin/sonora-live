// The sound check, without the browser. A short exponential sine sweep is played from the speakers while the
// microphone records; a matched filter (the cross-correlation with the sweep, by FFT) finds the sweep in the
// recording. Found clearly: the sound reaches the microphone (speakers), and its delay is the device's real
// round trip, output plus input. Not found: headphones (nothing reaches the microphone).

/** The sweep: 200 Hz to 8 kHz in 250 ms, faded in and out, at `rate` Hz. */
export function makeSweep(rate: number, seconds = 0.25, f0 = 200, f1 = 8000): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const k = Math.log(f1 / f0);
  const fade = Math.floor(rate * 0.01);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const phase = ((2 * Math.PI * f0 * seconds) / k) * (Math.exp((t / seconds) * k) - 1);
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = Math.sin(phase) * env;
  }
  return out;
}

/** In-place radix-2 FFT (re, im of a power-of-two length); `inverse` for the inverse transform (unscaled). */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Found {
  /** where the sweep starts in the recording, relative to where it starts in the reference (seconds) */
  lag: number;
  /** how clearly: the peak's normalised correlation, 0..1 */
  strength: number;
  /** the peak against the correlation's typical level (how distinct it is from noise) */
  prominence: number;
}

/**
 * Where `sweep` (played at sample `start` of `ref`) appears in `rec` (recorded on the same clock), up to
 * `maxLag` seconds later.
 */
export function findSweep(sweep: Float32Array, rec: Float32Array, start: number, rate: number, maxLag = 1): Found {
  const maxL = Math.min(Math.floor(maxLag * rate), rec.length - start - sweep.length);
  if (maxL <= 0) return { lag: 0, strength: 0, prominence: 0 };
  const span = sweep.length + maxL;
  let n = 1;
  while (n < span * 2) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < span && start + i < rec.length; i++) ar[i] = rec[start + i];
  for (let i = 0; i < sweep.length; i++) br[i] = sweep[i];
  fft(ar, ai);
  fft(br, bi);
  // correlation: A · conj(B)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const m = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r;
    ai[i] = m;
  }
  fft(ar, ai, true);
  let sweepEnergy = 0;
  for (const v of sweep) sweepEnergy += v * v;
  // running energy of the recording under the sweep's window, for a normalised correlation
  const win = new Float64Array(maxL + 1);
  let e = 0;
  for (let i = 0; i < sweep.length && start + i < rec.length; i++) e += rec[start + i] ** 2;
  win[0] = e;
  for (let l = 1; l <= maxL; l++) {
    const out = rec[start + l - 1] ?? 0;
    const inn = rec[start + l + sweep.length - 1] ?? 0;
    e += inn * inn - out * out;
    win[l] = Math.max(0, e);
  }
  let best = 0;
  let bestLag = 0;
  const mags: number[] = [];
  for (let l = 0; l <= maxL; l++) {
    const c = ar[l] / n;
    const norm = Math.sqrt(sweepEnergy * win[l]) || 1;
    const v = Math.abs(c) / norm;
    mags.push(Math.abs(c));
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  mags.sort((x, y) => x - y);
  const typical = mags[Math.floor(mags.length * 0.5)] || 1e-12;
  const peak = Math.abs(ar[bestLag] / n);
  return { lag: bestLag / rate, strength: best, prominence: peak / typical };
}

/** The sweep was heard: clear, and well above the recording's noise. */
export function heard(f: Found): boolean {
  return f.strength > 0.15 && f.prominence > 12;
}
