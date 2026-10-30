// The lesson: one room, the direct connections to everyone in it, this side's camera, microphone and instrument,
// and the chat. The UI reads its signals and calls its methods; everything below it is framework-free.

import { batch, computed, effect, signal } from '@preact/signals';
import { AUDIO_QUALITY, VIDEO_QUALITY, type SoundMode } from '../media/constraints.ts';
import { LocalMedia } from '../media/local.ts';
import { Meter, resumeMeters } from '../media/meter.ts';
import { MidiHub } from '../midi/hub.ts';
import { newRoomCode, normalizeRoomCode } from '../net/code.ts';
import { iceServers } from '../net/ice.ts';
import { PeerLink, type LinkState, type LinkStats, type SignalData, type Slot } from '../net/peer.ts';
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

export const ROLE_LABEL: Record<Role, string> = { student: 'Student', teacher: 'Teacher', observer: 'Observer' };

/** What a peer tells us about itself. */
export interface RemoteState {
  mic: boolean;
  cam: boolean;
  extra: 'screen' | 'camera' | null;
  sound: SoundMode;
  stereo: boolean;
  midi: { device: string; sending: boolean; receiving: boolean };
  away: boolean;
}

export interface PeerView {
  id: string;
  info: MemberInfo;
  link: LinkState;
  remote: RemoteState | null;
  audio: MediaStream | null;
  video: MediaStream | null;
  extra: MediaStream | null;
  stats: LinkStats | null;
  joinedAt: number;
  /** a background repair attempt: not shown until it connects */
  quiet?: boolean;
}

export interface Reaction {
  id: number;
  from: string;
  emoji: string;
  at: number;
}

