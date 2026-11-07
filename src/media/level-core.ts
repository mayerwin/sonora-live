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
/** lowering when the peaks are above the target (a peak that would reach the limiter is caught at once) */
const LOWER_DB_S = 3;
/** the peak memory fades this fast (dB per second): the loudest moments of the last few seconds count */
const PEAK_FALL_DB_S = 2;
/** below this block RMS (−50 dBFS), nothing plays: the gain holds */
const GATE = 0.00316;
/** the soft limiter starts here, and never lets a sample past 1 */
const KNEE = 0.89;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** the remembered peak holds this long before it starts to fade: a pause is not a quieter piece */
const HOLD_S = 10;
/** the gain rises only on the loud parts: a block whose peak reaches this share of the remembered peak (a pause's
 * room noise never does, so it is not brought up) */
const LOUD_PART = 0.25;

export class Leveler {
  gain: number;
  /** the others are playing: hold the gain (it would bring up what is left of their echo, not this side) */
  far = false;
  private peak = 0;
  private holdUntil = 0;
  private t = 0;
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
    this.t += dt;
    let peak = 0;
    let sum = 0;
    for (const ch of channels)
      for (let i = 0; i < n; i++) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        sum += ch[i] * ch[i];
      }
    const rms = Math.sqrt(sum / (n * channels.length));
    // the remembered peak: jumps up at once, holds through pauses, then fades slowly
    if (peak >= this.peak) {
      this.peak = peak;
      this.holdUntil = this.t + HOLD_S;
    } else if (this.t > this.holdUntil) {
      this.peak = Math.max(peak, this.peak * dbToGain(-PEAK_FALL_DB_S * dt));
    }
    let from = this.gain;
    if (rms > GATE && this.peak > 1e-5) {
      const want = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET / this.peak));
      if (want > this.gain) {
        if (!this.far && peak >= LOUD_PART * this.peak)
          this.gain = Math.min(want, this.gain * dbToGain(RAISE_DB_S * dt));
      } else this.gain = Math.max(want, this.gain * dbToGain(-LOWER_DB_S * dt));
    }
    // instant attack: this block's peak is known before the gain is applied, so a forte after a pianissimo is
    // turned down at once (the limiter below is only a safety net: as a steady stage it would distort)
    if (peak * this.gain > KNEE) this.gain = Math.max(MIN_GAIN * 0.1, KNEE / peak);
    if (peak * from > KNEE) from = this.gain;
    // the gain glides across the block (no clicks), then the safety limiter
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
