// A network simulator for testing: a minimal TURN relay (RFC 8656, UDP) that delays, jitters and drops each
// client's packets as its username says. Browsers forced through it (`?nodirect`, and this server as their TURN
// server) carry everything over it: sound, video, MIDI and the data channels, as on a real long-distance link.
//
//   username  sim-<up>-<down>[-<jitter>[-<loss>]]   ms from the client to the relay, ms back, ± ms, % lost
//
// Between two browsers the one-way delay is the sender's <up> plus the receiver's <down>: `sim-50-50` on both sides
// is 100 ms each way (200 ms round trip). Jitter delays each packet by up to that much more, in order (as a
// network queue does). The password is always `sim` (browsers check the relay's answers are signed with it);
// nothing else is checked: it is a test tool, listening on loopback by default.
//
//   node server/netsim.ts [port]       or, in tests, startNetsim() (tests/e2e/netsim.ts)
//
// Then in the app: Settings → Connection → TURN `turn:127.0.0.1:3479`, username `sim-100-100`, password `sim`, and
// open the page with `?nodirect`.

import { createHash, createHmac } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { crc32 } from 'node:zlib';

const MAGIC = 0x2112a442;
const REALM = 'sonora-netsim';
const PASSWORD = 'sim';

const M = {
  Binding: 0x001,
  Allocate: 0x003,
  Refresh: 0x004,
  Send: 0x006,
  Data: 0x007,
  CreatePermission: 0x008,
  ChannelBind: 0x009,
} as const;
const C = {
  Request: 0x0000,
  Indication: 0x0010,
  Success: 0x0100,
  Error: 0x0110,
} as const;
const A = {
  Username: 0x0006,
  MessageIntegrity: 0x0008,
  ErrorCode: 0x0009,
  ChannelNumber: 0x000c,
  Lifetime: 0x000d,
  XorPeerAddress: 0x0012,
  Data: 0x0013,
  Realm: 0x0014,
  Nonce: 0x0015,
  XorRelayedAddress: 0x0016,
  XorMappedAddress: 0x0020,
  Software: 0x8022,
  Fingerprint: 0x8028,
} as const;

export interface LinkProfile {
  /** ms from the client to the relay */
  up: number;
  /** ms from the relay to the client */
  down: number;
  /** up to this many ms more, per packet */
  jitter: number;
  /** share of packets lost, 0..1 */
  loss: number;
}

/** The link a username asks for (`sim-<up>-<down>[-<jitter>[-<loss %>]]`); no delay for any other name. */
export function profileOf(username: string): LinkProfile {
  const m = /^sim-(\d+)-(\d+)(?:-(\d+))?(?:-(\d+(?:\.\d+)?))?$/.exec(username);
  if (!m) return { up: 0, down: 0, jitter: 0, loss: 0 };
  return { up: +m[1], down: +m[2], jitter: +(m[3] ?? 0), loss: +(m[4] ?? 0) / 100 };
}

/** The username for a link profile. */
export function usernameOf(p: Partial<LinkProfile>): string {
  return `sim-${p.up ?? 0}-${p.down ?? 0}-${p.jitter ?? 0}-${(p.loss ?? 0) * 100}`;
}

interface Attr {
  type: number;
  value: Buffer;
}

interface Msg {
  method: number;
  cls: number;
  tid: Buffer;
  attrs: Attr[];
}

function parse(b: Buffer): Msg | null {
  if (b.length < 20 || b[0] >> 6 !== 0 || b.readUInt32BE(4) !== MAGIC) return null;
  const type = b.readUInt16BE(0);
  const len = b.readUInt16BE(2);
  if (20 + len > b.length) return null;
  const method = (type & 0x000f) | ((type & 0x00e0) >> 1) | ((type & 0x3e00) >> 2);
  const cls = type & 0x0110;
  const attrs: Attr[] = [];
  for (let o = 20; o + 4 <= 20 + len; ) {
    const t = b.readUInt16BE(o);
    const l = b.readUInt16BE(o + 2);
    attrs.push({ type: t, value: b.subarray(o + 4, o + 4 + l) });
    o += 4 + Math.ceil(l / 4) * 4;
  }
  return { method, cls, tid: b.subarray(8, 20), attrs };
}