const STATS_EVERY_MS = 2000;

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
  readonly self = computed<MemberInfo>(() => ({
    id: this.id.value,
    name: settings.value.name.trim() || 'Guest',
    role: settings.value.role ?? 'student',
    since: this.since,
  }));

  /** this side's instrument reaches someone over MIDI: the microphone only needs to carry speech */
  readonly midiCarriesInstrument = computed(
    () =>
      this.midi.devices.connected.value &&
      this.midi.sending.value &&
      this.peers.value.some((p) => p.link === 'connected' && p.remote?.midi.receiving),
  );
  readonly soundMode = computed<SoundMode>(() => {
    const s = settings.value.sound;
    if (s === 'pure' || s === 'voice') return s;
    return this.midiCarriesInstrument.value ? 'voice' : 'pure';
  });

  private relay: Relay;
  private room: Room;
  private links = new Map<string, PeerLink>();
  private creating = new Map<string, Promise<PeerLink>>();
  /** members others are connected to and we are not (id -> first noticed) */
  private missing = new Map<string, number>();
  private since = Date.now();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private audioEls = new Map<string, HTMLAudioElement>();
  private audioHost: HTMLElement | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private reactionId = 1;
  private fileIn = new Map<string, { id: string; chunks: BlobPart[]; got: number; size: number; mime: string; name: string }>();
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
    this.room = new Room(this.relay, this.self.peek(), {
      members: () => this.memberList(),
      busy: () => [...this.links.values()].some((l) => l.state === 'connecting'),
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
        if (again) {
          // it reloaded its page: the old connection is dead
          const old = this.links.get(info.id);
          if (old) this.dropLink(info.id, false);
        }
      },
      onKnock: (info) => this.onKnock(info),
      onSignal: (from, data) => void this.onSignal(from, data),
      onBye: (from) => this.dropLink(from, true),
    });
    this.midi.broadcast = (p) => {
      for (const l of this.links.values()) l.sendMidi(p);
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
    window.addEventListener('online', () => {
      (this.relay as { kick?: () => void }).kick?.();
      for (const l of this.links.values()) l.restartIce();
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
    if (!this.iceCache) this.iceCache = await iceServers(settings.peek().turn);
    return this.iceCache;
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

  /** Enter the lesson (from the lobby's button: this click also unlocks sound). */
  async enter(): Promise<void> {
    unlockChimes();
    resumeMeters();
    this.midi.piano.context();
    this.setAudioSession('play-and-record');
    await this.uniqueTab();
    this.since = Date.now();
    this.room.setSelf(this.self.peek());
    this.policy.value = initialPolicy(this.selfId);
    this.denied.value = null;
    this.phase.value = 'room';
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
        if (++tick % 3 === 0) this.sendRoster();
      }, STATS_EVERY_MS);
    }
    void this.lockScreen();
  }

  /** Leave the lesson (camera and microphone are released). */
  leave(): void {
    this.sayBye();
    for (const id of [...this.links.keys()]) this.dropLink(id, false, true);
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
    for (const l of this.links.values()) l.sendControl({ t: 'bye' });
    if (this.phase.peek() === 'room') this.room.leave(true);
  }

  private memberList(): MemberInfo[] {
    const list: MemberInfo[] = [{ ...this.self.peek(), since: this.since }];
    for (const p of this.peers.peek()) if (p.link === 'connected' || p.link === 'reconnecting') list.push(p.info);
    return list;
  }

  private onWelcome(members: MemberInfo[], policy: Policy): void {
    log('welcome', members.map((m) => `${m.name}#${m.id.slice(0, 4)}`), policy);
    this.policy.value = newerPolicy(this.policy.peek(), policy);
    this.denied.value = null;
    this.roomPhase.value = 'in';
    for (const m of members) {
      if (m.id === this.selfId || this.links.has(m.id)) continue;
      void this.link(m, true);
    }
  }

  private onKnock(info: MemberInfo): void {
    if (this.knocks.peek().some((k) => k.id === info.id)) return;
    this.knocks.value = [...this.knocks.peek(), info];
    chime('knock');
    buzz([60, 80, 60]);
    systemNotify('Someone is knocking', `${info.name} (${ROLE_LABEL[info.role]}) wants to join your lesson.`, 'knock');
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
    const next: Policy = { locked: p.locked, limit: Math.max(2, Math.min(12, p.limit)), ver: cur.ver + 1, by: this.selfId };
    this.policy.value = next;
    for (const l of this.links.values()) l.sendControl({ t: 'policy', policy: next });
  }

  // =========================================================================================== links

  private async connect(info: MemberInfo, initiator: boolean): Promise<PeerLink> {
    const servers = await this.warmIce();
    const existing = this.links.get(info.id);
    if (existing) return existing;
    log('link', initiator ? 'to' : 'from', `${info.name}#${info.id.slice(0, 4)}`);
    const link = new PeerLink({
      id: info.id,
      selfId: this.selfId,
      initiator,
      iceServers: servers,
      tracks: { audio: this.media.audio.peek(), video: this.media.video.peek(), extra: this.media.extra.peek() },
      streams: { audio: new MediaStream(), video: new MediaStream(), extra: new MediaStream() },
      params: this.sendParams(),
      tuning: DEFAULT_TUNING,
    });
    this.links.set(info.id, link);
    this.upsertPeer(info.id, {
      id: info.id,
      info,
      link: 'connecting',
      remote: null,
      audio: null,
      video: null,
      extra: null,
      stats: null,
      joinedAt: Date.now(),
    });
    link.onSignal = (data) => this.sendSignal(info.id, data);
    link.onState = (s) => this.onLinkState(link, s);
    link.onTrack = (slot, track) => this.onRemoteTrack(info.id, slot, track);
    link.onControl = (msg) => this.onControl(link, msg);
    link.onMidi = (data) => this.midi.fromPeer(info.id, data);
    link.onFile = (data) => this.onFileData(info.id, data);
    link.onLost = () => this.dropLink(info.id, false);
    return link;
  }

  private sendSignal(to: string, data: SignalData): void {
    const mid = Math.random().toString(36).slice(2, 12);
    this.room.signal(to, data, mid);
    // the direct channel is faster when it works (and does not depend on the brokers)
    const l = this.links.get(to);
    if (l && l.ctlOpen && l.state === 'connected') l.sendControl({ t: 'sig', data, mid });
  }

  private async onSignal(from: string, data: unknown, viaLink = false): Promise<void> {
    const d = data as SignalData;
    if (!d || typeof d !== 'object') return;
    let link = this.links.get(from) ?? (await this.creating.get(from));
    if (!link) {
      // an offer from someone the room let in
      if (!d.description || d.description.type !== 'offer' || viaLink) return;
      const p = this.policy.peek();
      const others = this.memberList().filter((m) => m.id !== from && m.id !== this.selfId).length;
      if (p.locked && others + 1 >= p.limit) {
        log('offer refused (room full)', from, p);
        return;
      }
      link = await this.link({ id: from, name: '…', role: 'student', since: Date.now() }, false);
    }
    await link.receiveSignal(d);
  }

  /** The connection to `info`, created once even when signals arrive while it is being set up. */
  private link(info: MemberInfo, initiator: boolean): Promise<PeerLink> {
    const have = this.links.get(info.id);
    if (have) return Promise.resolve(have);
    let p = this.creating.get(info.id);
    if (!p) {
      p = this.connect(info, initiator);
      this.creating.set(info.id, p);
      void p.finally(() => this.creating.delete(info.id));
    }
    return p;
  }

  private onLinkState(link: PeerLink, s: LinkState): void {
    const p = this.peers.peek().find((x) => x.id === link.id);
    const firstConnect = s === 'connected' && p?.link === 'connecting';
    log('link', link.id.slice(0, 4), s);
    this.patchPeer(link.id, s === 'connected' ? { link: s, quiet: false } : { link: s });
    if (s === 'connected') {
      this.room.connected(link.id);
      // introduce ourselves on the new channel
      link.sendControl(this.stateMessage());
      link.sendControl({ t: 'policy', policy: this.policy.peek() });
      const hist = this.chat.history();
      if (hist.length) link.sendControl({ t: 'history', messages: hist });
      link.sendMidi(this.midi.helloPacket());
      link.setParams(this.sendParams());
      this.sendRoster();
      if (firstConnect) this.knocks.value = this.knocks.peek().filter((k) => k.id !== link.id);
    }
  }

  /** The other side announced itself: now we can say who joined. */
  private announceJoin(peer: PeerView): void {
    const label = `${peer.info.name} (${ROLE_LABEL[peer.info.role]})`;
    if (settings.peek().joinSound) chime('join');
    buzz(40);
    toast({ kind: 'join', title: `${peer.info.name} joined`, body: `${ROLE_LABEL[peer.info.role]} · connected directly` });
    this.chat.system(`${label} joined the lesson`);
    if (settings.peek().notifyJoin) systemNotify(`${peer.info.name} joined your lesson`, `${ROLE_LABEL[peer.info.role]} · Sonora Live`, 'join');
    bumpTitle();
  }

  private dropLink(id: string, bye: boolean, silent = false): void {
    log('drop', id.slice(0, 4), bye ? 'bye' : 'lost', silent ? 'silent' : '');
    const link = this.links.get(id);
    const peer = this.peers.peek().find((p) => p.id === id);
    if (link) {
      this.links.delete(id);
      link.close();
    }
    this.midi.peerGone(id);
    const el = this.audioEls.get(id);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioEls.delete(id);
    }
    if (peer) {
      this.peers.value = this.peers.peek().filter((p) => p.id !== id);
      if (!silent && peer.remote) {
        if (settings.peek().joinSound) chime('leave');
        toast({
          kind: 'leave',
          title: bye ? `${peer.info.name} left` : `Lost connection to ${peer.info.name}`,
          body: bye ? undefined : 'They can rejoin with the same link; it reconnects by itself.',
        });
        this.chat.system(bye ? `${peer.info.name} left the lesson` : `Connection to ${peer.info.name} was lost`);
      }
    }
  }

  private upsertPeer(id: string, v: PeerView): void {
    const list = this.peers.peek().filter((p) => p.id !== id);
    this.peers.value = [...list, v];
  }

  private patchPeer(id: string, patch: Partial<PeerView>): void {
    this.peers.value = this.peers.peek().map((p) => (p.id === id ? { ...p, ...patch } : p));
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
    for (const l of this.links.values()) void l.setTrack(slot, track);
    if (slot === 'audio') this.meter.attach(track);
    this.broadcastState();
  }

  private onRemoteTrack(id: string, slot: Slot, track: MediaStreamTrack): void {
    const stream = new MediaStream([track]);
    this.patchPeer(id, { [slot]: stream } as Partial<PeerView>);
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
    if (sink && 'setSinkId' in el) void (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sink).catch(() => {});
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
      if ('setSinkId' in el) await (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(id).catch(() => {});
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
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } }).wakeLock;
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
    if (!this.links.size) return;
    const msg = this.stateMessage();
    for (const l of this.links.values()) l.sendControl(msg);
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
        modeTimer = setTimeout(() => {
          if (!this.media.audio.peek()) return;
          void this.media.setSoundMode(mode);
          if (settings.peek().sound === 'auto') {
            toast({
              kind: 'info',
              title: mode === 'voice' ? 'Microphone: voice mode' : 'Microphone: pure sound',
              body:
                mode === 'voice'
                  ? 'Your piano now travels as MIDI, so your microphone is tuned for speech.'
                  : 'MIDI is off, so your microphone sends your instrument untouched again.',
            });
          }
        }, 400);
      }),
    );
    // quality changes apply at once
    this.disposers.push(
      effect(() => {
        void settings.value.audioQuality;
        void settings.value.videoQuality;
        const p = this.sendParams();
        for (const l of this.links.values()) l.setParams(p);
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
        const send = settings.value.midi.send;
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
        title: present ? `${name} connected` : `${name} disconnected`,
        body: present ? undefined : 'It reconnects by itself when it comes back.',
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
        const before = this.peers.peek().find((p) => p.id === id);
        const wasKnown = !!before?.remote;
        const name = info.name.slice(0, 40) || 'Guest';
        const prevMidi = before?.remote?.midi;
        this.patchPeer(id, { info: { ...info, name }, remote: st });
        if (!wasKnown) {
          const now = this.peers.peek().find((p) => p.id === id);
          if (now) this.announceJoin(now);
        } else if (prevMidi && !prevMidi.sending && st.midi?.sending) {
          toast({ kind: 'info', title: `${name} connected ${st.midi.device || 'an instrument'}`, body: 'Their playing now reaches you as MIDI.' });
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
          const who = this.peers.peek().find((x) => x.id === next.by)?.info.name ?? 'Someone';
          toast({
            kind: 'info',
            title: next.locked ? `Room limited to ${next.limit} people` : 'Room unlocked',
            body: `Changed by ${who}`,
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
          name: peer?.info.name ?? 'Guest',
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
        void this.onSignal(id, msg.data, true);
        break;
      case 'bye':
        this.dropLink(id, true);
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
    for (const l of this.links.values()) l.sendControl({ t: 'roster', members });
  }

  /**
   * Another member is connected to someone we are not (our connection to them dropped, or the welcome missed
   * them): connect. Only the smaller id starts, so both sides do not start at once.
   */
  private onRoster(list: unknown): void {
    if (!Array.isArray(list) || this.phase.peek() !== 'room') return;
    const now = Date.now();
    for (const m of list.slice(0, 16)) {
      if (!validInfo(m) || m.id === this.selfId) continue;
      if (this.links.has(m.id) || this.creating.has(m.id)) {
        this.missing.delete(m.id);
        continue;
      }
      // a newcomer connects to everyone itself: only step in when that clearly did not happen
      const since = this.missing.get(m.id) ?? now;
      this.missing.set(m.id, since);
      if (now - since < 8000 || this.selfId > m.id) continue;
      this.missing.delete(m.id);
      void this.link(m, true).then((l) => this.patchPeer(l.id, { quiet: true }));
    }
  }

  private onIncomingChat(m: ChatMessage): void {
    if (!this.chat.visible || document.hidden) {
      chime('message');
      bumpTitle();
      systemNotify(m.name, m.kind === 'file' ? `Sent ${m.file?.name}` : (m.text ?? ''), 'chat');
    }
  }

  // =========================================================================================== chat

  sendChat(text: string): void {
    const t = text.trim();
    if (!t) return;
    const me = this.self.peek();
    const m: ChatMessage = { id: newId(), from: this.selfId, name: me.name, role: me.role, ts: Date.now(), kind: 'text', text: t, mine: true };
    this.chat.add(m);
    for (const l of this.links.values()) l.sendControl({ t: 'chat', id: m.id, text: t, ts: m.ts });
    this.typingSentAt = 0;
  }

  typing(): void {
    const now = Date.now();
    if (now - this.typingSentAt < 2500) return;
    this.typingSentAt = now;
    for (const l of this.links.values()) l.sendControl({ t: 'typing' });
  }

  react(emoji: string): void {
    this.addReaction(this.selfId, emoji);
    for (const l of this.links.values()) l.sendControl({ t: 'react', emoji });
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
      toast({ kind: 'warn', title: 'File too large', body: 'Files up to 50 MB can be shared in the chat.' });
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
      file: { id: fid, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', url, progress: 0 },
      mine: true,
    });
    const links = [...this.links.values()].filter((l) => l.file.readyState === 'open');
    if (!links.length) {
      this.chat.updateFile(fid, { progress: 1 });
      return;
    }
    this.fileOutQueue = this.fileOutQueue.then(async () => {
      const meta = JSON.stringify({ t: 'file', id: fid, name: file.name, size: file.size, mime: file.type, ts: Date.now() });
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
            if (ch.bufferedAmount > 4 * 1024 * 1024) {
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
          name: peer?.info.name ?? 'Guest',
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
      [...this.links.values()].map(async (l) => [l.id, await l.stats()] as const),
    );
    batch(() => {
      for (const [id, st] of updates) if (st) this.patchPeer(id, { stats: st });
    });
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
