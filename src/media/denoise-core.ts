// Steady background noise reduction for music: removes what does not change (hiss, a fan, air conditioning,
// a computer's whirr) and leaves everything that does (the instrument, the voice), unlike speech noise
// suppression, which keeps what sounds like a voice and removes the rest (and with it part of the music).
//
//   • Short-time spectrum: 512-sample frames (10.7 ms at 48 kHz), half overlapping, square-root Hann windows on
//     both sides (they reconstruct the signal exactly when nothing is changed). Delay: 384 samples, 8 ms.
//   • Noise, per frequency: the lowest level of the last ~5 s (minimum statistics: the background is what is
//     still there in the quietest moments), then smoothed across neighbouring frequencies with a median, so the
//     narrow peaks of a note held for a long time are not mistaken for noise; steady noise is broad.
//   • Each frequency is lowered by its share of noise (a Wiener-like gain), never by more than 15 dB, the gain
//     smoothed over time (quick to open, slower to close) so no "musical noise" chirps appear.

const N = 512;
const HOP = N / 2;
const BINS = N / 2 + 1;
/** frames per block of the minimum search, and blocks kept: ~5 s at 48 kHz */
const BLOCK = 47;
const BLOCKS = 20;
/** the minimum of a noisy level sits below its mean: raise it back (minimum statistics bias) */
const BIAS = 1.8;
/** how much more than the noise estimate is removed, and the most any frequency is lowered */
const OVER = 1.6;
const FLOOR = 0.18; // -15 dB
/** neighbouring frequencies for the median (each side) */
const SPREAD = 8;
/** frames left out of the noise estimate at the start (they hold the silence before it) */
const WARMUP = 40;

/** In-place radix-2 FFT of `re`/`im` (length a power of two); `inverse` without the 1/n scaling. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
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
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const WINDOW = (() => {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // periodic sqrt-Hann
  return w;
})();

/** One channel of noise reduction, fed and read in blocks of any size (128 in an AudioWorklet). */
export class ChannelDenoiser {
  private inBuf = new Float64Array(N);
  private outAcc = new Float64Array(N);
  private fill = 0;
  /** processed samples ready to leave, and where reading starts */
  private ready = new Float64Array(HOP * 4);
  private readyLen = 0;
  private re = new Float64Array(N);
  private im = new Float64Array(N);
  /** smoothed power per frequency */
  private power = new Float64Array(BINS);
  private gain = new Float64Array(BINS).fill(1);
  private noise = new Float64Array(BINS);
  /** power smoothed over ~10 frames, steady enough for the minimum search */
  private slow = new Float64Array(BINS);
  private blockMin = new Float64Array(BINS).fill(Infinity);
  private mins: Float64Array[] = [];
  private frames = 0;
  /** how much it lowers the signal: 0 (nothing) .. 1 (fully on) */
  amount = 1;

  /** Process `input` into `output` (same length), DENOISE_DELAY samples later (8 ms at 48 kHz, in 128-sample blocks). */
  process(input: Float32Array, output: Float32Array): void {
    let o = 0;
    for (let i = 0; i < input.length; i++) {
      this.inBuf[HOP + this.fill] = input[i];
      if (++this.fill === HOP) {
        this.frame();
        this.fill = 0;
      }
    }
    // hand out what is ready, oldest first (silence until the first frame is done)
    const take = Math.min(output.length, this.readyLen);
    const pad = output.length - take;
    for (; o < pad; o++) output[o] = 0;
    for (let i = 0; i < take; i++) output[o++] = this.ready[i];
    this.ready.copyWithin(0, take, this.readyLen);
    this.readyLen -= take;
  }

  private frame(): void {
    const { re, im } = this;
    for (let i = 0; i < N; i++) {
      re[i] = this.inBuf[i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);
    this.updateNoise();
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      this.power[k] = 0.6 * this.power[k] + 0.4 * p;
      const want = this.noise[k] > 0 ? Math.max(FLOOR, 1 - (OVER * this.noise[k]) / Math.max(this.power[k], 1e-20)) : 1;
      // open fast (an attack is never dulled), close slowly (no chirps)
      const g = want > this.gain[k] ? want : 0.7 * this.gain[k] + 0.3 * want;
      this.gain[k] = g;
      const applied = 1 - this.amount * (1 - g);
      re[k] *= applied;
      im[k] *= applied;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) this.outAcc[i] += (re[i] / N) * WINDOW[i];
    // the first half is complete: it leaves
    if (this.readyLen + HOP > this.ready.length) this.readyLen = 0; // a reader that stopped reading
    this.ready.set(this.outAcc.subarray(0, HOP), this.readyLen);
    this.readyLen += HOP;
    this.outAcc.copyWithin(0, HOP);
    this.outAcc.fill(0, N - HOP);
    this.inBuf.copyWithin(0, HOP);
  }

  /** Minimum statistics in blocks, then a median across neighbouring frequencies. */
  private updateNoise(): void {
    const { re, im } = this;
    const warm = this.frames >= WARMUP;
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const s = (this.slow[k] = this.frames ? 0.9 * this.slow[k] + 0.1 * p : p);
      // the first frames are partly the silence before the start: they would set a false minimum
      if (warm && s < this.blockMin[k]) this.blockMin[k] = s;
    }
    this.frames++;
    if (!warm) return;
    const full = (this.frames - WARMUP) % BLOCK === 0;
    // until the first block is full, its minimum so far is the estimate (a quick start); then whole blocks
    if (full) {
      this.mins.push(this.blockMin);
      if (this.mins.length > BLOCKS) this.mins.shift();
      this.blockMin = new Float64Array(BINS).fill(Infinity);
    } else if (this.mins.length || (this.frames - WARMUP) % 8 !== 0) {
      return;
    }
    const sources = this.mins.length ? this.mins : [this.blockMin];
    const raw = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) {
      let m = Infinity;
      for (const b of sources) if (b[k] < m) m = b[k];
      raw[k] = m === Infinity ? 0 : m * BIAS;
    }
    const win: number[] = [];
    for (let k = 0; k < BINS; k++) {
      win.length = 0;
      for (let j = Math.max(0, k - SPREAD); j <= Math.min(BINS - 1, k + SPREAD); j++) win.push(raw[j]);
      win.sort((a, b) => a - b);
      this.noise[k] = Math.min(raw[k], win[win.length >> 1]);
    }
  }
}

/** The delay the noise reduction adds, in samples. */
export const DENOISE_DELAY = HOP + 128;
