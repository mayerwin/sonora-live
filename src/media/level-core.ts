// Automatic level for music, like a sound engineer setting the input gain: slow, and only from the loudest
// moments. Speech AGC (the browser's) rides the gain within a phrase, so a crescendo is undone and a sustained
// chord is pulled down; this one looks at the peaks of the last seconds, raises the gain slowly (only while
// something plays: silence is not "too quiet"), lowers it faster when the peaks run over, and a soft limiter keeps
// a sudden forte from clipping in between. A crescendo stays a crescendo; a quiet microphone is brought up.
//
// Blocks of samples in, the same blocks out (no added delay). Several channels share one gain (the stereo image
// does not move).

/** where the peaks of the last seconds are brought (−10.5 dBFS): room for a crescendo of +10 dB above them */
const TARGET = 0.3;
/** the gain stays within these (−6 dB … +20 dB) */
const MIN_GAIN = 0.5;
const MAX_GAIN = 10;
/** gain changes, in dB per second */
const RAISE_DB_S = 2;
/** lowering: gently when the peaks are only above the target, fast when the limiter has to work */
const LOWER_DB_S = 3;
const LOWER_FAST_DB_S = 20;
/** the peak memory fades this fast (dB per second): the loudest moments of the last few seconds count */
const PEAK_FALL_DB_S = 2;
/** below this block RMS (−50 dBFS), nothing plays: the gain holds */
const GATE = 0.00316;
/** the soft limiter starts here, and never lets a sample past 1 */
const KNEE = 0.89;

const dbToGain = (db: number) => Math.pow(10, db / 20);

export class Leveler {
  gain: number;
  private peak = 0;
  private readonly rate: number;

  constructor(sampleRate: number, startGain = dbToGain(6)) {
    this.rate = sampleRate;
    this.gain = startGain;
  }

  /** Process one block in place, `channels` arrays of the same length. */
  process(channels: Float32Array[]): void {
    const n = channels[0]?.length ?? 0;
    if (!n) return;
    const dt = n / this.rate;
    let peak = 0;
    let sum = 0;
    for (const ch of channels)
      for (let i = 0; i < n; i++) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        sum += ch[i] * ch[i];
      }
    const rms = Math.sqrt(sum / (n * channels.length));
    // the remembered peak: jumps up at once, fades slowly
    this.peak = Math.max(peak, this.peak * dbToGain(-PEAK_FALL_DB_S * dt));
    const from = this.gain;
    if (rms > GATE && this.peak > 1e-5) {
      const want = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET / this.peak));
      const fast = this.peak * this.gain > KNEE;
      if (want > this.gain) this.gain = Math.min(want, this.gain * dbToGain(RAISE_DB_S * dt));
      else this.gain = Math.max(want, this.gain * dbToGain(-(fast ? LOWER_FAST_DB_S : LOWER_DB_S) * dt));
    } else if (this.peak * this.gain > 1) {
      // nothing playing but the memory says it would clip: come down anyway
      this.gain = Math.max(MIN_GAIN, this.gain * dbToGain(-LOWER_FAST_DB_S * dt));
    }
    // the gain glides across the block (no clicks), then the soft limiter
    const to = this.gain;
    for (const ch of channels)
      for (let i = 0; i < n; i++) {
        const g = from + ((to - from) * (i + 1)) / n;
        ch[i] = limit(ch[i] * g);
      }
  }
}

/** Soft limiter: unchanged below the knee, then bends smoothly towards 1, never past it. */
export function limit(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const over = (a - KNEE) / (1 - KNEE);
  const y = KNEE + (1 - KNEE) * Math.tanh(over);
  return x < 0 ? -y : y;
}
