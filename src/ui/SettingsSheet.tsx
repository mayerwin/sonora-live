import { useEffect, useState } from 'preact/hooks';
import {
  AudioWaveform,
  Bell,
  Download,
  ExternalLink,
  Headphones,
  Languages,
  Mic,
  Settings,
  ShieldCheck,
  Speech,
  Sparkles,
  TriangleAlert,
  Video,
  Volume2,
} from 'lucide-preact';
import { browserLang, LANGUAGES, t, type LanguageSetting } from '../app/i18n.ts';
import { session } from '../app/session.ts';
import { settings, update, type SoundSetting } from '../app/settings.ts';
import { askNotifications, chime, notifyPermission, unlockChimes } from '../app/notify.ts';
import { installable, promptInstall } from '../app/pwa.ts';
import { REPO_URL, isMobile } from '../app/platform.ts';
import { AUDIO_QUALITY, VIDEO_QUALITY, type AudioQuality, type VideoQuality } from '../media/constraints.ts';
import { canPickSpeaker, listDevices, looksLikeHeadphones, type DeviceLists } from '../media/local.ts';
import { hasBuiltInTurn } from '../net/ice.ts';
import { LevelBars, Rich, Seg, Sheet, ToggleRow } from './common.tsx';
import { sheet, settingsTab, type SettingsTab } from './state.ts';
import { GitHubIcon } from './icons.tsx';

const tabs = (): { id: SettingsTab; label: string }[] => [
  { id: 'audio', label: t('Sound') },
  { id: 'video', label: t('Video') },
  { id: 'room', label: t('Room') },
  { id: 'connection', label: t('Connection') },
  { id: 'about', label: t('General') },
];

const audioLabel = (q: AudioQuality) => ({ standard: t('Standard'), high: t('High'), studio: t('Studio') })[q];
const audioHint = (q: AudioQuality) =>
  ({
    standard: t('96 kbps · slow or mobile connections'),
    high: t('192 kbps stereo · recommended'),
    studio: t('320 kbps stereo · broadcast quality'),
  })[q];
/** why the browser sends less video than asked (WebRTC's qualityLimitationReason) */
const limitLabel = (r: string) =>
  r === 'cpu'
    ? t('limited by the processor')
    : r === 'bandwidth'
      ? t('limited by the network')
      : t('limited ({reason})', { reason: r });
const videoLabel = (q: VideoQuality) =>
  ({ sd: t('Data saver · 360p'), hd: t('HD · 720p'), fhd: t('Full HD · 1080p') })[q];

