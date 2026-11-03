// The people in the lesson, one state machine each. Everything about one remote person lives in their record:
// the connection to them, its timers, and what to tell this side when it changes (they arrived, they left, the
// connection was lost). The session routes events here; this module decides; a small host does the effects.
//
//            open / offer                link open                    link repairing
//   (new) ─────────────────► connecting ───────────► connected ◄──────────────────► reconnecting
//                             │   ▲                    │  │                               │
//         never opened, lost  │   │ a new attempt      │  │ replaced (their reload, our    │ lost after it
//                             ▼   │ (hello, offer)     │  │ return from the background):   │ had worked
//                         unreachable                  │  │ same person, new link          ▼
//                      (forgotten after 2 min)         │  └──────────► connecting      (removed: "lost")
//                                                      └─ bye ───────► (removed: "left")
//
// Notices of departure wait LEAVE_NOTICE_MS: someone who reloads the page is back before then, and nothing is said.
// A person is announced once, the first time they introduce themselves; replacing their link keeps the record, so
// a reconnection never announces them again.
//
// No browser API is used here: links are created by the host, time comes from the host, so the whole lifecycle is
// tested with a fake clock and fake links (tests/unit/participants.test.ts).

import type { SoundMode } from '../media/constraints.ts';
import type { LinkState, LinkStats, SignalData } from '../net/peer.ts';
import { fingerprintOf } from '../net/peer.ts';
import type { MemberInfo } from '../net/room.ts';

/** a departure is announced after this, unless the person is back (a page reload takes a second or two) */
export const LEAVE_NOTICE_MS = 3000;
/** an unreachable person is forgotten after this without a new attempt */
export const FORGET_UNREACHABLE_MS = 120_000;
/** after this long in the background, connections are replaced at once rather than repaired */
export const RECONNECT_AFTER_AWAY_MS = 20_000;
/** someone the room says reloaded: how long their old place waits for their new connection */
const EXPECT_BACK_MS = 15_000;
/** a member others are connected to and we are not: how long before we connect to them ourselves */
const MISSING_GRACE_MS = 8000;

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

/** One person as the interface shows them. */
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
  /** attempts that never connected (their networks block a direct path): the tile explains and keeps trying */
  failures?: number;
}

/** What this module needs of a connection (PeerLink in the app, a fake in tests). */
export interface LinkLike {
  readonly id: string;
  readonly everConnected: boolean;
  readonly remoteFingerprint: string | null;
  /** connected and its control channel open */
  healthy(): boolean;
  receiveSignal(d: SignalData): Promise<void>;
  restartIce(): void;
  close(): void;
}

export type ParticipantState = 'connecting' | 'connected' | 'reconnecting' | 'unreachable';
export type Departure = 'left' | 'lost';

type Timer = unknown;

export interface ParticipantsHost<L extends LinkLike> {
  /** a new connection to `info` (wired to call linkState / lost / introduced on this module) */
  createLink(info: MemberInfo, initiator: boolean): Promise<L>;
  /** an offer from someone with no connection yet: may they come in (room rules)? */
  acceptOffer(from: string): boolean;
  /** a connection just opened: introduce ourselves on it */
  onConnected(link: L): void;
  /** someone introduced themselves for the first time */
  onJoined(view: PeerView): void;
  /** someone is gone for good (announced LEAVE_NOTICE_MS after they went, unless they came back) */
  onLeft(info: MemberInfo, how: Departure): void;
  /** release what this side held for them (their sound, notes they were holding) */
  onGone(id: string): void;
  /** the list the interface shows changed */
  publish(views: PeerView[]): void;
  now(): number;
  setTimer(fn: () => void, ms: number): Timer;
  clearTimer(t: Timer): void;
  log(...args: unknown[]): void;
}

interface Participant<L> {
  id: string;
  info: MemberInfo;
  state: ParticipantState;
  link: L | null;
  /** a connection being created (offers and signals arriving meanwhile wait for it) */
  creating: Promise<L> | null;
  /** they introduced themselves (and were announced) */
  introduced: boolean;
  quiet: boolean;
  failures: number;
  joinedAt: number;
  remote: RemoteState | null;
  audio: MediaStream | null;
  video: MediaStream | null;
  extra: MediaStream | null;
  stats: LinkStats | null;
  /** the unreachable record is forgotten / the reloaded person's place given up */
  timer: Timer | null;
}

