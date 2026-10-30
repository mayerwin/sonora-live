import { describe, expect, it } from 'vitest';
import { MemoryRelay } from '../../src/net/relay.ts';
import { JOIN_WAIT_MS, newPeerId, Room, type MemberInfo, type Policy } from '../../src/net/room.ts';
import { newRoomCode } from '../../src/net/code.ts';

const all = new Map<string, Member>();

/** A browser in a room; "connecting" two members is instant here (the WebRTC part is tested in the browser). */
class Member {
  room: Room;
  peers = new Map<string, MemberInfo>();
  policy: Policy;
  knocks: string[] = [];
  denied: string | null = null;
  admittedAgain: string[] = [];

  constructor(name: string, id = newPeerId(), limit = 2) {
    this.policy = { locked: true, limit, ver: 0, by: id };
    this.room = new Room(new MemoryRelay(), { id, name, role: 'student', since: 0 }, {
      members: () => [this.room.self, ...this.peers.values()],
      busy: () => false,
      policy: () => this.policy,
      onWelcome: (members, policy) => {
        this.policy = policy;
        this.denied = null;
        for (const m of members) if (m.id !== this.id) link(this, all.get(m.id)!);
      },
      onDeny: (reason) => (this.denied = reason),
      onFounded: () => {},
      onAdmitted: (info, again) => {
        if (again) this.admittedAgain.push(info.id);
      },
      onKnock: (info) => this.knocks.push(info.name),
      onSignal: () => {},
      onBye: (from) => this.peers.delete(from),
    });
    all.set(id, this);
  }

  get id(): string {
    return this.room.self.id;
  }
}

function link(a: Member, b: Member): void {
  if (!b) return;
  a.peers.set(b.id, b.room.self);
  b.peers.set(a.id, a.room.self);
  a.room.connected(b.id);
  b.room.connected(a.id);
}

const until = async (cond: () => boolean, ms = 12_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('room rendezvous', () => {
  it('a newcomer is welcomed by the founder and connects', async () => {
    const code = newRoomCode();
    const a = new Member('Ana');
    const b = new Member('Ben');
    await a.room.enter(code, true);
    await b.room.enter(code, false);
    await until(() => b.peers.has(a.id) && a.peers.has(b.id));
    expect(b.room.phase).toBe('in');
    a.room.leave();
    b.room.leave();
  });

  it('a normal join is admitted once, never mistaken for a reload', async () => {
    const code = newRoomCode();
    const a = new Member('Ana');
    const b = new Member('Ben');
    let welcomes = 0;
    const orig = b.room['hooks'].onWelcome;
    b.room['hooks'].onWelcome = (m, p) => {
      welcomes++;
      orig(m, p);
    };
    await a.room.enter(code, true);
    await b.room.enter(code, false);
    await until(() => a.peers.has(b.id));
    await new Promise((r) => setTimeout(r, 3500)); // a beacon period
    expect(welcomes).toBe(1);
    expect(a.admittedAgain).toEqual([]);
    a.room.leave();
    b.room.leave();
  });

  it('a locked room refuses a third person, who knocks and can be let in', async () => {
    const code = newRoomCode();
    const a = new Member('Ana');
    const b = new Member('Ben');
    const c = new Member('Cleo');
    await a.room.enter(code, true);
    await b.room.enter(code, false);
    await until(() => a.peers.size === 1);
    await c.room.enter(code, false);
    await until(() => c.denied === 'full' && a.knocks.includes('Cleo'));
    expect(b.knocks).toContain('Cleo'); // every member sees the knock
    expect(c.peers.size).toBe(0);
    // let in: the room grows by one, the knocker's next hello is welcomed
    a.policy = { locked: true, limit: 3, ver: 1, by: a.id };
    b.policy = a.policy;
    await until(() => c.peers.size === 2);
    expect(c.room.phase).toBe('in');
    for (const m of [a, b, c]) m.room.leave();
  }, 20_000);

  it('two people opening the same empty room at once end up together', async () => {
    const code = newRoomCode();
    const a = new Member('Ana');
    const b = new Member('Ben');
    await Promise.all([a.room.enter(code, false), b.room.enter(code, false)]);
    await until(() => a.peers.has(b.id) && b.peers.has(a.id), JOIN_WAIT_MS + 8000);
    a.room.leave();
    b.room.leave();
  }, 20_000);

  it('someone who reloads the page gets back in, even when the room is full', async () => {
    const code = newRoomCode();
    const a = new Member('Ana');
    const b = new Member('Ben');
    await a.room.enter(code, true);
    await b.room.enter(code, false);
    await until(() => a.peers.size === 1);
    // Ben's tab reloads: same id, new page
    b.room.leave(false);
    const b2 = new Member('Ben', b.id);
    await b2.room.enter(code, false);
    await until(() => a.admittedAgain.includes(b.id) && b2.room.phase === 'in');
    expect(b2.denied).toBeNull();
    a.room.leave();
    b2.room.leave();
  });

  it('messages from another room never get in (wrong key)', async () => {
    const a = new Member('Ana');
    const b = new Member('Ben');
    await a.room.enter(newRoomCode(), true);
    await b.room.enter(newRoomCode(), false);
    await new Promise((r) => setTimeout(r, JOIN_WAIT_MS + 300));
    expect(a.peers.size).toBe(0);
    expect(b.peers.size).toBe(0);
    a.room.leave();
    b.room.leave();
  }, 10_000);
});
