// The backing track player: above the controls, like the piano keys. Load a file; it reaches everyone and plays
// on each side in time (src/app/backing.ts). Speed, key, loop and position are shared; the volume is each
// person's own.

import { useRef } from 'preact/hooks';
import {
  ChevronDown,
  FileMusic,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  Trash,
  Upload,
  X,
} from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update } from '../app/settings.ts';
import { t } from '../app/i18n.ts';
import { clockOf, MIN_LOOP_S, stepRate } from '../media/backing-core.ts';
import { trackOpen } from './state.ts';

const ACCEPT = 'audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.aif,.aiff';

export function BackingPlayer() {
  const b = session.backing;
  const tr = b.track.value;
  const s = b.shared.value;
  const incoming = b.incoming.value;
  const dur = b.duration.value;
  const pos = b.position.value;
  const peers = session.peers.value;
  const vol = settings.value.backingVolume;
  const can = b.canControl;
  const self = session.selfId;
  const file = useRef<HTMLInputElement>(null);
  const active = !!tr && !!s && s.id === tr.id;
  const loop = active ? s.loop : null;
  const musicians = [
    { id: self, name: t('Me') },
    ...peers
      .filter((p) => p.link === 'connected' && p.info.role === 'player')
      .map((p) => ({ id: p.id, name: p.info.name })),
  ];
  const ref = s?.ref ?? self;
  const refGone = active && !musicians.some((m) => m.id === ref);
  const pick = () => file.current?.click();
  const pct = (x: number) => (dur > 0 ? `${(Math.max(0, Math.min(dur, x)) / dur) * 100}%` : '0%');
  const headphones = session.media.headphones.value;

  return (
    <section class="track" aria-label={t('Backing track')} data-testid="backing-track">
      <input
        ref={file}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) b.load(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />
      <div class="track-row">
        <FileMusic class="track-ico" />
        <div class="track-name" title={tr?.name}>
          {tr ? (
            tr.name
          ) : incoming ? (
            t('Receiving {file} · {pct}%', { file: incoming.name, pct: Math.round(incoming.progress * 100) })
          ) : s?.id ? (
            t('Waiting for the track…')
          ) : (
            <span class="muted">{t('No backing track. Load an audio file: it plays for everyone, in time.')}</span>
          )}
        </div>
        {can && (
          <button class="btn btn-sm btn-ghost" onClick={pick} data-testid="track-load">
            <Upload /> {tr ? t('Change') : t('Load a track')}
          </button>
        )}
        {can && tr && (
          <button
            class="icon-btn sm"
            onClick={() => b.remove()}
            aria-label={t('Remove the track for everyone')}
            title={t('Remove the track for everyone')}
          >
            <Trash size={16} />
          </button>
        )}
        <button
          class="icon-btn sm"
          onClick={() => (trackOpen.value = false)}
          aria-label={t('Hide the player')}
          title={t('Hide the player')}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {active && (
        <>
          <div class="track-row">
            <button
              class="icon-btn"
              onClick={() => b.stop()}
              disabled={!can}
              aria-label={t('Back to the start')}
              title={t('Back to the start')}
            >
              <SkipBack size={18} />
            </button>
            <button
              class="icon-btn play"
              onClick={() => (s.playing ? b.pause() : b.play())}
              disabled={!can || b.failed.value}
              aria-label={s.playing ? t('Pause') : t('Play')}
              data-testid="track-play"
            >
              {s.playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <span class="track-time">{clockOf(pos)}</span>
            <div class="track-seek">
              {loop && (
                <i class="track-loop" style={{ left: pct(loop.a), width: `calc(${pct(loop.b)} - ${pct(loop.a)})` }} />
              )}
              <input
                class="range"
                type="range"
                min={0}
                max={dur || 1}
                step={0.1}
                value={pos}
                disabled={!can || !dur}
                onChange={(e) => b.seek(Number((e.currentTarget as HTMLInputElement).value))}
                aria-label={t('Position')}
              />
            </div>
            <span class="track-time">{clockOf(dur)}</span>
          </div>

          <div class="track-row track-opts">
            <span class="track-ctl" title={t('Speed (the pitch stays)')}>
              <span class="lbl">{t('Speed')}</span>
              <button
                class="icon-btn xs"
                disabled={!can}
                onClick={() => b.setRate(stepRate(s.rate, -1))}
                aria-label={t('Slower')}
              >
                <Minus size={14} />
              </button>
              <b class={s.rate !== 1 ? 'on' : ''}>{Math.round(s.rate * 100)}%</b>
              <button
                class="icon-btn xs"
                disabled={!can}
                onClick={() => b.setRate(stepRate(s.rate, 1))}
                aria-label={t('Faster')}
              >
                <Plus size={14} />
              </button>
            </span>
            <span class="track-ctl" title={t('Key (the speed stays)')}>
              <span class="lbl">{t('Key')}</span>
              <button
                class="icon-btn xs"
                disabled={!can}
                onClick={() => b.setSemitones(s.semis - 1)}
                aria-label={t('A semitone lower')}
              >
                <Minus size={14} />
              </button>
              <b class={s.semis !== 0 ? 'on' : ''}>{s.semis > 0 ? `+${s.semis}` : s.semis}</b>
              <button
                class="icon-btn xs"
                disabled={!can}
                onClick={() => b.setSemitones(s.semis + 1)}
                aria-label={t('A semitone higher')}
              >
                <Plus size={14} />
              </button>
            </span>
            <span
              class="track-ctl"
              title={t('Repeat a passage: set its start and end while it plays, or from the position')}
            >
              <Repeat size={15} class={loop ? 'on' : ''} />
              <button
                class="btn btn-xs"
                disabled={!can}
                onClick={() => b.setLoop({ a: pos, b: loop && loop.b > pos + MIN_LOOP_S ? loop.b : dur })}
                title={t('The passage starts here')}
              >
                A{loop ? ` ${clockOf(loop.a)}` : ''}
              </button>
              <button
                class="btn btn-xs"
                disabled={!can}
                onClick={() => b.setLoop({ a: loop && loop.a < pos - MIN_LOOP_S ? loop.a : 0, b: pos })}
                title={t('The passage ends here')}
              >
                B{loop ? ` ${clockOf(loop.b)}` : ''}
              </button>
              {loop && (
                <button class="icon-btn xs" disabled={!can} onClick={() => b.setLoop(null)} aria-label={t('No repeat')}>
                  <X size={14} />
                </button>
              )}
            </span>
            <label
              class="track-ctl count-in"
              title={t(
                'Before the track starts: one bar of clicks at the metronome’s tempo ({beats} beats at {bpm} BPM)',
                {
                  beats: settings.value.metronome.beats,
                  bpm: settings.value.metronome.bpm,
                },
              )}
            >
              <input
                type="checkbox"
                checked={settings.value.metronome.countIn}
                onChange={(e) =>
                  update({
                    metronome: { ...settings.value.metronome, countIn: (e.currentTarget as HTMLInputElement).checked },
                  })
                }
              />
              <span>{t('Count-in')}</span>
            </label>
            {musicians.length > 1 && (
              <label
                class="track-ctl"
                title={t(
                  'Who plays or sings along hears the track on time; the others hear it a little later, in time with them. Whoever presses Play is chosen; change it here.',
                )}
              >
                <span class="lbl">{t('In time with')}</span>
                <select
                  value={refGone ? '' : ref}
                  disabled={!can}
                  onChange={(e) => b.setReference((e.currentTarget as HTMLSelectElement).value)}
                >
                  {refGone && <option value="">{t('Someone who left')}</option>}
                  {musicians.map((m) => (
                    <option value={m.id}>{m.name}</option>
                  ))}
                </select>
                {ref !== self && b.delay.value > 0 && (
                  <small class="muted">{t('+{ms} ms here', { ms: b.delay.value })}</small>
                )}
              </label>
            )}
            <span class="track-ctl track-vol">
              <span class="lbl">{t('My volume')}</span>
              <input
                class="range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={vol}
                onInput={(e) => b.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
                aria-label={t('Backing track volume, on this device only')}
              />
            </span>
          </div>
          {!headphones && (
            <div class="track-hint">
              <Headphones size={14} />
              <span>{t('Best with headphones: the track then never reaches your microphone.')}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
