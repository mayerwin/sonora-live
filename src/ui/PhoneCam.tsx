// A phone as another camera: on the hands, the bow, the pedals. The computer shows a QR code; the phone opens it
// and becomes a camera of that person (no sound, nothing played, nothing to set up), seen by everyone next to its
// owner's picture. Up to four per person; the owner can take one away from here.

import { useEffect, useState } from 'preact/hooks';
import { Camera, CircleStop, RefreshCw, Smartphone, X } from 'lucide-preact';
import { session } from '../app/session.ts';
import { t } from '../app/i18n.ts';
import { Qr, Sheet } from './common.tsx';
import { sheet } from './state.ts';

export const MAX_PHONE_CAMS = 4;

/** The link a phone opens to be a camera of this person. */
export function phoneCamLink(): string {
  const q = new URLSearchParams({ cam: session.selfId, of: session.self.peek().name });
  return `${location.origin}${location.pathname}?${q}#${session.code.peek()}`;
}

/** This person's phones, connected now. */
export function myCams() {
  return session.peers.value.filter((p) => p.info.of === session.selfId && p.link !== 'closed');
}

/** The computer's side: the QR code, and the phones already connected. */
export function PhoneCamSheet() {
  const cams = myCams();
  const full = cams.length >= MAX_PHONE_CAMS;
  return (
    <Sheet title={t('A phone as a camera')} icon={<Smartphone />} onClose={() => (sheet.value = null)}>
      <div class="phonecam" data-testid="phonecam-sheet">
        <p class="lead">
          {t(
            'On your hands, the bow, the pedals: scan this with your phone’s camera and set it where it sees best. It joins as your camera, with no sound. Everyone sees it next to you.',
          )}
        </p>
        {full ? (
          <p class="hint">{t('Four phones at most: take one away to add another.')}</p>
        ) : (
          <div class="phonecam-qr">
            <Qr text={phoneCamLink()} />
            <ol class="steps">
              <li>{t('Open the camera app on the phone and point it at the code.')}</li>
              <li>{t('Allow the camera when asked.')}</li>
              <li>{t('Prop the phone up. Keep it plugged in for a long lesson.')}</li>
            </ol>
          </div>
        )}
        {cams.length > 0 && (
          <ul class="phonecam-list" data-testid="phonecam-list">
            {cams.map((c, i) => (
              <li key={c.id}>
                <Camera size={18} />
                <span class="grow">{t('Phone {n}', { n: i + 1 })}</span>
                <button class="btn btn-sm btn-ghost" onClick={() => session.stopPhoneCam(c.id)}>
                  <X size={15} /> {t('Take away')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** The phone's side: what it shows, and nothing else. */
export function CameraMode() {
  const of = session.camOf.value!;
  const st = session.camState.value;
  const video = session.media.video.value;
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (el) el.srcObject = video ? new MediaStream([video]) : null;
  }, [el, video]);
  useEffect(() => {
    void session.enterAsCamera();
  }, []);
  return (
    <div class="cam-mode" data-testid="camera-mode">
      <video ref={setEl} autoplay muted playsInline class="cam-preview" />
      <div class="cam-top">
        <span class={`cam-status ${st}`}>
          <i />
          {st === 'live'
            ? t('Live: a camera of {name}', { name: of.name })
            : st === 'stopped'
              ? t('{name} took this camera away', { name: of.name })
              : st === 'failed'
                ? t('The camera could not be opened')
                : t('Connecting to {name}’s lesson…', { name: of.name })}
        </span>
      </div>
      <div class="cam-bottom">
        {st !== 'stopped' && (
          <>
            <button class="ctl" onClick={() => void session.media.flipCamera()} aria-label={t('Switch camera')}>
              <RefreshCw />
              <span>{t('Flip')}</span>
            </button>
            <button class="ctl danger" onClick={() => session.leaveCamera()} data-testid="cam-stop">
              <CircleStop />
              <span>{t('Stop')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
