// The sound check, as a button and a sentence: in the lobby beside "Wearing headphones?", and in Settings → Sound.
// Two sweeps from the speakers settle headphones or speakers without guessing, and measure the device's real
// delay; with headphones, an optional second step measures theirs (held against the microphone).

import { useState } from 'preact/hooks';
import { AudioWaveform, Headphones, Volume2 } from 'lucide-preact';
import { session } from '../app/session.ts';
import { t } from '../app/i18n.ts';

type Phase =
  | { k: 'idle' }
  | { k: 'running'; mode: 'detect' | 'headphones' }
  | { k: 'speakers'; ms: number | null; extra: number | null }
  | { k: 'headphones' }
  | { k: 'measured'; ms: number | null; extra: number | null }
  | { k: 'unheard' }
  | { k: 'failed' };

export function SoundCheckButton() {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const run = async (mode: 'detect' | 'headphones') => {
    setPhase({ k: 'running', mode });
    try {
      const r = await session.soundCheck(mode);
      if (mode === 'detect')
        setPhase(r.heard ? { k: 'speakers', ms: r.roundTripMs, extra: r.extraMs } : { k: 'headphones' });
      else setPhase(r.heard ? { k: 'measured', ms: r.roundTripMs, extra: r.extraMs } : { k: 'unheard' });
    } catch {
      setPhase({ k: 'failed' });
    }
  };
  const busy = phase.k === 'running';
  return (
    <div class="check" data-testid="sound-check">
      <button
        type="button"
        class="btn btn-sm"
        disabled={busy}
        onClick={() => void run('detect')}
        data-testid="check-run"
      >
        <AudioWaveform /> {busy && phase.mode === 'detect' ? t('Listening…') : t('Sound check')}
      </button>
      <p class="check-say" aria-live="polite">
        {phase.k === 'idle' &&
          t(
            'Two short sweeps from your speakers: if your microphone hears them, you are on speakers. Takes 2 seconds.',
          )}
        {phase.k === 'running' && phase.mode === 'detect' && t('Playing two short sweeps…')}
        {phase.k === 'speakers' && (
          <>
            <Volume2 size={15} /> {t('Speakers: your microphone hears them, so their sound is taken out of it.')}{' '}
            {phase.ms !== null && t('Round trip {ms} ms.', { ms: Math.round(phase.ms) })}
          </>
        )}
        {(phase.k === 'headphones' || (phase.k === 'running' && phase.mode === 'headphones')) && (
          <>
            <Headphones size={15} /> {t('Headphones: nothing reaches your microphone, so nothing is processed.')}{' '}
            {t(
              'Bluetooth headphones can add a fifth of a second: to measure theirs, hold one earcup against your microphone and press Measure.',
            )}{' '}
            <button
              type="button"
              class="link-btn"
              disabled={busy}
              onClick={() => void run('headphones')}
              data-testid="check-measure"
            >
              {busy ? t('Listening…') : t('Measure')}
            </button>
          </>
        )}
        {phase.k === 'measured' &&
          (phase.extra
            ? t(
                'Headphones: {ms} ms more than the browser says. What the others play in time with you now waits for it.',
                {
                  ms: phase.extra,
                },
              )
            : t('Headphones: no more delay than the browser says.'))}
        {phase.k === 'unheard' &&
          t('Still nothing: hold the earcup closer to the microphone, turn the volume up, and try again.')}
        {phase.k === 'failed' && t('The microphone could not be opened for the check.')}
      </p>
    </div>
  );
}
