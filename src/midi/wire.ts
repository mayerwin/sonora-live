// MIDI over an unreliable, unordered data channel, without stuck notes.
//
// A reliable channel would resend lost packets, holding back every later note for a round trip or more (head of
// line blocking). Game netcode does better: send unreliably, and make loss harmless instead.
//   • Redundancy: every packet repeats the events of the last 250 ms, so a lost packet is repaired by the next one,
//     and the last packet of a phrase is sent a second time 30 ms later.
//   • Sequence numbers: events are applied once, in order; duplicates and stale ones are dropped.
//   • State snapshots: while keys or pedals are held, and twice after everything is released, the sender sends the
//     full list of held notes and pedal positions. The receiver releases anything it still holds that the
//     snapshot does not. Whatever is lost, a note can only hang for about a second.
//   • A note recovered too late (400 ms) is skipped rather than played out of time; releases always go through.
//
// Packets:
//   events    [1][lastSeq u32][count u8] then per event, oldest first: [age ms u16][length u8][bytes]
//   snapshot  [2][seq u32][channels u8] then per channel: [ch][sustain][sostenuto][soft][count][notes...]

export const REDUNDANCY_MS = 250;
export const MAX_EVENTS = 32;
export const TAIL_RESEND_MS = 30;
export const SNAPSHOT_EVERY_MS = 1000;
export const LATE_NOTE_MS = 400;

const T_EVENTS = 1;
const T_SNAPSHOT = 2;

export type MidiBytes = number[];

/** Held notes and pedals per channel, as a sequence of MIDI messages leaves them. */
export class NoteState {
  /** velocity of each held note, [channel * 128 + note] (0: up) */
  readonly notes = new Uint8Array(16 * 128);
  /** CC 64, 66, 67 per channel */
  readonly pedals = new Uint8Array(16 * 3);
  private count = 0;

  apply(m: MidiBytes): void {
    const type = m[0] & 0xf0;
    const ch = m[0] & 0x0f;
    if (type === 0x90 && m[2] > 0) {
      if (!this.notes[ch * 128 + m[1]]) this.count++;
      this.notes[ch * 128 + m[1]] = m[2];
    } else if (type === 0x80 || (type === 0x90 && m[2] === 0)) {
      if (this.notes[ch * 128 + m[1]]) this.count--;
      this.notes[ch * 128 + m[1]] = 0;
    } else if (type === 0xb0) {
      const p = pedalIndex(m[1]);
      if (p >= 0) this.pedals[ch * 3 + p] = m[2];
      if (m[1] === 120 || m[1] === 123) this.clearChannel(ch);
    }
  }

  private clearChannel(ch: number): void {
    for (let n = 0; n < 128; n++) {
      if (this.notes[ch * 128 + n]) this.count--;
      this.notes[ch * 128 + n] = 0;
    }
  }

  get empty(): boolean {
    if (this.count > 0) return false;
    for (let i = 0; i < this.pedals.length; i++) if (this.pedals[i] >= 64) return false;
    return true;
  }

  get heldCount(): number {
    return this.count;
  }

  channelsInUse(): number[] {
    const out: number[] = [];
    for (let ch = 0; ch < 16; ch++) {
      let used = this.pedals[ch * 3] > 0 || this.pedals[ch * 3 + 1] > 0 || this.pedals[ch * 3 + 2] > 0;
      for (let n = 0; n < 128 && !used; n++) if (this.notes[ch * 128 + n]) used = true;
      if (used) out.push(ch);
    }
    return out;
  }

  held(ch: number): number[] {
    const out: number[] = [];
    for (let n = 0; n < 128; n++) if (this.notes[ch * 128 + n]) out.push(n);
    return out;
  }

  /** Messages that release everything this state holds. */
  releaseAll(): MidiBytes[] {
    const out: MidiBytes[] = [];
    for (let ch = 0; ch < 16; ch++) {
      for (let n = 0; n < 128; n++) if (this.notes[ch * 128 + n]) out.push([0x80 | ch, n, 64]);
      for (let p = 0; p < 3; p++) if (this.pedals[ch * 3 + p]) out.push([0xb0 | ch, PEDAL_CC[p], 0]);
    }
    return out;
  }
}

const PEDAL_CC = [64, 66, 67];

function pedalIndex(cc: number): number {
  return cc === 64 ? 0 : cc === 66 ? 1 : cc === 67 ? 2 : -1;
}