export class Participants<L extends LinkLike> {
  private people = new Map<string, Participant<L>>();
  /** who the room let in, so an offer from them shows their name */
  private known = new Map<string, MemberInfo>();
  /** departures not announced yet */
  private leaving = new Map<string, Timer>();
  /** members others are connected to and we are not: first noticed */
  private missing = new Map<string, number>();

  constructor(
    private host: ParticipantsHost<L>,
    private selfId: () => string,
  ) {}

  // ----------------------------------------------------------------------------------------------- reading

  /** The current connections. */
  links(): L[] {
    const out: L[] = [];
    for (const p of this.people.values()) if (p.link) out.push(p.link);
    return out;
  }

  link(id: string): L | null {
    return this.people.get(id)?.link ?? null;
  }

  state(id: string): ParticipantState | null {
    return this.people.get(id)?.state ?? null;
  }

  /** People who introduced themselves and are connected (or repairing): they count as being in the room. */
  members(): MemberInfo[] {
    const out: MemberInfo[] = [];
    for (const p of this.people.values()) {
      if (p.introduced && (p.state === 'connected' || p.state === 'reconnecting')) out.push(p.info);
    }
    return out;
  }

  /** A first connection is being set up (the room holds back its beacons meanwhile). */
  busy(): boolean {
    for (const p of this.people.values()) if (p.state === 'connecting' && (p.link || p.creating)) return true;
    return false;
  }

  views(): PeerView[] {
    return [...this.people.values()].map((p) => ({
      id: p.id,
      info: p.info,
      link: p.state === 'unreachable' ? 'closed' : p.state,
      remote: p.remote,
      audio: p.audio,
      video: p.video,
      extra: p.extra,
      stats: p.stats,
      joinedAt: p.joinedAt,
      quiet: p.quiet || undefined,
      failures: p.failures || undefined,
    }));
  }

  private publish(): void {
    this.host.publish(this.views());
  }

  // ----------------------------------------------------------------------------------------------- room

  /** The room introduced someone (welcome, or admitting them): remember who they are. */
  remember(info: MemberInfo): void {
    if (info.id === this.selfId()) return;
    this.known.set(info.id, info);
    const p = this.people.get(info.id);
    if (p && p.info.name === '…') {
      p.info = info;
      this.publish();
    }
  }

  private stranger(id: string): MemberInfo {
    return this.known.get(id) ?? { id, name: '…', role: 'player', since: 0 };
  }

  /** Connect to `info` (once: a connection there or being made is reused). */
  open(info: MemberInfo, initiator: boolean, opts: { quiet?: boolean } = {}): Promise<L> {
    let p = this.people.get(info.id);
    if (p?.link) return Promise.resolve(p.link);
    if (p?.creating) return p.creating;
    if (!p) {
      p = {
        id: info.id,
        info,
        state: 'connecting',
        link: null,
        creating: null,
        introduced: false,
        quiet: !!opts.quiet,
        failures: 0,
        joinedAt: this.host.now(),
        remote: null,
        audio: null,
        video: null,
        extra: null,
        stats: null,
        timer: null,
      };
      this.people.set(info.id, p);
    } else {
      if (info.name !== '…') p.info = info;
      this.clearTimer(p);
      p.state = p.introduced ? 'reconnecting' : 'connecting';
    }
    this.missing.delete(info.id);
    const record = p;
    const creating = this.host.createLink(record.info, initiator).then((link) => {
      // given up meanwhile (they left, we left): this connection is not wanted any more
      if (this.people.get(record.id) !== record || record.creating !== creating) {
        link.close();
        return link;
      }
      record.link = link;
      record.creating = null;
      this.publish();
      return link;
    });
    record.creating = creating;
    this.publish();
    return creating;
  }

