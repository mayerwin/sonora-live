// Echo cancelling on piano, measured offline: how much echo is removed, how much of the near-end piano is kept.
//
//   node tools/aec-eval.mjs [path/to/aec3/node.js]
//
// A far-end piano (what the others play, out of the speakers) reaches the microphone through a simulated room:
// a slightly distorting speaker, a delay, early reflections and a reverberant tail. A near-end piano (the one
// played here) reaches the microphone directly. Segments: far end alone (echo removed, after time to adapt),
// both playing (near-end kept, echo removed), near end alone (untouched?).
//
// Compared: no processing; SpeexDSP MDF (src/media/aec.wasm, what the app runs) at two frame sizes; and, when its
// path is given, WebRTC's AEC3 (Chrome's echo cancelling), to see what the browser's own does to the piano.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000;

// ------------------------------------------------------------------------------------------------ signals

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 28,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;

const SAMPLES = join(ROOT, 'public/piano/ogg');
const files = readdirSync(SAMPLES).filter((f) => /\.(ogg)$/.test(f));
const notes = new Map();
const note = (name) => {
  if (!notes.has(name)) notes.set(name, decode(join(SAMPLES, name)));
  return notes.get(name);
};

/** A piano phrase: notes from the given octave range at random times, `seconds` long. */
function phrase(seconds, pattern, gain) {
  const out = new Float32Array(Math.round(seconds * SR));
  const pick = files.filter((f) => pattern.test(f));
  let t = 0;
  while (t < seconds - 0.2) {
    const chord = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < chord; k++) {
      const s = note(pick[Math.floor(rand() * pick.length)]);
      const at = Math.round(t * SR);
      const len = Math.min(s.length, out.length - at, Math.round((0.6 + rand() * 1.4) * SR));
      const g = gain * (0.5 + rand() * 0.5);
      for (let i = 0; i < len; i++) {
        // damper: a short release at the end of the held time
        const rel = i > len - 2400 ? (len - i) / 2400 : 1;
        out[at + i] += s[i] * g * rel;
      }
    }
    t += 0.15 + rand() * 0.5;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ room

/** Room impulse response: direct sound after `delay` s, early reflections, an exponential diffuse tail. */
function room(delay, rt60, length) {
  const h = new Float32Array(Math.round(length * SR));
  const d = Math.round(delay * SR);
  h[d] = 0.7;
  for (let k = 0; k < 12; k++) h[d + Math.round((0.002 + rand() * 0.02) * SR)] += (rand() - 0.5) * 0.5;
  const tau = rt60 / 6.91; // amplitude e-folding
  for (let i = d + Math.round(0.005 * SR); i < h.length; i++) {
    const t = (i - d) / SR;
    h[i] += (rand() * 2 - 1) * Number(process.env.TAIL ?? 0.08) * Math.exp(-t / tau);
  }
  return h;
}

function fft(re, im, inverse) {
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
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
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
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

/** x convolved with h (overlap-add), cut to x's length. */
function convolve(x, h) {
  let n = 1;
  while (n < 2 * h.length) n <<= 1;
  const step = n - h.length + 1;
  const hr = new Float64Array(n),
    hi = new Float64Array(n);
  hr.set(h);
  fft(hr, hi, false);
  const y = new Float32Array(x.length + n);
  for (let at = 0; at < x.length; at += step) {
    const r = new Float64Array(n),
      i = new Float64Array(n);
    r.set(x.subarray(at, Math.min(at + step, x.length)));
    fft(r, i, false);
    for (let k = 0; k < n; k++) {
      const a = r[k] * hr[k] - i[k] * hi[k];
      i[k] = r[k] * hi[k] + i[k] * hr[k];
      r[k] = a;
    }
    fft(r, i, true);
    for (let k = 0; k < n; k++) y[at + k] += r[k];
  }
  return y.subarray(0, x.length);
}

// ------------------------------------------------------------------------------------------------ cancellers

async function speex(frame, tailSec) {
  const mod = new WebAssembly.Module(readFileSync(join(ROOT, 'src/media/aec.wasm')));
  const env = { cos: Math.cos, sin: Math.sin, exp: Math.exp, pow: Math.pow, log: Math.log, atan: Math.atan };
  const inst = new WebAssembly.Instance(mod, { env });
  const e = inst.exports;
  e.aec_init(frame, Math.round(tailSec * SR), 1, SR);
  return {
    name: `MDF ${frame} (${((frame / SR) * 1000).toFixed(1)} ms), ${tailSec * 1000} ms tail`,
    run(mic, ref) {
      const out = new Float32Array(mic.length);
      const mem = () => new Float32Array(e.memory.buffer);
      for (let at = 0; at + frame <= mic.length; at += frame) {
        const m = mem();
        m.set(mic.subarray(at, at + frame), e.aec_mic() / 4);
        m.set(ref.subarray(at, at + frame), e.aec_ref() / 4);
        e.aec_process();
        out.set(mem().subarray(e.aec_out() / 4, e.aec_out() / 4 + frame), at);
      }
      return out;
    },
  };
}

async function aec3(path) {
  const { create } = await import(pathToFileURL(path).href);
  return {
    name: 'WebRTC AEC3 (Chrome echo cancelling), default tuning',
    run(mic, ref) {
      const a = create({ sampleRate: SR });
      const out = new Float32Array(mic.length);
      for (let at = 0; at + 128 <= mic.length; at += 128)
        out.set(a.cancel(mic.subarray(at, at + 128), ref.subarray(at, at + 128)), at);
      a.destroy();
      return out;
    },
  };
}

// ------------------------------------------------------------------------------------------------ measure

/** SpeexDSP's DC filter on the microphone (src: mdf.c filter_dc_notch16), to compare like with like. */
function dcNotch(x, r = 0.9987) {
  const den2 = r * r + 0.7 * (1 - r) * (1 - r);
  let m0 = 0,
    m1 = 0;
  return x.map((vin) => {
    const vout = m0 + vin;
    m0 = m1 + 2 * (-vin + r * vout);
    m1 = vin - den2 * vout;
    return r * vout;
  });
}

const pow = (x, a, b) => {
  let s = 0;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += x[i] * x[i];
  return s / ((b - a) * SR) + 1e-20;
};
const db = (x) => 10 * Math.log10(x);
const diff = (a, b) => a.map((v, i) => v - b[i]);

function main(cancellers) {
  const T = Number(process.env.SECONDS ?? 16);
  const far = phrase(T, /^ff-[a-g]s?[3-5]/, 0.5); // the others' piano, middle and high register
  const nearRaw = phrase(T, /^ff-[a-g]s?[1-3]/, 0.35); // played here, lower register
  const near = new Float32Array(T * SR);
  near.set(nearRaw.subarray(Math.round((T - 9) * SR)), Math.round((T - 9) * SR)); // the last 9 s
  for (let i = Math.round((T - 4) * SR); i < far.length; i++) far[i] = 0; // the others stop 4 s before the end

  // levels as a real interface delivers them (peaks below full scale)
  const norm = (x, peak) => {
    let m = 0;
    for (const v of x) m = Math.max(m, Math.abs(v));
    for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  };
  norm(far, 0.8);
  norm(near, 0.45);
  const drive = Number(process.env.DRIVE ?? 1.6);
  const speaker = drive ? far.map((v) => Math.tanh(drive * v) / Math.tanh(drive)) : far; // a little distortion
  const echo = convolve(speaker, room(Number(process.env.DELAY ?? 0.045), Number(process.env.RT60 ?? 0.35), 0.4));
  let peak = 0;
  for (const v of far) peak = Math.max(peak, Math.abs(v));
  console.log(`far-end peak ${peak.toFixed(2)}, speaker drive ${drive}`);
  const noise = Float32Array.from({ length: far.length }, () => (rand() * 2 - 1) * 3e-4);
  const echoGain = Number(process.env.ECHO ?? 0.6); // how loud the speakers are at the microphone
  for (let i = 0; i < echo.length; i++) echo[i] *= echoGain;
  const mic = echo.map((v, i) => v + near[i] + noise[i]);
  let micPeak = 0;
  for (const v of mic) micPeak = Math.max(micPeak, Math.abs(v));
  console.log(`microphone peak ${micPeak.toFixed(2)} (Speex stops learning above 0.98)`);

  const seg = { farAlone: [T - 13, T - 9], both: [T - 8, T - 4], nearAlone: [T - 3.4, T] };
  console.log(
    `echo at the microphone vs the near-end piano, while both play: ${db(pow(echo, ...seg.both) / pow(near, ...seg.both)).toFixed(1)} dB`,
  );
  console.log('');
  console.log(
    'canceller'.padEnd(66) +
      'echo removed'.padStart(14) +
      'piano kept (both)'.padStart(20) +
      'piano kept (alone)'.padStart(20),
  );
  const nearRef = dcNotch(near);
  const row = (name, raw) => {
    // a canceller may delay its output: line it up with the near-end piano before comparing
    const a0 = Math.round(seg.nearAlone[0] * SR);
    let lag = 0,
      best = -Infinity;
    for (let l = 0; l < 2400; l++) {
      let c = 0;
      for (let i = a0; i < a0 + SR; i += 3) c += raw[i + l] * near[i];
      if (c > best) [best, lag] = [c, l];
    }
    const out = new Float32Array(raw.length);
    out.set(raw.subarray(lag));
    if (lag) name += ` +${((lag / SR) * 1000).toFixed(1)} ms`;
    if (process.env.TRACE)
      console.log(
        '  echo removed per second: ' +
          Array.from({ length: T - 9 }, (_, k) => db(pow(echo, k, k + 1) / pow(out, k, k + 1)).toFixed(1)).join(' '),
      );
    const erle = db(pow(echo, ...seg.farAlone) / pow(out, ...seg.farAlone));
    // near-end kept: near-end power over the power of everything else in the output (echo left + damage)
    const ref = name.startsWith('none') ? near : nearRef;
    const both = db(pow(near, ...seg.both) / pow(diff(out, ref), ...seg.both));
    const alone = db(pow(near, ...seg.nearAlone) / pow(diff(out, ref), ...seg.nearAlone));
    console.log(
      name.padEnd(66) +
        `${erle.toFixed(1)} dB`.padStart(14) +
        `${both.toFixed(1)} dB`.padStart(20) +
        `${alone.toFixed(1)} dB`.padStart(20),
    );
  };
  row('none', mic);
  for (const c of cancellers) {
    const t0 = performance.now();
    const out = c.run(mic, far);
    const ms = performance.now() - t0;
    row(`${c.name} [${((ms / (T * 1000)) * 100).toFixed(1)}% CPU]`, out);
  }
}

const list = [await speex(128, 0.25), await speex(256, 0.25), await speex(128, 0.4)];
if (process.argv[2]) list.push(await aec3(process.argv[2]));
main(list);