const attr = (m: Msg, t: number) => m.attrs.find((a) => a.type === t)?.value;

function encodeType(method: number, cls: number): number {
  return (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | cls;
}

function xorAddress(ip: string, port: number, tid: Buffer): Buffer {
  const v = Buffer.alloc(8);
  v[1] = 0x01; // IPv4
  v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const parts = ip.split('.').map(Number);
  const a = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  v.writeUInt32BE((a ^ MAGIC) >>> 0, 4);
  void tid;
  return v;
}

function readXorAddress(v: Buffer): { address: string; port: number } | null {
  if (v.length < 8 || v[1] !== 0x01) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const a = (v.readUInt32BE(4) ^ MAGIC) >>> 0;
  return { address: [a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255].join('.'), port };
}

/** A STUN message; with `key`, MESSAGE-INTEGRITY and FINGERPRINT are added. */
function build(method: number, cls: number, tid: Buffer, attrs: Attr[], key?: Buffer): Buffer {
  const body = (list: Attr[]) =>
    Buffer.concat(
      list.map((a) => {
        const h = Buffer.alloc(4);
        h.writeUInt16BE(a.type, 0);
        h.writeUInt16BE(a.value.length, 2);
        return Buffer.concat([h, a.value, Buffer.alloc((4 - (a.value.length % 4)) % 4)]);
      }),
    );
  const header = (len: number) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(encodeType(method, cls), 0);
    h.writeUInt16BE(len, 2);
    h.writeUInt32BE(MAGIC, 4);
    tid.copy(h, 8);
    return h;
  };
  let msg = Buffer.concat([header(0), body(attrs)]);
  if (key) {
    const len = msg.length - 20 + 24;
    msg.writeUInt16BE(len, 2);
    const mi = createHmac('sha1', key).update(msg).digest();
    msg = Buffer.concat([msg, body([{ type: A.MessageIntegrity, value: mi }])]);
  }
  msg.writeUInt16BE(msg.length - 20 + 8, 2);
  const fp = Buffer.alloc(4);
  fp.writeUInt32BE((crc32(msg) ^ 0x5354554e) >>> 0, 0);
  msg = Buffer.concat([msg, body([{ type: A.Fingerprint, value: fp }])]);
  return msg;
}

/** A send on a socket that may have closed meanwhile (an allocation released while packets were delayed). */
function send(sock: Socket, b: Buffer, port: number, address: string): void {
  try {
    sock.send(b, port, address);
  } catch {
    // closed
  }
}

/** Room for bursts (a file over a data channel): a full socket buffer would drop packets the network did not. */
function big(sock: Socket): void {
  try {
    sock.setRecvBufferSize(8 * 1024 * 1024);
    sock.setSendBufferSize(8 * 1024 * 1024);
  } catch {
    // the system's limit
  }
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

interface Allocation {
  client: RemoteInfo;
  relay: Socket;
  relayPort: number;
  profile: LinkProfile;
  key: Buffer;
  channels: Map<number, string>;
  byPeer: Map<string, number>;
  expires: number;
}

/**
 * Packets on one direction of one link: delayed, jittered, some lost, and always in order (as a network queue:
 * reordering would make TCP-like transports, SCTP included, take it for loss and slow down). One timer per lane:
 * separate timers would fire out of order (they round to whole milliseconds).
 */
class Lane {
  private queue: { at: number; fn: () => void }[] = [];
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay: () => number;
  private jitter: () => number;
  private loss: () => number;
  constructor(delay: () => number, jitter: () => number, loss: () => number) {
    this.delay = delay;
    this.jitter = jitter;
    this.loss = loss;
  }

  push(fn: () => void): void {
    if (this.loss() > 0 && Math.random() < this.loss()) return;
    const now = performance.now();
    const at = Math.max(this.last, now + this.delay() + Math.random() * this.jitter());
    this.last = at;
    if (at - now < 0.5 && !this.queue.length) return fn();
    this.queue.push({ at, fn });
    if (!this.timer) this.arm();
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => this.drain(), Math.max(0, head.at - performance.now()));
  }

  private drain(): void {
    this.timer = null;
    const now = performance.now();
    // everything due (within half a millisecond: the timer's own rounding)
    while (this.queue.length && this.queue[0].at <= now + 0.5) this.queue.shift()!.fn();
    this.arm();
  }
}