  /** A signal (offer, answer, candidate) from `from`, through the brokers or (viaLink) the direct channel. */
  async signal(from: string, d: SignalData, viaLink = false): Promise<void> {
    if (!d || typeof d !== 'object' || from === this.selfId()) return;
    const p = this.people.get(from);
    let link = p?.link ?? (p?.creating ? await p.creating : null);
    // an offer from a new connection of theirs (they reloaded, or gave up on the old one): the old one is dead
    if (link && p && d.description?.type === 'offer' && link.remoteFingerprint) {
      const fp = fingerprintOf(d.description.sdp);
      if (fp && fp !== link.remoteFingerprint) {
        this.host.log('new connection from', from.slice(0, 4), '(old one replaced)');
        this.replace(p, false);
        link = await this.open(p.info, false);
      }
    }
    if (!link) {
      // a newcomer's offer, if the room has room for them
      if (!d.description || d.description.type !== 'offer' || viaLink) return;
      if (!p || !p.introduced) {
        if (!this.host.acceptOffer(from)) {
          this.host.log('offer refused (room full)', from.slice(0, 4));
          return;
        }
      }
      link = await this.open(p?.info ?? this.stranger(from), false);
    }
    await link.receiveSignal(d);
  }

  /** Close a person's link to make a new one, keeping who they are (no notices). */
  private replace(p: Participant<L>, reconnect: boolean): void {
    const old = p.link;
    p.link = null;
    p.creating = null;
    old?.close();
    this.host.onGone(p.id);
    p.audio = p.video = p.extra = null;
    p.stats = null;
    p.state = p.introduced ? 'reconnecting' : 'connecting';
    if (reconnect) void this.open(p.info, true);
    else this.publish();
  }

  // ----------------------------------------------------------------------------------------------- links

  /** A link's state changed (events of a link that was replaced are ignored). */
  linkState(link: L, s: LinkState): void {
    const p = this.people.get(link.id);
    if (!p || p.link !== link) return;
    if (s === 'connected') {
      p.state = 'connected';
      p.failures = 0;
      p.quiet = false;
      this.clearTimer(p);
      this.publish();
      this.host.onConnected(link);
    } else if (s === 'reconnecting') {
      // still the first attempt: it keeps saying "connecting"
      if (!link.everConnected) return;
      p.state = 'reconnecting';
      this.publish();
    }
  }

  /** A link gave up (it never opened in time, or it was lost for good). */
  lost(link: L): void {
    const p = this.people.get(link.id);
    if (!p || p.link !== link) return;
    link.close();
    p.link = null;
    if (link.everConnected || p.introduced) {
      this.remove(p, 'lost');
      return;
    }
    if (p.quiet) {
      // a background repair attempt that did not work: nothing to show
      this.remove(p, null);
      return;
    }
    // never connected: their network and ours found no direct path. The person stays on screen with an
    // explanation; the room keeps trying (each side says hello again while alone), and the next attempt
    // continues this record rather than flashing back to a plain spinner.
    p.failures++;
    p.state = 'unreachable';
    this.host.log('no direct path to', p.id.slice(0, 4), `(attempt ${p.failures})`);
    this.setTimer(p, FORGET_UNREACHABLE_MS, () => {
      if (!p.link && !p.creating) this.remove(p, null);
    });
    this.publish();
  }

  /** They introduced themselves on their link (their name, role and what they send). */
  introduced(link: L, info: MemberInfo, remote: RemoteState): { first: boolean; before: RemoteState | null } {
    const p = this.people.get(link.id);
    if (!p || p.link !== link) return { first: false, before: null };
    const before = p.remote;
    const first = !p.introduced;
    p.info = info;
    p.remote = remote;
    p.introduced = true;
    this.known.set(info.id, info);
    this.publish();
    if (first) {
      const back = this.leaving.get(p.id);
      if (back !== undefined) {
        // the same person, back from a reload: as if nothing happened
        this.host.clearTimer(back);
        this.leaving.delete(p.id);
      } else {
        this.host.onJoined(this.views().find((v) => v.id === p.id)!);
      }
    }
    return { first, before };
  }

