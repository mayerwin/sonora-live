import { computed } from '@preact/signals';
import { PeerSoundSheet } from './PeerSoundSheet.tsx';
import { useEffect, useState } from 'preact/hooks';
import {
  AudioWaveform,
  Check,
  DoorOpen,
  Ellipsis,
  AudioLines,
  Lock,
  LockOpen,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Piano,
  RefreshCw,
  Settings,
  Share2,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  X,
  Speech,
  Headphones,
  Circle,
  Smartphone,
} from 'lucide-preact';
import { session, roleLabel } from '../app/session.ts';
import { installUpdate } from '../app/update.ts';
import { settings, update } from '../app/settings.ts';
import { isMobile } from '../app/platform.ts';
import { prettyCode } from '../net/code.ts';
import { SignalBars } from './common.tsx';
import { Logo, Wordmark } from './icons.tsx';
import { chatOpen, menu, openSettings, sheet, sideTab } from './state.ts';
import { MusicStrip, stripShown, toggleMusic } from './Music.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { PeerTile, SelfPip, Waiting } from './Tiles.tsx';
import { ChatPanel } from './Chat.tsx';
import { MidiSheet } from './MidiSheet.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { LockSheet, ShareSheet } from './ShareSheet.tsx';
import { t } from '../app/i18n.ts';
import { RecChip, RecordMenu, RecoverBanner, clock } from './Record.tsx';
import { ScoreView, scoreShown } from './Score.tsx';
import { ShortcutsSheet, useShortcuts } from './Shortcuts.tsx';
import { PhoneCamSheet } from './PhoneCam.tsx';

/** MediaRecorder and a canvas's stream: every current browser (not some embedded web views) */
const canRecord =
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype;

/** Lights up while notes flow, in either direction. */
function MidiLed({ on }: { on: boolean }) {
  const last = Math.max(session.midi.lastLocal.value, session.midi.lastRemote.value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!last) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 140);
    return () => clearTimeout(t);
  }, [last]);
  return <span class={`led ${flash ? 'flash' : on ? 'on' : ''}`} />;
}

const REACTIONS = ['👏', '👍', '❤️', '🎵', '😂', '🔥', '🙌', '🤔'];

/** the microphone level in the control bar, bound to its element: no re-render at every frame */
const micLevelStyle = computed(() => `transform:scaleY(${session.meter.level.value.toFixed(2)})`);

export function Room() {
  const peers = session.peers.value;
  const rp = session.roomPhase.value;
  const denied = session.denied.value;
  const withScore = scoreShown.value && !denied && rp !== 'joining';

  useEffect(() => {
    chatOpenTracker();
  }, [chatOpen.value]);
  useShortcuts();

  return (
    <div class="room" data-chat={chatOpen.value} data-testid="room">
      <div class="atmos" />
      <TopBar />
      <main class={`stage ${withScore ? 'with-score' : ''}`}>
        <Banners />
        {withScore && <ScoreView />}
        {denied ? (
          <Knocking />
        ) : rp === 'joining' ? (
          <Joining />
        ) : peers.filter((p) => !p.quiet).length === 0 ? (
          withScore ? null : (
            <Waiting />
          )
        ) : (
          <TileGrid />
        )}
        {!denied && rp !== 'joining' && <SelfPip />}
        <Reactions />
      </main>
      {stripShown.value && <MusicStrip />}
      <ControlBar />
      {chatOpen.value && (sideTab.value === 'sound' ? <SoundPanel /> : <ChatPanel />)}
      {sheet.value === 'midi' && <MidiSheet />}
      {sheet.value === 'settings' && <SettingsSheet />}
      {sheet.value === 'share' && <ShareSheet />}
      {sheet.value === 'lock' && <LockSheet />}
      {sheet.value === 'peer-sound' && <PeerSoundSheet />}
      {sheet.value === 'shortcuts' && <ShortcutsSheet />}
      {sheet.value === 'phone-cam' && <PhoneCamSheet />}
    </div>
  );
}

function chatOpenTracker(): void {
  session.chat.visible = chatOpen.peek();
  if (chatOpen.peek()) session.chat.markRead();
}

