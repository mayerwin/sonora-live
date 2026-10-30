import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  ArrowRight,
  AudioWaveform,
  Copy,
  Download,
  FlipHorizontal2,
  Languages,
  Headphones,
  Mic,
  MicOff,
  Piano,
  QrCode,
  Share2,
  ShieldCheck,
  TriangleAlert,
  Video,
  VideoOff,
  Zap,
} from 'lucide-preact';
import { session, roleLabel } from '../app/session.ts';
import { askNotifications, notifyPermission } from '../app/notify.ts';
import { settings, update, updateMidi } from '../app/settings.ts';
import { browserName, os, REPO_URL } from '../app/platform.ts';
import type { Picture } from '../media/picture.ts';
import { listDevices, type DeviceLists, type MediaProblem } from '../media/local.ts';
import { normalizeRoomCode, prettyCode } from '../net/code.ts';
import type { Role } from '../net/room.ts';
import { LevelBars, Qr, VideoView } from './common.tsx';
import { GitHubIcon, initials, Logo, RoleIcon, Wordmark } from './icons.tsx';
import { installable, promptInstall } from '../app/pwa.ts';
import { canShare, copyLink, roomLink, shareLink } from './share.ts';
import { capital, lang, LANGUAGES, t } from '../app/i18n.ts';

const roles = (): { role: Role; sub: string }[] => [
  { role: 'student', sub: t('Here to learn') },
  { role: 'teacher', sub: t('Giving the lesson') },
  { role: 'observer', sub: t('Parent, guest') },
];

export function problemText(p: MediaProblem, what: 'camera' | 'microphone'): string {
  const cam = what === 'camera';
  const name = browserName();
  switch (p) {
    case 'denied':
      return cam
        ? t("Camera blocked. Allow it from the icon in {browser}'s address bar: it starts at once.", { browser: name })
        : t("Microphone blocked. Allow it from the icon in {browser}'s address bar: it starts at once.", {
            browser: name,
          });
    case 'none':
      return cam ? t('No camera found. You can join with sound only.') : t('No microphone found.');
    case 'busy':
      return cam
        ? t('The camera is used by another app. Close it (Zoom, Teams, another tab), then try again.')
        : t('The microphone is used by another app. Close it (Zoom, Teams, another tab), then try again.');
    case 'insecure':
      return t('Camera and microphone need a secure (https) page.');
    case 'unsupported':
      return capital(
        cam
          ? t('{browser} cannot use a camera here. Try Chrome, Edge, Safari or Firefox.', { browser: name })
          : t('{browser} cannot use a microphone here. Try Chrome, Edge, Safari or Firefox.', { browser: name }),
      );
    default:
      return cam ? t('The camera could not start.') : t('The microphone could not start.');
  }
}

/** Why the camera shows no real picture, and what to do (see src/media/picture.ts). */
function pictureHelp(p: Picture): string {
  if (p === 'dark')
    return t('Your camera sends a black picture: is its cover closed, or is it switched off by a key on the keyboard?');
  if (p === 'frozen') {
    return os === 'windows'
      ? t(
          'Your camera shows a still image, not you: Windows is blocking it. Check Settings → Privacy & security → Camera, the camera key or cover, and close other apps using it (Teams, Zoom). Then turn the camera off and on below.',
        )
      : t(
          'Your camera shows a still image, not you: it may be blocked by the system or used by another app. Close other apps using it, then turn the camera off and on below.',
        );
  }
  return t('No picture from your camera: another app may be using it, or it is switched off by a key on the keyboard.');
}