  /** Media, stats or other details of a person changed. */
  patch(id: string, data: Partial<Pick<PeerView, 'audio' | 'video' | 'extra' | 'stats'>>): void {
    const p = this.people.get(id);
    if (!p) return;
    Object.assign(p, data);
    this.publish();
  }

  /** Several stats at once (one change for the interface). */
  patchStats(updates: [string, LinkStats | null][]): void {
    let changed = false;
    for (const [id, st] of updates) {
      const p = this.people.get(id);
      if (p && st) {
        p.stats = st;
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  // ----------------------------------------------------------------------------------------------- departures

  /** They said goodbye. */
  bye(id: string): void {
    const p = this.people.get(id);
    if (p) this.remove(p, 'left');
  }

  /** The room says they reloaded their page: their old connection is dead, their new one is on its way. */
  expectBack(id: string): void {
    const p = this.people.get(id);
    if (!p || !p.link) return;
    this.replace(p, false);
    this.setTimer(p, EXPECT_BACK_MS, () => {
      if (!p.link && !p.creating) this.remove(p, p.introduced ? 'lost' : null);
    });
  }

  private remove(p: Participant<L>, how: Departure | null): void {
    if (this.people.get(p.id) !== p) return;
    this.clearTimer(p);
    p.link?.close();
    p.link = null;
    p.creating = null;
    this.people.delete(p.id);
    this.host.onGone(p.id);
    this.publish();
    if (how && p.introduced && !p.quiet) {
      const info = p.info;
      const prev = this.leaving.get(p.id);
      if (prev !== undefined) this.host.clearTimer(prev);
      this.leaving.set(
        p.id,
        this.host.setTimer(() => {
          this.leaving.delete(p.id);
          this.host.onLeft(info, how);
        }, LEAVE_NOTICE_MS),
      );
    }
  }

  // ----------------------------------------------------------------------------------------------- repairs

  /**
   * Back after `away` ms in the background. A short absence recovers by itself (ICE restart). After a long one,
   * the others have given up on our old connections and would not take them back: each person whose link is not
   * healthy gets a new one (at once after a long absence, after a few seconds otherwise), as the same person.
   */
  resume(away: number): void {
    if (away < 3000) return;
    const long = away >= RECONNECT_AFTER_AWAY_MS;
    for (const l of this.links()) l.restartIce();
    this.host.setTimer(
      () => {
        for (const p of [...this.people.values()]) {
          if (!p.link || p.link.healthy()) continue;
          this.host.log('fresh connection to', p.id.slice(0, 4), 'after the background');
          this.replace(p, true);
        }
      },
      long ? 300 : 4000,
    );
  }

  /** Someone else's list of who they are connected to: connect to members we miss (the smaller id starts). */
  roster(list: MemberInfo[]): void {
    const now = this.host.now();
    for (const m of list.slice(0, 16)) {
      if (m.id === this.selfId()) continue;
      const p = this.people.get(m.id);
      if (p && (p.link || p.creating)) {
        this.missing.delete(m.id);
        continue;
      }
      // a newcomer connects to everyone itself: only step in when that clearly did not happen
      const since = this.missing.get(m.id) ?? now;
      this.missing.set(m.id, since);
      if (now - since < MISSING_GRACE_MS || this.selfId() > m.id) continue;
      this.missing.delete(m.id);
      void this.open(m, true, { quiet: !p });
    }
  }

  /** Leave: every connection closed, nothing announced. */
  clear(): void {
    for (const p of this.people.values()) {
      this.clearTimer(p);
      p.link?.close();
      this.host.onGone(p.id);
    }
    this.people.clear();
    for (const t of this.leaving.values()) this.host.clearTimer(t);
    this.leaving.clear();
    this.missing.clear();
    this.known.clear();
    this.publish();
  }

  private setTimer(p: Participant<L>, ms: number, fn: () => void): void {
    this.clearTimer(p);
    p.timer = this.host.setTimer(() => {
      p.timer = null;
      fn();
    }, ms);
  }

  private clearTimer(p: Participant<L>): void {
    if (p.timer !== null) this.host.clearTimer(p.timer);
    p.timer = null;
  }
}
