// The MQTT client's sockets across reconnections, with a fake WebSocket (after the review's simulations): a late
// event from an old socket must not touch the new one, overlapping connects must not race, and nothing published
// while a connection is being replaced may be lost.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MqttClient, mqttPacket } from '../../src/net/mqtt.ts';
import { MqttRelay } from '../../src/net/relay.ts';

let sockets: FakeWS[] = [];
class FakeWS {
  static OPEN = 1;
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  sent: Uint8Array[] = [];
  closed = false;
  constructor(public url: string) {
    sockets.push(this);
  }
  send(p: Uint8Array) {
    this.sent.push(p);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  connack() {
    this.onmessage?.({ data: mqttPacket(2, 0, [0, 0]).buffer as ArrayBuffer });
  }
  dies() {
    this.readyState = 3;
    this.onclose?.();
  }
  publishes() {
    return this.sent.filter((x) => x[0] >> 4 === 3).length;
  }
}

const g = globalThis as unknown as { WebSocket: unknown };
let saved: unknown;
beforeEach(() => {
  sockets = [];
  saved = g.WebSocket;
  g.WebSocket = FakeWS;
  vi.useFakeTimers();
});
afterEach(() => {
  g.WebSocket = saved;
  vi.useRealTimers();
});

describe('MQTT client sockets', () => {
  it('a late close of the old socket does not touch the new connection', async () => {
    const c = new MqttClient('wss://x');
    let drops = 0;
    c.onClose = () => drops++;
    const p1 = c.connect('a');
    sockets[0].open();
    sockets[0].connack();
    await p1;
    // back from the background: a new connection replaces the old one
    const p2 = c.connect('b');
    expect(sockets[0].closed).toBe(true);
    sockets[1].open();
    sockets[1].connack();
    await p2;
    sockets[0].dies(); // its close event arrives late
    expect(c.connected).toBe(true);
    expect(c.ready).toBe(true);
    expect(drops).toBe(0);
    // the keep-alive still runs on the new socket
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets[1].sent.some((x) => x[0] >> 4 === 12)).toBe(true);
  });

  it('a second connect while one is in progress joins it, rather than racing with another socket', async () => {
    const c = new MqttClient('wss://y');
    const p1 = c.connect('a');
    const p2 = c.connect('b');
    expect(p2).toBe(p1);
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    sockets[0].connack();
    await p1;
    expect(c.connected).toBe(true);
  });

  it('a timed-out attempt does not close a socket that came after it', async () => {
    const c = new MqttClient('wss://z');
    const slow = c.connect('a').catch(() => 'failed');
    c.close(); // given up on
    const p2 = c.connect('b');
    sockets[1].open();
    sockets[1].connack();
    await p2;
    await vi.advanceTimersByTimeAsync(8000);
    expect(await slow).toBe('failed');
    expect(sockets[1].closed).toBe(false);
    expect(c.connected).toBe(true);
  });

  it('close() really leaves it disconnected', async () => {
    const c = new MqttClient('wss://w');
    const p = c.connect('a');
    sockets[0].open();
    sockets[0].connack();
    await p;
    c.close();
    expect(c.connected).toBe(false);
    expect(c.ready).toBe(false);
  });
});

describe('relay across a reconnection', () => {
  it('what is published while the connection is being replaced waits, and goes out on the new one', async () => {
    const r = new MqttRelay(['wss://a']);
    const started = r.start();
    sockets[0].open();
    sockets[0].connack();
    await started;
    r.kick(true); // back after a long absence
    r.publish('t', new Uint8Array([1, 2, 3]));
    expect(sockets[0].publishes()).toBe(0);
    sockets[1].open();
    sockets[1].connack();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[1].publishes()).toBe(1);
  });
});
