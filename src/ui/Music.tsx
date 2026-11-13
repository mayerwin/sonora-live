// The Music strip, above the controls: every music tool in one place. A row of chips (Keys, Track, Metronome,
// Tuner) opens their panels; several can be open at once, the keys at the bottom like a real keyboard. A tool someone
// starts (a track, the metronome) opens by itself for everyone; a dot shows which tools are in use.

import { HeldNote } from './Host.tsx';
import { computed, signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  FileText,
  Gauge,
  KeyboardMusic,
  ListMusic,
  Metronome as MetronomeIcon,
  Minus,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update, updateMidi } from '../app/settings.ts';
import { t } from '../app/i18n.ts';
import { MAX_BPM, MIN_BPM, tapTempo, type MetronomeSetup } from '../media/metronome-core.ts';
import { detectPitch, nearestNote } from '../media/pitch.ts';
import { engine } from '../media/engine.ts';
import { BackingPlayer } from './BackingTrack.tsx';
import { ScorePicker, scoreHidden, scoreShown } from './Score.tsx';

/** the score panel (to open one) is out */
const scorePickOpen = signal(false);
import { noteName, PianoKeys } from './Keyboard.tsx';
import { keyboardOpen, metroOpen, musicOpen, trackOpen, tunerOpen } from './state.ts';

/** an instrument or someone's notes are in play (true from the first note: not one change per note) */
export const midiActive = computed(
  () =>
    session.midi.devices.connected.value ||
    session.peers.value.some((p) => p.remote?.midi.sending) ||
    session.midi.lastLocal.value > 0,
);

/** a backing track is shared in the lesson (or on its way) */
export const trackInPlay = computed(
  () =>
    !!session.backing.track.value ||
    !!session.backing.incoming.value ||
    !!session.backing.shared.value?.id ||
    !!session.video.shared.value?.id,
);

/** What each tool shows now: opened by hand, or by itself while it is in use (unless hidden by hand). */
export const shown = computed(() => {
  const s = settings.value;
  const track = trackOpen.value;
  const metro = metroOpen.value;
  return {
    keys: keyboardOpen.value || (s.midi.keyboard && midiActive.value),
    track: trackInPlay.value ? track !== false : track === true,
    metronome: session.metronome.shared.value.running ? metro !== false : metro === true,
    tuner: tunerOpen.value,
  };
});

/** The strip is out: opened from the bar, or a tool in it is showing. */
export const stripShown = computed(() => {
  const s = shown.value;
  return musicOpen.value || s.keys || s.track || s.metronome || s.tuner;
});

/** Open or close the whole strip (the bar's Music button). */
export function toggleMusic(): void {
  if (stripShown.peek()) closeMusic();
  else musicOpen.value = true;
}

export function closeMusic(): void {
  musicOpen.value = false;
  setKeys(false);
  trackOpen.value = false;
  metroOpen.value = false;
  tunerOpen.value = false;
}

function setKeys(on: boolean): void {
  keyboardOpen.value = on;
  updateMidi({ keyboard: on });
}