/** Messages worth sending to the other side: notes, the three piano pedals, pitch bend, all-notes-off. */
export function forwardable(m: ArrayLike<number>): boolean {
  if (m.length < 2) return false;
  const type = m[0] & 0xf0;
  if (type === 0x80 || type === 0x90) return m.length >= 3 && m[1] < 128 && m[2] < 128;
  if (type === 0xb0) return m.length >= 3 && (m[1] === 64 || m[1] === 66 || m[1] === 67 || m[1] === 120 || m[1] === 123);
  if (type === 0xe0) return m.length >= 3;
  return false;
}

interface Ev {
  seq: number;
  t: number;
  data: MidiBytes;
}

type Clock = () => number;
type Timer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (t: unknown) => void;

export class MidiSender {
  /** where packets go (every connected peer) */
  send: (packet: Uint8Array) => void;
  private seq = 0;
  private history: Ev[] = [];
  readonly state = new NoteState();
  private now: Clock;
  private setTimer: Timer;
  private clearTimer: ClearTimer;
  private tailTimer: unknown = null;
  private snapTimer: unknown = null;
  private trailing = 0;

  constructor(
    send: (packet: Uint8Array) => void,
    clock: Clock = () => performance.now(),
    timer: Timer = (fn, ms) => setTimeout(fn, ms),
    clear: ClearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  ) {
    this.send = send;
    this.now = clock;
    this.setTimer = timer;
    this.clearTimer = clear;
  }

  push(data: MidiBytes): void {
    const now = this.now();
    this.seq = (this.seq + 1) >>> 0;
    this.history.push({ seq: this.seq, t: now, data: data.slice(0, 3) });
    this.state.apply(data);
    this.trim(now);
    this.send(this.eventsPacket(now));
    // the last packet of a burst goes twice
    if (this.tailTimer !== null) this.clearTimer(this.tailTimer);
    this.tailTimer = this.setTimer(() => {
      this.tailTimer = null;
      const t = this.now();
      this.trim(t);
      if (this.history.length) this.send(this.eventsPacket(t));
    }, TAIL_RESEND_MS);
    this.scheduleSnapshots();
  }

  private trim(now: number): void {
    while (this.history.length > MAX_EVENTS || (this.history.length && now - this.history[0].t > REDUNDANCY_MS)) {
      this.history.shift();
    }
  }

  private eventsPacket(now: number): Uint8Array {
    let size = 6;
    for (const e of this.history) size += 3 + e.data.length;
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    v.setUint8(0, T_EVENTS);
    v.setUint32(1, this.seq);
    v.setUint8(5, this.history.length);
    let p = 6;
    for (const e of this.history) {
      v.setUint16(p, Math.min(65535, Math.max(0, Math.round(now - e.t))));
      v.setUint8(p + 2, e.data.length);
      for (let i = 0; i < e.data.length; i++) out[p + 3 + i] = e.data[i];
      p += 3 + e.data.length;
    }
    return out;
  }

  /** Snapshots every second while anything is held; two more once everything is released. */
  private scheduleSnapshots(): void {
    if (this.snapTimer !== null) this.clearTimer(this.snapTimer);
    const held = !this.state.empty;
    if (held) {
      this.trailing = 2;
      this.snapTimer = this.setTimer(() => {
        this.snapTimer = null;
        this.send(this.snapshot());
        this.scheduleSnapshots();
      }, SNAPSHOT_EVERY_MS);
    } else if (this.trailing > 0) {
      const wait = this.trailing === 2 ? 120 : 600;
      this.snapTimer = this.setTimer(() => {
        this.snapTimer = null;
        this.trailing--;
        this.send(this.snapshot());
        this.scheduleSnapshots();
      }, wait);
    }
  }

  snapshot(): Uint8Array {
    const chans = this.state.channelsInUse();
    const parts: number[] = [T_SNAPSHOT, 0, 0, 0, 0, chans.length];
    for (const ch of chans) {
      const held = this.state.held(ch);
      parts.push(ch, this.state.pedals[ch * 3], this.state.pedals[ch * 3 + 1], this.state.pedals[ch * 3 + 2], held.length, ...held);
    }
    const out = new Uint8Array(parts);
    new DataView(out.buffer).setUint32(1, this.seq);
    return out;
  }

  /** Tell a newly connected peer where things stand. */
  hello(): Uint8Array {
    return this.snapshot();
  }

  dispose(): void {
    if (this.tailTimer !== null) this.clearTimer(this.tailTimer);
    if (this.snapTimer !== null) this.clearTimer(this.snapTimer);
    this.tailTimer = this.snapTimer = null;
  }
}

