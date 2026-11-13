// The lesson timer (off unless wanted, and only for this side): how long the lesson has been going, from the
// moment someone else is there, or how long is left of a 30, 45, 60 or 90 minute lesson, with a soft chime five
// minutes before the end and at the end. In the top bar; a tap changes it.

import { effect, signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { Timer as TimerIcon } from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update } from '../app/settings.ts';
import { chime, toast } from '../app/notify.ts';
import { t } from '../app/i18n.ts';
import { Seg } from './common.tsx';

export const LENGTHS = [0, 30, 45, 60, 90] as const;
export type LessonLength = (typeof LENGTHS)[number];

/** when the lesson started here: the first moment someone else was connected (0: not yet) */
const startedAt = signal(0);

effect(() => {
  const inRoom = session.phase.value === 'room';
  const someone = session.peers.value.some((p) => p.link === 'connected' && !p.info.of);
  if (!inRoom) startedAt.value = 0;
  else if (someone && !startedAt.peek()) startedAt.value = Date.now();
});

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
};

/** The chip, when the timer is on. */
export function LessonTimer() {
  const cfg = settings.value.timer;
  const start = startedAt.value;
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!cfg.on || !start) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cfg.on, start]);
  // the chimes: five minutes before the end, and at the end (once each)
  useEffect(() => {
    if (!cfg.on || !start || !cfg.minutes) return;
    const end = start + cfg.minutes * 60_000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const soon = end - 5 * 60_000 - Date.now();
    if (soon > 0)
      timers.push(
        setTimeout(() => {
          chime('join');
          toast({
            kind: 'info',
            title: t('Five minutes left'),
            body: t('The lesson ends at {time}.', { time: clockOf(end) }),
          });
        }, soon),
      );
    if (end > Date.now())
      timers.push(
        setTimeout(() => {
          chime('leave');
          toast({
            kind: 'info',
            title: t('Time is up'),
            body: t('{n} minutes: the lesson’s length.', { n: cfg.minutes }),
          });
        }, end - Date.now()),
      );
    return () => timers.forEach(clearTimeout);
  }, [cfg.on, cfg.minutes, start]);
  if (!cfg.on || !start) return null;
  const elapsed = now - start;
  const left = cfg.minutes ? cfg.minutes * 60_000 - elapsed : null;
  const state = left === null ? '' : left <= 0 ? 'over' : left <= 5 * 60_000 ? 'soon' : '';
  return (
    <div class="timer-wrap">
      <button
        class={`timer-chip ${state}`}
        onClick={() => setOpen(!open)}
        title={left === null ? t('Lesson time') : t('Time left in the lesson')}
        data-testid="lesson-timer"
      >
        <TimerIcon size={15} />
        <span>{left === null ? fmt(elapsed) : left > 0 ? fmt(left) : `+${fmt(-left)}`}</span>
      </button>
      {open && (
        <div class="menu timer-menu" role="dialog" aria-label={t('Lesson timer')}>
          <TimerSettings />
          <button class="link-btn" onClick={() => (startedAt.value = Date.now())}>
            {t('Start again from now')}
          </button>
        </div>
      )}
    </div>
  );
}

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Its two choices (the chip's menu, and Settings → Room). */
export function TimerSettings() {
  const cfg = settings.value.timer;
  return (
    <div class="timer-settings">
      <label class="check-row">
        <input
          type="checkbox"
          checked={cfg.on}
          onChange={(e) => update({ timer: { ...cfg, on: (e.currentTarget as HTMLInputElement).checked } })}
          data-testid="timer-on"
        />
        {t('Show the lesson timer')}
      </label>
      <Seg<LessonLength>
        label={t('Lesson length')}
        value={cfg.minutes}
        disabled={!cfg.on}
        options={LENGTHS.map((m) => ({
          value: m,
          label: m ? t('{n} min', { n: m }) : t('No end'),
        }))}
        onChange={(v) => update({ timer: { ...cfg, minutes: v } })}
      />
    </div>
  );
}
