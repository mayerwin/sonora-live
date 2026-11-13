// The sound check in the browser: two short sweeps from the speakers (or from headphones held against the
// microphone), recorded on the audio context's own clock together with a digital copy of what was played. The
// distance between the copy and what the microphone heard is the device's real round trip, whatever the browser
// reports (src/media/soundcheck-core.ts finds it).

import { findSweep, heard, makeSweep } from './soundcheck-core.ts';

export interface CheckResult {
  /** the microphone heard the sweeps */
  heard: boolean;
  /** the round trip out of the speakers and back through the microphone (ms), when heard */
  roundTripMs: number | null;
  /** how clearly (0..1) */
  strength: number;
  /** each sweep: where it was found (ms) and how clearly, for diagnostics */
  sweeps?: { ms: number; strength: number; prominence: number }[];
}

const LEVEL = 0.35;
const RECORD_S = 1.6;

/**
 * Play the sweeps into `out` and listen with microphone `micId` (opened for the check, with no processing: echo
 * cancelling would remove the very sound it listens for).
 */
export async function runSoundCheck(ctx: AudioContext, out: AudioNode, micId?: string): Promise<CheckResult> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(micId ? { deviceId: { exact: micId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  const mic = ctx.createMediaStreamSource(stream);
  const rate = ctx.sampleRate;
  const sweep = makeSweep(rate);
  const buf = ctx.createBuffer(1, sweep.length, rate);
  buf.getChannelData(0).set(sweep);
  const merger = ctx.createChannelMerger(2);
  const proc = ctx.createScriptProcessor(4096, 2, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  const level = ctx.createGain();
  level.gain.value = LEVEL;
  const ref: Float32Array[] = [];
  const rec: Float32Array[] = [];
  proc.onaudioprocess = (e) => {
    ref.push(e.inputBuffer.getChannelData(0).slice());
    rec.push(e.inputBuffer.getChannelData(1).slice());
  };
  mic.connect(merger, 0, 1);
  merger.connect(proc).connect(sink).connect(ctx.destination);
  const sources: AudioBufferSourceNode[] = [];
  const t0 = ctx.currentTime + 0.25;
  for (const at of [t0, t0 + 0.65]) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    // to the speakers, and as the reference, exactly as played
    s.connect(level).connect(out);
    s.connect(merger, 0, 0);
    s.start(at);
    sources.push(s);
  }
  await new Promise((r) => setTimeout(r, RECORD_S * 1000));
  for (const s of sources) s.disconnect();
  level.disconnect();
  mic.disconnect();
  merger.disconnect();
  proc.disconnect();
  sink.disconnect();
  for (const tr of stream.getTracks()) tr.stop();

  const join = (parts: Float32Array[]) => {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const outBuf = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      outBuf.set(p, o);
      o += p.length;
    }
    return outBuf;
  };
  const r = join(ref);
  const m = join(rec);
  // where each sweep starts in the reference (exactly), then where it is in what the microphone heard
  const starts: number[] = [];
  for (let i = 0; i < r.length && starts.length < 2; i++) {
    if (Math.abs(r[i]) > 1e-6) {
      starts.push(i);
      i += sweep.length + Math.floor(rate * 0.2);
    }
  }
  const found = starts.map((s) => findSweep(sweep, m, s, rate, 0.45));
  const sweeps = found.map((f) => ({
    ms: Math.round(f.lag * 10000) / 10,
    strength: Math.round(f.strength * 100) / 100,
    prominence: Math.round(f.prominence),
  }));
  const ok = found.filter(heard);
  if (ok.length < found.length || !found.length) {
    return { heard: false, roundTripMs: null, strength: Math.max(0, ...found.map((f) => f.strength)), sweeps };
  }
  // both sweeps agree (within 6 ms: capture can shift by an audio block, ~3 ms): a real echo, not a coincidence
  const lags = ok.map((f) => f.lag * 1000);
  if (Math.max(...lags) - Math.min(...lags) > 6)
    return { heard: false, roundTripMs: null, strength: Math.min(...ok.map((f) => f.strength)), sweeps };
  return {
    heard: true,
    roundTripMs: Math.round((lags.reduce((a, b) => a + b, 0) / lags.length) * 10) / 10,
    strength: Math.min(...ok.map((f) => f.strength)),
    sweeps,
  };
}
