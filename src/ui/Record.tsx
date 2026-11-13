// Recording, as people meet it: a Record button with its two choices, a red chip in the top bar while anyone
// records (nobody is recorded without seeing it), a banner offering back a recording a closed tab interrupted,
// and the recordings kept on this device in Settings.

import { computed } from '@preact/signals';
import { Circle, Download, Square, Trash2, TriangleAlert } from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update } from '../app/settings.ts';
import { fileName } from '../app/recorder.ts';
import type { RecMeta } from '../media/recstore.ts';
import { t } from '../app/i18n.ts';
import { Seg, ToggleRow } from './common.tsx';
import { menu } from './state.ts';
import { HeldNote } from './Host.tsx';

const rec = session.recorder;

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

export function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/** what the top bar shows: this side recording, or the others who are */
const anyone = computed(() => rec.state.value !== 'idle' || rec.others.value.length > 0);

/** The red chip in the top bar: this side's recording (time, Stop) or who else records. */
export function RecChip() {
  if (!anyone.value) return null;
  const st = rec.state.value;
  if (st !== 'idle') {
    return (
      <button
        class="rec-chip mine"
        onClick={() => void rec.stop()}
        disabled={st !== 'recording'}
        title={t('Stop recording and save the file')}
        data-testid="rec-chip"
      >
        <span class="rec-dot" />
        <span class="rec-time">{st === 'saving' ? t('Saving…') : clock(rec.elapsed.value)}</span>
        {st === 'recording' && <Square size={13} fill="currentColor" />}
      </button>
    );
  }
  const names = rec.others.value.map((o) => o.name);
  return (
    <span class="rec-chip" data-testid="rec-chip" title={t('Recorded on their device')}>
      <span class="rec-dot" />
      <span class="txt">
        {names.length === 1
          ? t('{name} is recording', { name: names[0] })
          : t('{names} are recording', { names: names.join(', ') })}
      </span>
      <span class="rec-short">REC</span>
    </span>
  );
}

/** The menu under Record: its choices, then Start (or Stop). */
export function RecordMenu({ right }: { right?: boolean } = {}) {
  const st = rec.state.value;
  const s = settings.value.record;
  const err = rec.error.value;
  return (
    <div
      class="menu rec-menu"
      style={right ? 'left:auto;right:-60px;transform:none' : undefined}
      role="dialog"
      aria-label={t('Record the lesson')}
      data-testid="rec-menu"
    >
      <div class="rec-menu-head">
        <b>{t('Record the lesson')}</b>
        <small>
          {t(
            'Everyone you see and hear, as on your screen, saved as a video on this device when you stop. Everyone is told.',
          )}
        </small>
      </div>
      {st === 'idle' && session.controlsHeld.value ? (
        <HeldNote />
      ) : st === 'idle' ? (
        <>
          <div class="rec-row">
            <span>{t('Picture')}</span>
            <Seg
              label={t('Picture')}
              value={s.quality}
              options={[
                { value: '720p', label: '720p', title: t('About 1.2 GB an hour') },
                { value: '1080p', label: '1080p', title: t('About 2.3 GB an hour') },
              ]}
              onChange={(v) => update({ record: { ...s, quality: v } })}
            />
          </div>
          <ToggleRow
            title={t('Each person’s sound in its own file too')}
            sub={t('For editing later: one sound file per person, besides the video.')}
            checked={s.voices}
            onChange={(v) => update({ record: { ...s, voices: v } })}
          />
          {err && (
            <p class="rec-err">
              <TriangleAlert size={14} /> {err}
            </p>
          )}
          <button
            class="btn btn-primary rec-start"
            onClick={() => {
              void rec.start().then((ok) => {
                if (ok) menu.value = null;
              });
            }}
            data-testid="rec-start"
          >
            <Circle size={14} fill="currentColor" /> {t('Start recording')}
          </button>
        </>
      ) : (
        <>
          <p class="rec-now">
            <span class="rec-dot" /> {st === 'saving' ? t('Saving…') : clock(rec.elapsed.value)}
            <span class="faint"> · {size(rec.bytes.value)}</span>
          </p>
          <button
            class="btn rec-start"
            disabled={st !== 'recording'}
            onClick={() => {
              void rec.stop();
              menu.value = null;
            }}
            data-testid="rec-stop"
          >
            <Square size={13} fill="currentColor" /> {t('Stop and save')}
          </button>
        </>
      )}
    </div>
  );
}

/** A recording a closed tab (or a crash) interrupted: offered back, once, wherever the person lands. */
export function RecoverBanner() {
  const list = rec.kept.value.filter((m) => !m.done && m.kind === 'lesson');
  if (!list.length || rec.state.value !== 'idle') return null;
  const m = list[0];
  return (
    <div class="banner" data-testid="rec-recover">
      <TriangleAlert />
      <div class="grow">
        <b>{t('A recording was interrupted')}</b>
        <small>
          {t('{when}, {length}: everything up to the last second was kept.', {
            when: new Date(m.started).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
            length: clock(m.durationMs ?? 0),
          })}
        </small>
      </div>
      <button class="btn btn-sm btn-primary" onClick={() => void rec.recover(m)} data-testid="rec-recover-save">
        <Download /> {t('Save it')}
      </button>
      <button class="icon-btn" aria-label={t('Discard')} title={t('Discard')} onClick={() => void rec.remove(m)}>
        <Trash2 />
      </button>
    </div>
  );
}

/** Settings → Room: the recording's choices and the recordings kept on this device. */
export function RecordingsSection() {
  const s = settings.value.record;
  const kept = rec.kept.value.filter((m) => m.kind === 'lesson');
  const voices = (m: RecMeta) => rec.kept.value.filter((v) => v.id.startsWith(`${m.id}-v`)).length;
  return (
    <div class="section">
      <h3>{t('Recording')}</h3>
      <div class="field">
        <label>{t('Picture')}</label>
        <Seg
          label={t('Picture')}
          value={s.quality}
          options={[
            { value: '720p', label: t('720p · about 1.2 GB an hour') },
            { value: '1080p', label: t('1080p · about 2.3 GB an hour') },
          ]}
          onChange={(v) => update({ record: { ...s, quality: v } })}
        />
      </div>
      <ToggleRow
        title={t('Each person’s sound in its own file too')}
        sub={t('For editing later: one sound file per person, besides the video.')}
        checked={s.voices}
        onChange={(v) => update({ record: { ...s, voices: v } })}
      />
      {kept.length > 0 && (
        <>
          <p class="hint">{t('Kept on this device for two weeks, in case a file needs saving again:')}</p>
          <ul class="rec-list" data-testid="rec-list">
            {kept.map((m) => (
              <li key={m.id}>
                <span class="grow">
                  <b>{fileName(m)}</b>
                  <small>
                    {clock(m.durationMs ?? 0)}
                    {voices(m) === 1
                      ? ` · ${t('1 sound file')}`
                      : voices(m) > 1
                        ? ` · ${t('{n} sound files', { n: voices(m) })}`
                        : ''}
                    {!m.done ? ` · ${t('interrupted')}` : ''}
                  </small>
                </span>
                <button
                  class="icon-btn"
                  title={t('Save again')}
                  aria-label={t('Save again')}
                  onClick={() => void rec.recover(m)}
                >
                  <Download />
                </button>
                <button
                  class="icon-btn"
                  title={t('Delete')}
                  aria-label={t('Delete')}
                  onClick={() => void rec.remove(m)}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
