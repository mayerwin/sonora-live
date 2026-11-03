// Minimal MQTT 3.1.1 client over WebSocket: QoS 0 publish / subscribe and keep-alive. That is all the room
// rendezvous needs from the public brokers (src/net/relay.ts); media, chat and MIDI never go through them.
// (Same client as Boom Buds, github.com/mayerwin/Boom-Buds.)

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

/** One MQTT control packet: fixed header (type, flags, remaining length) and body. */
export function mqttPacket(type: number, flags: number, body: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const len: number[] = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    len.push(d);
  } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = (type << 4) | flags;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

/** Split a byte stream into packets; returns the bytes of an incomplete trailing packet. */
export function mqttParse(
  buf: Uint8Array,
  handle: (type: number, flags: number, body: Uint8Array) => void,
): Uint8Array {
  let pos = 0;
  for (;;) {
    if (buf.length - pos < 2) break;
    let len = 0;
    let mul = 1;
    let i = pos + 1;
    let complete = false;
    while (i < buf.length && i < pos + 5) {
      const d = buf[i++];
      len += (d & 127) * mul;
      mul *= 128;
      if (!(d & 128)) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      if (i >= pos + 5) throw new Error('malformed MQTT length');
      break;
    }
    if (buf.length < i + len) break;
    handle(buf[pos] >> 4, buf[pos] & 15, buf.subarray(i, i + len));
    pos = i + len;
  }
  return buf.slice(pos);
}

/** how long an answer to a keep-alive ping may take before the socket counts as dead */
const PONG_TIMEOUT_MS = 10_000;

export class MqttClient {
  readonly url: string;
  /** CONNACK received on the current socket */
  connected = false;
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  /** the connection dropped after it had been established */
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;
  private buf: Uint8Array = new Uint8Array(0);
  private packetId = 1;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** the connection attempt in progress (a second connect() joins it rather than racing it) */
  private pending: Promise<void> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /** Connected, with a socket that can send right now. */
  get ready(): boolean {
    return this.connected && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect(clientId: string, timeoutMs = 8000): Promise<void> {
    if (this.pending) return this.pending;
    // one socket at a time: whatever was there is closed first, and its late events are ignored below
    this.close();
    this.buf = new Uint8Array(0);
    const attempt = new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket | null = null;
      const mine = () => ws !== null && this.ws === ws;
      const fail = (why: string) => {
        const established = settled;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`${this.url}: ${why}`));
        }
        // only this attempt's socket: a newer one may be working by now
        if (!mine()) return;
        const was = this.connected;
        this.close();
        // an established connection broke (an error before its close, a garbled packet, no answer to a ping):
        // the relay must hear it, to reconnect
        if (established && was) this.onClose();
      };
      const timer = setTimeout(() => fail('timeout'), timeoutMs);
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch (e) {
        fail(String(e));
        return;
      }
      const sock = ws;
      this.ws = sock;
      sock.binaryType = 'arraybuffer';
      // CONNECT: protocol "MQTT" level 4, clean session, keep-alive 30 s
      sock.onopen = () => {
        if (mine()) sock.send(mqttPacket(1, 0, [...utf8('MQTT'), 4, 0x02, 0, 30, ...utf8(clientId)]));
      };
      sock.onerror = () => fail('connection error');
      sock.onclose = () => {
        if (!mine()) return; // an old socket closing late: not ours to report
        const was = this.connected;
        this.ws = null;
        this.connected = false;
        this.stopKeepAlive();
        if (!settled) fail('closed');
        else if (was) this.onClose();
      };
      sock.onmessage = (ev) => {
        if (!mine()) return;
        const data = new Uint8Array(ev.data as ArrayBuffer);
        const all = new Uint8Array(this.buf.length + data.length);
        all.set(this.buf);
        all.set(data, this.buf.length);
        try {
          this.buf = mqttParse(all, (type, flags, body) => {
            if (type === 2) {
              // CONNACK
              if (body[1] !== 0) {
                fail(`refused (${body[1]})`);
                return;
              }
              this.connected = true;
              settled = true;
              clearTimeout(timer);
              this.stopKeepAlive();
              // a ping every 20 s; no answer within 10 s means the socket is dead (half-open after a network change)
              this.keepAlive = setInterval(() => {
                this.send(mqttPacket(12, 0, []));
                if (this.pongTimer) clearTimeout(this.pongTimer);
                this.pongTimer = setTimeout(() => fail('no answer to ping'), PONG_TIMEOUT_MS);
              }, 20_000);
              resolve();
            } else if (type === 3) {
              // PUBLISH
              const tl = (body[0] << 8) | body[1];
              const topic = dec.decode(body.subarray(2, 2 + tl));
              let p = 2 + tl;
              if ((flags >> 1) & 3) p += 2; // packet identifier (QoS > 0)
              this.onMessage(topic, body.slice(p));
            } else if (type === 13) {
              // PINGRESP
              if (this.pongTimer) clearTimeout(this.pongTimer);
              this.pongTimer = null;
            }
            // SUBACK, UNSUBACK: nothing to do
          });
        } catch {
          fail('malformed');
        }
      };
    });
    this.pending = attempt;
    const done = () => {
      if (this.pending === attempt) this.pending = null;
    };
    attempt.then(done, done);
    return attempt;
  }

  private stopKeepAlive(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.keepAlive = null;
    this.pongTimer = null;
  }

  private send(p: Uint8Array<ArrayBuffer>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(p);
  }

  private nextId(): number[] {
    const id = this.packetId;
    this.packetId = (this.packetId % 65535) + 1;
    return [id >> 8, id & 255];
  }

  subscribe(topic: string): void {
    this.send(mqttPacket(8, 2, [...this.nextId(), ...utf8(topic), 0]));
  }

  unsubscribe(topic: string): void {
    this.send(mqttPacket(10, 2, [...this.nextId(), ...utf8(topic)]));
  }

  publish(topic: string, payload: Uint8Array): void {
    const t = utf8(topic);
    const body = new Uint8Array(t.length + payload.length);
    body.set(t);
    body.set(payload, t.length);
    this.send(mqttPacket(3, 0, body));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    this.pending = null;
    this.stopKeepAlive();
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(mqttPacket(14, 0, [])); // DISCONNECT
      } catch {
        // closing anyway
      }
    }
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}