export function MusicStrip() {
  const s = shown.value;
  // a new track, or the metronome starting or stopping: they show by themselves again
  const trackId = session.backing.shared.value?.id ?? null;
  const running = session.metronome.shared.value.running;
  useEffect(() => {
    trackOpen.value = null;
  }, [trackId]);
  useEffect(() => {
    metroOpen.value = null;
  }, [running]);
  const bt = session.backing.shared.value;
  const chips: {
    id: 'track' | 'metronome' | 'tuner' | 'keys' | 'score';
    label: string;
    icon: typeof Play;
    on: boolean;
    busy: boolean;
    badge?: string;
    toggle: () => void;
  }[] = [
    {
      id: 'track',
      label: t('Track'),
      icon: ListMusic,
      on: s.track,
      busy: !!bt?.id && bt.playing,
      toggle: () => (trackOpen.value = !s.track),
    },
    {
      id: 'metronome',
      label: t('Metronome'),
      icon: MetronomeIcon,
      on: s.metronome,
      busy: running,
      badge: running ? `${session.metronome.shared.value.bpm}` : undefined,
      toggle: () => (metroOpen.value = !s.metronome),
    },
    {
      id: 'tuner',
      label: t('Tuner'),
      icon: Gauge,
      on: s.tuner,
      busy: false,
      toggle: () => (tunerOpen.value = !s.tuner),
    },
    { id: 'keys', label: t('Piano'), icon: KeyboardMusic, on: s.keys, busy: false, toggle: () => setKeys(!s.keys) },
    {
      id: 'score',
      label: t('Score'),
      icon: FileText,
      on: scoreShown.value || (scorePickOpen.value && !session.score.shared.value?.id),
      busy: !!session.score.shared.value?.id,
      // show and hide the one open, or the panel to open one (a file, or one used before)
      toggle: () => {
        if (session.score.shared.peek()?.id) scoreHidden.value = !scoreHidden.peek();
        else scorePickOpen.value = !scorePickOpen.peek();
      },
    },
  ];
  return (
    <section class="music" aria-label={t('Music tools')} data-testid="music">
      <div class="music-head" role="toolbar" aria-label={t('Music tools')}>
        {chips.map((c) => (
          <button
            type="button"
            class={`music-chip ${c.on ? 'on' : ''}`}
            aria-pressed={c.on}
            aria-label={c.label}
            title={c.label}
            onClick={c.toggle}
            data-testid={`chip-${c.id}`}
          >
            <c.icon size={16} />
            <span>{c.label}</span>
            {c.badge && <b class="chip-badge">{c.badge}</b>}
            {c.busy && <i class="chip-dot" aria-label={t('in use')} />}
          </button>
        ))}
        <span class="grow" />
        <button
          type="button"
          class="icon-btn sm"
          onClick={closeMusic}
          aria-label={t('Hide the music tools')}
          title={t('Hide the music tools')}
        >
          <X size={16} />
        </button>
      </div>
      {s.track && <BackingPlayer />}
      {s.metronome && <MetronomePanel />}
      {s.tuner && <TunerPanel />}
      {scorePickOpen.value && !session.score.shared.value?.id && <ScorePicker />}
      {s.keys && <PianoKeys onClose={() => setKeys(false)} />}
    </section>
  );
}

// ============================================================================================ metronome

const SUBS: { value: MetronomeSetup['sub']; label: string; title: () => string }[] = [
  { value: 1, label: '♩', title: () => t('Quarter notes') },
  { value: 2, label: '♫', title: () => t('Eighth notes') },
  { value: 3, label: '3', title: () => t('Triplets') },
  { value: 4, label: '♬', title: () => t('Sixteenth notes') },
];