function TileGrid() {
  const peers = session.peers.value;
  const tiles: { peer: (typeof peers)[number]; extra: boolean }[] = [];
  const visible = (p: (typeof peers)[number]) => !(p.quiet && p.link !== 'connected');
  for (const p of peers) {
    if (!visible(p) || p.info.of) continue;
    if (p.remote?.extra && p.extra) tiles.push({ peer: p, extra: true });
    tiles.push({ peer: p, extra: false });
    // their phones, right after them
    for (const c of peers) if (c.info.of === p.id && visible(c)) tiles.push({ peer: c, extra: false });
  }
  // the phones of this side (shown here too: the angle is checked at a glance), and of someone not here yet
  for (const c of peers) {
    if (c.info.of && visible(c) && !tiles.some((x) => x.peer === c)) tiles.push({ peer: c, extra: false });
  }
  const n = tiles.length;
  const cls = n === 1 ? 'n1' : n === 2 ? 'n2' : n <= 4 ? 'n4' : 'many';
  return (
    <div class={`tiles ${cls}`}>
      {tiles.map((t) => (
        <PeerTile key={`${t.peer.id}${t.extra ? ':x' : ''}`} peer={t.peer} extra={t.extra} ambient={n === 1} />
      ))}
    </div>
  );
}

function TopBar() {
  const code = session.code.value;
  const policy = session.policy.value;
  const peers = session.peers.value;
  const count = 1 + peers.filter((p) => p.link !== 'closed' && !p.info.of).length;
  const stats = peers.map((p) => p.stats).filter((x) => x && x.latencyMs != null);
  const worst = stats.reduce<number | null>((m, x) => Math.max(m ?? 0, x!.latencyMs!), null);
  const quality = stats.some((x) => x!.quality === 'poor')
    ? 'poor'
    : stats.some((x) => x!.quality === 'fair')
      ? 'fair'
      : stats.length
        ? 'good'
        : 'unknown';
  const relayed = stats.some((x) => x!.relayed);
  return (
    <header class="topbar">
      <Logo size={30} />
      <Wordmark />
      <button
        class="code-chip"
        onClick={() => (sheet.value = 'share')}
        aria-label={t('Room {code}. Share the room', { code })}
        data-testid="code-chip"
      >
        <span class="lbl">{t('Room')}</span>
        {prettyCode(code)}
        <span class="share-ico">
          <Share2 />
        </span>
      </button>
      <button
        class="lock-chip"
        onClick={() => (sheet.value = 'lock')}
        title={policy.locked ? t('Limited to {n} people', { n: policy.limit }) : t('Anyone with the link can join')}
        data-testid="lock-chip"
      >
        {policy.locked ? <Lock /> : <LockOpen />}
        <span>
          {count}
          {policy.locked ? `/${policy.limit}` : ''}
        </span>
        <span class="txt">{policy.locked ? t('locked') : t('open')}</span>
      </button>
      <RecChip />
      <span class="spacer" />
      {stats.length > 0 && (
        <button class="net-chip" onClick={() => openSettings('connection')} title={t('Connection details')}>
          <SignalBars quality={quality} />
          <span class="txt">
            {worst} ms{relayed ? ` · ${t('relayed')}` : ''}
          </span>
        </button>
      )}
    </header>
  );
}

