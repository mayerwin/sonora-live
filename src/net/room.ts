// Rendezvous: the browsers of a lesson meet under a 6-character room code on a relay (src/net/relay.ts), then
// connect directly with WebRTC (src/net/peer.ts). The relay only carries this handshake, end-to-end encrypted
// with a key derived from the room code: the brokers see random topic names and opaque bytes.
//
// There is no host. A room exists while someone is in it; the member who has been there longest (the leader)
// answers newcomers, so the room survives anyone leaving or reloading.
//
// Messages on the room topic (JSON {v, mid, from, t, ...}):
//   hello   {info, joining, alone}   "let me in" (repeated until answered). Members who are alone repeat it
//                                    slowly too, so two people who opened the same empty room at the same
//                                    moment find each other (the one who came first stays).
//   welcome {to, members, policy}    leader -> newcomer: who to connect to, and the room's rules
//   deny    {to, reason, policy}     leader -> newcomer: 'full' (the room is locked) or 'version'
//   sig     {to, data}               WebRTC offer / answer / ICE candidate for one peer
//   bye     {}                       leaving

import type { Relay } from './relay.ts';

export const ROOM_PROTOCOL = 1;

export type Role = 'student' | 'teacher' | 'observer';

export interface MemberInfo {
  /** random per browser tab (kept across reloads of the tab) */
  id: string;
  name: string;
  role: Role;
  /** when it entered the room (its own clock, ms): the earliest member leads */
  since: number;
}

export interface Policy {
  /** limit the room to `limit` people */
  locked: boolean;
  limit: number;
  /** version: the highest wins when members disagree (ties: the larger author id) */
  ver: number;
  by: string;
}

export type DenyReason = 'full' | 'version';

export type RoomPhase = 'idle' | 'joining' | 'knocking' | 'in';

export interface RoomHooks {
  /** members connected to this browser right now, this one included */
  members(): MemberInfo[];
  /** connections being set up (no beacons while busy) */
  busy(): boolean;
  policy(): Policy;
  /** admitted: connect to these members (all but `self`) and adopt the policy */
  onWelcome(members: MemberInfo[], policy: Policy): void;
  onDeny(reason: DenyReason, policy: Policy): void;
  /** nobody answered: this browser founds the room */
  onFounded(): void;
  /** the leader admitted `info` (seen by every member; `again`: it was already a member, e.g. it reloaded) */
  onAdmitted(info: MemberInfo, again: boolean): void;
  /** someone was refused because the room is full (shown as a knock on the door) */
  onKnock(info: MemberInfo): void;
  onSignal(from: string, data: unknown): void;
  onBye(from: string): void;
}

const HELLO_EVERY_MS = 900;
const KNOCK_EVERY_MS = 2500;
const BEACON_EVERY_MS = 3000;
/** how long a newcomer waits for an answer before founding the room itself */
export const JOIN_WAIT_MS = 3200;
/** an admitted newcomer counts toward the limit for this long, until it is connected */
const PENDING_MS = 20_000;

