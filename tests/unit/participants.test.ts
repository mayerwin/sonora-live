// The lifecycle of the people in a lesson, with a fake clock and fake connections: every case that broke in real
// lessons (a network with no direct path, a reload, a phone back from the background, a duplicate offer) runs here
// in milliseconds.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  FORGET_UNREACHABLE_MS,
  LEAVE_NOTICE_MS,
  Participants,
  type Departure,
  type LinkLike,
  type PeerView,
  type RemoteState,
} from '../../src/app/participants.ts';
import type { SignalData } from '../../src/net/peer.ts';
import type { MemberInfo } from '../../src/net/room.ts';

class FakeLink implements LinkLike {
  everConnected = false;
  remoteFingerprint: string | null = null;
  closed = false;
  ok = false;
  restarts = 0;
  received: SignalData[] = [];
  constructor(
    readonly id: string,
    readonly initiator: boolean,
  ) {}
  healthy(): boolean {
    return this.ok && !this.closed;
  }
  async receiveSignal(d: SignalData): Promise<void> {
    this.received.push(d);
    const fp = d.description?.sdp?.match(/a=fingerprint:(\S+ \S+)/)?.[1];
    if (fp) this.remoteFingerprint = fp;
  }
  restartIce(): void {
    this.restarts++;
  }
  close(): void {
    this.closed = true;
  }
}

const STATE: RemoteState = {
  mic: true,
  cam: true,
  extra: null,
  sound: 'pure',
  stereo: true,
  midi: { device: '', sending: false, receiving: true },
  away: false,
};

const info = (id: string, name = id): MemberInfo => ({ id, name, role: 'player', since: 1 });
const offer = (fp: string): SignalData => ({
  description: { type: 'offer', sdp: `v=0\r\na=fingerprint:sha-256 ${fp}\r\n` },
});

/** A lesson as seen from "me", with a clock that only moves when told. */
function world(opts: { accept?: boolean } = {}) {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextTimer = 1;
  const events: string[] = [];
  const links: FakeLink[] = [];
  let views: PeerView[] = [];
  const parts = new Participants<FakeLink>(
    {
      createLink: async (i, initiator) => {
        const l = new FakeLink(i.id, initiator);
        links.push(l);
        return l;
      },
      acceptOffer: () => opts.accept ?? true,
      onConnected: (l) => events.push(`connected ${l.id}`),
      onJoined: (v) => events.push(`joined ${v.info.name}`),
      onLeft: (i, how: Departure) => events.push(`${how} ${i.name}`),
      onGone: (id) => events.push(`gone ${id}`),
      publish: (v) => (views = v),
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn, id: nextTimer++ };
        timers.push(t);
        return t.id;
      },
      clearTimer: (id) => (timers = timers.filter((t) => t.id !== id)),
      log: () => {},
    },
    () => 'me',
  );
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
      await Promise.resolve();
    }
    now = end;
    await flush();
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  /** the link opens, and they introduce themselves */
  const connect = async (l: FakeLink, name = l.id) => {
    // a real link knows the other side's fingerprint once negotiated (from their offer or their answer)
    l.remoteFingerprint ??= `answer-${l.id}`;
    l.everConnected = true;
    l.ok = true;
    parts.linkState(l, 'connected');
    parts.introduced(l, info(l.id, name), STATE);
  };
  return { parts, events, links, views: () => views, advance, flush, connect, last: () => links[links.length - 1] };
}