function Banners() {
  const knocks = session.knocks.value;
  const needsTap = session.needsTap.value;
  const relayFailed = session.relayFailed.value && session.relayUp.value === 0;
  const policy = session.policy.value;
  return (
    <div class="banner-stack">
      <RecoverBanner />
      {needsTap && (
        <div class="banner">
          <Volume2 />
          <div class="grow">
            <b>{t('Sound is paused by the browser')}</b>
            <small>{t('One tap turns it on.')}</small>
          </div>
          <button class="btn btn-sm btn-primary" onClick={() => session.resumeSound()}>
            {t('Turn on sound')}
          </button>
        </div>
      )}
      {relayFailed && (
        <div class="banner">
          <WifiOff />
          <div class="grow">
            <b>{t("Can't reach the meeting point")}</b>
            <small>{t('Check the internet connection. Retrying by itself; connected lessons continue.')}</small>
          </div>
        </div>
      )}
      {knocks.map((k) => (
        <div class="banner" key={k.id} data-testid="knock">
          <DoorOpen />
          <div class="grow">
            <b>{t('{name} ({role}) is knocking', { name: k.name, role: roleLabel(k.role) })}</b>
            <small>{t('The room is limited to {n} people.', { n: policy.limit })}</small>
          </div>
          <button class="btn btn-sm btn-primary" onClick={() => session.letIn(k)}>
            {t('Let in')}
          </button>
          <button class="icon-btn" aria-label={t('Ignore')} onClick={() => session.dismissKnock(k)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

function Joining() {
  return (
    <div class="card center-card" data-testid="joining">
      <span class="spinner" style="width:30px;height:30px;border-width:3px" />
      <h2>{t('Joining {code}…', { code: prettyCode(session.code.value) })}</h2>
      <p>{t('Finding the others and opening a direct connection.')}</p>
    </div>
  );
}

function Knocking() {
  const reason = session.denied.value;
  const policy = session.policy.value;
  if (reason === 'version') {
    return (
      <div class="card center-card">
        <div class="big-ico">
          <RefreshCw />
        </div>
        <h2>{t('A newer version is in use')}</h2>
        <p>{t('The others use a newer Sonora Live. Reload to update, then join again.')}</p>
        <button class="btn btn-primary" onClick={() => void installUpdate()}>
          {t('Reload')}
        </button>
      </div>
    );
  }
  return (
    <div class="card center-card" data-testid="knocking">
      <div class="big-ico">
        <DoorOpen />
      </div>
      <h2>{t('This lesson is full')}</h2>
      <p>
        {t("The room is limited to {n} people. We let them know you're knocking: someone inside can let you in.", {
          n: policy.limit,
        })}
      </p>
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">
        <span class="spinner" /> {t('Waiting to be let in…')}
      </div>
      <button
        class="link-btn"
        onClick={() => {
          session.leave();
          session.newRoom();
          session.phase.value = 'lobby';
        }}
      >
        {t('Start a new room instead')}
      </button>
    </div>
  );
}

function Reactions() {
  const list = session.reactions.value;
  const peers = session.peers.value;
  return (
    <div class="reactions" aria-hidden="true">
      {list.map((r) => {
        const who = r.from === session.selfId ? t('You') : (peers.find((p) => p.id === r.from)?.info.name ?? '');
        const left = 12 + ((r.id * 37) % 70);
        return (
          <div class="reaction" key={r.id} style={{ left: `${left}%` }}>
            {r.emoji}
            <small>{who}</small>
          </div>
        );
      })}
    </div>
  );
}

type SoundChoice = 'headphones' | 'speakers' | 'voice';

/** The sound modes of the control bar: the one choice most people need. */
const soundChoices = (): { value: SoundChoice; title: string; sub: string; icon: typeof AudioWaveform }[] => [
  {
    value: 'headphones',
    title: t('Headphones'),
    sub: t('Studio sound: nothing processed, the lowest delay.'),
    icon: Headphones,
  },
  {
    value: 'speakers',
    title: t('Speakers'),
    sub: t('The others’ sound is taken out of your microphone, so they never hear themselves.'),
    icon: Volume2,
  },
  {
    value: 'voice',
    title: t('Voice only'),
    sub: t('Speech processing, for talking in a noisy room (it takes part of the music out).'),
    icon: Speech,
  },
];

/** The sound mode now: voice only when chosen, else what this side listens on. */
const soundChoice = computed<SoundChoice>(() => (settings.value.sound === 'voice' ? 'voice' : session.listening.value));

/** Where the headphones / speakers answer comes from, in a few words. */
function listeningNote(): string {
  const s = settings.value;
  const label = session.media.outputLabel.value;
  if (s.echo !== 'auto') return t('Chosen for every output (Settings → Sound).');
  if (!label) return t('Guessed: browsers do not say whether it is headphones. Choose to be sure.');
  return s.outputs[label]
    ? t('Remembered for {name}.', { name: label })
    : t('Guessed from its name ({name}): browsers do not say whether it is headphones. Choose to be sure.', {
        name: label,
      });
}

function ControlBar() {
  const media = session.media;
  const mic = media.micOn.value;
  const cam = media.camOn.value;
  const mode = session.soundMode.value;
  const choice = soundChoice.value;
  const unread = session.chat.unread.value;
  const midiOn = session.midi.devices.connected.value;
  const sharing = media.extraKind.value === 'screen';
  const music = stripShown.value;
  const open = menu.value;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const recording = session.recorder.state.value !== 'idle';
  const toggleMenu = (m: typeof open) => (menu.value = open === m ? null : m);

  useEffect(() => {
    if (!open && !confirmLeave) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menu, .ctl')) {
        menu.value = null;
        setConfirmLeave(false);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open, confirmLeave]);

  const soundMenu = (
    <div class="menu" role="menu" style="min-width:300px" data-testid="sound-menu">
      {soundChoices().map((o) => (
        <button
          class="menu-item"
          role="menuitemradio"
          aria-checked={choice === o.value}
          onClick={() => {
            if (o.value === 'voice') update({ sound: 'voice' });
            else session.setListening(o.value);
            menu.value = null;
          }}
        >
          <o.icon />
          <span style="flex:1">
            <b>{o.title}</b>
            <small>{o.sub}</small>
          </span>
          {choice === o.value && <Check size={16} />}
        </button>
      ))}
      <p class="menu-note">
        {listeningNote()}{' '}
        <button
          class="link-btn"
          onClick={() => {
            menu.value = null;
            openSettings('audio');
          }}
        >
          {t('More in Settings')}
        </button>
      </p>
    </div>
  );

  return (
    <nav class="bar" aria-label={t('Lesson controls')}>
      <div class="bar-group">
        <button
          class={`ctl ${mic ? '' : 'off'}`}
          onClick={() => media.setMicOn(!mic)}
          aria-pressed={!mic}
          aria-label={mic ? t('Mute microphone') : t('Unmute microphone')}
          data-testid="btn-mic"
        >
          {mic ? <Mic /> : <MicOff />}
          <span>{mic ? t('Mute') : t('Unmute')}</span>
          {mic && (
            <span class="mic-level">
              <i style={micLevelStyle} />
            </span>
          )}
        </button>
        <button
          class={`ctl ${cam ? '' : 'off'}`}
          onClick={() => {
            update({ camOff: cam });
            void media.setCamOn(!cam);
          }}
          aria-pressed={!cam}
          aria-label={cam ? t('Turn camera off') : t('Turn camera on')}
          data-testid="btn-cam"
        >
          {cam ? <Video /> : <VideoOff />}
          <span>{t('Camera')}</span>
        </button>
        <div style="position:relative" class="hide-sm-wrap">
          <button
            class="ctl hide-sm"
            onClick={() => toggleMenu('sound')}
            aria-haspopup="menu"
            aria-expanded={open === 'sound'}
            title={t('Sound mode')}
            data-testid="btn-sound"
          >
            {choice === 'headphones' ? <Headphones /> : choice === 'speakers' ? <Volume2 /> : <Speech />}
            <span>
              {choice === 'headphones' ? t('Headphones') : choice === 'speakers' ? t('Speakers') : t('Voice')}
              {/* voice only for a moment, while the piano plays through MIDI */}
              <span class="lbl-long">{choice !== 'voice' && mode === 'voice' ? ` · ${t('voice')}` : ''}</span>
            </span>
          </button>
          {open === 'sound' && soundMenu}
        </div>
      </div>

      <div class="bar-group">
        <button
          class={`ctl ${midiOn ? 'active' : ''}`}
          onClick={() => (sheet.value = 'midi')}
          aria-label={t('MIDI instrument')}
          data-testid="btn-midi"
        >
          <Piano />
          <span>MIDI</span>
          <MidiLed on={midiOn} />
        </button>
        <button
          class={`ctl ${music ? 'active' : ''}`}
          onClick={toggleMusic}
          aria-pressed={music}
          title={t('Keys, backing track, metronome and tuner')}
          data-testid="btn-music"
        >
          <AudioLines />
          <span>{t('Music')}</span>
        </button>
        {media.canShareScreen ? (
          <button
            class={`ctl hide-sm ${sharing ? 'active' : ''}`}
            onClick={() => (sharing ? media.stopExtra() : void media.shareScreen())}
            aria-pressed={sharing}
          >
            {sharing ? <MonitorX /> : <MonitorUp />}
            <span>{sharing ? t('Stop') : t('Share')}</span>
          </button>
        ) : isMobile ? (
          <button class="ctl hide-sm" onClick={() => void media.flipCamera()}>
            <SwitchCamera />
            <span>{t('Flip')}</span>
          </button>
        ) : null}
        {canRecord && (
          <div style="position:relative" class="hide-sm-wrap">
            <button
              class={`ctl hide-sm ${recording ? 'rec-on' : ''}`}
              onClick={() => toggleMenu('rec')}
              aria-haspopup="dialog"
              aria-expanded={open === 'rec'}
              data-testid="btn-rec"
            >
              <Circle fill={recording ? 'currentColor' : 'none'} />
              <span>{recording ? clock(session.recorder.elapsed.value) : t('Record')}</span>
            </button>
            {open === 'rec' && <RecordMenu />}
          </div>
        )}
        <button
          class={`ctl ${chatOpen.value ? 'active' : ''}`}
          onClick={() => {
            chatOpen.value = !chatOpen.value;
            update({ chatOpen: chatOpen.value });
          }}
          aria-pressed={chatOpen.value}
          data-testid="btn-chat"
        >
          <MessageSquare />
          <span>{t('Chat')}</span>
          {unread > 0 && !chatOpen.value && <span class="badge">{unread}</span>}
        </button>
        <button class="ctl hide-sm" onClick={() => openSettings('audio')} data-testid="btn-settings">
          <Settings />
          <span>{t('Settings')}</span>
        </button>
        <div style="position:relative" class="show-sm-wrap">
          <button
            class="ctl show-sm"
            onClick={() => toggleMenu('more')}
            data-testid="btn-more"
            aria-haspopup="menu"
            aria-expanded={open === 'more'}
          >
            <Ellipsis />
            <span>{t('More')}</span>
          </button>
          {open === 'more' && (
            <div class="menu" role="menu" style="left:auto;right:-60px;transform:none;min-width:250px">
              <div class="emoji-row" style="justify-content:space-between">
                {REACTIONS.slice(0, 5).map((e) => (
                  <button
                    onClick={() => {
                      session.react(e);
                      menu.value = null;
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <button class="menu-item" onClick={() => toggleMenu('sound-more')}>
                {choice === 'headphones' ? <Headphones /> : choice === 'speakers' ? <Volume2 /> : <Speech />}
                <span>
                  <b>
                    {t('Sound: {mode}', {
                      mode:
                        choice === 'headphones'
                          ? t('headphones')
                          : choice === 'speakers'
                            ? t('speakers')
                            : t('voice only'),
                    })}
                  </b>
                  <small>{t('Tap to change')}</small>
                </span>
              </button>
              <button
                class="menu-item"
                onClick={() => {
                  toggleMusic();
                  menu.value = null;
                }}
              >
                <AudioLines />
                <span>
                  <b>{music ? t('Hide the music tools') : t('Music tools')}</b>
                  <small>{t('Keys, backing track, metronome and tuner')}</small>
                </span>
              </button>
              {canRecord && (
                <button class="menu-item" onClick={() => toggleMenu('rec-more')} data-testid="more-rec">
                  <Circle fill={recording ? 'currentColor' : 'none'} />
                  <span>
                    <b>
                      {recording
                        ? t('Recording · {time}', { time: clock(session.recorder.elapsed.value) })
                        : t('Record the lesson')}
                    </b>
                    <small>{t('Saved on this device')}</small>
                  </span>
                </button>
              )}
              {!isMobile && (
                <button
                  class="menu-item"
                  onClick={() => {
                    menu.value = null;
                    sheet.value = 'phone-cam';
                  }}
                  data-testid="more-phonecam"
                >
                  <Smartphone />
                  <span>
                    <b>{t('A phone as a camera')}</b>
                    <small>{t('On the hands, the bow, the pedals')}</small>
                  </span>
                </button>
              )}
              {isMobile && (
                <button
                  class="menu-item"
                  onClick={() => {
                    void media.flipCamera();
                    menu.value = null;
                  }}
                >
                  <SwitchCamera />
                  <span>
                    <b>{t('Switch camera')}</b>
                  </span>
                </button>
              )}
              <button
                class="menu-item"
                onClick={() => {
                  menu.value = null;
                  sheet.value = 'share';
                }}
              >
                <Share2 />
                <span>
                  <b>{t('Invite')}</b>
                </span>
              </button>
              <button
                class="menu-item"
                onClick={() => {
                  menu.value = null;
                  openSettings('audio');
                }}
              >
                <Settings />
                <span>
                  <b>{t('Settings')}</b>
                </span>
              </button>
            </div>
          )}
          {open === 'sound-more' && soundMenu}
          {open === 'rec-more' && <RecordMenu right />}
        </div>
      </div>

      <div style="position:relative">
        <button
          class="ctl leave"
          onClick={() => (session.peers.peek().length ? setConfirmLeave(!confirmLeave) : session.leave())}
          data-testid="btn-leave"
        >
          <LogOut />
          <span>{t('Leave')}</span>
        </button>
        {confirmLeave && (
          <div class="menu" role="menu" style="left:auto;right:0;transform:none;min-width:220px">
            <button class="menu-item" onClick={() => session.leave()} data-testid="confirm-leave">
              <LogOut color="var(--red)" />
              <span>
                <b>{t('Leave the lesson')}</b>
                <small>{t('Camera and microphone turn off.')}</small>
              </span>
            </button>
            <button class="menu-item" onClick={() => setConfirmLeave(false)}>
              <X />
              <span>
                <b>{t('Stay')}</b>
              </span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
