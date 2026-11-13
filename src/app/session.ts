// The lesson: one room, the direct connections to everyone in it, this side's camera, microphone and instrument,
// and the chat. The UI reads its signals and calls its methods; everything below it is framework-free.

import { computed, effect, signal } from '@preact/signals';
import { AUDIO_QUALITY, VIDEO_QUALITY, type SoundMode } from '../media/constraints.ts';
import { LocalMedia } from '../media/local.ts';
import { engine } from '../media/engine.ts';
import { Meter, resumeMeters } from '../media/meter.ts';
import { MidiHub } from '../midi/hub.ts';
import { newRoomCode, normalizeRoomCode } from '../net/code.ts';
import { hasBuiltInTurn, iceServers } from '../net/ice.ts';
import { PeerLink, type SignalData, type Slot } from '../net/peer.ts';
import { createRelay, type Relay } from '../net/relay.ts';
import {
  newerPolicy,
  newPeerId,
  Room,
  validInfo,
  validPolicy,
  type DenyReason,
  type MemberInfo,
  type Policy,
  type Role,
  type RoomPhase,
} from '../net/room.ts';
import { DEFAULT_TUNING } from '../net/sdp.ts';
import { Chat, MAX_FILE_BYTES, newId, type ChatMessage } from './chat.ts';
import { BackingTrack, MAX_TRACK_BYTES, type BackingHost, type TrackMeta } from './backing.ts';
import { Metronome } from './metronome.ts';
import { Recorder } from './recorder.ts';
import { SharedVideo } from './youtube.ts';
import { MAX_SCORE_BYTES, Score, type ScoreMeta } from './score.ts';
import { runSoundCheck, type CheckResult } from '../media/soundcheck.ts';
import { bumpTitle, buzz, chime, setTitleRoom, systemNotify, toast, unlockChimes } from './notify.ts';
import { settings, tabId, update, updateMidi, type EchoSetting, type SoundSetting } from './settings.ts';
import type { PlayOn } from '../midi/hub.ts';

/** what one musician may change of another's sound settings */
export interface TheirSettings {
  sound?: SoundSetting;
  echo?: EchoSetting;
  musicEcho?: boolean;
  autoLevel?: boolean;
  playOn?: PlayOn;
  send?: boolean;
}
import { log } from './log.ts';
import { trackEvent } from './analytics.ts';
import {
  Participants,
  RECONNECT_AFTER_AWAY_MS,
  type Departure,
  type PeerView,
  type RemoteState,
} from './participants.ts';
import { t } from './i18n.ts';

const LESSON_KEY = 'sonora.lesson';
/** the last lesson on this device and whether the microphone was muted there (localStorage) */
const LAST_KEY = 'sonora.last';
/** back in the same lesson within this time: muted again if it was */
const SAME_LESSON_MS = 3 * 3600_000;

export const roleLabel = (r: Role): string => (r === 'observer' ? t('Observer') : t('Musician'));

/** Opened with an observer's link (`?watch`): joins to watch and listen, not to play. */
export const watching = (): boolean => typeof location !== 'undefined' && /[?&]watch\b/.test(location.search);

/** This page is a phone used as someone's camera (?cam=<their id>&of=<their name>). */
function cameraOf(): { owner: string; name: string } | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const owner = q.get('cam');
  return owner && owner.length < 40 ? { owner, name: (q.get('of') ?? '').slice(0, 40) } : null;
}

export type { PeerView, RemoteState } from './participants.ts';

export interface Reaction {
  id: number;
  from: string;
  emoji: string;
  at: number;
}

const STATS_EVERY_MS = 1000;
/** the key of someone's screen sound among the audio elements (theirs is their id) */
const SCREEN = ':screen';

function initialPolicy(selfId: string): Policy {
  const s = settings.peek();
  return {
    locked: s.lockRooms,
    limit: Math.max(2, s.roomLimit),
    ver: 0,
    by: selfId,
    host: selfId,
    controls: s.holdControls,
  };
}

export class Session {
  /** this tab's id (kept across reloads; a duplicated tab gets its own, see uniqueTab) */
  private readonly id = signal(tabId(newPeerId));
  private tabs: BroadcastChannel | null = null;
  private enteredAt = 0;
  readonly media = new LocalMedia();
  /** the audio engine (src/media/engine.ts), for tests and diagnostics */
  readonly engine = engine;
  readonly meter = new Meter();
  readonly midi = new MidiHub();
  readonly chat = new Chat();
  /** what the shared music tools need of the lesson */
  private readonly toolHost: BackingHost = {
    selfId: () => this.selfId,
    observer: () => watching(),
    peers: () => this.peers.peek(),
    send: (msg, to) => {
      for (const l of this.parts.links()) if (!to || l.id === to) l.sendControl(msg);
    },
    sendFile: (meta, blob, to) => this.sendTrackFile(meta, blob, to),
    note: (text) => this.chat.system(text),
    mayControl: (id) => this.mayControl(id),
  };
  /** the backing track everyone plays in time (src/app/backing.ts) */
  readonly backing = new BackingTrack(this.toolHost);
  /** the shared metronome (src/app/metronome.ts) */
  readonly metronome = new Metronome(this.toolHost);
  /** the shared score with everyone's ink (src/app/score.ts) */
  readonly score = new Score({
    ...this.toolHost,
    sendFile: (meta, blob, to) => this.sendScoreFile(meta, blob, to),
  });
  /** a YouTube video watched together (src/app/youtube.ts) */
  readonly video = new SharedVideo(this.toolHost);
  /** recording the lesson on this device (src/app/recorder.ts) */
  readonly recorder = new Recorder({
    selfId: () => this.selfId,
    selfName: () => this.self.peek().name,
    peers: () => this.peers.value,
    camera: () => (this.media.camOn.value ? this.media.sentVideo.value : null),
    extra: () => {
      const tr = this.media.extra.value;
      const kind = this.media.extraKind.value;
      return tr && kind ? { track: tr, kind } : null;
    },
    mic: () => (this.media.micOn.value ? (this.media.sentAudio.value ?? this.media.audio.value) : null),
    screenSound: () => (this.media.screenThroughEngine ? null : this.media.screenAudio.value),
    context: () => {
      const ctx = engine.ensure();
      // the piano joins the mix only once it has sounded here (its nodes exist from then on)
      this.midi.piano.context();
      return ctx;
    },
    localSources: () => [this.midi.piano.output(), engine.trackBus].filter((n): n is AudioNode => !!n),
    send: (msg) => {
      for (const l of this.parts.links()) l.sendControl(msg);
    },
    note: (text) => this.chat.system(text),
    allowed: () => this.mayControl(this.selfId),
  });

  /** lobby: choosing name and role; room: in the lesson; left: after leaving */
  readonly phase = signal<'lobby' | 'room' | 'left'>('lobby');
  readonly code = signal('');
  /** the code was created here and nobody has been told yet */
  readonly fresh = signal(true);
  readonly roomPhase = signal<RoomPhase>('idle');
  readonly denied = signal<DenyReason | null>(null);
  readonly policy = signal<Policy>(initialPolicy(this.selfId));
  readonly peers = signal<PeerView[]>([]);
  readonly knocks = signal<MemberInfo[]>([]);
  readonly reactions = signal<Reaction[]>([]);
  readonly relayUp = signal(0);
  readonly relayTotal = signal(0);
  readonly relayFailed = signal(false);
  /** sound could not start without a tap (autoplay rules) */
  readonly needsTap = signal(false);
  /** an observer chose to send its playing too (MIDI sheet) */
  readonly observerPlays = signal(false);
  /** this page is a phone used as someone's camera: whose */
  readonly camOf = signal(cameraOf());
  /** the phone camera's state, as it shows it */
  readonly camState = signal<'connecting' | 'live' | 'stopped' | 'failed'>('connecting');
  readonly self = computed<MemberInfo>(() => {
    const cam = this.camOf.value;
    if (cam) return { id: this.id.value, name: cam.name, role: 'observer', since: this.since, of: cam.owner };
    return {
      id: this.id.value,
      name: settings.value.name.trim() || roleLabel(watching() ? 'observer' : 'player'),
      role: watching() ? 'observer' : 'player',
      since: this.since,
    };
  });

