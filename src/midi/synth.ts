// The built-in instrument's other sounds, made on the spot (no samples to load): an electric piano (two-operator
// FM, the classic tine sound), an organ (drawbars as one periodic wave, with a key click), and strings (two
// detuned saws through a soft filter, with a bow's slower attack). Each note is a small graph that ends on its own.

export type InstrumentSound = 'grand' | 'epiano' | 'organ' | 'strings';

export const SOUNDS: InstrumentSound[] = ['grand', 'epiano', 'organ', 'strings'];

export interface SynthVoice {
  /** what stops the voice (and ends it: onended) */
  main: AudioScheduledSourceNode;
  /** the other sources, stopped with it */
  others: AudioScheduledSourceNode[];
  out: GainNode;
  /** how fast it fades once let go (s) */
  releaseTau: number;
}

const hz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

let organWave: { ctx: BaseAudioContext; wave: PeriodicWave } | null = null;

/** Drawbars 16′ 8′ 5⅓′ 4′ 2⅔′ 2′ (a warm jazz registration), as harmonics of the sub-octave. */
function organ(ctx: BaseAudioContext): PeriodicWave {
  if (organWave?.ctx === ctx) return organWave.wave;
  const n = 9;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  // harmonic k of f/2: 1 = 16′, 2 = 8′, 3 = 5⅓′, 4 = 4′, 6 = 2⅔′, 8 = 2′
  const bars: Record<number, number> = { 1: 0.55, 2: 1, 3: 0.45, 4: 0.55, 6: 0.25, 8: 0.3 };
  for (const [k, g] of Object.entries(bars)) im[Number(k)] = g;
  organWave = { ctx, wave: ctx.createPeriodicWave(re, im) };
  return organWave.wave;
}

/** A note of `sound` (not the grand: that is sampled), started now into `dest`. */
export function synthNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  sound: Exclude<InstrumentSound, 'grand'>,
  note: number,
  vel: number,
): SynthVoice {
  const now = ctx.currentTime;
  const f = hz(note);
  const v = Math.max(1, Math.min(127, vel)) / 127;
  const out = ctx.createGain();
  out.connect(dest);
  if (sound === 'epiano') {
    // carrier and modulator at the same pitch: the index (brightness) follows the velocity and decays fast;
    // a quiet high modulator adds the tine's attack
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const idx = ctx.createGain();
    const peak = f * (0.6 + 2.4 * v * v);
    idx.gain.setValueAtTime(peak, now);
    idx.gain.setTargetAtTime(f * 0.18, now, 0.25 + 0.4 * (1 - v));
    mod.connect(idx).connect(car.frequency);
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 14;
    const tineIdx = ctx.createGain();
    tineIdx.gain.setValueAtTime(f * 1.4 * v, now);
    tineIdx.gain.setTargetAtTime(0, now, 0.02);
    tine.connect(tineIdx).connect(car.frequency);
    const level = 0.12 + 0.3 * Math.pow(v, 1.4);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(level, now + 0.003);
    // long, lower notes longer
    out.gain.setTargetAtTime(level * 0.35, now + 0.003, 0.9 + (108 - note) / 45);
    car.connect(out);
    for (const o of [car, mod, tine]) o.start(now);
    return { main: car, others: [mod, tine], out, releaseTau: 0.12 };
  }
  if (sound === 'organ') {
    // an organ does not know velocity: every key the same, until it is let go
    const o = ctx.createOscillator();
    o.setPeriodicWave(organ(ctx));
    o.frequency.value = f / 2;
    // the key click: a short burst of the contacts closing
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 2800 + Math.random() * 600;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.025, now);
    cg.gain.setTargetAtTime(0, now, 0.004);
    click.connect(cg).connect(out);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.16, now + 0.006);
    o.connect(out);
    o.start(now);
    click.start(now);
    click.stop(now + 0.05);
    return { main: o, others: [], out, releaseTau: 0.025 };
  }
  // strings: the bow takes a moment to speak; harder playing speaks faster and brighter
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.value = Math.min(12000, f * 3 + 1200 + 3800 * v);
  const oscs: OscillatorNode[] = [];
  for (const cents of [-7, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = cents;
    o.connect(lp);
    oscs.push(o);
  }
  // a slow vibrato, coming in after the attack
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, now);
  depth.gain.linearRampToValueAtTime(9, now + 0.6);
  vib.connect(depth);
  for (const o of oscs) depth.connect(o.detune);
  lp.connect(out);
  const level = 0.07 + 0.09 * v;
  out.gain.setValueAtTime(0, now);
  out.gain.setTargetAtTime(level, now, 0.16 - 0.1 * v);
  for (const o of [...oscs, vib]) o.start(now);
  return { main: oscs[0], others: [oscs[1], vib], out, releaseTau: 0.28 };
}