export function SettingsSheet() {
  const tab = settingsTab.value;
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);
  return (
    <Sheet
      title={t('Settings')}
      icon={<Settings />}
      wide
      onClose={() => (sheet.value = null)}
      tabs={
        <div class="sheet-tabs" role="tablist">
          {tabs().map((x) => (
            <button role="tab" aria-selected={tab === x.id} onClick={() => (settingsTab.value = x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'audio' && <AudioTab devices={devices} />}
      {tab === 'video' && <VideoTab devices={devices} />}
      {tab === 'room' && <RoomTab />}
      {tab === 'connection' && <ConnectionTab />}
      {tab === 'about' && <AboutTab />}
    </Sheet>
  );
}

function AudioTab({ devices }: { devices: DeviceLists }) {
  const s = settings.value;
  const media = session.media;
  const mode = session.soundMode.value;
  const level = session.meter.level.value;
  const clipping = session.meter.clipping.value;
  const speakerLabel =
    devices.speakers.find((d) => d.deviceId === s.speakerId)?.label ?? devices.speakers[0]?.label ?? '';
  return (
    <>
      <div class="section">
        <h3>{t('Sound mode')}</h3>
        <Seg<SoundSetting>
          label={t('Sound mode')}
          value={s.sound}
          onChange={(v) => update({ sound: v })}
          options={[
            {
              value: 'auto',
              label: (
                <>
                  <Sparkles /> {t('Auto')}
                </>
              ),
            },
            {
              value: 'pure',
              label: (
                <>
                  <AudioWaveform /> {t('Pure')}
                </>
              ),
            },
            {
              value: 'voice',
              label: (
                <>
                  <Speech /> {t('Voice')}
                </>
              ),
            },
          ]}
        />
        <p class="lead">
          {s.sound === 'auto' && (
            <Rich
              text={
                mode === 'pure'
                  ? t(
                      'Now: <b>pure</b>. Your microphone sends your instrument untouched; while your piano travels as MIDI, it switches to voice processing so speech stays clear.',
                    )
                  : t(
                      'Now: <b>voice</b>. Your microphone sends your instrument untouched; while your piano travels as MIDI, it switches to voice processing so speech stays clear.',
                    )
              }
            />
          )}
          {s.sound === 'pure' && (
            <>
              {t(
                'No noise suppression, no echo cancellation, no automatic volume, stereo when your microphone has it: every sustain, pedal and pianissimo arrives as played.',
              )}
            </>
          )}
          {s.sound === 'voice' &&
            t("The browser's speech processing: removes background noise and echo, and part of the music with it.")}
        </p>
        {mode === 'pure' && !looksLikeHeadphones(speakerLabel) && (
          <div class="hint hint-warn">
            <Headphones />
            <span>
              {t(
                'Pure sound has no echo cancelling: use headphones (wired ones add no delay), or the others will hear themselves.',
              )}
            </span>
          </div>
        )}
      </div>

      <div class="section">
        <h3>{t('Quality')}</h3>
        <Seg<AudioQuality>
          label={t('Audio quality')}
          value={s.audioQuality}
          onChange={(v) => update({ audioQuality: v })}
          options={(Object.keys(AUDIO_QUALITY) as AudioQuality[]).map((k) => ({ value: k, label: audioLabel(k) }))}
        />
        <p class="lead">
          {t('{quality}. Opus codec, 10 ms frames, no silence suppression.', { quality: audioHint(s.audioQuality) })}
        </p>
      </div>

      <div class="section">
        <h3>{t('Microphone')}</h3>
        <select
          class="select"
          value={media.microphoneId}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            update({ micId: id });
            void media.restartAudio(session.soundMode.peek(), id);
          }}
          aria-label={t('Microphone')}
        >
          {devices.mics.map((d, i) => (
            <option value={d.deviceId}>{d.label || t('Microphone {n}', { n: i + 1 })}</option>
          ))}
        </select>
        <div style="display:flex;align-items:center;gap:10px;color:var(--text-2);font-size:13.5px">
          <Mic size={16} />
          <LevelBars level={media.micOn.value ? level : 0} clipping={clipping} n={12} />
          <span>{media.stereo.value ? t('Stereo input') : t('Mono input')}</span>
        </div>
        {clipping && (
          <div class="hint hint-bad">
            <TriangleAlert />
            <span>
              {t(
                "Your microphone is overloaded (it clips on loud passages). Lower its input level in your system's sound settings, or move it a little further from the instrument.",
              )}
            </span>
          </div>
        )}
      </div>

      {canPickSpeaker && devices.speakers.length > 0 && (
        <div class="section">
          <h3>{t('Speakers or headphones')}</h3>
          <div style="display:flex;gap:8px">
            <select
              class="select"
              value={s.speakerId || devices.speakers[0]?.deviceId}
              onChange={(e) => {
                const id = (e.currentTarget as HTMLSelectElement).value;
                update({ speakerId: id });
                void session.setSpeaker(id);
              }}
              aria-label={t('Speakers')}
            >
              {devices.speakers.map((d, i) => (
                <option value={d.deviceId}>{d.label || t('Output {n}', { n: i + 1 })}</option>
              ))}
            </select>
            <button
              class="btn"
              onClick={() => {
                unlockChimes();
                chime('join');
              }}
            >
              <Volume2 /> {t('Test')}
            </button>
          </div>
        </div>
      )}

      <div class="section">
        <ToggleRow
          title={t('Join and message sounds')}
          sub={t('A soft chime when someone joins, leaves or writes.')}
          checked={s.joinSound}
          onChange={(v) => update({ joinSound: v })}
        />
      </div>
    </>
  );
}

function VideoTab({ devices }: { devices: DeviceLists }) {
  const s = settings.value;
  const media = session.media;
  const extra = media.extraKind.value;
  const [second, setSecond] = useState('');
  return (
    <>
      <div class="section">
        <h3>{t('Camera')}</h3>
        <select
          class="select"
          value={media.cameraId}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            update({ camId: id });
            void media.restartVideo(id);
          }}
          aria-label={t('Camera')}
        >
          {devices.cams.map((d, i) => (
            <option value={d.deviceId}>{d.label || t('Camera {n}', { n: i + 1 })}</option>
          ))}
        </select>
      </div>
      <div class="section">
        <h3>{t('Quality')}</h3>
        <Seg<VideoQuality>
          label={t('Video quality')}
          value={s.videoQuality}
          onChange={(v) => {
            update({ videoQuality: v });
            void media.restartVideo(undefined, v);
          }}
          options={(Object.keys(VIDEO_QUALITY) as VideoQuality[]).map((k) => ({
            value: k,
            label: videoLabel(k).split(' · ')[1],
          }))}
        />
        <p class="lead">
          {t('{quality}. Smooth motion is kept first, so hands stay fluid.', { quality: videoLabel(s.videoQuality) })}
        </p>
      </div>
      {!isMobile && devices.cams.length > 1 && (
        <div class="section">
          <h3>{t('Second camera')}</h3>
          <p class="lead">{t('Show the keys from above (or your hands) next to your face. The others see both.')}</p>
          {extra === 'camera' ? (
            <button class="btn" onClick={() => media.stopExtra()}>
              {t('Stop second camera')}
            </button>
          ) : (
            <div style="display:flex;gap:8px">
              <select
                class="select"
                value={second}
                onChange={(e) => setSecond((e.currentTarget as HTMLSelectElement).value)}
                aria-label={t('Second camera')}
              >
                <option value="">{t('Choose a camera…')}</option>
                {devices.cams
                  .filter((d) => d.deviceId !== media.cameraId)
                  .map((d, i) => (
                    <option value={d.deviceId}>{d.label || t('Camera {n}', { n: i + 1 })}</option>
                  ))}
              </select>
              <button class="btn" disabled={!second} onClick={() => void media.addCamera(second)}>
                <Video /> {t('Add')}
              </button>
            </div>
          )}
          <p class="lead" style="font-size:13px">
            {t("Or join from a phone with the room's QR code, as an Observer, and point it at the keyboard.")}
          </p>
        </div>
      )}
      <div class="section">
        <ToggleRow
          title={t('Mirror my preview')}
          sub={t('Only for you: the others always see the real image.')}
          checked={s.mirror}
          onChange={(v) => update({ mirror: v })}
        />
        <ToggleRow title={t('Start with the camera off')} checked={s.camOff} onChange={(v) => update({ camOff: v })} />
      </div>
    </>
  );
}