export interface Netsim {
  port: number;
  host: string;
  /** TURN url for a browser */
  url: string;
  close(): Promise<void>;
  /** packets relayed so far (to check the browsers really went through it) */
  readonly relayed: number;
}

/** Start the relay on `port` (0: any free one). */
export function startNetsim(port = 3479, host = '127.0.0.1'): Promise<Netsim> {
  const sock = createSocket('udp4');
  const allocs = new Map<string, Allocation>();
  const lanes = new Map<string, { up: Lane; down: Lane }>();
  let relayed = 0;
  /** packets still on their way when the relay closes are dropped */
  let closed = false;
  const keyOf = (r: RemoteInfo) => `${r.address}:${r.port}`;

  const NONE: LinkProfile = { up: 0, down: 0, jitter: 0, loss: 0 };
  /** a client's two lanes; the profile is read at each packet (the allocation may come after the first one) */
  const lanesOf = (r: RemoteInfo) => {
    const k = keyOf(r);
    let l = lanes.get(k);
    if (!l) {
      const profile = () => allocs.get(k)?.profile ?? NONE;
      l = {
        up: new Lane(
          () => profile().up,
          () => profile().jitter,
          () => profile().loss,
        ),
        down: new Lane(
          () => profile().down,
          () => profile().jitter,
          () => profile().loss,
        ),
      };
      lanes.set(k, l);
    }
    return l;
  };

  /** to the client, after its downlink */
  const toClient = (r: RemoteInfo, b: Buffer) => {
    lanesOf(r).down.push(() => {
      if (!closed) send(sock, b, r.port, r.address);
    });
  };

  const fromRelay = (a: Allocation, data: Buffer, from: RemoteInfo) => {
    relayed++;
    const peer = keyOf(from);
    const ch = a.byPeer.get(peer);
    if (ch !== undefined) {
      const h = Buffer.alloc(4);
      h.writeUInt16BE(ch, 0);
      h.writeUInt16BE(data.length, 2);
      toClient(a.client, Buffer.concat([h, data, Buffer.alloc((4 - (data.length % 4)) % 4)]));
    } else {
      const tid = Buffer.alloc(12);
      for (let i = 0; i < 12; i++) tid[i] = (Math.random() * 256) | 0;
      toClient(
        a.client,
        build(M.Data, C.Indication, tid, [
          { type: A.XorPeerAddress, value: xorAddress(from.address, from.port, tid) },
          { type: A.Data, value: data },
        ]),
      );
    }
  };

  const handle = (b: Buffer, r: RemoteInfo) => {
    const a = allocs.get(keyOf(r));
    // ChannelData
    if (b.length >= 4 && b[0] >> 6 === 1) {
      if (!a) return;
      const ch = b.readUInt16BE(0);
      const len = b.readUInt16BE(2);
      const peer = a.channels.get(ch);
      if (!peer) return;
      const [address, p] = peer.split(':');
      relayed++;
      send(a.relay, b.subarray(4, 4 + len), +p, address);
      return;
    }
    const m = parse(b);
    if (!m) return;
    const reply = (cls: number, attrs: Attr[], key?: Buffer) => toClient(r, build(m.method, cls, m.tid, attrs, key));
    const error = (code: number, reason: string, extra: Attr[] = []) => {
      const v = Buffer.concat([Buffer.from([0, 0, Math.floor(code / 100), code % 100]), Buffer.from(reason)]);
      reply(C.Error, [{ type: A.ErrorCode, value: v }, ...extra]);
    };
    if (m.method === M.Binding && m.cls === C.Request) {
      reply(C.Success, [{ type: A.XorMappedAddress, value: xorAddress(r.address, r.port, m.tid) }]);
      return;
    }
    if (m.method === M.Send && m.cls === C.Indication) {
      const peer = readXorAddress(attr(m, A.XorPeerAddress) ?? Buffer.alloc(0));
      const data = attr(m, A.Data);
      if (a && peer && data) {
        relayed++;
        send(a.relay, data, peer.port, peer.address);
      }
      return;
    }
    if (m.cls !== C.Request) return;
    const user = attr(m, A.Username)?.toString();
    if (!user || !attr(m, A.MessageIntegrity)) {
      error(401, 'Unauthorized', [
        { type: A.Realm, value: Buffer.from(REALM) },
        { type: A.Nonce, value: Buffer.from('n' + Math.random().toString(36).slice(2, 14)) },
      ]);
      return;
    }
    const key = createHash('md5').update(`${user}:${REALM}:${PASSWORD}`).digest();
    const clientKey = key;
    switch (m.method) {
      case M.Allocate: {
        if (a) {
          reply(
            C.Success,
            [
              { type: A.XorRelayedAddress, value: xorAddress(host, a.relayPort, m.tid) },
              { type: A.XorMappedAddress, value: xorAddress(r.address, r.port, m.tid) },
              { type: A.Lifetime, value: u32(600) },
            ],
            a.key,
          );
          return;
        }
        const relay = createSocket('udp4');
        relay.bind(0, host, () => {
          big(relay);
          const relayPort = relay.address().port;
          const alloc: Allocation = {
            client: r,
            relay,
            relayPort,
            profile: profileOf(user),
            key: clientKey,
            channels: new Map(),
            byPeer: new Map(),
            expires: Date.now() + 600_000,
          };
          allocs.set(keyOf(r), alloc);
          relay.on('message', (data, from) => fromRelay(alloc, data, from));
          reply(
            C.Success,
            [
              { type: A.XorRelayedAddress, value: xorAddress(host, relayPort, m.tid) },
              { type: A.XorMappedAddress, value: xorAddress(r.address, r.port, m.tid) },
              { type: A.Lifetime, value: u32(600) },
            ],
            clientKey,
          );
        });
        return;
      }
      case M.Refresh: {
        const life = attr(m, A.Lifetime)?.readUInt32BE(0) ?? 600;
        if (a && life === 0) {
          a.relay.close();
          allocs.delete(keyOf(r));
        } else if (a) a.expires = Date.now() + life * 1000;
        reply(C.Success, [{ type: A.Lifetime, value: u32(life) }], clientKey);
        return;
      }
      case M.CreatePermission:
        reply(C.Success, [], clientKey);
        return;
      case M.ChannelBind: {
        const ch = attr(m, A.ChannelNumber)?.readUInt16BE(0);
        const peer = readXorAddress(attr(m, A.XorPeerAddress) ?? Buffer.alloc(0));
        if (a && ch !== undefined && peer) {
          const k = `${peer.address}:${peer.port}`;
          a.channels.set(ch, k);
          a.byPeer.set(k, ch);
        }
        reply(C.Success, [], clientKey);
        return;
      }
      default:
        error(400, 'Bad Request');
    }
  };

  sock.on('message', (b, r) => {
    // the client's uplink first (its allocation's profile; before one exists, its username decides at once)
    if (!allocs.has(keyOf(r))) return handle(b, r);
    lanesOf(r).up.push(() => {
      if (!closed) handle(b, r);
    });
  });

  return new Promise((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(port, host, () => {
      big(sock);
      const p = sock.address().port;
      resolve({
        port: p,
        host,
        url: `turn:${host}:${p}?transport=udp`,
        get relayed() {
          return relayed;
        },
        close: () =>
          new Promise<void>((done) => {
            closed = true;
            for (const a of allocs.values()) a.relay.close();
            allocs.clear();
            sock.close(() => done());
          }),
      });
    });
  });
}

// run directly: a relay for trying things by hand
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 3479);
  void startNetsim(port).then((n) =>
    console.log(`netsim TURN relay on ${n.url} (username sim-<up>-<down>-<jitter>-<loss%>)`),
  );
}
