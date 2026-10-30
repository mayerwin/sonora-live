import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  ArrowRight,
  AudioWaveform,
  Copy,
  Download,
  FlipHorizontal2,
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
import { session, ROLE_LABEL } from '../app/session.ts';
import { settings, update, updateMidi } from '../app/settings.ts';
import { browser, BROWSER_NAMES, REPO_URL } from '../app/platform.ts';
import { listDevices, type DeviceLists, type MediaProblem } from '../media/local.ts';
import { normalizeRoomCode, prettyCode } from '../net/code.ts';
import type { Role } from '../net/room.ts';
import { LevelBars, Qr, VideoView } from './common.tsx';
import { GitHubIcon, initials, Logo, RoleIcon, Wordmark } from './icons.tsx';
import { installable, promptInstall } from '../app/pwa.ts';
import { canShare, copyLink, roomLink, shareLink } from './share.ts';

const ROLES: { role: Role; sub: string }[] = [
  { role: 'student', sub: 'Here to learn' },
  { role: 'teacher', sub: 'Giving the lesson' },
  { role: 'observer', sub: 'Parent, guest' },
];

export function problemText(p: MediaProblem, what: 'camera' | 'microphone'): string {
  switch (p) {
    case 'denied':
      return `${what === 'camera' ? 'Camera' : 'Microphone'} blocked. Allow it from the icon in ${BROWSER_NAMES[browser]}'s address bar, then reload.`;
    case 'none':
      return `No ${what} found.${what === 'camera' ? ' You can join with sound only.' : ''}`;
    case 'busy':
      return `The ${what} is used by another app. Close it (Zoom, Teams, another tab), then try again.`;
    case 'insecure':
      return 'Camera and microphone need a secure (https) page.';
    case 'unsupported':
      return `${BROWSER_NAMES[browser]} cannot use a ${what} here. Try Chrome, Edge, Safari or Firefox.`;
    default:
      return `The ${what} could not start.`;
  }
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

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void listDevices().then((d) => {
        if (alive) setDevices(d);
      });
    if (!media.audio.peek() && !media.video.peek()) {
      void media
        .start({
          mode: session.soundMode.peek(),
          micId: s.micId,
          camId: s.camId,
          quality: s.videoQuality,
          wantVideo: !s.camOff,
        })
        .then(refresh);
    } else refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
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
  const vp = media.videoProblem.value;

  return (
    <div class="lobby">
      <div class="atmos" />
      <header class="lobby-top">
        <a class="brand" href={REPO_URL} target="_blank" rel="noopener" aria-label="Sonora Live on GitHub">
          <Logo />
          <Wordmark />
        </a>
        <div style="display:flex;gap:6px;align-items:center">
          {installable.value && (
            <button class="btn btn-sm btn-ghost" onClick={() => void promptInstall()}>
              <Download /> Install app
            </button>
          )}
          <a class="icon-btn" href={REPO_URL} target="_blank" rel="noopener" aria-label="Source code on GitHub">
            <GitHubIcon />
          </a>
        </div>
      </header>

      <main class="lobby-main">
        <section class="lobby-hero">
          {fresh ? (
            <h1>
              Music lessons, <em>face to face</em>, from anywhere.
            </h1>
          ) : (
            <h1>
              You're invited to a <em>lesson</em>.
            </h1>
          )}
          <p class="lede">
            Your instrument, heard as it really sounds. Two-way MIDI between pianos. Direct, private, no account and
            nothing to install.
          </p>
          <div class="preview">
            {stream && media.camOn.value ? (
              <VideoView stream={stream} class={s.mirror ? 'mirror' : ''} />
            ) : (
              <div class="preview-empty">
                <div>
                  <div class="avatar" data-role={s.role ?? 'student'}>
                    {initials(name || 'You')}
                  </div>
                  {vp ? problemText(vp, 'camera') : media.camOn.value ? 'Starting camera…' : 'Camera is off'}
                </div>
              </div>
            )}
            {media.audio.value && (
              <div class="preview-meter" title={clipping ? 'Too loud: lower the microphone level' : 'Microphone level'}>
                <Mic />
                <LevelBars level={media.micOn.value ? level : 0} clipping={clipping} />
                {clipping ? 'Too loud' : 'Mic'}
              </div>
            )}
            <div class="preview-bar">
              <button
                class={`round ${media.micOn.value ? '' : 'off'}`}
                onClick={() => media.setMicOn(!media.micOn.value)}
                aria-label={media.micOn.value ? 'Mute microphone' : 'Unmute microphone'}
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
                aria-label={media.camOn.value ? 'Turn camera off' : 'Turn camera on'}
                aria-pressed={!media.camOn.value}
              >
                {media.camOn.value ? <Video /> : <VideoOff />}
              </button>
              {media.camOn.value && (
                <button
                  class="round"
                  onClick={() => update({ mirror: !s.mirror })}
                  aria-label={s.mirror ? 'Show my preview unmirrored' : 'Mirror my preview'}
                  aria-pressed={s.mirror}
                  title="Mirror my preview (only for you). Turn it off for a camera pointed at the keys or a score."
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
                  aria-label="Microphone"
                  value={media.microphoneId}
                  onChange={(e) => {
                    const id = (e.currentTarget as HTMLSelectElement).value;
                    update({ micId: id });
                    void media.restartAudio(session.soundMode.peek(), id);
                  }}
                >
                  {devices.mics.map((d, i) => (
                    <option value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                  ))}
                </select>
              )}
              {devices.cams.length > 0 && (
                <select
                  class="select"
                  aria-label="Camera"
                  value={media.cameraId}
                  onChange={(e) => {
                    const id = (e.currentTarget as HTMLSelectElement).value;
                    update({ camId: id });
                    void media.restartVideo(id);
                  }}
                >
                  {devices.cams.map((d, i) => (
                    <option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div class="features">
            <span>
              <AudioWaveform /> Pure instrument sound
            </span>
            <span>
              <Piano /> Piano-to-piano MIDI
            </span>
            <span>
              <Zap /> Game-grade low latency
            </span>
            <span>
              <ShieldCheck /> Peer to peer, encrypted
            </span>
          </div>
        </section>

        <section class="card join-card" aria-label="Join the lesson">
          <div class="room-code-box">
            <span class="label">{fresh ? 'Your room is ready' : 'Joining room'}</span>
            <div class="room-code-row">
              <span class="code" aria-label={`Room code ${code.split('').join(' ')}`}>
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
                  <Copy /> Copy link
                </button>
                {canShare && (
                  <button class="btn btn-sm" onClick={() => void shareLink(code)}>
                    <Share2 /> Share
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
                <small style="color:var(--muted)">Scan with a phone or tablet to join this room (handy for a second camera).</small>
              </div>
            )}
          </div>

          <label class="field">
            <span class="label">Your name</span>
            <input
              class="input"
              value={s.name}
              maxLength={40}
              placeholder="e.g. Clara"
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
              I'm joining as
            </span>
            <div class={`roles ${shake ? 'shake' : ''}`} role="radiogroup" aria-labelledby="role-label">
              {ROLES.map((r) => (
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
                  <b>{ROLE_LABEL[r.role]}</b>
                  <small>{r.sub}</small>
                </button>
              ))}
            </div>
          </div>

          {ap && (
            <div class="hint hint-bad">
              <TriangleAlert />
              <span>{problemText(ap, 'microphone')}</span>
            </div>
          )}

          <button class="btn btn-primary btn-lg btn-block" onClick={() => void enter()} disabled={busy}>
            {busy ? <span class="spinner" /> : null}
            {fresh ? 'Enter the room' : 'Join the lesson'} <ArrowRight />
          </button>

          <div class="hint">
            <Headphones />
            <span>
              Use headphones, wired if you can: pure sound has no echo cancelling, and Bluetooth adds delay.
            </span>
          </div>

          {joinOther.value ? (
            <div class="field">
              <span class="label">Room code</span>
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
                  Use
                </button>
              </div>
            </div>
          ) : (
            <div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap">
              <button class="link-btn" onClick={() => (joinOther.value = true)}>
                Have a code? Join another room
              </button>
              {!fresh && (
                <button class="link-btn" onClick={() => session.newRoom()}>
                  Start a new room instead
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      <footer class="lobby-foot">
        <span>No account. No server sees your lesson.</span>
        <a href={`${REPO_URL}#how-it-works`} target="_blank" rel="noopener">
          How it works
        </a>
        <a href={`${REPO_URL}#privacy`} target="_blank" rel="noopener">
          Privacy
        </a>
      </footer>
    </div>
  );
}