function RoomTab() {
  const s = settings.value;
  const policy = session.policy.value;
  const perm = notifyPermission.value;
  return (
    <>
      <div class="section">
        <h3>{t('This room')}</h3>
        <ToggleRow
          title={t('Limit to {n} people', { n: policy.limit })}
          sub={t('Others have to knock; someone inside can let them in. Change the size from the lock in the top bar.')}
          checked={policy.locked}
          onChange={(v) => {
            session.setPolicy({ locked: v, limit: policy.limit });
            update({ lockRooms: v });
          }}
        />
      </div>
      <div class="section">
        <h3>{t('Notifications')}</h3>
        <ToggleRow
          title={t('Notify me when someone joins')}
          sub={
            perm === 'granted'
              ? t('A system notification when this tab is in the background, plus a chime.')
              : perm === 'denied'
                ? t(
                    'Blocked in this browser: allow notifications for this site from the icon at the left of the address bar. A chime still plays.',
                  )
                : perm === 'unsupported'
                  ? t('Not available in this browser (on iPhone and iPad: install the app first). A chime still plays.')
                  : t('Your browser asks for permission first. Without it, a chime still plays.')
          }
          checked={s.notifyJoin}
          disabled={perm === 'unsupported'}
          onChange={(v) => {
            update({ notifyJoin: v });
            if (v) void askNotifications(true);
          }}
        />
        {s.notifyJoin && perm === 'default' && (
          <button class="btn btn-sm" style="justify-self:start" onClick={() => void askNotifications(true)}>
            <Bell /> {t('Allow notifications')}
          </button>
        )}
      </div>
    </>
  );
}

