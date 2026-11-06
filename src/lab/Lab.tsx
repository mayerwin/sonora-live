// Sound lab (open the app with ?lab): measures, on this device and in this room, what each way of processing the
// microphone does. The laptop plays "the other side" through its speakers (the built-in piano, then a voice-like
// sound) while its microphone records, four ways at once on the same clock:
//
//   raw          the microphone untouched
//   browserEcho  the browser's echo cancelling only (the default for Instrument and voice on speakers)
//   voice        the browser's speech processing (Voice only)
//   musicSafe    the raw microphone through the app's music-safe echo canceller
//
// Then the piano played here (by you, or by the lab itself through MIDI when a digital piano is connected), alone
// and while "the other side" plays. Out: room noise, echo removed, levels, how much of your piano is kept while the
// others play; a summary to copy and a recording (with what the speakers played) to download, for offline work.

import { useRef, useState } from 'preact/hooks';
import { session } from '../app/session.ts';
import { audioConstraints } from '../media/constraints.ts';
import { engine } from '../media/engine.ts';
import { analyzePass, power, SR, wav, type PassReport, type Report, type Segments } from './analyze.ts';
import recWorkletUrl from './rec.worklet.ts?worker&url';

type Kind = 'raw' | 'browserEcho' | 'voice' | 'musicSafe';
const KINDS: Kind[] = ['raw', 'browserEcho', 'voice', 'musicSafe'];
const LABEL: Record<Kind, string> = {
  raw: 'Raw',
  browserEcho: 'Browser echo cancelling',
  voice: 'Voice only',
  musicSafe: 'Music-safe echo cancelling',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Result {
  report: Report;
  summary: Record<string, unknown>;
  recording: Blob;
}

/** The other side's piano: chords and a melody in the middle register, from the built-in piano. */
async function playFarPiano(seconds: number, stop: () => boolean): Promise<void> {
  const p = session.midi.piano;
  const chords = [
    [60, 64, 67],
    [57, 60, 64],
    [62, 65, 69],
    [55, 59, 62, 67],
  ];
  const melody = [72, 74, 76, 79, 77, 76, 74, 72, 71, 72, 76, 79];
  const end = performance.now() + seconds * 1000;
  let k = 0;
  while (performance.now() < end && !stop()) {
    const notes = k % 2 === 0 ? chords[(k / 2) % chords.length] : [melody[k % melody.length]];
    const vel = 60 + ((k * 37) % 50);
    for (const n of notes) p.midi([0x90, n, vel], 'lab-far');
    await sleep(380);
    for (const n of notes) p.midi([0x80, n, 0], 'lab-far');
    k++;
  }
  p.midi([0xb0, 123, 0], 'lab-far');
}

/** The other side talking: a voice-like sound (a buzz through moving formants, in syllables). */
async function playFarVoice(ctx: AudioContext, out: AudioNode, seconds: number): Promise<void> {
  const t0 = ctx.currentTime + 0.05;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(140, t0);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5;
  const vibGain = ctx.createGain();
  vibGain.gain.value = 6;
  vib.connect(vibGain).connect(src.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  const vowels = [
    [700, 1200, 2600],
    [300, 2300, 3000],
    [500, 900, 2400],
    [400, 1900, 2600],
  ];
  const formants = [0, 1, 2].map(() => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    src.connect(f).connect(env);
    return f;
  });
  for (let s = 0, t = t0; t < t0 + seconds; s++, t += 0.25) {
    const v = vowels[s % vowels.length];
    formants.forEach((f, i) => f.frequency.setValueAtTime(v[i], t));
    src.frequency.setValueAtTime(120 + ((s * 23) % 60), t);
    // a syllable, and now and then a pause between words
    const on = s % 7 !== 6;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(on ? 0.5 : 0, t + 0.04);
    env.gain.linearRampToValueAtTime(on ? 0.35 : 0, t + 0.18);
    env.gain.linearRampToValueAtTime(0, t + 0.24);
  }
  env.connect(out);
  src.start(t0);
  vib.start(t0);
  src.stop(t0 + seconds);
  vib.stop(t0 + seconds);
  await sleep(seconds * 1000 + 100);
  env.disconnect();
}

/** The piano played here, by the lab through a MIDI output (a digital piano connected to this device). */
async function playNearMidi(out: MIDIOutput, seconds: number): Promise<void> {
  const seq = [48, 52, 55, 60, 59, 55, 52, 50, 53, 57, 62, 60];
  const end = performance.now() + seconds * 1000;
  let k = 0;
  while (performance.now() < end) {
    const n = seq[k % seq.length];
    // soft and loud
    const vel = k % 8 < 4 ? 40 + k * 3 : 100;
    out.send([0x90, n, Math.min(120, vel)]);
    out.send([0x90, n - 12, Math.min(120, vel)]);
    await sleep(450);
    out.send([0x80, n, 0]);
    out.send([0x80, n - 12, 0]);
    k++;
  }
  out.send([0xb0, 123, 0]);
}

export function Lab() {
  const [phase, setPhase] = useState<'intro' | 'running' | 'done' | 'error'>('intro');
  const [prompt, setPrompt] = useState('');
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [midiOuts, setMidiOuts] = useState<MIDIOutput[]>([]);
  // ?lab&auto&near=skip: echo only (a script without a pianist)
  const [nearBy, setNearBy] = useState<string>(new URLSearchParams(location.search).get('near') ?? 'me');
  const stopped = useRef(false);
  const started = useRef(false);
  const auto = new URLSearchParams(location.search).has('auto');

  const findMidi = async () => {
    try {
      const access = await navigator.requestMIDIAccess?.();
      if (access) setMidiOuts([...access.outputs.values()]);
    } catch {
      // no MIDI here
    }
  };

  const countdown = async (text: string, seconds: number, during?: () => Promise<void>) => {
    setPrompt(text);
    const end = performance.now() + seconds * 1000;
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((end - performance.now()) / 1000))), 200);
    try {
      await Promise.all([during?.(), sleep(seconds * 1000)]);
    } finally {
      clearInterval(tick);
    }
  };

  /**
   * One processing, measured on its own: the browser applies one processing per microphone at a time (a second
   * capture with other settings silently gets the first one's), so each gets its own pass over the same program.
   */
  const measurePass = async (
    ctx: AudioContext,
    kind: 'raw' | 'browserEcho' | 'voice',
    pass: number,
    midiOut: MIDIOutput | null,
  ) => {
    const constraints =
      kind === 'raw'
        ? audioConstraints('pure', undefined, false)
        : kind === 'browserEcho'
          ? audioConstraints('pure', undefined, true)
          : audioConstraints('voice');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...constraints, channelCount: { ideal: 1 } } });
    const track = stream.getAudioTracks()[0];
    const st = track.getSettings() as MediaTrackSettings & { latency?: number };
    const out = engine.out!;
    const mono = () => {
      const g = ctx.createGain();
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
      return g;
    };
    const ref = mono();
    out.connect(ref);
    const src = ctx.createMediaStreamSource(stream);
    // record: what the speakers play, the microphone, and (raw pass) the music-safe canceller's output
    const rec = new AudioWorkletNode(ctx, 'sonora-rec', {
      numberOfInputs: 3,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    const nodes: AudioNode[] = [ref, src, rec];
    ref.connect(rec, 0, 0);
    const m = mono();
    nodes.push(m);
    src.connect(m).connect(rec, 0, 1);
    let aecStats: unknown = null;
    if (kind === 'raw' && engine.wasm) {
      const aec = new AudioWorkletNode(ctx, 'sonora-aec', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { bytes: engine.wasm.slice(0), tail: 0.3 },
      });
      aec.port.onmessage = (e) => (aecStats = e.data);
      m.connect(aec, 0, 0);
      ref.connect(aec, 0, 1);
      aec.connect(rec, 0, 2);
      nodes.push(aec);
    }
    const silent = ctx.createGain();
    silent.gain.value = 0;
    rec.connect(silent).connect(ctx.destination);
    nodes.push(silent);
    const chunks: Float32Array[][] = [];
    rec.port.onmessage = (e: MessageEvent<Float32Array[]>) => chunks.push(e.data);
    const t0 = ctx.currentTime;
    const now = () => ctx.currentTime - t0;
    const mark = async (text: string, seconds: number, during?: () => Promise<void>) => {
      const a = now();
      await countdown(`${pass}/3 · ${text}`, seconds, during);
      return [a, now()] as [number, number];
    };
    const inner = (x: [number, number], head: number) => [x[0] + head, x[1] - 0.3] as [number, number];

    const seg: Segments = { noise: [0, 0], echoPiano: [0, 0], echoVoice: [0, 0], near: null, both: null };
    seg.noise = inner(await mark('Quiet please: measuring the room', 3), 0.5);
    // the first seconds: the music-safe canceller learns the room
    seg.echoPiano = inner(
      await mark('The other side plays the piano (from your speakers)', 9, () =>
        playFarPiano(9, () => stopped.current),
      ),
      3,
    );
    seg.echoVoice = inner(
      await mark('The other side talks (from your speakers)', 6, () => playFarVoice(ctx, out, 6)),
      1,
    );
    if (nearBy !== 'skip') {
      if (!midiOut) await countdown(`${pass}/3 · Get ready to play your piano…`, 3);
      seg.near = inner(
        await mark(
          midiOut ? 'Your piano plays (through MIDI)' : 'Your turn: play your piano, soft and loud',
          10,
          midiOut ? () => playNearMidi(midiOut, 10) : undefined,
        ),
        1,
      );
      seg.both = inner(
        await mark(midiOut ? 'Both play' : 'Keep playing while the other side plays', 10, () =>
          Promise.all([
            playFarPiano(10, () => stopped.current),
            midiOut ? playNearMidi(midiOut, 10) : Promise.resolve(),
          ]).then(() => {}),
        ),
        1,
      );
    }
    rec.port.postMessage({ stop: true });
    await sleep(300);
    for (const n of nodes) n.disconnect();
    try {
      out.disconnect(ref);
    } catch {
      // already
    }
    stream.getTracks().forEach((t) => t.stop());
    const len = chunks.reduce((n, c) => n + c[0].length, 0);
    const pcm = [0, 1, 2].map(() => new Float32Array(len));
    let at = 0;
    for (const c of chunks) {
      c.forEach((x, k) => pcm[k].set(x, at));
      at += c[0].length;
    }
    return {
      seg,
      pcm,
      aecStats,
      settings: {
        echoCancellation: st.echoCancellation,
        noiseSuppression: st.noiseSuppression,
        autoGainControl: st.autoGainControl,
        channelCount: st.channelCount,
        sampleRate: st.sampleRate,
        latency: st.latency,
      },
    };
  };

  const run = async () => {
    stopped.current = false;
    setPhase('running');
    setError('');
    try {
      const ctx = engine.ensure();
      if (!ctx || !engine.out) throw new Error('No audio engine in this browser');
      await ctx.resume();
      if (!(await engine.load()) || !engine.wasm) throw new Error('The echo canceller cannot run in this browser');
      await ctx.audioWorklet.addModule(recWorkletUrl);
      setPrompt('Loading the piano…');
      session.midi.piano.context();
      await session.midi.piano.load(true);
      const midiOut = midiOuts.find((o) => o.id === nearBy) ?? null;

      const raw = await measurePass(ctx, 'raw', 1, midiOut);
      await sleep(400);
      const be = await measurePass(ctx, 'browserEcho', 2, midiOut);
      await sleep(400);
      const vo = await measurePass(ctx, 'voice', 3, midiOut);
      setPrompt('Measuring…');

      const passes: Record<Kind, PassReport> = {
        raw: analyzePass(raw.pcm[1], raw.seg),
        browserEcho: analyzePass(be.pcm[1], be.seg),
        voice: analyzePass(vo.pcm[1], vo.seg),
        musicSafe: analyzePass(raw.pcm[2], raw.seg),
      };
      // echo removed: the same program at the same volume, against the raw pass
      const removed = (k: Kind, key: 'echoPiano' | 'echoVoice') =>
        Math.round((passes.raw[key] - passes[k][key]) * 10) / 10;
      const report: Report = {
        noise: Object.fromEntries(KINDS.map((k) => [k, passes[k].noise])),
        echoRemovedPiano: Object.fromEntries(KINDS.map((k) => [k, removed(k, 'echoPiano')])),
        echoRemovedVoice: Object.fromEntries(KINDS.map((k) => [k, removed(k, 'echoVoice')])),
        echoLeftPiano: Object.fromEntries(KINDS.map((k) => [k, passes[k].echoPiano])),
        nearRms: passes.raw.nearRms != null ? Object.fromEntries(KINDS.map((k) => [k, passes[k].nearRms!])) : null,
        nearPeak: passes.raw.nearPeak != null ? Object.fromEntries(KINDS.map((k) => [k, passes[k].nearPeak!])) : null,
        nearKeptWhileOthersPlay:
          passes.raw.nearKept != null ? Object.fromEntries(KINDS.map((k) => [k, passes[k].nearKept!])) : null,
      };
      const c = ctx as AudioContext & { outputLatency?: number };
      const refLevel = Math.round(10 * Math.log10(Math.max(1e-12, power(raw.pcm[0], ...raw.seg.echoPiano))) * 10) / 10;
      const summary = {
        lab: 2,
        at: new Date().toISOString(),
        ua: navigator.userAgent,
        output: { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: c.outputLatency },
        speakersLevel: refLevel,
        settings: { raw: raw.settings, browserEcho: be.settings, voice: vo.settings },
        nearBy: midiOut ? `midi:${midiOut.name}` : nearBy,
        musicSafeStats: raw.aecStats,
        report,
      };
      // the recording: what the speakers played, the microphone, the music-safe output; the three passes in a row
      const cat = (k: number) => {
        const parts = [raw.pcm[k], be.pcm[k], vo.pcm[k]];
        const outPcm = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
        let at = 0;
        for (const x of parts) {
          outPcm.set(x, at);
          at += x.length;
        }
        return outPcm;
      };
      const recording = wav([cat(0), cat(1), cat(2)]);
      (summary as Record<string, unknown>).passStarts = [
        0,
        raw.pcm[0].length / SR,
        (raw.pcm[0].length + be.pcm[0].length) / SR,
      ];
      setResult({ report, summary, recording });
      (window as unknown as { __labResult: unknown }).__labResult = summary;
      setPhase('done');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setPhase('error');
    }
  };

  const copy = async () => {
    if (!result) return;
    const text = JSON.stringify(result.summary);
    try {
      await navigator.clipboard.writeText(text);
      setPrompt('Summary copied: paste it in the chat with Claude.');
    } catch {
      setPrompt('Could not copy: select the summary below and copy it.');
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(result.recording);
    a.download = `sonora-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    a.click();
  };

  const rows: [string, keyof Report][] = [
    ['Room noise (dBFS)', 'noise'],
    ['Echo removed, piano from speakers (dB)', 'echoRemovedPiano'],
    ['Echo removed, voice from speakers (dB)', 'echoRemovedVoice'],
    ['Echo left (dBFS)', 'echoLeftPiano'],
    ['Your piano: level (dBFS)', 'nearRms'],
    ['Your piano: peaks (dBFS)', 'nearPeak'],
    ['Your piano kept while the others play (dB)', 'nearKeptWhileOthersPlay'],
  ];

  if (auto && phase === 'intro' && !started.current) {
    // driven by a script: start at once (the script grants the microphone)
    started.current = true;
    setTimeout(() => void run(), 0);
  }

  return (
    <main class="lab" data-testid="lab">
      <h1>Sonora sound lab</h1>
      {phase === 'intro' && (
        <>
          <p>
            Put this laptop where it will be during a lesson, next to the piano, with the speakers at the volume you
            would use (no headphones). The lab plays "the other side" through the speakers while it records the
            microphone, then asks you to play; three times, once per way of processing the microphone (the browser
            allows only one at a time). It takes about two minutes.
          </p>
          <p>
            <label>
              Your piano parts:{' '}
              <select
                class="select"
                value={nearBy}
                onFocus={() => void findMidi()}
                onChange={(e) => setNearBy((e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="me">I play them myself</option>
                {midiOuts.map((o) => (
                  <option value={o.id}>Played by the lab on {o.name} (MIDI)</option>
                ))}
                <option value="skip">Skip (echo only)</option>
              </select>
            </label>
          </p>
          <button class="btn btn-primary btn-lg" onClick={() => void run()} data-testid="lab-start">
            Start
          </button>
        </>
      )}
      {phase === 'running' && (
        <div class="lab-now" role="status">
          <b>{prompt}</b>
          {left > 0 && <span class="lab-left">{left}</span>}
          <button class="btn btn-ghost" onClick={() => (stopped.current = true)}>
            Stop
          </button>
        </div>
      )}
      {phase === 'error' && (
        <p class="hint hint-bad">
          {error}{' '}
          <button class="btn btn-sm" onClick={() => setPhase('intro')}>
            Back
          </button>
        </p>
      )}
      {phase === 'done' && result && (
        <>
          <p>{prompt}</p>
          <table class="lab-table" data-testid="lab-results">
            <thead>
              <tr>
                <th />
                {KINDS.map((k) => (
                  <th>{LABEL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key]) => {
                const v = result.report[key] as Record<string, number> | null;
                if (!v) return null;
                return (
                  <tr>
                    <td>{label}</td>
                    {KINDS.map((k) => (
                      <td>{v[k] ?? '—'}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onClick={() => void copy()} data-testid="lab-copy">
              Copy the summary
            </button>
            <button class="btn" onClick={download}>
              Download the recording
            </button>
            <button class="btn btn-ghost" onClick={() => setPhase('intro')}>
              Run again
            </button>
          </p>
          <textarea class="lab-json" readOnly value={JSON.stringify(result.summary)} />
        </>
      )}
    </main>
  );
}
