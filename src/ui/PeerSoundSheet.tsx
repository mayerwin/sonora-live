// The sound from one person, as this side hears it: their microphone's settings (applied on their device, which
// shows who changed what) and the noise reduction of what this side hears (for this listener only). Whoever hears
// a sound is the one who can tell what it needs.

import { AudioWaveform } from 'lucide-preact';
import { t } from '../app/i18n.ts';
import { session, watching } from '../app/session.ts';
import { settings, type EchoSetting } from '../app/settings.ts';
import { Seg, Sheet, ToggleRow } from './common.tsx';
import { peerSound, sheet } from './state.ts';

export function PeerSoundSheet() {
  const id = peerSound.value;
  const peer = session.peers.value.find((p) => p.id === id);
  void settings.value.cleanNoise;
  const close = () => (sheet.value = null);
  if (!peer || !id) return null;
  const r = peer.remote;
  const name = peer.info.name;
  const observer = watching();
  // older versions do not say their settings: nothing to change then
  const known = !!r?.soundSetting && !!r.echoSetting;
  const locked = observer || !known;
  const mic = r?.soundSetting === 'voice' ? 'voice' : 'pure';
  return (
    <Sheet title={t('Sound from {name}', { name })} icon={<AudioWaveform />} onClose={close}>
      <p class="lead" style="margin-top:0">
        {t(
          'You hear it, so you can tell what it needs. Changes to their microphone are made on their device, and they are told.',
        )}
      </p>

      <div class="section">
        <h3>{t('Their microphone')}</h3>
        <Seg<'pure' | 'voice'>
          label={t('Their microphone')}
          value={mic}
          disabled={locked}
          onChange={(v) => session.setTheirSound(id, { sound: v === 'voice' ? 'voice' : 'auto' })}
          options={[
            { value: 'pure', label: t('Instrument and voice') },
            { value: 'voice', label: t('Voice only') },
          ]}
        />
        {mic === 'pure' && (
          <ToggleRow
            title={t('Voice only while their piano plays through MIDI')}
            sub={
              r?.midi.sending
                ? r.sound === 'voice'
                  ? t('Now: their piano reaches you as MIDI, their microphone carries their voice only.')
                  : t('Now: their piano reaches you as MIDI and through their microphone.')
                : t('Their piano does not play through MIDI now.')
            }
            checked={r?.soundSetting === 'auto'}
            disabled={locked}
            onChange={(v) => session.setTheirSound(id, { sound: v ? 'auto' : 'pure' })}
          />
        )}
      </div>

      <div class="section">
        <h3>{t('Echo cancelling on their side')}</h3>
        <Seg<EchoSetting>
          label={t('Echo cancelling on their side')}
          value={r?.echoSetting ?? 'auto'}
          disabled={locked}
          onChange={(v) => session.setTheirSound(id, { echo: v })}
          options={[
            { value: 'auto', label: t('Auto') },
            { value: 'on', label: t('On') },
            { value: 'off', label: t('Off (headphones)') },
          ]}
        />
        <p class="lead">
          {r?.echo
            ? t('Now: on. You do not hear yourself back from their speakers.')
            : r?.headphones
              ? t('Now: off, they wear headphones.')
              : t('Now: off. If you hear yourself back, turn it on.')}
        </p>
      </div>

      <div class="section">
        <ToggleRow
          title={t('Remove steady background noise')}
          sub={t(
            'For what you hear only: hiss, a fan, air conditioning are taken out; their instrument and voice stay as they are. Adds 8 ms.',
          )}
          checked={session.cleansNoise(id)}
          onChange={(v) => session.setCleanNoise(id, v)}
        />
      </div>

      {observer && <p class="lead">{t('As an observer, you can only change what you hear.')}</p>}
      {!observer && !known && (
        <p class="lead">
          {t('{name} uses an older version: reload it to change their microphone from here.', { name })}
        </p>
      )}
    </Sheet>
  );
}
