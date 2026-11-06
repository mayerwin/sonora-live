// Sound lab measurements (src/lab/Lab.tsx): levels, echo removed and near-end kept, from aligned recordings of the
// same moments through the different microphone processings.

export const SR = 48_000;

/** Power (mean square) of x between seconds a and b. */
export function power(x: Float32Array, a: number, b: number, sr = SR): number {
  const i0 = Math.max(0, Math.round(a * sr));
  const i1 = Math.min(x.length, Math.round(b * sr));
  let s = 0;
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return i1 > i0 ? s / (i1 - i0) : 0;
}

export function peak(x: Float32Array, a: number, b: number, sr = SR): number {
  const i0 = Math.max(0, Math.round(a * sr));
  const i1 = Math.min(x.length, Math.round(b * sr));
  let p = 0;
  for (let i = i0; i < i1; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export const db = (p: number) => (p > 0 ? 10 * Math.log10(p) : -120);
export const dbAmp = (a: number) => (a > 0 ? 20 * Math.log10(a) : -120);
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface Segments {
  noise: [number, number];
  echoPiano: [number, number];
  echoVoice: [number, number];
  near: [number, number] | null;
  both: [number, number] | null;
}

export interface Report {
  /** room noise (dBFS RMS) */
  noise: Record<string, number>;
  /** echo removed against the raw microphone (dB), on piano and on voice from the speakers */
  echoRemovedPiano: Record<string, number>;
  echoRemovedVoice: Record<string, number>;
  /** echo left (dBFS RMS) while the speakers play the piano */
  echoLeftPiano: Record<string, number>;
  /** the piano played here: level (dBFS RMS) and peak (dBFS) */
  nearRms: Record<string, number> | null;
  nearPeak: Record<string, number> | null;
  /** how much of the piano played here is kept while the speakers play (dB, 0 = all of it) */
  nearKeptWhileOthersPlay: Record<string, number> | null;
}

/**
 * The report from the recordings: `raw` the microphone untouched, `others` the processed ones (same moments).
 * Echo removed: how much quieter than raw each is while only the speakers play. Near-end kept: during "both",
 * the power each keeps above its own echo, against what the raw microphone had of the near end then.
 */
export function analyze(raw: Float32Array, others: Record<string, Float32Array>, seg: Segments): Report {
  const all: Record<string, Float32Array> = { raw, ...others };
  const map = (f: (x: Float32Array, k: string) => number) =>
    Object.fromEntries(Object.entries(all).map(([k, x]) => [k, r1(f(x, k))]));
  const report: Report = {
    noise: map((x) => db(power(x, ...seg.noise))),
    echoRemovedPiano: map((x) => db(power(raw, ...seg.echoPiano) / Math.max(1e-12, power(x, ...seg.echoPiano)))),
    echoRemovedVoice: map((x) => db(power(raw, ...seg.echoVoice) / Math.max(1e-12, power(x, ...seg.echoVoice)))),
    echoLeftPiano: map((x) => db(power(x, ...seg.echoPiano))),
    nearRms: null,
    nearPeak: null,
    nearKeptWhileOthersPlay: null,
  };
  if (seg.near) {
    const near = seg.near;
    report.nearRms = map((x) => db(power(x, ...near)));
    report.nearPeak = map((x) => dbAmp(peak(x, ...near)));
  }
  if (seg.near && seg.both) {
    const near = seg.near;
    const both = seg.both;
    const rawNear = power(raw, ...near);
    // the raw microphone's near end while both play: its total less the echo (the same program as the echo test)
    const rawEcho = power(raw, ...seg.echoPiano);
    const rawNearInBoth = Math.max(1e-12, power(raw, ...both) - rawEcho);
    report.nearKeptWhileOthersPlay = map((x) => {
      const gainAlone = power(x, ...near) / Math.max(1e-12, rawNear);
      const xEcho = power(x, ...seg.echoPiano);
      const gainBoth = Math.max(1e-12, power(x, ...both) - xEcho) / rawNearInBoth;
      return db(gainBoth / Math.max(1e-12, gainAlone));
    });
  }
  return report;
}

export interface PassReport {
  /** room noise (dBFS RMS) */
  noise: number;
  /** what the microphone has while only the speakers play (dBFS RMS): the echo left */
  echoPiano: number;
  echoVoice: number;
  /** the piano played here alone: level (dBFS RMS) and peak (dBFS) */
  nearRms: number | null;
  nearPeak: number | null;
  /** how much of the piano played here is kept while the speakers play (dB, 0 = all of it): its level then,
   * less the echo, against its level alone */
  nearKept: number | null;
}

/** One processing, measured on its own (the browser gives one processing per microphone at a time). */
export function analyzePass(mic: Float32Array, seg: Segments): PassReport {
  const p = (s: [number, number]) => power(mic, ...s);
  const out: PassReport = {
    noise: r1(db(p(seg.noise))),
    echoPiano: r1(db(p(seg.echoPiano))),
    echoVoice: r1(db(p(seg.echoVoice))),
    nearRms: null,
    nearPeak: null,
    nearKept: null,
  };
  if (seg.near) {
    out.nearRms = r1(db(p(seg.near)));
    out.nearPeak = r1(dbAmp(peak(mic, ...seg.near)));
    if (seg.both) out.nearKept = r1(db(Math.max(1e-12, p(seg.both) - p(seg.echoPiano)) / Math.max(1e-12, p(seg.near))));
  }
  return out;
}

/** A WAV file (16-bit PCM) from planar channels of the same length. */
export function wav(channels: Float32Array[], sr = SR): Blob {
  const n = channels[0]?.length ?? 0;
  const c = channels.length;
  const buf = new ArrayBuffer(44 + n * c * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * c * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, c, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * c * 2, true);
  v.setUint16(32, c * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * c * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let k = 0; k < c; k++) {
      const s = Math.max(-1, Math.min(1, channels[k][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}
