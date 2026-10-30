// Message relays for the rendezvous (src/net/room.ts). Peers meet through free public MQTT brokers, several at
// once so that one being down does not matter; the local development server can stand in for them
// (`?relay=local`, used by the browser tests). Only the short, encrypted handshake goes through a relay: audio,
// video, chat and MIDI travel directly between the browsers over WebRTC.

import { MqttClient } from './mqtt.ts';

export interface Relay {
  /** Connect; resolves as soon as one connection works, rejects if none does. */
  start(): Promise<void>;
  /** Messages published on `topic` by anyone (this client included). */
  subscribe(topic: string, cb: (data: Uint8Array) => void): () => void;
  publish(topic: string, data: Uint8Array): void;
  /** working connections */
  readonly up: number;
  /** how many connections it tries */
  readonly total: number;
  /** called whenever `up` changes */
  onChange: () => void;
  close(): void;
}

/** Free public MQTT brokers with WebSocket access (the same set as Boom Buds, checked 2026-10). */
export const PUBLIC_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];

type Listener = (data: Uint8Array) => void;

/** Publishes to every connected broker and listens on all of them (the room layer drops duplicates). */
export class MqttRelay implements Relay {
  onChange: () => void = () => {};
  private clients: MqttClient[];
  private subs = new Map<string, Set<Listener>>();
  private closed = false;
  /** messages published while no broker was reachable (sent as soon as one is) */
  private backlog: { topic: string; data: Uint8Array; at: number }[] = [];

  constructor(urls: string[] = PUBLIC_BROKERS) {
    this.clients = urls.map((u) => {
      const c = new MqttClient(u);
      c.onMessage = (topic, payload) => {
        for (const cb of this.subs.get(topic) ?? []) cb(payload);
      };
      c.onClose = () => {
        this.onChange();
        this.retry(c, 1000);
      };
      return c;
    });
  }

  get up(): number {
    return this.clients.filter((c) => c.connected).length;
  }

  get total(): number {
    return this.clients.length;
  }

  private async open(c: MqttClient): Promise<void> {
    await c.connect(`sl${Math.random().toString(36).slice(2, 12)}`);
    for (const t of this.subs.keys()) c.subscribe(t);
    const now = Date.now();
    for (const m of this.backlog.splice(0)) if (now - m.at < 20_000) c.publish(m.topic, m.data);
    this.onChange();
  }

  private retry(c: MqttClient, delay: number): void {
    setTimeout(() => {
      if (this.closed || c.connected) return;
      this.open(c).catch(() => this.retry(c, Math.min(delay * 2, 30_000)));
    }, delay);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let failed = 0;
      for (const c of this.clients) {
        this.open(c).then(resolve, () => {
          if (++failed === this.clients.length) reject(new Error('no relay reachable'));
          if (!this.closed) this.retry(c, 3000);
        });
      }
    });
  }

  /** Reconnect dropped brokers now (the network came back). */
  kick(): void {
    for (const c of this.clients) if (!c.connected) this.open(c).catch(() => {});
  }

  subscribe(topic: string, cb: Listener): () => void {
    let set = this.subs.get(topic);
    if (!set) {
      set = new Set();
      this.subs.set(topic, set);
      for (const c of this.clients) if (c.connected) c.subscribe(topic);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size || this.subs.get(topic) !== set) return;
      this.subs.delete(topic);
      for (const c of this.clients) if (c.connected) c.unsubscribe(topic);
    };
  }

  publish(topic: string, data: Uint8Array): void {
    let sent = false;
    for (const c of this.clients) {
      if (c.connected) {
        c.publish(topic, data);
        sent = true;
      }
    }
    if (!sent) {
      this.backlog.push({ topic, data, at: Date.now() });
      if (this.backlog.length > 64) this.backlog.shift();
    }
  }

  close(): void {
    this.closed = true;
    this.backlog = [];
    for (const c of this.clients) c.close();
  }
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The relay of the development / preview server (server/relay.ts, WebSocket on /relay). */
export class LocalRelay implements Relay {
  readonly url: string;
  readonly total = 1;
  onChange: () => void = () => {};
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Listener>>();
  private closed = false;

  constructor(url?: string) {
    this.url = url ?? new URL('relay', location.href.split('#')[0].split('?')[0]).href.replace(/^http/, 'ws');
  }

  get up(): number {
    return this.ws && this.ws.readyState === WebSocket.OPEN ? 1 : 0;
  }

  start(timeoutMs = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('local relay not reachable'));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        for (const t of this.subs.keys()) this.send({ type: 'sub', topic: t });
        this.onChange();
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('local relay not reachable'));
      };
      ws.onclose = () => {
        this.onChange();
        if (!this.closed) setTimeout(() => this.start().catch(() => {}), 1000);
      };
      ws.onmessage = (ev) => {
        let m: { type?: string; topic?: string; data?: string };
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.type !== 'msg' || !m.topic || typeof m.data !== 'string') return;
        const data = fromBase64(m.data);
        for (const cb of this.subs.get(m.topic) ?? []) cb(data);
      };
    });
  }

  private send(m: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  subscribe(topic: string, cb: Listener): () => void {
    let set = this.subs.get(topic);
    if (!set) {
      set = new Set();
      this.subs.set(topic, set);
      this.send({ type: 'sub', topic });
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size || this.subs.get(topic) !== set) return;
      this.subs.delete(topic);
      this.send({ type: 'unsub', topic });
    };
  }

  publish(topic: string, data: Uint8Array): void {
    this.send({ type: 'pub', topic, data: toBase64(data) });
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}

/** In-memory relay shared by several clients in one process (unit tests). */
export class MemoryRelay implements Relay {
  static readonly hub = new Map<string, Set<Listener>>();
  readonly total = 1;
  onChange: () => void = () => {};
  up = 1;
  private mine: { topic: string; cb: Listener }[] = [];

  start(): Promise<void> {
    return Promise.resolve();
  }

  subscribe(topic: string, cb: Listener): () => void {
    let set = MemoryRelay.hub.get(topic);
    if (!set) {
      set = new Set();
      MemoryRelay.hub.set(topic, set);
    }
    set.add(cb);
    const entry = { topic, cb };
    this.mine.push(entry);
    return () => {
      set.delete(cb);
      this.mine = this.mine.filter((e) => e !== entry);
    };
  }

  publish(topic: string, data: Uint8Array): void {
    if (!this.up) return;
    for (const cb of [...(MemoryRelay.hub.get(topic) ?? [])]) queueMicrotask(() => cb(data.slice()));
  }

  close(): void {
    for (const e of this.mine) MemoryRelay.hub.get(e.topic)?.delete(e.cb);
    this.mine = [];
    this.up = 0;
  }
}

/** The relay for this page: `?relay=local` (development server), `?relay=public`, or the default. */
export function createRelay(search = typeof location === 'undefined' ? '' : location.search): Relay {
  const want = new URLSearchParams(search).get('relay');
  if (want === 'local' || (!want && import.meta.env?.DEV)) return new LocalRelay();
  return new MqttRelay();
}