export class MidiReceiver {
  /** a message to play now; `late`: how old it is (ms) */
  deliver: (m: MidiBytes, late: number) => void;
  private lastSeq = -1;
  /** what this receiver has sounded (to release it on snapshots and resets) */
  readonly state = new NoteState();
  /** counters for the connection panel and tests */
  readonly counters = { events: 0, duplicates: 0, recovered: 0, skippedLate: 0, reconciled: 0, gaps: 0 };

  constructor(deliver: (m: MidiBytes, late: number) => void) {
    this.deliver = deliver;
  }

  receive(packet: ArrayBuffer | Uint8Array): void {
    const b = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    if (b.length < 6) return;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const type = v.getUint8(0);
    if (type === T_EVENTS) this.onEvents(b, v);
    else if (type === T_SNAPSHOT) this.onSnapshot(b, v);
  }

  /** seq a is after seq b (wrapping 32-bit counter) */
  private after(a: number, b: number): boolean {
    if (b < 0) return true;
    return ((a - b) | 0) > 0;
  }

  private onEvents(b: Uint8Array, v: DataView): void {
    const last = v.getUint32(1);
    const count = v.getUint8(5);
    const evs: { seq: number; age: number; data: MidiBytes }[] = [];
    let p = 6;
    for (let i = 0; i < count; i++) {
      if (p + 3 > b.length) return;
      const age = v.getUint16(p);
      const len = v.getUint8(p + 2);
      if (len < 1 || len > 3 || p + 3 + len > b.length) return;
      evs.push({ seq: (last - (count - 1 - i)) >>> 0, age, data: Array.from(b.subarray(p + 3, p + 3 + len)) });
      p += 3 + len;
    }
    let first = true;
    for (const e of evs) {
      if (!this.after(e.seq, this.lastSeq)) {
        this.counters.duplicates++;
        continue;
      }
      if (first && this.lastSeq >= 0 && ((e.seq - this.lastSeq) | 0) > 1) this.counters.gaps++;
      first = false;
      const isLast = e === evs[evs.length - 1];
      if (!isLast) this.counters.recovered++;
      this.lastSeq = e.seq;
      this.apply(e.data, e.age);
    }
  }

  private apply(m: MidiBytes, late: number): void {
    const type = m[0] & 0xf0;
    const noteOn = type === 0x90 && m[2] > 0;
    if (noteOn && late > LATE_NOTE_MS) {
      this.counters.skippedLate++;
      return;
    }
    if ((type === 0x80 || (type === 0x90 && m[2] === 0)) && !this.state.notes[(m[0] & 15) * 128 + m[1]]) {
      // releasing a note we never sounded (skipped as late, or from before we connected)
      return;
    }
    this.counters.events++;
    this.state.apply(m);
    this.deliver(m, late);
  }

  private onSnapshot(b: Uint8Array, v: DataView): void {
    const seq = v.getUint32(1);
    if (this.lastSeq >= 0 && this.after(this.lastSeq, seq)) return; // older than what we applied
    this.lastSeq = seq;
    const want = new NoteState();
    const n = v.getUint8(5);
    let p = 6;
    for (let i = 0; i < n; i++) {
      if (p + 5 > b.length) return;
      const ch = b[p] & 15;
      want.pedals[ch * 3] = b[p + 1];
      want.pedals[ch * 3 + 1] = b[p + 2];
      want.pedals[ch * 3 + 2] = b[p + 3];
      const count = b[p + 4];
      if (p + 5 + count > b.length) return;
      for (let k = 0; k < count; k++) want.notes[ch * 128 + (b[p + 5 + k] & 127)] = 1;
      p += 5 + count;
    }
    // release what we hold and the sender does not; set pedals to the sender's positions
    for (let ch = 0; ch < 16; ch++) {
      for (let note = 0; note < 128; note++) {
        if (this.state.notes[ch * 128 + note] && !want.notes[ch * 128 + note]) {
          this.counters.reconciled++;
          const m = [0x80 | ch, note, 64];
          this.state.apply(m);
          this.deliver(m, 0);
        }
      }
      for (let k = 0; k < 3; k++) {
        const have = this.state.pedals[ch * 3 + k];
        const target = want.pedals[ch * 3 + k];
        if ((have >= 64) !== (target >= 64) || (k === 0 && Math.abs(have - target) > 8)) {
          this.counters.reconciled++;
          const m = [0xb0 | ch, PEDAL_CC[k], target];
          this.state.apply(m);
          this.deliver(m, 0);
        }
      }
    }
  }

  /** The peer left or stopped sending: release everything it was holding. */
  reset(): void {
    for (const m of this.state.releaseAll()) {
      this.state.apply(m);
      this.deliver(m, 0);
    }
    this.lastSeq = -1;
  }
}