describe('the people in a lesson', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('connects, announces once, and says goodbye once, a moment later', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    expect(w.views()[0].link).toBe('connecting');
    await w.connect(w.last(), 'Leo');
    expect(w.views()[0].link).toBe('connected');
    expect(w.events.filter((e) => e.startsWith('joined'))).toEqual(['joined Leo']);
    // introducing again (a state update) is not a new arrival
    w.parts.introduced(w.last(), info('leo', 'Leo'), STATE);
    expect(w.events.filter((e) => e.startsWith('joined'))).toHaveLength(1);
    w.parts.bye('leo');
    expect(w.views()).toEqual([]);
    expect(w.events).not.toContain('left Leo');
    await w.advance(LEAVE_NOTICE_MS);
    expect(w.events.filter((e) => e === 'left Leo')).toHaveLength(1);
  });

  it('opens one connection, however many offers and opens arrive while it is being made', async () => {
    const a = w.parts.open(info('leo'), false);
    const b = w.parts.signal('leo', offer('AA'));
    const c = w.parts.open(info('leo'), true);
    await Promise.all([a, b, c]);
    expect(w.links).toHaveLength(1);
    expect(w.last().received).toHaveLength(1);
  });

  it('a network with no direct path: a steady "unreachable" person, kept through retries, then connected', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    const first = w.last();
    w.parts.lost(first);
    expect(w.views()[0]).toMatchObject({ link: 'closed', failures: 1 });
    expect(w.events.some((e) => e.startsWith('lost') || e.startsWith('left'))).toBe(false);
    // the room tries again (their hello, their offer): same person, still explained
    await w.parts.signal('leo', offer('BB'));
    expect(w.links).toHaveLength(2);
    expect(w.views()[0]).toMatchObject({ link: 'connecting', failures: 1 });
    w.parts.lost(w.last());
    expect(w.views()[0].failures).toBe(2);
    // the network allows it now
    await w.parts.signal('leo', offer('CC'));
    await w.connect(w.last(), 'Leo');
    expect(w.views()[0]).toMatchObject({ link: 'connected' });
    expect(w.views()[0].failures).toBeUndefined();
    expect(w.events.filter((e) => e.startsWith('joined'))).toEqual(['joined Leo']);
  });

  it('forgets an unreachable person after a while without attempts, silently', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    w.parts.lost(w.last());
    await w.advance(FORGET_UNREACHABLE_MS - 1);
    expect(w.views()).toHaveLength(1);
    await w.advance(1);
    expect(w.views()).toHaveLength(0);
    expect(w.events.some((e) => e.startsWith('lost') || e.startsWith('left'))).toBe(false);
  });

  it('a reload (goodbye, then a new connection within seconds) says nothing at all', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    await w.connect(w.last(), 'Leo');
    w.events.length = 0;
    w.parts.bye('leo');
    await w.advance(1600);
    await w.parts.signal('leo', offer('NEW'));
    await w.connect(w.last(), 'Leo');
    await w.advance(LEAVE_NOTICE_MS * 2);
    expect(w.events.filter((e) => /^(joined|left|lost)/.test(e))).toEqual([]);
  });

  it('their new connection (a new fingerprint) replaces the old one: same person, no notice', async () => {
    await w.parts.signal('leo', offer('OLD'));
    const old = w.last();
    await w.connect(old, 'Leo');
    w.events.length = 0;
    await w.parts.signal('leo', offer('NEW'));
    expect(old.closed).toBe(true);
    expect(w.links).toHaveLength(2);
    expect(w.views()[0].link).toBe('reconnecting');
    await w.connect(w.last(), 'Leo');
    expect(w.views()).toHaveLength(1);
    expect(w.events.filter((e) => /^(joined|left|lost)/.test(e))).toEqual([]);
    // the old link's late events change nothing
    w.parts.lost(old);
    w.parts.linkState(old, 'reconnecting');
    expect(w.views()[0].link).toBe('connected');
  });

  it('the same offer again (a duplicate through both paths) does not replace anything', async () => {
    await w.parts.signal('leo', offer('SAME'));
    await w.connect(w.last());
    await w.parts.signal('leo', offer('SAME'));
    expect(w.links).toHaveLength(1);
  });

  it('back from a long time in the background: dead connections replaced at once, as the same people', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    const old = w.last();
    await w.connect(old, 'Leo');
    w.events.length = 0;
    old.ok = false; // it died while the phone slept
    w.parts.resume(90_000);
    expect(old.restarts).toBe(1);
    await w.advance(300);
    expect(old.closed).toBe(true);
    const fresh = w.last();
    expect(fresh).not.toBe(old);
    expect(fresh.initiator).toBe(true);
    await w.connect(fresh, 'Leo');
    expect(w.events.filter((e) => /^(joined|left|lost)/.test(e))).toEqual([]);
  });

  it('back after a short absence: a healthy connection is left alone', async () => {
    await w.parts.open(info('leo'), true);
    await w.connect(w.last());
    w.parts.resume(5000);
    await w.advance(5000);
    expect(w.links).toHaveLength(1);
  });

  it('a connection that worked and is then lost for good is announced as lost, once', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    await w.connect(w.last(), 'Leo');
    w.parts.linkState(w.last(), 'reconnecting');
    expect(w.views()[0].link).toBe('reconnecting');
    w.parts.lost(w.last());
    expect(w.views()).toHaveLength(0);
    await w.advance(LEAVE_NOTICE_MS);
    expect(w.events.filter((e) => e === 'lost Leo')).toHaveLength(1);
  });

  it('the first attempt repairing itself still reads "connecting", not "reconnecting"', async () => {
    await w.parts.open(info('leo'), true);
    w.parts.linkState(w.last(), 'reconnecting');
    expect(w.views()[0].link).toBe('connecting');
  });

  it('a full room refuses a stranger’s offer, but not one from someone already in', async () => {
    const full = world({ accept: false });
    await full.parts.signal('stranger', offer('X'));
    expect(full.links).toHaveLength(0);
    await full.parts.open(info('leo'), true);
    await full.connect(full.last());
    await full.parts.signal('leo', offer('NEW'));
    expect(full.links).toHaveLength(2);
  });

  it('a page reload the room detects: the old place waits for the new connection, then gives up', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    await w.connect(w.last(), 'Leo');
    w.events.length = 0;
    w.parts.expectBack('leo');
    expect(w.views()[0].link).toBe('reconnecting');
    await w.advance(15_000);
    expect(w.views()).toHaveLength(0);
    await w.advance(LEAVE_NOTICE_MS);
    expect(w.events.filter((e) => e === 'lost Leo')).toHaveLength(1);
  });

  it('roster repair: a member we miss is connected quietly, after a grace period, by the smaller id only', async () => {
    w.parts.roster([info('zed')]);
    expect(w.links).toHaveLength(0);
    await w.advance(8000);
    w.parts.roster([info('zed')]);
    await w.flush();
    expect(w.links).toHaveLength(1); // 'me' < 'zed': we start
    expect(w.views()[0].quiet).toBe(true);
    // a quiet attempt that fails leaves nothing behind
    w.parts.lost(w.last());
    expect(w.views()).toHaveLength(0);
    // the other way round, they start
    w.parts.roster([info('abe')]);
    await w.advance(8000);
    w.parts.roster([info('abe')]);
    await w.flush();
    expect(w.links).toHaveLength(1);
  });

  it('leaving closes everything and announces nothing, even what was pending', async () => {
    await w.parts.open(info('leo', 'Leo'), true);
    await w.connect(w.last(), 'Leo');
    await w.parts.open(info('mia', 'Mia'), true);
    w.parts.bye('mia');
    w.parts.clear();
    await w.advance(LEAVE_NOTICE_MS * 2);
    expect(w.links.every((l) => l.closed)).toBe(true);
    expect(w.views()).toEqual([]);
    expect(w.events.filter((e) => /^(left|lost)/.test(e))).toEqual([]);
  });

  it('a connection that arrives after the person was given up is closed at once', async () => {
    let resolve!: (l: FakeLink) => void;
    const slow = new Participants<FakeLink>(
      {
        createLink: () => new Promise((r) => (resolve = r)),
        acceptOffer: () => true,
        onConnected: () => {},
        onJoined: () => {},
        onLeft: () => {},
        onGone: () => {},
        publish: () => {},
        now: () => 0,
        setTimer: () => 0,
        clearTimer: () => {},
        log: () => {},
      },
      () => 'me',
    );
    const p = slow.open(info('leo'), true);
    slow.clear();
    const l = new FakeLink('leo', true);
    resolve(l);
    await p;
    expect(l.closed).toBe(true);
    expect(slow.links()).toEqual([]);
  });
});
