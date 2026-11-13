// The host (whoever opened the room and shared its code) can hold the shared controls: the backing track, the
// metronome, recording, and the others' sound settings. Everyone keeps their own microphone, camera and volume.
// Released the moment the host leaves.

import { Crown } from 'lucide-preact';
import { session } from '../app/session.ts';
import { update } from '../app/settings.ts';
import { t } from '../app/i18n.ts';
import { ToggleRow } from './common.tsx';

/** In a tool's panel while the host holds the controls: why the buttons do nothing here. */
export function HeldNote() {
  if (!session.controlsHeld.value) return null;
  return (
    <p class="held-note" data-testid="held-note">
      <Crown size={14} /> {t('{name} holds the shared controls.', { name: session.hostName.value ?? t('The host') })}
    </p>
  );
}

/** In the room's sheet: the host's switch, or who holds the controls. */
export function HostSection() {
  const p = session.policy.value;
  const host = session.isHost.value;
  const name = session.hostName.value;
  if (host) {
    return (
      <div class="host-section" data-testid="host-section">
        <ToggleRow
          title={t('Only I control the shared tools')}
          sub={t(
            'The backing track, the metronome, recording, and the others’ sound settings. Everyone keeps their own microphone, camera and volume. Released if you leave.',
          )}
          checked={p.controls}
          onChange={(v) => {
            session.setPolicy({ locked: p.locked, limit: p.limit, controls: v });
            update({ holdControls: v });
          }}
        />
      </div>
    );
  }
  if (!name) return null;
  return (
    <div class="host-section" data-testid="host-section">
      <p class="held-note big">
        <Crown size={16} />{' '}
        {p.controls && session.controlsHeld.value
          ? t('{name} opened this room and holds the shared controls: the track, the metronome and recording.', {
              name,
            })
          : t('{name} opened this room.', { name })}
      </p>
    </div>
  );
}