export function Lobby() {
  const s = settings.value;
  const media = session.media;
  const code = session.code.value;
  const fresh = session.fresh.value;
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  const joinOther = useSignal(false);
  const typed = useSignal('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const videoTrack = media.video.value;
  const stream = useMemo(() => (videoTrack ? new MediaStream([videoTrack]) : null), [videoTrack]);
  const level = session.meter.level.value;
  const clipping = session.meter.clipping.value;
  const typedCode = useComputed(() => normalizeRoomCode(typed.value));

  // camera and microphone (again, after a problem: what works is kept, what failed is asked for again)
  const startMedia = () => {
    const cur = settings.peek();
    return media.start({
      mode: session.soundMode.peek(),
      micId: cur.micId,
      camId: cur.camId,
      quality: cur.videoQuality,
      wantVideo: !cur.camOff,
    });
  };

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void listDevices().then((d) => {
        if (alive) setDevices(d);
      });
    // back from a reload in the middle of a lesson: straight back in
    const resume = session.wasInLesson() && !!settings.peek().role;
    if (!media.audio.peek() && !media.video.peek())
      void startMedia().then(() => {
        refresh();
        if (resume && alive) void enter();
      });
    else refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    // allowed afterwards from the address bar: start at once, no reload needed
    const watched: PermissionStatus[] = [];
    for (const name of ['camera', 'microphone'] as PermissionName[]) {
      void navigator.permissions
        ?.query({ name })
        .then((st) => {
          watched.push(st);
          st.onchange = () => {
            if (alive && st.state === 'granted') void startMedia().then(refresh);
          };
        })
        .catch(() => {});
    }
    // an instrument used here before reconnects without asking
    void (async () => {
      const key = settings.peek().midi.instrument;
      if (key.startsWith('port:') && (await session.midi.devices.granted())) {
        if (await session.midi.devices.request()) {
          if (session.midi.devices.instruments.peek().some((i) => i.key === key)) session.midi.devices.select(key);
        }
      }
    })();
    return () => {
      alive = false;
      for (const st of watched) st.onchange = null;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  const enter = async () => {
    if (!settings.peek().role) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      document.querySelector('.roles')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    // whoever opens a new room waits for the others: the moment to offer a notification when they arrive
    if (session.fresh.peek() && settings.peek().notifyJoin && notifyPermission.peek() === 'default')
      void askNotifications();
    await session.enter();
  };

  const join = () => {
    const c = typedCode.value;
    if (!c) return;
    session.useCode(c);
    joinOther.value = false;
    typed.value = '';
  };

  const name = s.name.trim();
  const ap = media.audioProblem.value;
  const picture = media.picture.state.value;
  const vp = media.videoProblem.value;

  return (
    <div class="lobby">
      <div class="atmos" />
      <header class="lobby-top">
        <a class="brand" href={REPO_URL} target="_blank" rel="noopener" aria-label={t('Sonora Live on GitHub')}>
          <Logo />
          <Wordmark />
        </a>
        <div style="display:flex;gap:6px;align-items:center">
          {installable.value && (
            <button class="btn btn-sm btn-ghost" onClick={() => void promptInstall()}>
              <Download /> {t('Install app')}
            </button>
          )}
          {LANGUAGES.filter((l) => l.value !== lang.value).map((l) => (
            <button
              class="btn btn-sm btn-ghost"
              lang={l.value}
              onClick={() => update({ language: l.value })}
              data-testid="lobby-language"
            >
              <Languages /> {l.name}
            </button>
          ))}
          <a class="icon-btn" href={REPO_URL} target="_blank" rel="noopener" aria-label={t('Source code on GitHub')}>
            <GitHubIcon />
          </a>
        </div>
      </header>

      <main class="lobby-main">
        <section class="lobby-hero">
          {fresh ? (
            <h1>
              {t('Music lessons,')} <em>{t('face to face')}</em>
              {t(', from anywhere.')}
            </h1>
          ) : (
            <h1>
              {t("You're invited to a")} <em>{t('lesson')}</em>.
            </h1>
          )}
          <p class="lede">
            {t(
              'Your instrument, heard as it really sounds. Two-way MIDI between pianos. Direct, private, no account and nothing to install.',
            )}
          </p>
          <div class="preview">
            {stream && media.camOn.value ? (
              <>
                <VideoView stream={stream} class={s.mirror ? 'mirror' : ''} />
                {picture !== 'ok' && picture !== 'unknown' && (
                  <div class="preview-note" data-testid="camera-dark">
                    <VideoOff />
                    <span>{pictureHelp(picture)}</span>
                  </div>
                )}
              </>
            ) : (
              <div class="preview-empty">
                <div>
                  <div class="avatar" data-role={s.role ?? 'student'}>
                    {initials(name || t('You'))}
                  </div>
                  {vp ? (
                    <>
                      {problemText(vp, 'camera')}
                      <button class="btn btn-sm" onClick={() => void startMedia()}>
                        {t('Try again')}
                      </button>
                    </>
                  ) : media.asking.value ? (
                    <b data-testid="camera-asking">
                      {t("Allow the camera and microphone in your browser's request, at the top of the window.")}
                    </b>
                  ) : media.camOn.value ? (
                    t('Starting camera…')
                  ) : (
                    <>
                      {t('Camera is off')}
                      <button
                        class="btn btn-sm"
                        onClick={() => void media.setCamOn(true).then(() => update({ camOff: false }))}
                      >
                        <Video /> {t('Turn camera on')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {media.audio.value && (
              <div
                class="preview-meter"
                title={clipping ? t('Too loud: lower the microphone level') : t('Microphone level')}
              >
                <Mic />
                <LevelBars level={media.micOn.value ? level : 0} clipping={clipping} />
                {clipping ? t('Too loud') : t('Mic')}
              </div>
            )}
            <div class="preview-bar">
              <button
                class={`round ${media.micOn.value ? '' : 'off'}`}
                onClick={() => media.setMicOn(!media.micOn.value)}
                aria-label={media.micOn.value ? t('Mute microphone') : t('Unmute microphone')}
                aria-pressed={!media.micOn.value}
              >
                {media.micOn.value ? <Mic /> : <MicOff />}
              </button>
              <button
                class={`round ${media.camOn.value ? '' : 'off'}`}
                onClick={() => {
                  const on = !media.camOn.value;
                  update({ camOff: !on });
                  void media.setCamOn(on);
                }}
                aria-label={media.camOn.value ? t('Turn camera off') : t('Turn camera on')}
                aria-pressed={!media.camOn.value}
              >
                {media.camOn.value ? <Video /> : <VideoOff />}
              </button>
              {media.camOn.value && (
                <button
                  class="round"
                  onClick={() => update({ mirror: !s.mirror })}
                  aria-label={s.mirror ? t('Show my preview unmirrored') : t('Mirror my preview')}
                  aria-pressed={s.mirror}
                  title={t(
                    'Mirror my preview (only for you). Turn it off for a camera pointed at the keys or a score.',
                  )}
                >
                  <FlipHorizontal2 />
                </button>
              )}
            </div>
          </div>
          {(devices.mics.length > 1 || devices.cams.length > 1) && (
            <div class="preview-devices">
              {devices.mics.length > 0 && (
                <select
                  class="select"
                  aria-label={t('Microphone')}
                  value={media.microphoneId}
                  onChange={(e) => {
                    const id = (e.currentTarget as HTMLSelectElement).value;
                    update({ micId: id });
                    void media.restartAudio(session.soundMode.peek(), id);
                  }}
                >
                  {devices.mics.map((d, i) => (
                    <option value={d.deviceId}>{d.label || t('Microphone {n}', { n: i + 1 })}</option>
                  ))}
                </select>
              )}
              {devices.cams.length > 0 && (
                <select
                  class="select"
                  aria-label={t('Camera')}
                  value={media.cameraId}
                  onChange={(e) => {
                    const id = (e.currentTarget as HTMLSelectElement).value;
                    update({ camId: id });
                    void media.restartVideo(id);
                  }}
                >
                  {devices.cams.map((d, i) => (
                    <option value={d.deviceId}>{d.label || t('Camera {n}', { n: i + 1 })}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div class="features">
            <span>
              <AudioWaveform /> {t('Pure instrument sound')}
            </span>
            <span>
              <Piano /> {t('Piano-to-piano MIDI')}
            </span>
            <span>
              <Zap /> {t('Game-grade low latency')}
            </span>
            <span>
              <ShieldCheck /> {t('Peer to peer, encrypted')}
            </span>
          </div>
        </section>

        <section class="card join-card" aria-label={t('Join the lesson')}>
          <div class="room-code-box">
            <span class="label">{fresh ? t('Your room is ready') : t('Joining room')}</span>
            <div class="room-code-row">
              <span class="code" aria-label={t('Room code {code}', { code: code.split('').join(' ') })}>
                {prettyCode(code)
                  .split(' ')
                  .map((p) => (
                    <span>{p}</span>
                  ))}
              </span>
            </div>
            {fresh && (
              <div class="code-actions">
                <button class="btn btn-sm" onClick={() => void copyLink(code)}>
                  <Copy /> {t('Copy link')}
                </button>
                {canShare && (
                  <button class="btn btn-sm" onClick={() => void shareLink(code)}>
                    <Share2 /> {t('Share')}
                  </button>
                )}
                <button class="btn btn-sm btn-ghost" onClick={() => setShowQr(!showQr)} aria-expanded={showQr}>
                  <QrCode /> QR
                </button>
              </div>
            )}
            {showQr && fresh && (
              <div style="display:flex;gap:14px;align-items:center">
                <Qr text={roomLink(code)} />
                <small style="color:var(--muted)">
                  {t('Scan with a phone or tablet to join this room (handy for a second camera).')}
                </small>
              </div>
            )}
            {fresh && (
              <ol class="steps" data-testid="steps">
                <li>{t('Enter your name, choose your role and enter the room.')}</li>
                <li>{t('Send the link (or the code) to the other person.')}</li>
                <li>{t('They open it, choose their role, and you see and hear each other.')}</li>
              </ol>
            )}
          </div>

          <label class="field">
            <span class="label">{t('Your name')}</span>
            <input
              class="input"
              value={s.name}
              maxLength={40}
              placeholder={t('e.g. Clara')}
              autoComplete="name"
              enterKeyHint="go"
              onInput={(e) => update({ name: (e.currentTarget as HTMLInputElement).value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void enter();
              }}
            />
          </label>

          <div class="field">
            <span class="label" id="role-label">
              {t("I'm joining as")}
            </span>
            <div class={`roles ${shake ? 'shake' : ''}`} role="radiogroup" aria-labelledby="role-label">
              {roles().map((r) => (
                <button
                  type="button"
                  role="radio"
                  class="role"
                  data-role={r.role}
                  aria-checked={s.role === r.role}
                  onClick={() => {
                    update({ role: r.role });
                    // an observer listens: it does not send MIDI unless it chooses to
                    updateMidi({ send: r.role !== 'observer' });
                  }}
                >
                  <span class="ico">
                    <RoleIcon role={r.role} />
                  </span>
                  <b>{roleLabel(r.role)}</b>
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>
          </div>

          {ap && (
            <div class="hint hint-bad">
              <TriangleAlert />
              <span>{problemText(ap, 'microphone')}</span>
              <button class="btn btn-sm" onClick={() => void startMedia()}>
                {t('Try again')}
              </button>
            </div>
          )}

          <button class="btn btn-primary btn-lg btn-block" onClick={() => void enter()} disabled={busy}>
            {busy ? <span class="spinner" /> : null}
            {fresh ? t('Enter the room') : t('Join the lesson')} <ArrowRight />
          </button>

          <div class="hint">
            <Headphones />
            <span>
              {t('Use headphones, wired if you can: pure sound has no echo cancelling, and Bluetooth adds delay.')}
            </span>
          </div>

          {joinOther.value ? (
            <div class="field">
              <span class="label">{t('Room code')}</span>
              <div class="join-other">
                <input
                  class="input"
                  autoFocus
                  value={typed.value}
                  placeholder="ABC 234"
                  maxLength={64}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellcheck={false}
                  enterKeyHint="go"
                  onInput={(e) => (typed.value = (e.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') join();
                  }}
                />
                <button class="btn" disabled={!typedCode.value} onClick={join}>
                  {t('Use')}
                </button>
              </div>
            </div>
          ) : (
            <div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap">
              <button class="link-btn" onClick={() => (joinOther.value = true)}>
                {t('Have a code? Join another room')}
              </button>
              {!fresh && (
                <button class="link-btn" onClick={() => session.newRoom()}>
                  {t('Start a new room instead')}
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      <footer class="lobby-foot">
        <span>{t('No account. No server sees your lesson.')}</span>
        <a href={`${REPO_URL}#how-it-works`} target="_blank" rel="noopener">
          {t('How it works')}
        </a>
        <a href={`${REPO_URL}#privacy`} target="_blank" rel="noopener">
          {t('Privacy')}
        </a>
      </footer>
    </div>
  );
}
