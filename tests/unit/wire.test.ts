import { describe, expect, it } from 'vitest';
import { LATE_NOTE_MS, MidiReceiver, MidiSender, NoteState, forwardable, type MidiBytes } from '../../src/midi/wire.ts';

/** A sender driven by a manual clock and timer queue, so loss and timing are deterministic. */
function rig() {
  let now = 1000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const sent: Uint8Array[] = [];
  const sender = new MidiSender(
    (p) => sent.push(p.slice()),
    () => now,
    (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  const got: MidiBytes[] = [];
  const receiver = new MidiReceiver((m) => got.push(m));
  return { sender, receiver, sent, got, advance, take: () => sent.splice(0) };
}

const on = (n: number, v = 80): MidiBytes => [0x90, n, v];
const off = (n: number): MidiBytes => [0x80, n, 64];

describe('MIDI wire protocol', () => {
  it('delivers events in order, once', () => {
    const r = rig();
    r.sender.push(on(60));
    r.sender.push(off(60));
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.got).toEqual([on(60), off(60)]);
    // duplicates (the tail resend) change nothing
    r.advance(50);
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.got).toEqual([on(60), off(60)]);
  });

  it('repairs a lost packet with the next one', () => {
    const r = rig();
    r.sender.push(on(60));
    r.take(); // lost
    r.advance(10);
    r.sender.push(on(64));
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.got).toEqual([on(60), on(64)]);
    expect(r.receiver.counters.recovered).toBe(1);
  });

  it('repairs a lost final note-off with the tail resend', () => {
    const r = rig();
    r.sender.push(on(60));
    for (const p of r.take()) r.receiver.receive(p);
    r.advance(100);
    r.sender.push(off(60));
    r.take(); // the note-off packet is lost
    r.advance(40); // tail resend
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.got.at(-1)).toEqual(off(60));
    expect(r.receiver.state.heldCount).toBe(0);
  });

  it('a snapshot releases a note whose every packet was lost', () => {
    const r = rig();
    r.sender.push(on(60));
    r.sender.push(on(64));
    for (const p of r.take()) r.receiver.receive(p);
    r.advance(500);
    r.sender.push(off(60));
    r.advance(31); // tail resend happens...
    r.take(); // ...but everything is lost
    r.advance(130); // trailing snapshot? 64 is still held, so the next is the 1 s snapshot
    r.advance(1000);
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.receiver.state.heldCount).toBe(1);
    expect(r.got).toContainEqual([0x80, 60, 64]);
  });

  it('snapshots after release clean up a lost pedal release', () => {
    const r = rig();
    r.sender.push([0xb0, 64, 127]);
    for (const p of r.take()) r.receiver.receive(p);
    r.advance(300);
    r.sender.push([0xb0, 64, 0]);
    r.advance(35);
    r.take(); // lost, with its resend
    r.advance(200); // snapshot 120 ms after release
    for (const p of r.take()) r.receiver.receive(p);
    expect(r.receiver.state.pedals[0]).toBe(0);
    expect(r.got.at(-1)).toEqual([0xb0, 64, 0]);
  });

  it('handles reordering: a stale packet after a newer one is ignored', () => {
    const r = rig();
    r.sender.push(on(60));
    const p1 = r.take();
    r.advance(5);
    r.sender.push(off(60));
    const p2 = r.take();
    for (const p of p2) r.receiver.receive(p);
    for (const p of p1) r.receiver.receive(p);
    expect(r.got).toEqual([on(60), off(60)]);
  });

  it('skips a note recovered too late but still delivers releases safely', () => {
    const r = rig();
    r.sender.push(on(60));
    r.take(); // lost
    r.advance(LATE_NOTE_MS + 50);
    // history only keeps 250 ms, so build the late case by hand: an event with a large age
    const late = new Uint8Array([1, 0, 0, 0, 9, 1, 0x02, 0x00, 3, 0x90, 61, 90]);
    r.receiver.receive(late);
    expect(r.receiver.counters.skippedLate).toBe(1);
    expect(r.got).toEqual([]);
    // its release is dropped too (we never sounded it)
    r.receiver.receive(new Uint8Array([1, 0, 0, 0, 10, 1, 0, 0, 3, 0x80, 61, 64]));
    expect(r.got).toEqual([]);
  });

  it('reset releases everything a peer held', () => {
    const r = rig();
    r.sender.push(on(60));
    r.sender.push([0xb0, 64, 127]);
    for (const p of r.take()) r.receiver.receive(p);
    r.got.length = 0;
    r.receiver.reset();
    expect(r.got).toContainEqual([0x80, 60, 64]);
    expect(r.got).toContainEqual([0xb0, 64, 0]);
  });

  it('survives 30% random loss without stuck notes', () => {
    const r = rig();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const deliver = () => {
      for (const p of r.take()) if (rnd() > 0.3) r.receiver.receive(p);
    };
    for (let bar = 0; bar < 40; bar++) {
      const n = 48 + ((bar * 7) % 24);
      r.sender.push(on(n, 40 + bar));
      deliver();
      r.advance(90);
      deliver();
      if (bar % 4 === 0) {
        r.sender.push([0xb0, 64, bar % 8 ? 0 : 127]);
        deliver();
      }
      r.sender.push(off(n));
      deliver();
      r.advance(60);
      deliver();
    }
    r.sender.push([0xb0, 64, 0]);
    deliver();
    // the trailing snapshots (sent twice) fix whatever was lost
    for (let i = 0; i < 30; i++) {
      r.advance(100);
      for (const p of r.take()) if (rnd() > 0.3 || i > 20) r.receiver.receive(p);
    }
    expect(r.receiver.state.heldCount).toBe(0);
    expect(r.receiver.state.pedals[0]).toBe(0);
  });

  it('only forwards notes, piano pedals, pitch bend and all-notes-off', () => {
    expect(forwardable([0x90, 60, 100])).toBe(true);
    expect(forwardable([0x80, 60, 0])).toBe(true);
    expect(forwardable([0xb0, 64, 127])).toBe(true);
    expect(forwardable([0xb0, 67, 127])).toBe(true);
    expect(forwardable([0xb0, 7, 100])).toBe(false); // volume would mute the other piano
    expect(forwardable([0xc0, 5])).toBe(false); // program change would switch its sound
    expect(forwardable([0xfe])).toBe(false); // active sensing
    expect(forwardable([0xf8])).toBe(false); // clock
    expect(forwardable([0xe0, 0, 64])).toBe(true);
  });

  it('NoteState treats note-on velocity 0 as note-off', () => {
    const s = new NoteState();
    s.apply([0x91, 60, 90]);
    expect(s.heldCount).toBe(1);
    s.apply([0x91, 60, 0]);
    expect(s.heldCount).toBe(0);
    expect(s.empty).toBe(true);
  });
});