/** Topic of a room: a hash of the code (FNV-1a, 64 bits as two lanes), so brokers never see the code. */
export function roomTopic(code: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (const ch of `sonora-live:${code}`) {
    const c = ch.charCodeAt(0);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b ^ c, 0x01000193) ^ (a >>> 7)) >>> 0;
  }
  return `sonora-live/${ROOM_PROTOCOL}/${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function roomKey(code: string): Promise<CryptoKey | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // plain-http pages other than localhost have no Web Crypto
  const base = await subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('sonora-live-room-v1'), iterations: 20_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** a before b: who came first leads (ties broken by id) */
export function earlier(a: Pick<MemberInfo, 'since' | 'id'>, b: Pick<MemberInfo, 'since' | 'id'>): boolean {
  return a.since !== b.since ? a.since < b.since : a.id < b.id;
}

export function leaderOf(members: MemberInfo[]): MemberInfo | undefined {
  let best: MemberInfo | undefined;
  for (const m of members) if (!best || earlier(m, best)) best = m;
  return best;
}

export function newPeerId(): string {
  const r = new Uint8Array(9);
  crypto.getRandomValues(r);
  return Array.from(r, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

type Msg = Record<string, unknown> & { t: string; from: string; mid: string; v: number };

export class Room {
  self: MemberInfo;
  code = '';
  phase: RoomPhase = 'idle';
  private relay: Relay;
  private hooks: RoomHooks;
  private topic = '';
  private key: CryptoKey | null = null;
  private unsub: (() => void) | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** admitted newcomers not connected yet (id -> admitted at) */
  private pending = new Map<string, number>();
  private lastKnock = new Map<string, number>();

  constructor(relay: Relay, self: MemberInfo, hooks: RoomHooks) {
    this.relay = relay;
    this.self = self;
    this.hooks = hooks;
  }

  /**
   * Enter room `code`. `fresh`: the code was just generated here, nobody can be inside, so this browser founds it
   * at once (it still announces itself, in case).
   */
  async enter(code: string, fresh: boolean): Promise<void> {
    this.leave(false);
    this.code = code;
    this.topic = roomTopic(code);
    this.key = await roomKey(code);
    this.self = { ...this.self, since: Date.now() };
    this.unsub = this.relay.subscribe(this.topic, (d) => void this.receive(d));
    if (fresh) {
      this.found();
      return;
    }
    this.phase = 'joining';
    this.hello();
    this.every(HELLO_EVERY_MS, () => this.phase === 'joining' && this.hello());
    this.after(JOIN_WAIT_MS, () => {
      if (this.phase === 'joining') this.found();
    });
  }

  private found(): void {
    this.clearTimers();
    this.phase = 'in';
    this.hooks.onFounded();
    this.startBeacon();
  }

  private startBeacon(): void {
    this.hello();
    this.every(BEACON_EVERY_MS, () => {
      if (this.phase === 'in' && this.alone() && !this.hooks.busy()) this.hello();
    });
  }

  private alone(): boolean {
    return this.hooks.members().length <= 1;
  }

  private hello(): void {
    const joining = this.phase !== 'in';
    this.post({ t: 'hello', info: this.self, joining, alone: joining || this.alone() });
  }

  /** Update what this browser tells others about itself (name / role changes before joining). */
  setSelf(info: Partial<MemberInfo>): void {
    this.self = { ...this.self, ...info };
  }

  /** WebRTC signaling for peer `to` (through the relay). */
  signal(to: string, data: unknown, mid?: string): void {
    this.post({ t: 'sig', to, data }, mid);
  }

  /** The newcomer `id` is now connected (it no longer counts as pending). */
  connected(id: string): void {
    this.pending.delete(id);
  }

  /** Leave the room (the others are told when `sayBye`). The relay connection stays open. */
  leave(sayBye = true): void {
    if (this.unsub) {
      if (sayBye) this.post({ t: 'bye' });
      this.unsub();
    }
    this.unsub = null;
    this.clearTimers();
    this.pending.clear();
    this.phase = 'idle';
  }

  get isLeader(): boolean {
    return leaderOf(this.hooks.members())?.id === this.self.id;
  }

  /** members plus admitted newcomers still connecting */
  private headcount(): number {
    const now = Date.now();
    const ids = new Set(this.hooks.members().map((m) => m.id));
    for (const [id, at] of this.pending) {
      if (now - at > PENDING_MS) this.pending.delete(id);
      else ids.add(id);
    }
    return ids.size;
  }

  // ----------------------------------------------------------------------------------------------- receive

  private async receive(d: Uint8Array): Promise<void> {
    const m = await this.open(d);
    if (!m) return;
    const from = m.from;
    if (!from || from === this.self.id || !this.remember(m.mid)) return;
    const toMe = m.to === this.self.id;
    switch (m.t) {
      case 'hello':
        this.onHello(m);
        break;
      case 'welcome': {
        const to = String(m.to ?? '');
        const members = Array.isArray(m.members) ? (m.members as MemberInfo[]).filter(validInfo) : [];
        const policy = validPolicy(m.policy);
        if (toMe) {
          // admitted (or, while alone in a room, merged into an existing group)
          if (!policy) return;
          if (this.phase === 'joining' || this.phase === 'knocking' || (this.phase === 'in' && this.alone())) {
            this.clearTimers();
            this.phase = 'in';
            this.hooks.onWelcome(members, policy);
            this.startBeacon();
          }
        } else if (to) {
          // another newcomer was let in: count it, and accept its connection
          const info = members.find((x) => x.id === to) ?? null;
          const again = this.hooks.members().some((x) => x.id === to);
          this.pending.set(to, Date.now());
          if (info && this.phase === 'in') this.hooks.onAdmitted(info, again);
        }
        break;
      }
      case 'deny':
        if (toMe && (this.phase === 'joining' || this.phase === 'knocking')) {
          const reason: DenyReason = m.reason === 'version' ? 'version' : 'full';
          const policy = validPolicy(m.policy);
          this.clearTimers();
          this.phase = 'knocking';
          if (policy) this.hooks.onDeny(reason, policy);
          if (reason === 'full') {
            // keep knocking: the members see it and can let us in
            this.every(KNOCK_EVERY_MS, () => this.phase === 'knocking' && this.hello());
          }
        }
        break;
      case 'sig':
        if (toMe) this.hooks.onSignal(from, m.data);
        break;
      case 'bye':
        this.pending.delete(from);
        this.hooks.onBye(from);
        break;
    }
  }

  private onHello(m: Msg): void {
    if (this.phase !== 'in') return;
    const info = m.info as MemberInfo;
    if (!validInfo(info) || info.id !== m.from) return;
    const members = this.hooks.members();
    const isMember = members.some((x) => x.id === info.id);
    const policy = this.hooks.policy();
    const full = policy.locked && this.headcount() >= policy.limit && !isMember && !this.pending.has(info.id);
    if (!this.isLeader) {
      if (full) this.knock(info);
      return;
    }
    if (m.v !== ROOM_PROTOCOL) {
      this.post({ t: 'deny', to: info.id, reason: 'version', policy });
      return;
    }
    // two people alone in the same room: the one who came first welcomes the other
    if (!isMember && !m.joining && m.alone && this.alone() && earlier(info, this.self)) return;
    if (full) {
      this.post({ t: 'deny', to: info.id, reason: 'full', policy });
      this.knock(info);
      return;
    }
    const list = members.map((x) => (x.id === this.self.id ? this.self : x)).filter((x) => x.id !== info.id);
    this.pending.set(info.id, Date.now());
    this.post({ t: 'welcome', to: info.id, members: [...list, info], policy });
    this.hooks.onAdmitted(info, isMember);
  }

  private knock(info: MemberInfo): void {
    const now = Date.now();
    if (now - (this.lastKnock.get(info.id) ?? 0) < 8000) return;
    this.lastKnock.set(info.id, now);
    this.hooks.onKnock(info);
  }

  // ----------------------------------------------------------------------------------------------- transport

  private post(m: Record<string, unknown>, mid = Math.random().toString(36).slice(2, 12)): void {
    if (!this.topic) return;
    this.remember(mid);
    const topic = this.topic;
    const key = this.key;
    const body = enc.encode(JSON.stringify({ v: ROOM_PROTOCOL, mid, from: this.self.id, ...m }));
    void (async () => {
      let out: Uint8Array;
      if (key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
        out = new Uint8Array(1 + 12 + ct.length);
        out[0] = 1;
        out.set(iv, 1);
        out.set(ct, 13);
      } else {
        out = new Uint8Array(1 + body.length);
        out[0] = 0;
        out.set(body, 1);
      }
      this.relay.publish(topic, out);
    })();
  }

  private async open(d: Uint8Array): Promise<Msg | null> {
    let text: string;
    try {
      if (d[0] === 1) {
        if (!this.key) return null;
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.slice(1, 13) }, this.key, d.slice(13));
        text = dec.decode(plain);
      } else if (d[0] === 0 && !this.key) {
        text = dec.decode(d.subarray(1));
      } else {
        return null;
      }
      const m = JSON.parse(text);
      if (!m || typeof m !== 'object' || typeof m.t !== 'string' || typeof m.mid !== 'string') return null;
      m.from = String(m.from ?? '');
      if (m.to !== undefined) m.to = String(m.to);
      return m as Msg;
    } catch {
      return null; // another room's message on a colliding topic, or garbage
    }
  }

  /** Remember a message id (the same message arrives once per broker); false if already seen. */
  remember(mid: string): boolean {
    if (this.seen.has(mid)) return false;
    this.seen.add(mid);
    this.seenOrder.push(mid);
    if (this.seenOrder.length > 4000) this.seen.delete(this.seenOrder.shift()!);
    return true;
  }

  private every(ms: number, fn: () => void): void {
    this.timers.push(setInterval(fn, ms));
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    this.timers = [];
  }

  close(): void {
    this.leave();
  }
}

const ROLES = new Set(['student', 'teacher', 'observer']);

export function validInfo(x: unknown): x is MemberInfo {
  const m = x as MemberInfo;
  return (
    !!m &&
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    m.id.length < 40 &&
    typeof m.name === 'string' &&
    ROLES.has(m.role) &&
    typeof m.since === 'number'
  );
}

export function validPolicy(x: unknown): Policy | null {
  const p = x as Policy;
  if (!p || typeof p.locked !== 'boolean' || typeof p.limit !== 'number' || typeof p.ver !== 'number') return null;
  return { locked: p.locked, limit: Math.max(2, Math.min(12, Math.round(p.limit))), ver: p.ver, by: String(p.by ?? '') };
}

/** Which of two policies wins (the most recent change). */
export function newerPolicy(a: Policy, b: Policy): Policy {
  if (a.ver !== b.ver) return a.ver > b.ver ? a : b;
  return a.by >= b.by ? a : b;
}
