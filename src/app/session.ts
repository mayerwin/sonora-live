// The lesson: one room, the direct connections to everyone in it, this side's camera, microphone and instrument,
// and the chat. The UI reads its signals and calls its methods; everything below it is framework-free.

import { computed, effect, signal } from '@preact/signals';
import { AUDIO_QUALITY, VIDEO_QUALITY, type SoundMode } from '../media/constraints.ts';
import { LocalMedia } from '../media/local.ts';
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
import { bumpTitle, buzz, chime, setTitleRoom, systemNotify, toast, unlockChimes } from './notify.ts';
import { settings, tabId, updateMidi } from './settings.ts';
import { log } from './log.ts';
import {
  Participants,
  RECONNECT_AFTER_AWAY_MS,
  type Departure,
  type PeerView,
  type RemoteState,
} from './participants.ts';
import { t } from './i18n.ts';

const LESSON_KEY = 'sonora.lesson';

export const roleLabel = (r: Role): string => (r === 'observer' ? t('Observer') : t('Musician'));

/** Opened with an observer's link (`?watch`): joins to watch and listen, not to play. */
export const watching = (): boolean => typeof location !== 'undefined' && /[?&]watch\b/.test(location.search);

export type { PeerView, RemoteState } from './participants.ts';

export interface Reaction {
  id: number;
  from: string;
  emoji: string;
  at: number;
}

const STATS_EVERY_MS = 1000;

function initialPolicy(selfId: string): Policy {
  const s = settings.peek();
  return { locked: s.lockRooms, limit: Math.max(2, s.roomLimit), ver: 0, by: selfId };
}

export class Session {
  /** this tab's id (kept across reloads; a duplicated tab gets its own, see uniqueTab) */
  private readonly id = signal(tabId(newPeerId));
  private tabs: BroadcastChannel | null = null;
  readonly media = new LocalMedia();
  readonly meter = new Meter();
  readonly midi = new MidiHub();
  readonly chat = new Chat();

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
  readonly self = computed<MemberInfo>(() => ({
    id: this.id.value,
    name: settings.value.name.trim() || roleLabel(watching() ? 'observer' : 'player'),
    role: watching() ? 'observer' : 'player',
    since: this.since,
  }));

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
  private fileIn = new Map<
    string,
    { id: string; chunks: BlobPart[]; got: number; size: number; mime: string; name: string }
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
          const others = this.memberList().filter((m) => m.id !== from && m.id !== this.selfId).length;
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