function MetronomePanel() {
  const m = session.metronome;
  const s = m.shared.value;
  const lit = m.lit.value;
  const held = session.controlsHeld.value;
  const can = m.canControl && !held;
  const self = session.selfId;
  const peers = session.peers.value;
  const vol = settings.value.metronome.volume;
  const taps = useRef<number[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const musicians = [
    { id: self, name: t('Me') },
    ...peers
      .filter((p) => p.link === 'connected' && p.info.role === 'player')
      .map((p) => ({ id: p.id, name: p.info.name })),
  ];
  const ref = s.ref || self;
  const refGone = s.running && !musicians.some((x) => x.id === ref);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current, now].slice(-6);
    const bpm = tapTempo(taps.current);
    if (bpm) m.setBpm(bpm);
  };
  return (
    <div class="tool metro" data-testid="metronome">
      <HeldNote />
      <div class="tool-row">
        <button
          type="button"
          class="icon-btn play"
          onClick={() => m.toggle()}
          disabled={!can}
          aria-label={s.running ? t('Stop the metronome') : t('Start the metronome')}
          title={
            s.running ? t('Stop the metronome') : t('Start the metronome: it plays in time with you, for everyone')
          }
          data-testid="metro-play"
        >
          {s.running ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <span class="bpm" title={t('Tempo, beats per minute')}>
          <button
            type="button"
            class="icon-btn xs"
            disabled={!can}
            onClick={() => m.setBpm(s.bpm - 1)}
            aria-label={t('Slower')}
          >
            <Minus size={14} />
          </button>
          <input
            class="bpm-input"
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            value={draft ?? String(s.bpm)}
            disabled={!can}
            aria-label={t('Tempo, beats per minute')}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => {
              if (draft !== null && draft.trim()) m.setBpm(Number(draft));
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            }}
          />
          <button
            type="button"
            class="icon-btn xs"
            disabled={!can}
            onClick={() => m.setBpm(s.bpm + 1)}
            aria-label={t('Faster')}
          >
            <Plus size={14} />
          </button>
          <small>BPM</small>
        </span>
        <button
          type="button"
          class="btn btn-xs"
          disabled={!can}
          onClick={tap}
          title={t('Tap a few times in the tempo you want')}
        >
          {t('Tap')}
        </button>
        <span class="beats" aria-hidden="true">
          {Array.from({ length: s.beats }, (_, i) => (
            <i
              key={`${i}-${lit?.at ?? 0}`}
              class={`beat ${lit && lit.beat === i ? (lit.kind === 'bar' ? 'lit bar' : 'lit') : ''} ${i === 0 && s.accent && s.beats > 1 ? 'first' : ''}`}
            />
          ))}
        </span>
      </div>
      <div class="tool-row tool-opts">
        <label class="tool-ctl" title={t('Beats in a bar')}>
          <span class="lbl">{t('Beats')}</span>
          <select
            value={String(s.beats)}
            disabled={!can}
            onChange={(e) => m.setBeats(Number((e.currentTarget as HTMLSelectElement).value))}
            aria-label={t('Beats in a bar')}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option value={String(i + 1)}>{i + 1}</option>
            ))}
          </select>
        </label>
        <span class="sp-seg" role="group" aria-label={t('Clicks per beat')}>
          {SUBS.map((x) => (
            <button
              type="button"
              aria-pressed={s.sub === x.value}
              title={x.title()}
              aria-label={x.title()}
              disabled={!can}
              onClick={() => m.setSub(x.value)}
            >
              {x.label}
            </button>
          ))}
        </span>
        <label class="tool-ctl check" title={t('The first beat of each bar sounds higher')}>
          <input
            type="checkbox"
            checked={s.accent}
            disabled={!can}
            onChange={(e) => m.setAccent((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{t('Accent')}</span>
        </label>
        {musicians.length > 1 && (
          <label
            class="tool-ctl"
            title={t(
              'Who plays along hears it on time; the others hear it a little later, in time with them. Whoever starts it is chosen; change it here.',
            )}
          >
            <span class="lbl">{t('In time with')}</span>
            <select
              value={refGone ? '' : ref}
              disabled={!can}
              onChange={(e) => m.setReference((e.currentTarget as HTMLSelectElement).value)}
            >
              {refGone && <option value="">{t('Someone who left')}</option>}
              {musicians.map((x) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
            {s.running && ref !== self && m.delay.value > 0 && (
              <small class="muted">{t('+{ms} ms here', { ms: m.delay.value })}</small>
            )}
          </label>
        )}
        <span class="tool-ctl tool-vol">
          <span class="lbl">{t('My volume')}</span>
          <input
            class="range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onInput={(e) => m.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
            aria-label={t('Metronome volume, on this device only')}
          />
        </span>
      </div>
    </div>
  );
}

// ============================================================================================ tuner

const REFERENCES = [415, 430, 432, 435, 438, 440, 441, 442, 443, 444, 446];

/** Listens to this side's microphone and shows the nearest note and how far off it is. */
function TunerPanel() {
  const a4 = settings.value.tunerA4;
  const mic = session.media.audio.value;
  const [reading, setReading] = useState<{ midi: number; cents: number; hz: number } | null>(null);
  /** the microphone could not be opened for the tuner (blocked, or none) */
  const [noMic, setNoMic] = useState(false);
  useEffect(() => {
    let alive = true;
    let stop = () => {};
    const listen = (track: MediaStreamTrack, own: boolean) => {
      const ctx = engine.ensure();
      if (!ctx || !alive) {
        if (own) track.stop();
        return;
      }
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const recent: number[] = [];
      let frame = 0;
      let quiet = 0;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        an.getFloatTimeDomainData(buf);
        const p = detectPitch(buf, ctx.sampleRate, 40, 2100);
        if (!p || p.clarity < 0.8) {
          // a short gap keeps the last note; a longer one clears it
          if (++quiet > 20) {
            recent.length = 0;
            setReading(null);
          }
          return;
        }
        quiet = 0;
        recent.push(p.hz);
        if (recent.length > 5) recent.shift();
        const sorted = [...recent].sort((x, y) => x - y);
        const hz = sorted[sorted.length >> 1];
        const n = nearestNote(hz, settings.peek().tunerA4);
        setReading({ ...n, hz });
      };
      loop();
      stop = () => {
        cancelAnimationFrame(frame);
        src.disconnect();
        track.stop();
      };
    };
    if (mic && mic.readyState === 'live') {
      // a copy of the lesson's microphone that keeps running even while muted (the tuner listens; nothing is sent)
      const copy = mic.clone();
      copy.enabled = true;
      setNoMic(false);
      listen(copy, true);
    } else {
      // no microphone in the lesson (none chosen, or it stopped): the tuner opens it for itself, unprocessed
      navigator.mediaDevices
        ?.getUserMedia({
          audio: {
            deviceId: settings.peek().micId ? { ideal: settings.peek().micId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
        .then(
          (st) => {
            setNoMic(false);
            const tr = st.getAudioTracks()[0];
            if (alive && tr) listen(tr, true);
            else st.getTracks().forEach((x) => x.stop());
          },
          () => alive && setNoMic(true),
        );
    }
    return () => {
      alive = false;
      stop();
    };
  }, [mic]);
  const cents = reading?.cents ?? 0;
  const inTune = !!reading && Math.abs(cents) <= 5;
  return (
    <div class="tool tuner" data-testid="tuner">
      <div class="tool-row">
        <div class={`tuner-note ${inTune ? 'in' : ''}`} aria-live="polite">
          {reading ? noteName(reading.midi) : '–'}
        </div>
        <div
          class="tuner-meter"
          role="meter"
          aria-valuemin={-50}
          aria-valuemax={50}
          aria-valuenow={cents}
          aria-label={t('Cents off the note')}
        >
          <span class="tuner-scale" aria-hidden="true">
            <i>−50</i>
            <i>0</i>
            <i>+50</i>
          </span>
          <span class="tuner-track" aria-hidden="true">
            <b class="tuner-zone" />
            {reading && (
              <b
                class={`tuner-needle ${inTune ? 'in' : ''}`}
                style={{ left: `${50 + Math.max(-50, Math.min(50, cents))}%` }}
              />
            )}
          </span>
        </div>
        <div class="tuner-read">
          {reading ? (
            <>
              <b>
                {cents > 0 ? '+' : ''}
                {cents.toFixed(0)}¢
              </b>
              <small>{reading.hz.toFixed(1)} Hz</small>
            </>
          ) : (
            <small class="muted">
              {noMic ? t('The microphone could not be opened for the tuner.') : t('Play or sing a note')}
            </small>
          )}
        </div>
        <label class="tool-ctl" title={t('The pitch of A4 your ensemble tunes to')}>
          <span class="lbl">A4</span>
          <select
            value={String(a4)}
            onChange={(e) => update({ tunerA4: Number((e.currentTarget as HTMLSelectElement).value) })}
            aria-label={t('Reference pitch of A4')}
          >
            {REFERENCES.map((r) => (
              <option value={String(r)}>{r} Hz</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
