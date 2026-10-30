import { useEffect, useState } from 'preact/hooks';
import {
  AudioWaveform,
  Check,
  DoorOpen,
  Ellipsis,
  Keyboard,
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
  SmilePlus,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  X,
  Speech,
  Sparkles,
} from 'lucide-preact';
import { session, roleLabel } from '../app/session.ts';
import { installUpdate } from '../app/update.ts';
import { settings, update, updateMidi, type SoundSetting } from '../app/settings.ts';
import { isMobile } from '../app/platform.ts';
import { prettyCode } from '../net/code.ts';
import { SignalBars } from './common.tsx';
import { Logo, Wordmark } from './icons.tsx';
import { chatOpen, keyboardOpen, menu, openSettings, sheet } from './state.ts';
import { PeerTile, SelfPip, Waiting } from './Tiles.tsx';
import { ChatPanel } from './Chat.tsx';
import { PianoKeys } from './Keyboard.tsx';
import { MidiSheet } from './MidiSheet.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { LockSheet, ShareSheet } from './ShareSheet.tsx';
import { t } from '../app/i18n.ts';

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

export function Room() {
  const peers = session.peers.value;
  const rp = session.roomPhase.value;
  const denied = session.denied.value;
  const s = settings.value;
  const midiActive =
    session.midi.devices.connected.value ||
    peers.some((p) => p.remote?.midi.sending) ||
    session.midi.lastLocal.value > 0;
  const showKeys = keyboardOpen.value || (s.midi.keyboard && midiActive);

  useEffect(() => {
    chatOpenTracker();
  }, [chatOpen.value]);

  return (
    <div class="room" data-chat={chatOpen.value} data-testid="room">
      <div class="atmos" />
      <TopBar />
      <main class="stage">
        <Banners />
        {denied ? (
          <Knocking />
        ) : rp === 'joining' ? (
          <Joining />
        ) : peers.filter((p) => !p.quiet).length === 0 ? (
          <Waiting />
        ) : (
          <TileGrid />
        )}
        {!denied && rp !== 'joining' && <SelfPip />}
        <Reactions />
      </main>
      {showKeys && (
        <PianoKeys
          onClose={() => {
            keyboardOpen.value = false;
            updateMidi({ keyboard: false });
          }}
        />
      )}
      <ControlBar showKeys={showKeys} />
      {chatOpen.value && <ChatPanel />}
      {sheet.value === 'midi' && <MidiSheet />}
      {sheet.value === 'settings' && <SettingsSheet />}
      {sheet.value === 'share' && <ShareSheet />}
      {sheet.value === 'lock' && <LockSheet />}
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
  for (const p of peers) {
    if (p.quiet && p.link !== 'connected') continue;
    if (p.remote?.extra && p.extra) tiles.push({ peer: p, extra: true });
    tiles.push({ peer: p, extra: false });
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
  const count = 1 + peers.filter((p) => p.link !== 'closed').length;
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

const soundOptions = (): { value: SoundSetting; title: string; sub: string; icon: typeof AudioWaveform }[] => [
  {
    value: 'auto',
    title: t('Auto (recommended)'),
    sub: t('Pure sound for your instrument; voice mode while MIDI carries your piano.'),
    icon: Sparkles,
  },
  {
    value: 'pure',
    title: t('Pure instrument'),
    sub: t('No noise suppression, no echo cancelling, stereo. Use headphones.'),
    icon: AudioWaveform,
  },
  {
    value: 'voice',
    title: t('Voice'),
    sub: t('Speech processing: removes noise and echo (and some of the music).'),
    icon: Speech,
  },
];

function ControlBar({ showKeys }: { showKeys: boolean }) {
  const media = session.media;
  const mic = media.micOn.value;
  const cam = media.camOn.value;
  const level = session.meter.level.value;
  const mode = session.soundMode.value;
  const setting = settings.value.sound;
  const unread = session.chat.unread.value;
  const midiOn = session.midi.devices.connected.value;
  const sharing = media.extraKind.value === 'screen';
  const open = menu.value;
  const [confirmLeave, setConfirmLeave] = useState(false);
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
    <div class="menu" role="menu" style="min-width:300px">
      {soundOptions().map((o) => (
        <button
          class="menu-item"
          role="menuitemradio"
          aria-checked={setting === o.value}
          onClick={() => {
            update({ sound: o.value });
            menu.value = null;
          }}
        >
          <o.icon />
          <span style="flex:1">
            <b>{o.title}</b>
            <small>{o.sub}</small>
          </span>
          {setting === o.value && <Check size={16} />}
        </button>
      ))}
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
              <i style={{ transform: `scaleY(${level})` }} />
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
            class={`ctl hide-sm ${mode === 'pure' ? 'active' : ''}`}
            onClick={() => toggleMenu('sound')}
            aria-haspopup="menu"
            aria-expanded={open === 'sound'}
            title={t('Sound mode')}
            data-testid="btn-sound"
          >
            {mode === 'pure' ? <AudioWaveform /> : <Speech />}
            <span>
              {mode === 'pure' ? t('Pure') : t('Voice')}
              <span class="lbl-long">{setting === 'auto' ? ` · ${t('auto')}` : ''}</span>
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
          class={`ctl hide-sm ${showKeys ? 'active' : ''}`}
          onClick={() => {
            const next = !showKeys;
            keyboardOpen.value = next;
            updateMidi({ keyboard: next });
          }}
          aria-pressed={showKeys}
          data-testid="btn-keys"
        >
          <Keyboard />
          <span>{t('Keys')}</span>
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
        <div style="position:relative">
          <button
            class="ctl hide-sm"
            onClick={() => toggleMenu('react')}
            aria-haspopup="menu"
            aria-expanded={open === 'react'}
          >
            <SmilePlus />
            <span>{t('React')}</span>
          </button>
          {open === 'react' && (
            <div class="menu" role="menu" style="min-width:auto">
              <div class="emoji-row">
                {REACTIONS.map((e) => (
                  <button
                    aria-label={t('React {emoji}', { emoji: e })}
                    onClick={() => {
                      session.react(e);
                      menu.value = null;
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
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
              <button class="menu-item" onClick={() => toggleMenu('sound')}>
                {mode === 'pure' ? <AudioWaveform /> : <Speech />}
                <span>
                  <b>{t('Sound: {mode}', { mode: mode === 'pure' ? t('Pure instrument') : t('Voice') })}</b>
                  <small>{setting === 'auto' ? t('Auto · tap to change') : t('Manual · tap to change')}</small>
                </span>
              </button>
              <button
                class="menu-item"
                onClick={() => {
                  keyboardOpen.value = !showKeys;
                  updateMidi({ keyboard: !showKeys });
                  menu.value = null;
                }}
              >
                <Keyboard />
                <span>
                  <b>{showKeys ? t('Hide piano keys') : t('Show piano keys')}</b>
                </span>
              </button>
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
          {open === 'sound' && isMobile && soundMenu}
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
