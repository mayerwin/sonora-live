import { useEffect, useState } from 'preact/hooks';
import { AudioWaveform, Bell, Download, ExternalLink, Headphones, Mic, Settings, ShieldCheck, Speech, Sparkles, TriangleAlert, Video, Volume2 } from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update, type SoundSetting } from '../app/settings.ts';
import { askNotifications, chime, notifyPermission, unlockChimes } from '../app/notify.ts';
import { installable, promptInstall } from '../app/pwa.ts';
import { REPO_URL, isMobile } from '../app/platform.ts';
import { AUDIO_QUALITY, VIDEO_QUALITY, type AudioQuality, type VideoQuality } from '../media/constraints.ts';
import { canPickSpeaker, listDevices, looksLikeHeadphones, type DeviceLists } from '../media/local.ts';
import { hasBuiltInTurn } from '../net/ice.ts';
import { LevelBars, Seg, Sheet, ToggleRow } from './common.tsx';
import { sheet, settingsTab, type SettingsTab } from './state.ts';
import { GitHubIcon } from './icons.tsx';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'audio', label: 'Sound' },
  { id: 'video', label: 'Video' },
  { id: 'room', label: 'Room' },
  { id: 'connection', label: 'Connection' },
  { id: 'about', label: 'About' },
];

export function SettingsSheet() {
  const tab = settingsTab.value;
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);
  return (
    <Sheet
      title="Settings"
      icon={<Settings />}
      wide
      onClose={() => (sheet.value = null)}
      tabs={
        <div class="sheet-tabs" role="tablist">
          {TABS.map((t) => (
            <button role="tab" aria-selected={tab === t.id} onClick={() => (settingsTab.value = t.id)}>
              {t.label}
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
  const speakerLabel = devices.speakers.find((d) => d.deviceId === s.speakerId)?.label ?? devices.speakers[0]?.label ?? '';
  return (
    <>
      <div class="section">
        <h3>Sound mode</h3>
        <Seg<SoundSetting>
          label="Sound mode"
          value={s.sound}
          onChange={(v) => update({ sound: v })}
          options={[
            { value: 'auto', label: <><Sparkles /> Auto</> },
            { value: 'pure', label: <><AudioWaveform /> Pure</> },
            { value: 'voice', label: <><Speech /> Voice</> },
          ]}
        />
        <p class="lead">
          {s.sound === 'auto' && (
            <>
              Now: <b>{mode === 'pure' ? 'pure' : 'voice'}</b>. Your microphone sends your instrument untouched; while
              your piano travels as MIDI, it switches to voice processing so speech stays clear.
            </>
          )}
          {s.sound === 'pure' && (
            <>
              No noise suppression, no echo cancellation, no automatic volume, stereo when your microphone has it: every
              sustain, pedal and pianissimo arrives as played.
            </>
          )}
          {s.sound === 'voice' && <>The browser's speech processing: removes background noise and echo, and part of the music with it.</>}
        </p>
        {mode === 'pure' && !looksLikeHeadphones(speakerLabel) && (
          <div class="hint hint-warn">
            <Headphones />
            <span>Pure sound has no echo cancelling: use headphones (wired ones add no delay), or the others will hear themselves.</span>
          </div>
        )}
      </div>

      <div class="section">
        <h3>Quality</h3>
        <Seg<AudioQuality>
          label="Audio quality"
          value={s.audioQuality}
          onChange={(v) => update({ audioQuality: v })}
          options={(Object.keys(AUDIO_QUALITY) as AudioQuality[]).map((k) => ({ value: k, label: AUDIO_QUALITY[k].label }))}
        />
        <p class="lead">{AUDIO_QUALITY[s.audioQuality].hint}. Opus codec, 10 ms frames, no silence suppression.</p>
      </div>

      <div class="section">
        <h3>Microphone</h3>
        <select
          class="select"
          value={media.microphoneId}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            update({ micId: id });
            void media.restartAudio(session.soundMode.peek(), id);
          }}
          aria-label="Microphone"
        >
          {devices.mics.map((d, i) => (
            <option value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
          ))}
        </select>
        <div style="display:flex;align-items:center;gap:10px;color:var(--text-2);font-size:13.5px">
          <Mic size={16} />
          <LevelBars level={media.micOn.value ? level : 0} clipping={clipping} n={12} />
          <span>{media.stereo.value ? 'Stereo input' : 'Mono input'}</span>
        </div>
        {clipping && (
          <div class="hint hint-bad">
            <TriangleAlert />
            <span>
              Your microphone is overloaded (it clips on loud passages). Lower its input level in your system's sound
              settings, or move it a little further from the instrument.
            </span>
          </div>
        )}
      </div>

      {canPickSpeaker && devices.speakers.length > 0 && (
        <div class="section">
          <h3>Speakers or headphones</h3>
          <div style="display:flex;gap:8px">
            <select
              class="select"
              value={s.speakerId || devices.speakers[0]?.deviceId}
              onChange={(e) => {
                const id = (e.currentTarget as HTMLSelectElement).value;
                update({ speakerId: id });
                void session.setSpeaker(id);
              }}
              aria-label="Speakers"
            >
              {devices.speakers.map((d, i) => (
                <option value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
              ))}
            </select>
            <button
              class="btn"
              onClick={() => {
                unlockChimes();
                chime('join');
              }}
            >
              <Volume2 /> Test
            </button>
          </div>
        </div>
      )}

      <div class="section">
        <ToggleRow title="Join and message sounds" sub="A soft chime when someone joins, leaves or writes." checked={s.joinSound} onChange={(v) => update({ joinSound: v })} />
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
        <h3>Camera</h3>
        <select
          class="select"
          value={media.cameraId}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            update({ camId: id });
            void media.restartVideo(id);
          }}
          aria-label="Camera"
        >
          {devices.cams.map((d, i) => (
            <option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
          ))}
        </select>
      </div>
      <div class="section">
        <h3>Quality</h3>
        <Seg<VideoQuality>
          label="Video quality"
          value={s.videoQuality}
          onChange={(v) => {
            update({ videoQuality: v });
            void media.restartVideo(undefined, v);
          }}
          options={(Object.keys(VIDEO_QUALITY) as VideoQuality[]).map((k) => ({ value: k, label: VIDEO_QUALITY[k].label.split(' · ')[1] }))}
        />
        <p class="lead">{VIDEO_QUALITY[s.videoQuality].label}. Smooth motion is kept first, so hands stay fluid.</p>
      </div>
      {!isMobile && devices.cams.length > 1 && (
        <div class="section">
          <h3>Second camera</h3>
          <p class="lead">Show the keys from above (or your hands) next to your face. The others see both.</p>
          {extra === 'camera' ? (
            <button class="btn" onClick={() => media.stopExtra()}>
              Stop second camera
            </button>
          ) : (
            <div style="display:flex;gap:8px">
              <select class="select" value={second} onChange={(e) => setSecond((e.currentTarget as HTMLSelectElement).value)} aria-label="Second camera">
                <option value="">Choose a camera…</option>
                {devices.cams
                  .filter((d) => d.deviceId !== media.cameraId)
                  .map((d, i) => (
                    <option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                  ))}
              </select>
              <button class="btn" disabled={!second} onClick={() => void media.addCamera(second)}>
                <Video /> Add
              </button>
            </div>
          )}
          <p class="lead" style="font-size:13px">
            Or join from a phone with the room's QR code, as an Observer, and point it at the keyboard.
          </p>
        </div>
      )}
      <div class="section">
        <ToggleRow title="Mirror my preview" sub="Only for you: the others always see the real image." checked={s.mirror} onChange={(v) => update({ mirror: v })} />
        <ToggleRow title="Start with the camera off" checked={s.camOff} onChange={(v) => update({ camOff: v })} />
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
        <h3>This room</h3>
        <ToggleRow
          title={`Limit to ${policy.limit} people`}
          sub="Others have to knock; someone inside can let them in. Change the size from the lock in the top bar."
          checked={policy.locked}
          onChange={(v) => {
            session.setPolicy({ locked: v, limit: policy.limit });
            update({ lockRooms: v });
          }}
        />
      </div>
      <div class="section">
        <h3>Notifications</h3>
        <ToggleRow
          title="Notify me when someone joins"
          sub={
            perm === 'denied'
              ? 'Notifications are blocked for this site in your browser settings.'
              : perm === 'unsupported'
                ? 'Not available in this browser (on iPhone and iPad: install the app first).'
                : 'A system notification when this tab is in the background, plus a chime.'
          }
          checked={s.notifyJoin && perm === 'granted'}
          disabled={perm === 'denied' || perm === 'unsupported'}
          onChange={async (v) => {
            if (v && perm !== 'granted') {
              const ok = await askNotifications();
              update({ notifyJoin: ok });
            } else update({ notifyJoin: v });
          }}
        />
        {perm === 'default' && (
          <button class="btn btn-sm" style="justify-self:start" onClick={() => void askNotifications()}>
            <Bell /> Allow notifications
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
        <h3>Meeting point</h3>
        <p class="lead">
          {session.relayUp.value}/{session.relayTotal.value} rendezvous servers reachable. They only pass the encrypted
          handshake; the lesson itself flows directly between you.
        </p>
      </div>
      {peers.length === 0 && <p class="lead">Connection details appear here once someone joins.</p>}
      {peers.map((p) => {
        const st = p.stats;
        return (
          <div class="section" data-role={p.info.role}>
            <h3 style="color:var(--rc)">{p.info.name}</h3>
            {!st ? (
              <p class="lead">Measuring…</p>
            ) : (
              <table class="stats">
                <tbody>
                  <tr>
                    <td>Path</td>
                    <td>{st.path || '—'}</td>
                  </tr>
                  <tr>
                    <td>Network round trip</td>
                    <td>{st.rtt ?? '—'} ms</td>
                  </tr>
                  <tr>
                    <td>Their sound reaches you in (est.)</td>
                    <td>{st.latencyMs ?? '—'} ms</td>
                  </tr>
                  <tr>
                    <td>Jitter buffer</td>
                    <td>{st.bufferMs} ms</td>
                  </tr>
                  <tr>
                    <td>Audio in / out</td>
                    <td>
                      {st.audioInKbps} / {st.audioOutKbps} kbps
                    </td>
                  </tr>
                  <tr>
                    <td>Audio codec</td>
                    <td>
                      {st.audioCodec || 'opus'} {st.audioChannels === 2 ? 'stereo' : st.audioChannels === 1 ? 'mono' : ''}
                      {st.audioOutPps ? ` · ${Math.round(1000 / st.audioOutPps)} ms frames` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>Audio packet loss</td>
                    <td>{st.audioLossPct.toFixed(1)} %</td>
                  </tr>
                  <tr>
                    <td>Video in</td>
                    <td>{st.videoIn && st.videoIn.w ? `${st.videoIn.w}×${st.videoIn.h} · ${st.videoIn.fps} fps · ${st.videoIn.kbps} kbps` : '—'}</td>
                  </tr>
                  <tr>
                    <td>Video out</td>
                    <td>
                      {st.videoOut && st.videoOut.w
                        ? `${st.videoOut.w}×${st.videoOut.h} · ${st.videoOut.fps} fps${st.videoOut.limit !== 'none' ? ` · limited by ${st.videoOut.limit}` : ''}`
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
          <ShieldCheck /> Strict network? Add a TURN relay
        </summary>
        <div class="details-body">
          <p>
            Most connections are direct. A few networks (some offices, schools, mobile carriers) block that; a TURN relay
            gets through.
            {hasBuiltInTurn() ? ' This site already has one configured; you can add your own.' : ' You can use your own, for example a free Metered or Cloudflare account.'}
          </p>
          <input class="input" placeholder="turn:relay.example.com:3478, turns:relay.example.com:443" value={turn.urls} onInput={(e) => setTurn({ ...turn, urls: (e.currentTarget as HTMLInputElement).value })} aria-label="TURN URLs" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input class="input" placeholder="Username" value={turn.username} onInput={(e) => setTurn({ ...turn, username: (e.currentTarget as HTMLInputElement).value })} aria-label="TURN username" />
            <input class="input" type="password" placeholder="Credential" value={turn.credential} onInput={(e) => setTurn({ ...turn, credential: (e.currentTarget as HTMLInputElement).value })} aria-label="TURN credential" />
          </div>
          <button
            class="btn btn-sm"
            style="justify-self:start"
            onClick={() => {
              update({ turn });
              session.refreshIce();
            }}
          >
            Save (used for new connections)
          </button>
        </div>
      </details>
    </>
  );
}

function AboutTab() {
  return (
    <>
      <div class="section">
        <h3>Sonora Live</h3>
        <p class="lead">
          Remote music lessons that sound like the room. Peer-to-peer video, pure instrument sound and two-way MIDI, in the
          browser. Free and open source (MIT).
        </p>
        <p class="lead" style="font-size:13px;color:var(--muted)">
          Version {__APP_VERSION__} · {__APP_COMMIT__}
        </p>
        <div class="code-actions">
          <a class="btn btn-sm" href={REPO_URL} target="_blank" rel="noopener">
            <GitHubIcon size={16} /> Source on GitHub
          </a>
          {installable.value && (
            <button class="btn btn-sm" onClick={() => void promptInstall()}>
              <Download /> Install app
            </button>
          )}
        </div>
      </div>
      <div class="section">
        <h3>Privacy</h3>
        <p class="lead">
          No account, no server in the middle, no recording. Audio, video, chat, files and MIDI travel directly between the
          browsers, encrypted (DTLS-SRTP). The short handshake that lets you find each other passes through public
          rendezvous servers, encrypted with a key made from the room code. Your preferences stay in this browser.
        </p>
      </div>
      <div class="section">
        <h3>Credits</h3>
        <p class="lead" style="font-size:13.5px">
          Built-in piano: the Splendid Grand Piano (Steinway, public domain samples by Akai, remastered by the SFZ
          Instruments project) · Fonts: Instrument Serif and Instrument Sans (SIL Open Font License) · Emoji picker:
          emoji-picker-element · Icons: Lucide ·{' '}
          <a href={`${REPO_URL}#credits`} target="_blank" rel="noopener">
            all credits <ExternalLink size={12} />
          </a>
        </p>
      </div>
    </>
  );
}