  /** this side's instrument reaches someone over MIDI: the microphone only needs to carry speech */
  readonly midiCarriesInstrument = computed(
    () =>
      this.midi.devices.connected.value &&
      this.midi.sending.value &&
      this.peers.value.some((p) => (p.link === 'connected' || p.link === 'reconnecting') && p.remote?.midi.receiving),
  );
  readonly soundMode = computed<SoundMode>(() => {
    const s = settings.value.sound;
    if (s === 'pure' || s === 'voice') return s;
    return this.midiCarriesInstrument.value ? 'voice' : 'pure';
  });
  /** cancel the speakers' echo in pure sound: on unless headphones are in use (voice mode always does) */
  readonly pureEcho = computed(() => {
    const e = settings.value.echo;
    return e === 'on' || (e === 'auto' && !this.media.headphones.value);
  });
  /** how this side listens, as the control bar shows it (detected by the output's name until chosen) */
  readonly listening = computed<'headphones' | 'speakers'>(() => (this.pureEcho.value ? 'speakers' : 'headphones'));

  /**
   * The one choice most people need. Headphones: studio sound, nothing processed (no echo cancelling, no automatic
   * level; noise suppression and automatic gain are never on for music). Speakers: the others' sound is taken out
   * of the microphone, and a quiet laptop microphone is brought up. Either leaves voice-only mode. Remembered for
   * the output in use (browsers do not tell headphones from speakers: its name is all there is to go by).
   */
  setListening(m: 'headphones' | 'speakers'): void {
    const s = settings.peek();
    const sound = s.sound === 'voice' ? 'auto' : s.sound;
    const label = this.media.outputLabel.peek();
    if (label) {
      // remembered for this output: plugging in or out switches by itself
      update({ outputs: { ...s.outputs, [label]: m }, echo: 'auto', sound });
      void this.media.checkOutput();
    } else {
      update({ echo: m === 'headphones' ? 'off' : 'on', sound });
    }
  }

  private relay: Relay;
  private room: Room;
  /** everyone else in the lesson: one state machine each, with their connection (src/app/participants.ts) */
  private parts: Participants<PeerLink>;
  private since = Date.now();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private audioEls = new Map<string, HTMLAudioElement>();
  private audioHost: HTMLElement | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private reactionId = 1;
  /** what each person is sending over the file channel now: a chat file or the backing track */
  private fileIn = new Map<
    string,
    {
      kind: 'chat' | 'track' | 'score';
      id: string;
      chunks: BlobPart[];
      got: number;
      size: number;
      mime: string;
      name: string;
    }
  >();
  private fileOutQueue = Promise.resolve();
  private iceCache: RTCIceServer[] | null = null;
  private disposers: (() => void)[] = [];
  private typingSentAt = 0;

  constructor() {
    this.relay = createRelay();
    this.relayTotal.value = this.relay.total;
    this.relay.onChange = () => {
      this.relayUp.value = this.relay.up;
      if (this.relay.up) this.relayFailed.value = false;
    };
    this.parts = new Participants<PeerLink>(
      {
        createLink: (info, initiator) => this.connect(info, initiator),
        acceptOffer: (from) => {
          const p = this.policy.peek();
          const all = this.memberList();
          // someone's phone used as a camera takes no place in the room
          const info = this.parts.knownInfo(from);
          if (info?.of && all.some((m) => m.id === info.of)) return true;
          const others = all.filter((m) => m.id !== from && m.id !== this.selfId && !m.of).length;
          return !p.locked || others + 1 < p.limit;
        },
        onConnected: (link) => this.onConnected(link),
        onJoined: (view) => this.announceJoin(view),
        onLeft: (info, how) => this.announceLeave(info, how),
        onGone: (id) => this.releasePeer(id),
        publish: (views) => (this.peers.value = views),
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
        log,
      },
      () => this.selfId,
    );
    this.room = new Room(this.relay, this.self.peek(), {
      members: () => this.memberList(),
      busy: () => this.parts.busy(),
      policy: () => this.policy.peek(),
      onWelcome: (members, policy) => this.onWelcome(members, policy),
      onDeny: (reason, policy) => {
        log('denied', reason, policy);
        this.policy.value = policy;
        this.denied.value = reason;
        this.roomPhase.value = this.room.phase;
      },
      onFounded: () => {
        log('founded the room');
        this.roomPhase.value = 'in';
        this.denied.value = null;
      },
      onAdmitted: (info, again) => {
        log('admitted', info.name, again ? '(again)' : '');
        this.parts.remember(info);
        // it reloaded its page: its old connection is dead, its new one on its way
        if (again) this.parts.expectBack(info.id);
      },
      onKnock: (info) => this.onKnock(info),
      onSignal: (from, data) => void this.parts.signal(from, data as SignalData),
      onBye: (from) => this.parts.bye(from),
    });
    this.midi.broadcast = (p) => {
      for (const l of this.parts.links()) l.sendMidi(p);
    };
    this.media.onTrack = (slot, track) => this.sendTrack(slot, track);
    this.media.knownOutput = (label) => settings.peek().outputs[label];
  }

  get selfId(): string {
    return this.id.peek();
  }

  // =========================================================================================== start / room