function ConnectionTab() {
  const peers = session.peers.value;
  const s = settings.value;
  const [turn, setTurn] = useState(s.turn);
  return (
    <>
      <div class="section">
        <h3>{t('Meeting point')}</h3>
        <p class="lead">
          {t(
            '{up}/{total} rendezvous servers reachable. They only pass the encrypted handshake; the lesson itself flows directly between you.',
            {
              up: session.relayUp.value,
              total: session.relayTotal.value,
            },
          )}
        </p>
      </div>
      {peers.length === 0 && <p class="lead">{t('Connection details appear here once someone joins.')}</p>}
      {peers.map((p) => {
        const st = p.stats;
        return (
          <div class="section" data-role={p.info.role}>
            <h3 style="color:var(--rc)">{p.info.name}</h3>
            {!st ? (
              <p class="lead">{t('Measuring…')}</p>
            ) : (
              <table class="stats">
                <tbody>
                  <tr>
                    <td>{t('Path')}</td>
                    <td>{st.path || '—'}</td>
                  </tr>
                  <tr>
                    <td>{t('Network round trip')}</td>
                    <td>{st.rtt ?? '—'} ms</td>
                  </tr>
                  <tr>
                    <td>{t('Their sound reaches you in (est.)')}</td>
                    <td>{st.latencyMs ?? '—'} ms</td>
                  </tr>
                  <tr>
                    <td>{t('Jitter buffer')}</td>
                    <td>{st.bufferMs} ms</td>
                  </tr>
                  <tr>
                    <td>{t('Audio in / out')}</td>
                    <td>
                      {st.audioInKbps} / {st.audioOutKbps} kbps
                    </td>
                  </tr>
                  <tr>
                    <td>{t('Audio codec')}</td>
                    <td>
                      {st.audioCodec || 'opus'}{' '}
                      {st.audioChannels === 2 ? t('stereo') : st.audioChannels === 1 ? t('mono') : ''}
                      {st.audioOutPps ? ` · ${t('{n} ms frames', { n: Math.round(1000 / st.audioOutPps) })}` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('Audio packet loss')}</td>
                    <td>{st.audioLossPct.toFixed(1)} %</td>
                  </tr>
                  <tr>
                    <td>{t('Video in')}</td>
                    <td>
                      {st.videoIn && st.videoIn.w
                        ? `${st.videoIn.w}×${st.videoIn.h} · ${st.videoIn.fps} fps · ${st.videoIn.kbps} kbps`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('Video out')}</td>
                    <td>
                      {st.videoOut && st.videoOut.w
                        ? `${st.videoOut.w}×${st.videoOut.h} · ${st.videoOut.fps} fps${st.videoOut.limit !== 'none' ? ` · ${limitLabel(st.videoOut.limit)}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <details class="details">
        <summary>
          <ShieldCheck /> {t('Strict network? Add a TURN relay')}
        </summary>
        <div class="details-body">
          <p>
            {hasBuiltInTurn()
              ? t(
                  'Most connections are direct. A few networks (some offices, schools, mobile carriers) block that; a TURN relay gets through. This site already has one configured; you can add your own.',
                )
              : t(
                  'Most connections are direct. A few networks (some offices, schools, mobile carriers) block that; a TURN relay gets through. You can use your own, for example a free Metered account or your own coturn server.',
                )}
          </p>
          <input
            class="input"
            placeholder="turn:relay.example.com:3478, turns:relay.example.com:443"
            value={turn.urls}
            onInput={(e) => setTurn({ ...turn, urls: (e.currentTarget as HTMLInputElement).value })}
            aria-label="TURN URLs"
          />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input
              class="input"
              placeholder={t('Username')}
              value={turn.username}
              onInput={(e) => setTurn({ ...turn, username: (e.currentTarget as HTMLInputElement).value })}
              aria-label={t('TURN username')}
            />
            <input
              class="input"
              type="password"
              placeholder={t('Credential')}
              value={turn.credential}
              onInput={(e) => setTurn({ ...turn, credential: (e.currentTarget as HTMLInputElement).value })}
              aria-label={t('TURN credential')}
            />
          </div>
          <button
            class="btn btn-sm"
            style="justify-self:start"
            onClick={() => {
              update({ turn });
              session.refreshIce();
            }}
          >
            {t('Save (used for new connections)')}
          </button>
        </div>
      </details>
    </>
  );
}

function AboutTab() {
  const pref = settings.value.language;
  return (
    <>
      <div class="section">
        <h3>
          <Languages size={16} style="vertical-align:-3px" /> {t('Language')}
        </h3>
        <Seg<LanguageSetting>
          label={t('Language')}
          value={pref}
          onChange={(v) => update({ language: v })}
          options={[
            { value: 'auto', label: t('Automatic'), title: t('The language of this browser') },
            ...LANGUAGES.map((l) => ({ value: l.value, label: l.name })),
          ]}
        />
        {pref === 'auto' && (
          <p class="lead" style="font-size:13px">
            {t('Following this browser: {language}.', {
              language: LANGUAGES.find((l) => l.value === browserLang())!.name,
            })}
          </p>
        )}
      </div>
      <div class="section">
        <h3>Sonora Live</h3>
        <p class="lead">
          {t(
            'Remote music lessons that sound like the room. Peer-to-peer video, pure instrument sound and two-way MIDI, in the browser. Free and open source (MIT).',
          )}
        </p>
        <p class="lead" style="font-size:13px;color:var(--muted)">
          {t('Version {version}', { version: __APP_VERSION__ })} · {__APP_COMMIT__}
        </p>
        <div class="code-actions">
          <a class="btn btn-sm" href={REPO_URL} target="_blank" rel="noopener">
            <GitHubIcon size={16} /> {t('Source on GitHub')}
          </a>
          {installable.value && (
            <button class="btn btn-sm" onClick={() => void promptInstall()}>
              <Download /> {t('Install app')}
            </button>
          )}
        </div>
      </div>
      <div class="section">
        <h3>{t('Privacy')}</h3>
        <p class="lead">
          {t(
            'No account, no server in the middle, no recording. Audio, video, chat, files and MIDI travel directly between the browsers, encrypted (DTLS-SRTP). The short handshake that lets you find each other passes through public rendezvous servers, encrypted with a key made from the room code. Your preferences stay in this browser.',
          )}
        </p>
      </div>
      <div class="section">
        <h3>{t('Credits')}</h3>
        <p class="lead" style="font-size:13.5px">
          {t(
            'Built-in piano: the Splendid Grand Piano (Steinway, public domain samples by Akai, remastered by the SFZ Instruments project) · Fonts: Instrument Serif and Instrument Sans (SIL Open Font License) · Emoji picker: emoji-picker-element · Icons: Lucide',
          )}{' '}
          ·{' '}
          <a href={`${REPO_URL}#credits`} target="_blank" rel="noopener">
            {t('all credits')} <ExternalLink size={12} />
          </a>
        </p>
      </div>
    </>
  );
}