  private markInLesson(on: boolean): void {
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
    // steady-noise reduction, if chosen: started from this click (its audio context needs one)
    void this.media.setDenoise(settings.peek().denoise);
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
    this.markInLesson(false);
    this.sayBye();
    this.parts.clear();
    this.room.leave(false);
    this.roomPhase.value = 'idle';
    this.phase.value = 'left';
    this.media.stopAll();
    this.meter.detach();
    this.chat.clear();
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

  setPolicy(p: { locked: boolean; limit: number }): void {
    const cur = this.policy.peek();
    const next: Policy = {
      locked: p.locked,
      limit: Math.max(2, Math.min(12, p.limit)),
      ver: cur.ver + 1,
      by: this.selfId,
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
        video: this.media.video.peek(),
        extra: this.media.extra.peek(),
      },
      streams: { audio: new MediaStream(), video: new MediaStream(), extra: new MediaStream() },
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
  }

  /** The other side introduced itself for the first time: now we can say who joined. */
  private announceJoin(peer: PeerView): void {
    const name = peer.info.name;
    const role = roleLabel(peer.info.role);
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
    if (this.phase.peek() !== 'room') return;
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
    this.fileIn.delete(id);
    const el = this.audioEls.get(id);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioEls.delete(id);
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
  }

  /** Remote sound plays from a plain audio element: no extra processing, no added delay. */
  private playAudio(id: string, stream: MediaStream): void {
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
    unlockChimes();
    resumeMeters();
    this.midi.piano.context();
    for (const el of this.audioEls.values()) void el.play().catch(() => {});
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
      sound: m.mode.peek(),
      stereo: m.stereo.peek(),
      midi: {
        device: d.connected.peek() ? d.currentName.peek() : '',
        sending: d.connected.peek() && this.midi.sending.peek(),
        receiving: this.midi.playOn.peek() !== 'off',
      },
      away: document.hidden,
    };
    return { t: 'state', info: { ...this.self.peek(), since: this.since }, state };
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
        void this.media.mode.value;
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
              title: mode === 'voice' ? t('Microphone: voice mode') : t('Microphone: pure sound'),
              body:
                mode === 'voice'
                  ? t('Your piano now travels as MIDI, so your microphone is tuned for speech.')
                  : t('MIDI is off, so your microphone sends your instrument untouched again.'),
            });
          }
        }, wait);
      }),
    );
    // the noise reduction follows its setting (and the sound mode: pure only)
    this.disposers.push(
      effect(() => {
        const on = settings.value.denoise;
        void this.media.mode.value;
        void this.media.setDenoise(on);
      }),
    );
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
        this.midi.outChannel.value = m.outChannel;
        this.midi.piano.setVolume(m.pianoVolume);
        this.midi.piano.setReverb(m.reverb);
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
        break;
      }
      case 'policy': {
        const p = validPolicy(msg.policy);
        if (!p) return;
        const cur = this.policy.peek();
        const next = newerPolicy(cur, p);
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
          ts: Number(msg.ts) || Date.now(),
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
    }
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
    this.fileOutQueue = this.fileOutQueue.then(async () => {
      const meta = JSON.stringify({
        t: 'file',
        id: fid,
        name: file.name,
        size: file.size,
        mime: file.type,
        ts: Date.now(),
      });
      const chunk = 64 * 1024;
      let sent = 0;
      const total = file.size * links.length;
      for (const l of links) {
        const ch = l.file;
        const max = (l.pc.sctp?.maxMessageSize ?? 65536) || 65536;
        const size = Math.min(chunk, max);
        try {
          ch.send(meta);
          for (let off = 0; off < file.size; off += size) {
            const buf = await file.slice(off, off + size).arrayBuffer();
            if (ch.bufferedAmount > 256 * 1024) {
              await new Promise<void>((resolve) => {
                const done = () => {
                  ch.removeEventListener('bufferedamountlow', done);
                  ch.removeEventListener('close', done);
                  resolve();
                };
                ch.addEventListener('bufferedamountlow', done);
                ch.addEventListener('close', done);
              });
            }
            if (ch.readyState !== 'open') break;
            ch.send(buf);
            sent += buf.byteLength;
            this.chat.updateFile(fid, { progress: Math.min(0.99, sent / total) });
          }
          ch.send(JSON.stringify({ t: 'end', id: fid }));
        } catch {
          // this peer left mid-way
        }
      }
      this.chat.updateFile(fid, { progress: 1 });
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
        this.fileIn.set(from, { id: m.id, chunks: [], got: 0, size, mime, name });
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
      } else if (m.t === 'end') {
        const f = this.fileIn.get(from);
        if (!f || f.id !== m.id) return;
        this.fileIn.delete(from);
        const blob = new Blob(f.chunks, { type: f.mime });
        this.chat.updateFile(f.id, { url: URL.createObjectURL(blob), progress: 1, failed: f.got < f.size });
      }
      return;
    }
    const f = this.fileIn.get(from);
    if (!f) return;
    if (f.got + data.byteLength > MAX_FILE_BYTES) return;
    f.chunks.push(data);
    f.got += data.byteLength;
    if (f.size) this.chat.updateFile(f.id, { progress: Math.min(0.99, f.got / f.size) });
  }

  // =========================================================================================== stats

  private async pollStats(): Promise<void> {
    if (document.hidden && this.peers.peek().length === 0) return;
    const updates = await Promise.all(
      this.parts.links().map(async (l) => [l.id, await l.stats()] as [string, Awaited<ReturnType<PeerLink['stats']>>]),
    );
    this.parts.patchStats(updates);
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