  /** Connect to the rendezvous now (it takes a second) and pick the room from the address. */
  boot(): void {
    const fromUrl = normalizeRoomCode(location.hash.slice(1));
    if (fromUrl) {
      this.code.value = fromUrl;
      this.fresh.value = false;
    } else {
      this.code.value = newRoomCode();
      this.fresh.value = true;
      history.replaceState(null, '', `#${this.code.value}`);
    }
    setTitleRoom(this.code.value);
    this.relay.start().catch(() => {
      this.relayFailed.value = true;
    });
    window.addEventListener('hashchange', () => {
      const c = normalizeRoomCode(location.hash.slice(1));
      if (c && c !== this.code.peek() && this.phase.peek() !== 'room') {
        this.code.value = c;
        this.fresh.value = false;
        setTitleRoom(c);
      }
    });
    // the moment a page may be closed or frozen: remember the lesson is still going; and when it comes back
    // (a phone switching apps), reconnect at once rather than waiting for the old connections to time out
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (this.phase.peek() !== 'room') return;
      if (document.hidden) {
        hiddenAt = Date.now();
        this.markInLesson(true);
      } else if (hiddenAt) {
        this.resume(Date.now() - hiddenAt);
        hiddenAt = 0;
      }
    });
    // Chrome's page lifecycle: a frozen page thawed
    document.addEventListener('resume', () => {
      if (this.phase.peek() === 'room') this.resume(RECONNECT_AFTER_AWAY_MS);
    });
    window.addEventListener('pagehide', () => {
      if (this.phase.peek() === 'room') this.markInLesson(true);
    });
    window.addEventListener('online', () => {
      (this.relay as { kick?: () => void }).kick?.();
      for (const l of this.parts.links()) l.restartIce();
    });
    window.addEventListener('pagehide', () => this.sayBye());
    document.addEventListener('visibilitychange', () => {
      this.broadcastState();
      if (!document.hidden && this.phase.peek() === 'room') void this.lockScreen();
    });
    void this.warmIce();
    // recordings kept on this device (one interrupted by a closed tab is offered back)
    void this.recorder.refresh();
    // any tap may be the one a browser waits for to start audio processing (Safari)
    const tap = () => this.media.unlockAudio();
    window.addEventListener('pointerdown', tap, { capture: true, passive: true });
    window.addEventListener('keydown', tap, { capture: true, passive: true });
    this.startEffects();
    // a duplicated tab inherits this tab's id: tell it so it takes its own
    if (typeof BroadcastChannel !== 'undefined') {
      this.tabs = new BroadcastChannel('sonora-live-tabs');
      this.tabs.onmessage = (e) => {
        if (e.data?.who === this.selfId && this.phase.peek() === 'room') this.tabs?.postMessage({ mine: this.selfId });
      };
    }
  }

  /** Another tab of this browser already uses our id (the tab was duplicated): take a new one. */
  private async uniqueTab(): Promise<void> {
    const bc = this.tabs;
    if (!bc) return;
    const taken = await new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(timer);
        bc.removeEventListener('message', on);
        resolve(v);
      };
      const on = (e: MessageEvent) => {
        if (e.data?.mine === this.selfId) done(true);
      };
      const timer = setTimeout(() => done(false), 150);
      bc.addEventListener('message', on);
      bc.postMessage({ who: this.selfId });
    });
    if (!taken) return;
    const id = newPeerId();
    this.id.value = id;
    try {
      sessionStorage.setItem('sonora.tab', id);
    } catch {
      // private mode: this visit only
    }
    log('duplicated tab: new id', id);
  }

  private async warmIce(): Promise<RTCIceServer[]> {
    if (this.iceCache) return this.iceCache;
    const list = await iceServers(settings.peek().turn);
    // a relay that could not be fetched this time is asked for again by the next connection
    const relay = list.some((s) => [s.urls].flat().some((u) => /^turns?:/i.test(u)));
    if (relay || !hasBuiltInTurn()) this.iceCache = list;
    return list;
  }

  /** Use another room code (typed, or from a link). */
  useCode(code: string): void {
    this.code.value = code;
    this.fresh.value = false;
    history.replaceState(null, '', `#${code}`);
    setTitleRoom(code);
  }

  /** A brand-new room. */
  newRoom(): void {
    this.code.value = newRoomCode();
    this.fresh.value = true;
    history.replaceState(null, '', `#${this.code.value}`);
    setTitleRoom(this.code.value);
  }

  /**
   * Back after `away` ms in the background: the brokers' sockets, which a sleeping phone often loses without
   * noticing, reopened first (all of them after a long absence), the room greeted, then each connection
   * repaired or replaced (src/app/participants.ts).
   */
  private resume(away: number): void {
    if (away < 3000) return;
    log('back after', Math.round(away / 1000), 's');
    (this.relay as { kick?: (all?: boolean) => void }).kick?.(away >= RECONNECT_AFTER_AWAY_MS);
    this.room.announce();
    this.parts.resume(away);
  }

  /** This tab was in this room's lesson a moment ago (a reload, or the phone closed the tab in the background). */
  wasInLesson(): boolean {
    try {
      const v = JSON.parse(sessionStorage.getItem(LESSON_KEY) ?? 'null') as { code?: string; at?: number } | null;
      return !!v && v.code === this.code.peek() && Date.now() - (v.at ?? 0) < 20 * 60_000;
    } catch {
      return false;
    }
  }

  /** Remember this lesson and the microphone's state in it (a rejoin finds it muted again if it was). */
  private noteLesson(): void {
    try {
      const v = { code: this.code.peek(), micOff: !this.media.micOn.peek(), at: Date.now() };
      localStorage.setItem(LAST_KEY, JSON.stringify(v));
    } catch {
      // private mode
    }
  }

  /**
   * In the lobby: back to the lesson left last (within a few hours), the microphone is as it was then (muted
   * stays muted); any other lesson starts unmuted, so no one starts a new lesson talking unheard.
   */
  restoreMute(): void {
    let off = false;
    try {
      const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as {
        code?: string;
        micOff?: boolean;
        at?: number;
      } | null;
      off = !!v && v.code === this.code.peek() && Date.now() - (v.at ?? 0) < SAME_LESSON_MS && v.micOff === true;
    } catch {
      // nothing remembered
    }
    this.media.setMicOn(!off);
  }

  private markInLesson(on: boolean): void {
    if (this.phase.peek() === 'room') this.noteLesson();
    try {
      if (on) sessionStorage.setItem(LESSON_KEY, JSON.stringify({ code: this.code.peek(), at: Date.now() }));
      else sessionStorage.removeItem(LESSON_KEY);
    } catch {
      // private mode: no automatic rejoin
    }
  }

  /** Enter the lesson (from the lobby's button: this click also unlocks sound). */
  async enter(): Promise<void> {
    this.markInLesson(true);
    unlockChimes();
    resumeMeters();
    this.midi.piano.context();
    this.setAudioSession('play-and-record');
    // the audio engine, started from this click (echo cancelling, noise reduction: it needs one)
    engine.ensure();
    await this.uniqueTab();
    this.since = Date.now();
    this.room.setSelf(this.self.peek());
    this.policy.value = initialPolicy(this.selfId);
    this.denied.value = null;
    this.phase.value = 'room';
    // the built-in piano, ready before anyone plays (after the call has had a few seconds to connect)
    setTimeout(() => {
      if (this.phase.peek() === 'room') this.midi.piano.preload();
    }, 3000);
    // a code made here is new, unless it was shared already: then someone may be waiting inside
    const fresh = this.fresh.peek();
    if (!this.relay.up) {
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            const t = setInterval(() => {
              if (this.relay.up) {
                clearInterval(t);
                resolve();
              }
            }, 100);
          }),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 12_000)),
        ]);
      } catch {
        this.relayFailed.value = true;
      }
    }
    this.roomPhase.value = fresh ? 'in' : 'joining';
    this.enteredAt = Date.now();
    trackEvent(fresh ? 'room_created' : 'room_joined', {
      role: this.self.peek().role,
      has_video: this.media.camOn.peek(),
      has_audio: this.media.micOn.peek(),
    });
    await this.room.enter(this.code.peek(), fresh, this.since);
    this.roomPhase.value = this.room.phase;
    this.fresh.value = false;
    if (!this.statsTimer) {
      let tick = 0;
      this.statsTimer = setInterval(() => {
        void this.pollStats();
        if (++tick % 6 === 0) this.sendRoster();
      }, STATS_EVERY_MS);
    }
    void this.lockScreen();
  }

  /** Leave the lesson (camera and microphone are released). */
  leave(): void {
    if (this.enteredAt > 0) {
      const durationSec = Math.round((Date.now() - this.enteredAt) / 1000);
      trackEvent('lesson_ended', { role: this.self.peek().role }, durationSec);
      this.enteredAt = 0;
    }
    this.noteLesson();
    this.markInLesson(false);
    // a recording in progress is closed and saved
    void this.recorder.stop();
    this.sayBye();
    this.parts.clear();
    this.room.leave(false);
    this.roomPhase.value = 'idle';
    this.phase.value = 'left';
    this.media.stopAll();
    this.meter.detach();
    this.chat.clear();
    this.backing.clear();
    this.score.clear();
    this.video.clear();
    this.metronome.clear();
    this.knocks.value = [];
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.setAudioSession('auto');
  }

  private sayBye(): void {
    for (const l of this.parts.links()) l.sendControl({ t: 'bye' });
    if (this.phase.peek() === 'room') this.room.leave(true);
  }

  /** Who is in the room as far as this browser knows: itself and the peers that introduced themselves. */
  private memberList(): MemberInfo[] {
    return [{ ...this.self.peek(), since: this.since }, ...this.parts.members()];
  }

  private onWelcome(members: MemberInfo[], policy: Policy): void {
    log(
      'welcome',
      members.map((m) => `${m.name}#${m.id.slice(0, 4)}`),
      policy,
    );
    // the room's rules, not our own defaults
    this.policy.value = policy;
    this.denied.value = null;
    this.roomPhase.value = 'in';
    for (const m of members) this.parts.remember(m);
    for (const m of members) {
      if (m.id === this.selfId || this.parts.link(m.id)) continue;
      void this.parts.open(m, true);
    }
  }

  private onKnock(info: MemberInfo): void {
    if (this.knocks.peek().some((k) => k.id === info.id)) return;
    this.knocks.value = [...this.knocks.peek(), info];
    chime('knock');
    buzz([60, 80, 60]);
    systemNotify(
      t('Someone is knocking'),
      t('{name} ({role}) wants to join your lesson.', { name: info.name, role: roleLabel(info.role) }),
      'knock',
    );
    bumpTitle();
    setTimeout(() => {
      this.knocks.value = this.knocks.peek().filter((k) => k.id !== info.id);
    }, 30_000);
  }

  /** Let a knocking person in: the room grows by one. */
  letIn(info: MemberInfo): void {
    const p = this.policy.peek();
    const count = this.memberList().length;
    this.setPolicy({ locked: p.locked, limit: Math.max(p.limit, count + 1) });
    this.knocks.value = this.knocks.peek().filter((k) => k.id !== info.id);
  }

  dismissKnock(info: MemberInfo): void {
    this.knocks.value = this.knocks.peek().filter((k) => k.id !== info.id);
  }

  /** Who opened the room: the one who may hold the shared controls. */
  readonly isHost = computed(() => this.policy.value.host === this.id.value);
  /** The host holds the shared controls and is here: this side may only change its own things. */
  readonly controlsHeld = computed(() => {
    const p = this.policy.value;
    return p.controls && p.host !== this.id.value && this.peers.value.some((x) => x.id === p.host);
  });
  /** The host's name, while here. */
  readonly hostName = computed(() => {
    const p = this.policy.value;
    if (p.host === this.id.value) return this.self.value.name;
    return this.peers.value.find((x) => x.id === p.host)?.info.name ?? null;
  });

  /**
   * May `id` change the shared tools (the backing track, the metronome, recording, someone else's sound)? Anyone,
   * unless the host holds the controls: then only the host, while present (it is released when they leave).
   */
  mayControl(id: string): boolean {
    const p = this.policy.peek();
    if (!p.controls || id === p.host) return true;
    const hostHere = p.host === this.selfId || this.peers.peek().some((x) => x.id === p.host);
    return !hostHere;
  }

  setPolicy(p: { locked: boolean; limit: number; controls?: boolean }): void {
    const cur = this.policy.peek();
    // the room's rules are the host's while they hold the controls; holding them is theirs alone
    if (!this.mayControl(this.selfId)) return;
    const controls = this.isHost.peek() && p.controls !== undefined ? p.controls : cur.controls;
    const next: Policy = {
      locked: p.locked,
      limit: Math.max(2, Math.min(12, p.limit)),
      ver: cur.ver + 1,
      by: this.selfId,
      host: cur.host,
      controls,
    };
    this.policy.value = next;
    for (const l of this.parts.links()) l.sendControl({ t: 'policy', policy: next });
  }

  // =========================================================================================== links

  /** A new WebRTC link to `info`, its events routed to the participant (src/app/participants.ts). */
  private async connect(info: MemberInfo, initiator: boolean): Promise<PeerLink> {
    const servers = await this.warmIce();
    log('link', initiator ? 'to' : 'from', `${info.name}#${info.id.slice(0, 4)}`);
    const link = new PeerLink({
      id: info.id,
      selfId: this.selfId,
      initiator,
      iceServers: servers,
      tracks: {
        audio: this.media.sentAudio.peek() ?? this.media.audio.peek(),
        video: this.media.sentVideo.peek(),
        extra: this.media.extra.peek(),
        screenAudio: this.media.screenAudio.peek(),
      },
      streams: {
        audio: new MediaStream(),
        video: new MediaStream(),
        extra: new MediaStream(),
        screenAudio: new MediaStream(),
      },
      params: this.sendParams(),
      tuning: DEFAULT_TUNING,
    });
    // events of a link that was replaced meanwhile are ignored
    const current = () => this.parts.link(info.id) === link;
    link.onSignal = (data) => this.sendSignal(info.id, data);
    link.onState = (s) => {
      log('link', info.id.slice(0, 4), s);
      this.parts.linkState(link, s);
    };
    link.onTrack = (slot, track) => {
      if (current()) this.onRemoteTrack(info.id, slot, track);
    };
    link.onControl = (msg) => {
      if (current()) this.onControl(link, msg);
    };
    link.onMidi = (data) => {
      if (current()) this.midi.fromPeer(info.id, data);
    };
    link.onFile = (data) => {
      if (current()) this.onFileData(info.id, data);
    };
    link.onLost = () => this.parts.lost(link);
    link.onMidiOpen = () => link.sendMidi(this.midi.helloPacket());
    return link;
  }

  private sendSignal(to: string, data: SignalData): void {
    const mid = Math.random().toString(36).slice(2, 12);
    this.room.signal(to, data, mid);
    // the direct channel is faster when it works (and does not depend on the brokers)
    const l = this.parts.link(to);
    if (l && l.ctlOpen && l.state === 'connected') l.sendControl({ t: 'sig', data, mid });
  }

  /** A link just opened: introduce ourselves on it. */
  private onConnected(link: PeerLink): void {
    this.room.connected(link.id);
    link.sendControl(this.stateMessage());
    link.sendControl({ t: 'policy', policy: this.policy.peek() });
    const hist = this.chat.history();
    if (hist.length) link.sendControl({ t: 'history', messages: hist });
    link.setParams(this.sendParams());
    this.sendRoster();
    this.knocks.value = this.knocks.peek().filter((k) => k.id !== link.id);
    this.backing.onConnected(link.id);
    this.score.onConnected(link.id);
    this.video.onConnected(link.id);
    this.metronome.onConnected(link.id);
    this.recorder.onConnected((m) => link.sendControl(m));
  }

  /** The other side introduced itself for the first time: now we can say who joined. */
  private announceJoin(peer: PeerView): void {
    // a phone someone set up as their camera: said once, quietly
    if (peer.info.of) {
      const owner = peer.info.of === this.selfId ? null : peer.info.name;
      this.chat.system(owner ? t('{name} added a camera', { name: owner }) : t('Your phone is connected as a camera'));
      return;
    }
    const name = peer.info.name;
    const role = roleLabel(peer.info.role);
    trackEvent('peer_joined', { role: peer.info.role });
    if (settings.peek().joinSound) chime('join');
    buzz(40);
    toast({ kind: 'join', title: t('{name} joined', { name }), body: role });
    this.chat.system(t('{name} ({role}) joined the lesson', { name, role }));
    if (settings.peek().notifyJoin)
      systemNotify(t('{name} joined your lesson', { name }), `${role} · Sonora Live`, 'join');
    bumpTitle();
  }

  /** Someone left (or their connection was lost for good), a moment ago and not back since. */
  private announceLeave(info: MemberInfo, how: Departure): void {
    if (this.phase.peek() !== 'room' || info.of) return;
    const name = info.name;
    const bye = how === 'left';
    if (settings.peek().joinSound) chime('leave');
    toast({
      kind: 'leave',
      title: bye ? t('{name} left', { name }) : t('Lost connection to {name}', { name }),
      body: bye ? undefined : t('They can rejoin with the same link; it reconnects by itself.'),
    });
    this.chat.system(bye ? t('{name} left the lesson', { name }) : t('Connection to {name} was lost', { name }));
  }

  /** Release what this side held for someone whose connection is gone (their sound, their notes, a file). */
  private releasePeer(id: string): void {
    this.midi.peerGone(id);
    // a file they were sending will not finish
    const f = this.fileIn.get(id);
    if (f?.kind === 'chat') this.chat.updateFile(f.id, { progress: 1, failed: true });
    this.fileIn.delete(id);
    this.backing.peerGone(id);
    this.score.peerGone(id);
    this.recorder.peerGone(id);
    for (const key of [id, `${id}${SCREEN}`]) {
      engine.playRemote(key, null);
      const el = this.audioEls.get(key);
      if (el) {
        el.srcObject = null;
        el.remove();
        this.audioEls.delete(key);
      }
    }
  }

  // =========================================================================================== media

  private sendParams() {
    const s = settings.peek();
    return {
      audioBitrate: AUDIO_QUALITY[s.audioQuality].bitrate,
      videoBitrate: VIDEO_QUALITY[s.videoQuality].bitrate,
      extraBitrate: 1_500_000,
    };
  }

  private sendTrack(slot: Slot, track: MediaStreamTrack | null): void {
    for (const l of this.parts.links()) void l.setTrack(slot, track);
    // the meter shows the microphone itself (before any noise reduction)
    if (slot === 'audio') this.meter.attach(this.media.audio.peek());
    this.broadcastState();
  }

  private onRemoteTrack(id: string, slot: Slot, track: MediaStreamTrack): void {
    const stream = new MediaStream([track]);
    this.parts.patch(id, { [slot]: stream });
    if (slot === 'audio') this.playAudio(id, stream);
    // their screen's sound: an audio element of its own (through the engine while echo cancelling runs)
    if (slot === 'screenAudio') this.screenSound(id);
  }

  /**
   * Where someone's sound plays: through the audio engine while echo cancelling runs (so the canceller knows what
   * the speakers play) or while this listener reduces their noise; from its plain element otherwise (no added
   * delay). Through the engine, the element keeps playing it, muted (Chrome delivers a remote stream to an audio
   * context only then).
   */
  private routeAudio(id: string): void {
    const el = this.audioEls.get(id);
    if (!el) return;
    const stream = el.srcObject as MediaStream | null;
    const denoise = this.cleansNoise(id);
    const through = (engine.aecOn.peek() && engine.running.peek()) || denoise;
    el.muted = through && engine.playRemote(id, stream, denoise);
    if (!el.muted) engine.playRemote(id, null);
  }

  /** This listener reduces the steady background noise in `id`'s sound. */
  cleansNoise(id: string): boolean {
    const name = this.peers.peek().find((p) => p.id === id)?.info.name;
    return !!name && settings.peek().cleanNoise.includes(name);
  }

  /** Reduce (or not) the steady background noise in `id`'s sound, for this listener only. Remembered by name. */
  setCleanNoise(id: string, on: boolean): void {
    const name = this.peers.peek().find((p) => p.id === id)?.info.name;
    if (!name) return;
    engine.ensure();
    const list = settings.peek().cleanNoise.filter((n) => n !== name);
    update({ cleanNoise: on ? [...list, name].slice(-50) : list });
  }

  /** Someone's screen sound plays while they share it (their state says so), and stops with it. */
  private screenSound(id: string): void {
    const p = this.peers.peek().find((x) => x.id === id);
    const key = `${id}${SCREEN}`;
    if (p?.remote?.screenSound && p.screenAudio) {
      if (this.audioEls.get(key)?.srcObject !== p.screenAudio) this.playAudio(key, p.screenAudio);
      return;
    }
    engine.playRemote(key, null);
    const el = this.audioEls.get(key);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioEls.delete(key);
    }
  }

  // =========================================================================================== phone cameras

  /** The phone joins as its owner's camera: the back camera, no microphone, nothing played. */
  async enterAsCamera(): Promise<void> {
    const ok = await this.media.startCameraOnly(settings.peek().videoQuality);
    if (!ok) {
      this.camState.value = 'failed';
      return;
    }
    await this.enter();
    const live = effect(() => {
      if (this.camState.value === 'stopped') return live();
      const owner = this.camOf.peek()?.owner;
      const up = this.peers.value.some((p) => p.id === owner && p.link === 'connected');
      this.camState.value = up ? 'live' : 'connecting';
    });
  }

  leaveCamera(): void {
    this.camState.value = 'stopped';
    this.leave();
  }

  /** Take one of this person's phone cameras away. */
  stopPhoneCam(id: string): void {
    const p = this.peers.peek().find((x) => x.id === id);
    if (p?.info.of !== this.selfId) return;
    this.parts.link(id)?.sendControl({ t: 'cam-stop' });
  }

  /** Remote sound plays from a plain audio element unless the engine needs it (routeAudio). */
  private playAudio(id: string, stream: MediaStream): void {
    // a phone used as a camera plays nothing (its owner's microphone is next to it)
    if (this.camOf.peek()) return;
    if (!this.audioHost) {
      this.audioHost = document.createElement('div');
      this.audioHost.hidden = true;
      document.body.appendChild(this.audioHost);
    }
    let el = this.audioEls.get(id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      this.audioHost.appendChild(el);
      this.audioEls.set(id, el);
    }
    el.srcObject = stream;
    this.routeAudio(id);
    const sink = settings.peek().speakerId;
    if (sink && 'setSinkId' in el)
      void (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sink).catch(() => {});
    el.play().then(
      () => (this.needsTap.value = false),
      () => (this.needsTap.value = true),
    );
  }

  /** After a tap: start every sound the browser held back. */
  resumeSound(): void {
    engine.ensure();
    unlockChimes();
    resumeMeters();
    this.midi.piano.context();
    for (const el of this.audioEls.values()) void el.play().catch(() => {});
    this.media.unlockAudio();
    this.needsTap.value = false;
  }

  async setSpeaker(id: string): Promise<void> {
    for (const el of this.audioEls.values()) {
      if ('setSinkId' in el)
        await (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(id).catch(() => {});
    }
    await this.midi.piano.setSink(id);
  }

  /** Let the Web Audio and WebRTC sound mix with the microphone on iOS (Safari 17+). */
  private setAudioSession(type: 'play-and-record' | 'auto'): void {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (s) {
      try {
        s.type = type;
      } catch {
        // not allowed now
      }
    }
  }

  private async lockScreen(): Promise<void> {
    if (this.wakeLock || document.hidden) return;
    try {
      const wl = (
        navigator as Navigator & {
          wakeLock?: {
            request(
              t: 'screen',
            ): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }>;
          };
        }
      ).wakeLock;
      if (!wl) return;
      const lock = await wl.request('screen');
      this.wakeLock = lock;
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) this.wakeLock = null;
      });
    } catch {
      // not allowed (battery saver) or unsupported
    }
  }

  // =========================================================================================== state messages

  private stateMessage(): Record<string, unknown> {
    const m = this.media;
    const d = this.midi.devices;
    const state: RemoteState = {
      mic: m.micOn.peek() && !!m.audio.peek(),
      cam: m.camOn.peek() && !!m.video.peek(),
      extra: m.extra.peek() ? m.extraKind.peek() : null,
      screenSound: !!m.screenAudio.peek(),
      sound: m.mode.peek(),
      stereo: m.stereo.peek(),
      soundSetting: settings.peek().sound,
      echoSetting: settings.peek().echo,
      echo: m.echo.peek(),
      headphones: m.headphones.peek(),
      sendMs: this.sendMs(),
      hearExtra: this.hearExtra(),
      musicEcho: settings.peek().musicEcho,
      autoLevel: settings.peek().autoLevel,
      midiPlayOn: settings.peek().midi.playOn,
      midiSend: settings.peek().midi.send,
      midi: {
        device: d.connected.peek() ? d.currentName.peek() : '',
        sending: d.connected.peek() && this.midi.sending.peek(),
        receiving: this.midi.playOn.peek() !== 'off',
        sound: settings.peek().midi.sound,
      },
      away: document.hidden,
    };
    return { t: 'state', info: { ...this.self.peek(), since: this.since }, state };
  }

  /**
   * How long this side's microphone sound takes before it leaves: the capture (as the browser says), the
   * processing (the browser's echo cancelling, the app's level on frames or in the audio context), one 10 ms frame.
   */
  private sendMs(): number {
    const t = this.media.audio.peek();
    const st = (t?.getSettings() ?? {}) as MediaTrackSettings & { latency?: number };
    let ms = (st.latency ?? 0.01) * 1000 + 10;
    const ec = st.echoCancellation as boolean | string | undefined;
    if (ec !== undefined && ec !== false) ms += 10;
    const path = engine.path.peek();
    if (path === 'frames') ms += 2;
    else if (path === 'context') ms += (engine.ctx?.baseLatency ?? 0.01) * 1000 + 10;
    return Math.round(ms);
  }

  broadcastState(): void {
    const links = this.parts.links();
    if (!links.length) return;
    const msg = this.stateMessage();
    for (const l of links) l.sendControl(msg);
  }

  private startEffects(): void {
    // tell the others whenever something they show changes
    this.disposers.push(
      effect(() => {
        void this.media.micOn.value;
        void this.media.camOn.value;
        void this.media.extra.value;
        void this.media.screenAudio.value;
        void this.media.mode.value;
        void this.media.echo.value;
        void this.media.headphones.value;
        void settings.value.sound;
        void settings.value.echo;
        void settings.value.musicEcho;
        void settings.value.autoLevel;
        void settings.value.midi;
        void engine.path.value;
        void settings.value.calibration;
        void this.media.outputLabel.value;
        void this.midi.devices.connected.value;
        void this.midi.devices.currentName.value;
        void this.midi.sending.value;
        void this.midi.playOn.value;
        void this.self.value;
        this.room.setSelf({ ...this.self.peek(), since: this.since });
        this.broadcastState();
      }),
    );
    // sound mode follows the setting and MIDI (auto)
    let modeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMode: SoundMode | null = null;
    this.disposers.push(
      effect(() => {
        const mode = this.soundMode.value;
        if (lastMode === null) {
          lastMode = mode;
          return;
        }
        if (mode === lastMode) return;
        lastMode = mode;
        if (modeTimer) clearTimeout(modeTimer);
        // back to pure only once MIDI has really stopped (not on a short dropout of the instrument or the link)
        const wait = mode === 'pure' && settings.peek().sound === 'auto' ? 5000 : 400;
        modeTimer = setTimeout(() => {
          if (!this.media.audio.peek()) return;
          void this.media.setSoundMode(mode);
          if (settings.peek().sound === 'auto') {
            toast({
              kind: 'info',
              title: mode === 'voice' ? t('Microphone: voice only') : t('Microphone: instrument and voice'),
              body:
                mode === 'voice'
                  ? t(
                      'Your piano now reaches the others as MIDI, so your microphone carries your voice only. To send your piano’s sound through it too: MIDI panel, “Voice only on my microphone while I play through MIDI”.',
                    )
                  : t('MIDI is off, so your microphone sends your instrument untouched again.'),
            });
          }
        }, wait);
      }),
    );
    // the microphone's mute is remembered for this lesson; the camera side (front, back) for every lesson
    this.disposers.push(
      effect(() => {
        void this.media.micOn.value;
        if (this.phase.value === 'room') this.noteLesson();
      }),
    );
    this.media.facing.value = settings.peek().facing;
    this.disposers.push(
      effect(() => {
        const f = this.media.facing.value;
        if (f !== settings.peek().facing) update({ facing: f });
      }),
    );
    // the others' sound through the audio engine while echo cancelling runs or their noise is reduced, from
    // plain elements otherwise
    this.disposers.push(
      effect(() => {
        void engine.aecOn.value;
        void engine.running.value;
        void engine.loaded.value;
        void settings.value.cleanNoise;
        void this.peers.value;
        for (const id of this.audioEls.keys()) this.routeAudio(id);
      }),
    );
    // the others' MIDI in time with their sound, at once when switched
    this.disposers.push(
      effect(() => {
        void settings.value.midiSync;
        this.syncMidi();
      }),
    );
    // which echo canceller, and the automatic level, follow their settings
    this.disposers.push(effect(() => void this.media.setMusicEcho(settings.value.musicEcho)));
    // the automatic level runs on speakers only: with headphones, nothing is processed
    this.disposers.push(
      effect(() => void this.media.setAutoLevel(settings.value.autoLevel && this.listening.value === 'speakers')),
    );
    // a backing track loaded here: on speakers, its echo is cancelled
    this.disposers.push(
      effect(() => void this.media.setBacking(!!this.backing.track.value || this.metronome.shared.value.running)),
    );
    // echo cancelling in pure sound follows its setting and the output (headphones or not)
    this.disposers.push(effect(() => void this.media.setEcho(this.pureEcho.value)));
    // the chosen output for everything: the others' sound (its elements), and the engine (the built-in piano,
    // chimes, the others' sound when it goes through the engine), from the start, not only once changed
    this.disposers.push(
      effect(() => {
        const id = settings.value.speakerId;
        void this.media.setSpeaker(id);
        void engine.setSink(id);
      }),
    );
    // the others playing (their sound, from the last packets): the automatic level holds meanwhile, so it never
    // brings up what is left of their echo
    let farUntil = 0;
    const farTimer = setInterval(() => {
      if (this.phase.peek() !== 'room') return;
      const now = performance.now();
      // −34 dB and above: someone is playing or talking
      if (this.parts.links().some((l) => l.audioLevel() > 0.02)) farUntil = now + 500;
      engine.setFar(now < farUntil);
    }, 100);
    this.disposers.push(() => clearInterval(farTimer));
    const outputs = () => void this.media.checkOutput();
    navigator.mediaDevices?.addEventListener?.('devicechange', outputs);
    this.disposers.push(() => navigator.mediaDevices?.removeEventListener?.('devicechange', outputs));
    // quality changes apply at once
    this.disposers.push(
      effect(() => {
        void settings.value.audioQuality;
        void settings.value.videoQuality;
        const p = this.sendParams();
        for (const l of this.parts.links()) l.setParams(p);
      }),
    );
    // MIDI preferences
    this.disposers.push(
      effect(() => {
        const m = settings.value.midi;
        this.midi.playOn.value = m.playOn;
        this.midi.setOutChannel(m.outChannel);
        this.midi.piano.setVolume(m.pianoVolume);
        this.midi.piano.setReverb(m.reverb);
        this.midi.piano.setSound('local', m.sound);
      }),
    );
    // the background blur follows its setting (a phone used as a camera never blurs)
    this.disposers.push(
      effect(() => {
        this.media.setBlur(settings.value.blur && !this.camOf.peek());
      }),
    );
    // turned off by itself (the device could not keep up): the setting says so too, and it is not tried again
    this.disposers.push(
      effect(() => {
        if (this.media.blurTooSlow.value && settings.peek().blur) update({ blur: false });
      }),
    );
    // what the others play sounds as they chose it (a grand, an electric piano, an organ, strings)
    this.disposers.push(
      effect(() => {
        for (const p of this.peers.value) this.midi.piano.setSound(p.id, p.remote?.midi.sound ?? 'grand');
      }),
    );
    this.disposers.push(
      effect(() => {
        // an observer does not send what it plays unless it says so (its own switch, not the saved one)
        const send = watching() ? this.observerPlays.value : settings.value.midi.send;
        if (send !== this.midi.sending.peek()) this.midi.setSending(send);
      }),
    );
    // remember the instrument
    this.disposers.push(
      effect(() => {
        const key = this.midi.devices.current.value;
        if (key && key !== settings.peek().midi.instrument) updateMidi({ instrument: key });
      }),
    );
    // load the piano sound as soon as someone may send notes that play here
    this.disposers.push(
      effect(() => {
        const someoneSends = this.peers.value.some((p) => p.remote?.midi.sending);
        if (someoneSends && this.midi.target === 'piano') void this.midi.piano.load();
      }),
    );
    this.midi.devices.onPresence = (present, name) => {
      if (present) trackEvent('midi_device_connected', { name });
      toast({
        kind: present ? 'success' : 'warn',
        title: present ? t('{name} connected', { name }) : t('{name} disconnected', { name }),
        body: present ? undefined : t('It reconnects by itself when it comes back.'),
      });
    };
  }

  // =========================================================================================== control channel

  private onControl(link: PeerLink, msg: Record<string, unknown>): void {
    const id = link.id;
    switch (msg.t) {
      case 'state': {
        const info = msg.info;
        const st = msg.state as RemoteState;
        if (!validInfo(info) || info.id !== id || !st) return;
        const name = info.name.slice(0, 40) || t('Guest');
        const { first, before } = this.parts.introduced(link, { ...info, name }, st);
        const prevMidi = before?.midi;
        if (!first && prevMidi && !prevMidi.sending && st.midi?.sending) {
          toast({
            kind: 'info',
            title: st.midi.device
              ? t('{name} connected {device}', { name, device: st.midi.device })
              : t('{name} connected an instrument', { name }),
            body: t('Their playing now reaches you as MIDI.'),
          });
        }
        if (prevMidi?.sending && !st.midi?.sending) this.midi.peerGone(id);
        this.screenSound(id);
        break;
      }
      case 'policy': {
        const p = validPolicy(msg.policy);
        if (!p) return;
        const cur = this.policy.peek();
        let next = newerPolicy(cur, p);
        // only the host takes or gives back the controls (an older version, or someone else, cannot)
        if (next !== cur && next.controls !== cur.controls && next.by !== cur.host)
          next = { ...next, controls: cur.controls, host: cur.host };
        if (next !== cur && next.controls !== cur.controls) {
          toast({
            kind: 'info',
            title: next.controls
              ? t('{name} holds the shared controls', { name: this.hostName.peek() ?? t('The host') })
              : t('Everyone can use the shared controls again'),
            body: next.controls ? t('The track, the metronome and recording.') : undefined,
          });
        }
        if (next !== cur && (next.locked !== cur.locked || next.limit !== cur.limit)) {
          const who = this.peers.peek().find((x) => x.id === next.by)?.info.name ?? t('Someone');
          toast({
            kind: 'info',
            title: next.locked ? t('Room limited to {n} people', { n: next.limit }) : t('Room unlocked'),
            body: t('Changed by {name}', { name: who }),
          });
        }
        this.policy.value = next;
        break;
      }
      case 'chat': {
        const peer = this.peers.peek().find((p) => p.id === id);
        if (typeof msg.text !== 'string' || typeof msg.id !== 'string') return;
        const m: ChatMessage = {
          id: msg.id,
          from: id,
          name: peer?.info.name ?? t('Guest'),
          role: peer?.info.role ?? null,
          // in the order it arrives here (their clock may be minutes off ours)
          ts: Date.now(),
          kind: 'text',
          text: msg.text.slice(0, 4000),
          mine: false,
        };
        this.chat.add(m);
        this.onIncomingChat(m);
        break;
      }
      case 'typing': {
        const peer = this.peers.peek().find((p) => p.id === id);
        if (peer) this.chat.setTyping(id, peer.info.name);
        break;
      }
      case 'history':
        this.chat.merge(msg.messages, this.selfId);
        break;
      case 'react':
        if (typeof msg.emoji === 'string' && msg.emoji.length <= 16) this.addReaction(id, msg.emoji);
        break;
      case 'sig':
        if (typeof msg.mid === 'string' && !this.room.remember(msg.mid)) return;
        void this.parts.signal(id, msg.data as SignalData, true);
        break;
      case 'bye':
        this.parts.bye(id);
        break;
      case 'roster':
        this.onRoster(msg.members);
        break;
      case 'sound':
        this.onSoundChange(id, msg);
        break;
      case 'bt':
      case 'bt-at':
        this.backing.onControl(id, msg);
        break;
      case 'mt':
        this.metronome.onControl(id, msg);
        break;
      case 'rec':
        this.recorder.onControl(id, msg);
        break;
      case 'cam-stop':
        // the owner took this phone away
        if (this.camOf.peek()?.owner === id) {
          this.camState.value = 'stopped';
          this.leave();
        }
        break;
      case 'yt':
        this.video.onControl(id, msg);
        break;
      case 'sc':
      case 'sc-ink':
        this.score.onControl(id, msg);
        break;
    }
  }

  /**
   * Change someone else's sound settings (what this side hears from them, or how their side plays the others'
   * MIDI): applied on their device, which shows who changed what. Musicians only (an observer only listens).
   */
  setTheirSound(id: string, patch: TheirSettings): void {
    if (watching() || !this.mayControl(this.selfId)) return;
    const link = this.parts.link(id);
    if (!link) return;
    link.sendControl({ t: 'sound', ...patch });
  }

  /** Someone changed this side's sound settings. */
  private onSoundChange(id: string, msg: Record<string, unknown>): void {
    const by = this.peers.peek().find((p) => p.id === id);
    if (!by || by.info.role === 'observer' || !this.mayControl(id)) return;
    const cur = settings.peek();
    const name = by.info.name;
    const said: string[] = [];
    const patch: Partial<typeof cur> = {};
    if ((msg.sound === 'auto' || msg.sound === 'pure' || msg.sound === 'voice') && msg.sound !== cur.sound) {
      patch.sound = msg.sound;
      said.push(
        msg.sound === 'voice'
          ? t('{name} set your microphone to voice only', { name })
          : msg.sound === 'auto'
            ? t('{name} set your microphone to voice only while your piano plays through MIDI', { name })
            : t('{name} set your microphone to instrument and voice', { name }),
      );
    }
    if ((msg.echo === 'auto' || msg.echo === 'on' || msg.echo === 'off') && msg.echo !== cur.echo) {
      patch.echo = msg.echo;
      said.push(
        msg.echo === 'off'
          ? t('{name} turned off echo cancelling on your microphone', { name })
          : t('{name} turned on echo cancelling on your microphone', { name }),
      );
    }
    if (typeof msg.musicEcho === 'boolean' && msg.musicEcho !== cur.musicEcho) {
      patch.musicEcho = msg.musicEcho;
      said.push(
        msg.musicEcho
          ? t('{name} turned on music-safe echo cancelling on your microphone', { name })
          : t('{name} turned off music-safe echo cancelling on your microphone', { name }),
      );
    }
    if (typeof msg.autoLevel === 'boolean' && msg.autoLevel !== cur.autoLevel) {
      patch.autoLevel = msg.autoLevel;
      said.push(
        msg.autoLevel
          ? t('{name} turned on the automatic level of your microphone', { name })
          : t('{name} turned off the automatic level of your microphone', { name }),
      );
    }
    const midi: Partial<typeof cur.midi> = {};
    if (
      (msg.playOn === 'auto' || msg.playOn === 'instrument' || msg.playOn === 'piano' || msg.playOn === 'off') &&
      msg.playOn !== cur.midi.playOn
    ) {
      midi.playOn = msg.playOn;
      said.push(
        msg.playOn === 'off'
          ? t('{name} turned off the others’ MIDI notes on your side', { name })
          : t('{name} turned on the others’ MIDI notes on your side', { name }),
      );
    }
    if (typeof msg.send === 'boolean' && msg.send !== cur.midi.send) {
      midi.send = msg.send;
      said.push(
        msg.send
          ? t('{name} turned on sending your MIDI', { name })
          : t('{name} turned off sending your MIDI', { name }),
      );
    }
    if (!said.length) return;
    if (Object.keys(patch).length) update(patch);
    if (Object.keys(midi).length) updateMidi(midi);
    toast({ kind: 'info', title: said.join(' · '), body: t('You can change it back in the Sound tab.') });
  }

  /** The sound check's key for this output and microphone. */
  private deviceKey(): string {
    return `${this.media.outputLabel.peek()}|${this.media.audio.peek()?.label ?? ''}`;
  }

  /** How much later than the browser says this side hears and captures (ms), as the sound check measured. */
  private hearExtra(): number {
    return settings.peek().calibration[this.deviceKey()] ?? 0;
  }

  /**
   * The sound check: sweeps from the speakers, heard or not by the microphone. `detect`: heard means speakers,
   * not heard headphones (remembered for this output, as if answered). `headphones`: headphones held against the
   * microphone, to measure their delay (Bluetooth). When heard, the delay beyond what the browser reports is
   * remembered for this output and microphone, and told to the others: what they play in time with this side
   * waits for it.
   */
  async soundCheck(mode: 'detect' | 'headphones'): Promise<CheckResult & { extraMs: number | null }> {
    const ctx = engine.ensure();
    if (!ctx || !engine.out) throw new Error('no audio');
    const micId = this.media.audio.peek()?.getSettings().deviceId || settings.peek().micId || undefined;
    const r = await runSoundCheck(ctx, engine.out, micId);
    let extraMs: number | null = null;
    if (r.heard && r.roundTripMs !== null) {
      const st = (this.media.audio.peek()?.getSettings() ?? {}) as MediaTrackSettings & { latency?: number };
      const said = engine.outputLatencyMs + (st.latency ?? 0.01) * 1000;
      extraMs = Math.max(0, Math.round(r.roundTripMs - said));
      update({ calibration: { ...settings.peek().calibration, [this.deviceKey()]: extraMs } });
    }
    if (mode === 'detect') this.setListening(r.heard ? 'speakers' : 'headphones');
    else if (r.heard) this.setListening('headphones');
    return { ...r, extraMs };
  }

  /** Tell everyone who this browser is connected to. */
  private sendRoster(): void {
    const members = this.peers
      .peek()
      .filter((p) => p.link === 'connected' && p.remote)
      .map((p) => p.info);
    for (const l of this.parts.links()) l.sendControl({ t: 'roster', members });
  }

  /**
   * Another member is connected to someone we are not (our connection to them dropped, or the welcome missed
   * them): connect. Only the smaller id starts, so both sides do not start at once.
   */
  private onRoster(list: unknown): void {
    if (!Array.isArray(list) || this.phase.peek() !== 'room') return;
    this.parts.roster(list.slice(0, 16).filter((m): m is MemberInfo => validInfo(m)));
  }

  private onIncomingChat(m: ChatMessage): void {
    if (!this.chat.visible || document.hidden) {
      chime('message');
      bumpTitle();
      systemNotify(m.name, m.kind === 'file' ? t('Sent {file}', { file: m.file?.name ?? '' }) : (m.text ?? ''), 'chat');
    }
  }

  // =========================================================================================== chat

  sendChat(text: string): void {
    const t = text.trim();
    if (!t) return;
    const me = this.self.peek();
    const m: ChatMessage = {
      id: newId(),
      from: this.selfId,
      name: me.name,
      role: me.role,
      ts: Date.now(),
      kind: 'text',
      text: t,
      mine: true,
    };
    this.chat.add(m);
    for (const l of this.parts.links()) l.sendControl({ t: 'chat', id: m.id, text: t, ts: m.ts });
    this.typingSentAt = 0;
  }

  typing(): void {
    const now = Date.now();
    if (now - this.typingSentAt < 2500) return;
    this.typingSentAt = now;
    for (const l of this.parts.links()) l.sendControl({ t: 'typing' });
  }

  react(emoji: string): void {
    this.addReaction(this.selfId, emoji);
    for (const l of this.parts.links()) l.sendControl({ t: 'react', emoji });
  }

  private addReaction(from: string, emoji: string): void {
    const r: Reaction = { id: this.reactionId++, from, emoji, at: Date.now() };
    this.reactions.value = [...this.reactions.peek(), r].slice(-24);
    setTimeout(() => {
      this.reactions.value = this.reactions.peek().filter((x) => x.id !== r.id);
    }, 3200);
  }

  /** Share a file with everyone (sent directly, in chunks, over the file channel). */
  sendFile(file: File): void {
    if (file.size > MAX_FILE_BYTES) {
      toast({ kind: 'warn', title: t('File too large'), body: t('Files up to 50 MB can be shared in the chat.') });
      return;
    }
    const me = this.self.peek();
    const fid = newId();
    const url = URL.createObjectURL(file);
    this.chat.add({
      id: fid,
      from: this.selfId,
      name: me.name,
      role: me.role,
      ts: Date.now(),
      kind: 'file',
      file: {
        id: fid,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        url,
        progress: 0,
      },
      mine: true,
    });
    const links = this.parts.links().filter((l) => l.file.readyState === 'open');
    if (!links.length) {
      this.chat.updateFile(fid, { progress: 1 });
      return;
    }
    const meta = { t: 'file', id: fid, name: file.name, size: file.size, mime: file.type, ts: Date.now() };
    this.pushFile(links, meta, file, (p) => this.chat.updateFile(fid, { progress: p }));
  }

  /** The backing track's file, to everyone or to one person. */
  private sendScoreFile(meta: ScoreMeta, blob: Blob, to?: string): void {
    const links = this.parts.links().filter((l) => l.file.readyState === 'open' && (!to || l.id === to));
    if (!links.length) return;
    this.pushFile(links, { t: 'score', ...meta }, blob, () => {});
  }

  private sendTrackFile(meta: TrackMeta, blob: Blob, to?: string): void {
    const links = this.parts.links().filter((l) => l.file.readyState === 'open' && (!to || l.id === to));
    if (!links.length) return;
    this.pushFile(links, { t: 'track', ...meta }, blob, () => {});
  }

  /**
   * Send `blob` over the file channel of `links`, one after the other and after what is already being sent:
   * the description (`meta`), the chunks, then the end.
   */
  private pushFile(links: PeerLink[], meta: Record<string, unknown>, blob: Blob, progress: (p: number) => void): void {
    this.fileOutQueue = this.fileOutQueue.then(async () => {
      const head = JSON.stringify(meta);
      // small chunks: a chunk being sent cannot be overtaken, and MIDI shares the connection
      const chunk = 16 * 1024;
      let sent = 0;
      const total = blob.size * links.length;
      for (const l of links) {
        const ch = l.file;
        const max = (l.pc.sctp?.maxMessageSize ?? 65536) || 65536;
        const size = Math.min(chunk, max);
        try {
          ch.send(head);
          for (let off = 0; off < blob.size; off += size) {
            const buf = await blob.slice(off, off + size).arrayBuffer();
            if (ch.bufferedAmount > 256 * 1024) await drained(ch);
            if (ch.readyState !== 'open') break;
            ch.send(buf);
            sent += buf.byteLength;
            progress(Math.min(0.99, sent / total));
          }
          ch.send(JSON.stringify({ t: 'end', id: meta.id }));
        } catch {
          // this peer left mid-way
        }
      }
      progress(1);
    });
  }

  private onFileData(from: string, data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.t === 'file' && typeof m.id === 'string') {
        const size = Math.min(MAX_FILE_BYTES, Number(m.size) || 0);
        const name = String(m.name ?? 'file').slice(0, 120);
        const mime = safeMime(String(m.mime || ''));
        this.fileIn.set(from, { kind: 'chat', id: m.id, chunks: [], got: 0, size, mime, name });
        const peer = this.peers.peek().find((p) => p.id === from);
        const msg: ChatMessage = {
          id: m.id,
          from,
          name: peer?.info.name ?? t('Guest'),
          role: peer?.info.role ?? null,
          ts: Number(m.ts) || Date.now(),
          kind: 'file',
          file: { id: m.id, name, size, mime, url: null, progress: 0 },
          mine: false,
        };
        this.chat.add(msg);
        this.onIncomingChat(msg);
      } else if (m.t === 'track' && typeof m.id === 'string') {
        const meta: TrackMeta = {
          id: m.id.slice(0, 40),
          name: String(m.name ?? 'track').slice(0, 120),
          size: Math.min(MAX_TRACK_BYTES, Number(m.size) || 0),
          mime: safeMime(String(m.mime || '')),
        };
        this.fileIn.set(from, { kind: 'track', ...meta, chunks: [], got: 0 });
        this.backing.receiving(from, meta);
      } else if (m.t === 'score' && typeof m.id === 'string') {
        const meta: ScoreMeta = {
          id: m.id.slice(0, 40),
          name: String(m.name ?? 'score').slice(0, 120),
          size: Math.min(MAX_SCORE_BYTES, Number(m.size) || 0),
          mime: safeMime(String(m.mime || '')),
        };
        this.fileIn.set(from, { kind: 'score', ...meta, chunks: [], got: 0 });
        this.score.receiving(from, meta);
      } else if (m.t === 'end') {
        const f = this.fileIn.get(from);
        if (!f || f.id !== m.id) return;
        this.fileIn.delete(from);
        const ok = f.got >= f.size;
        const blob = new Blob(f.chunks, { type: f.mime });
        if (f.kind === 'score') {
          this.score.received(from, { id: f.id, name: f.name, size: f.size, mime: f.mime }, ok ? blob : null);
          return;
        }
        if (f.kind === 'track') {
          this.backing.received(from, { id: f.id, name: f.name, size: f.size, mime: f.mime }, ok ? blob : null);
          return;
        }
        this.chat.updateFile(f.id, { url: URL.createObjectURL(blob), progress: 1, failed: !ok });
      }
      return;
    }
    const f = this.fileIn.get(from);
    if (!f) return;
    const max = f.kind === 'track' ? MAX_TRACK_BYTES : f.kind === 'score' ? MAX_SCORE_BYTES : MAX_FILE_BYTES;
    if (f.got + data.byteLength > max) return;
    f.chunks.push(data);
    f.got += data.byteLength;
    const p = f.size ? Math.min(0.99, f.got / f.size) : 0;
    if (f.kind === 'track') this.backing.progress(from, p);
    else if (f.kind === 'score') this.score.progress(from, p);
    else if (f.size) this.chat.updateFile(f.id, { progress: p });
  }

  // =========================================================================================== stats

  private async pollStats(): Promise<void> {
    if (document.hidden && this.peers.peek().length === 0) return;
    const updates = await Promise.all(
      this.parts.links().map(async (l) => [l.id, await l.stats()] as [string, Awaited<ReturnType<PeerLink['stats']>>]),
    );
    this.parts.patchStats(updates);
    this.syncMidi();
  }

  /**
   * Each peer's MIDI waits for their sound: their send time plus this side's jitter buffer for them (the network
   * part is the same for both). Changed only when it moves by more than a few ms (no wobble).
   */
  private syncMidi(): void {
    const on = settings.peek().midiSync;
    for (const p of this.peers.peek()) {
      // their sound reaches the speakers later still when this side cleans its noise (8 ms)
      const want =
        on && p.remote && p.stats ? (p.remote.sendMs ?? 30) + p.stats.bufferMs + (this.cleansNoise(p.id) ? 8 : 0) : 0;
      if (Math.abs(want - this.midi.delayOf(p.id)) > 8 || (want === 0 && this.midi.delayOf(p.id) !== 0))
        this.midi.setDelay(p.id, want);
    }
  }

  /** The connection settings changed (TURN server): new connections use them. */
  refreshIce(): void {
    this.iceCache = null;
    void this.warmIce();
  }

  get isLeader(): boolean {
    return this.room.isLeader;
  }
}

/**
 * Until a data channel's send buffer has drained (or the channel is closed: a channel closed by our own side
 * fires no event, so its state is checked too).
 */
function drained(ch: RTCDataChannel): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearInterval(poll);
      ch.removeEventListener('bufferedamountlow', done);
      ch.removeEventListener('close', done);
      resolve();
    };
    const poll = setInterval(() => {
      if (ch.readyState !== 'open' || ch.bufferedAmount <= ch.bufferedAmountLowThreshold) done();
    }, 250);
    ch.addEventListener('bufferedamountlow', done);
    ch.addEventListener('close', done);
  });
}

/**
 * Files from others open from a blob: URL of this site, so only types that cannot run script keep their type
 * (HTML or SVG would run in our origin); anything else is downloaded instead of opened.
 */
export function safeMime(mime: string): string {
  const m = mime.toLowerCase().trim();
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(m)) return m;
  if (/^audio\/[a-z0-9.+-]+$/.test(m) || /^video\/(mp4|webm|ogg)$/.test(m)) return m;
  if (m === 'application/pdf' || m === 'text/plain') return m;
  return 'application/octet-stream';
}

export const session = new Session();
