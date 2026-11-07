import { describe, expect, it, vi } from 'vitest';
import { MidiHub } from '../../src/midi/hub.ts';
import { MidiSender } from '../../src/midi/wire.ts';

// the hub redraws the keys on the next frame (not part of these tests)
(globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame ??= () => 0;

/** A hub whose instrument output is recorded, receiving notes from peer "teacher". */
function setup() {
  const hub = new MidiHub();
  const sent: number[][] = [];
  hub.devices.send = (m: number[]) => void sent.push(m.slice());
  (hub.devices.hasOutput as { value: boolean }).value = true;
  hub.playOn.value = 'instrument';
  const packets: Uint8Array[] = [];
  const teacher = new MidiSender((p) => packets.push(p.slice()));
  const play = (m: number[]) => {
    teacher.push(m);
    for (const p of packets.splice(0)) hub.fromPeer('teacher', p.buffer as ArrayBuffer);
  };
  return { hub, sent, play };
}

describe('MIDI to this side’s instrument', () => {
  it('plays the others’ notes on the chosen output channel', () => {
    const { hub, sent, play } = setup();
    hub.setOutChannel(2);
    play([0x90, 60, 100]);
    expect(sent).toContainEqual([0x91, 60, 100]);
  });

  it('a new output channel releases what was sounding on the old one', () => {
    const { hub, sent, play } = setup();
    hub.setOutChannel(2);
    play([0xb0, 64, 127]);
    play([0x90, 60, 100]);
    sent.length = 0;
    hub.setOutChannel(3);
    expect(sent).toContainEqual([0x81, 60, 64]);
    expect(sent).toContainEqual([0xb1, 64, 0]);
  });

  it('moving the sound to the built-in piano releases on the channel the notes were sent on', () => {
    const { hub, sent, play } = setup();
    hub.setOutChannel(2);
    play([0x90, 64, 90]);
    sent.length = 0;
    hub.silenceRemote();
    expect(sent).toEqual([[0x81, 64, 64]]);
    // and only once
    sent.length = 0;
    hub.silenceRemote();
    expect(sent).toEqual([]);
  });

  it('switching instrument releases the notes on the old one first', () => {
    const { hub, sent, play } = setup();
    play([0x90, 67, 80]);
    sent.length = 0;
    hub.devices.onGone();
    expect(sent).toContainEqual([0x80, 67, 64]);
  });
});

describe('MIDI in time with their sound', () => {
  it('waits the delay, keeps the order, and plays at once without one', () => {
    vi.useFakeTimers();
    try {
      const { hub, sent, play } = setup();
      hub.setDelay('teacher', 80);
      play([0x90, 60, 100]);
      play([0x80, 60, 0]);
      expect(sent).toEqual([]);
      // the keys wait too
      expect(hub.remote.get('teacher')?.notes[60] ?? 0).toBe(0);
      vi.advanceTimersByTime(79);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(2);
      expect(sent).toEqual([
        [0x90, 60, 100],
        [0x80, 60, 0],
      ]);
      hub.setDelay('teacher', 0);
      play([0x90, 62, 90]);
      expect(sent).toContainEqual([0x90, 62, 90]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a note waiting when they leave never sounds (no hanging note)', () => {
    vi.useFakeTimers();
    try {
      const { hub, sent, play } = setup();
      hub.setDelay('teacher', 100);
      play([0x90, 60, 100]);
      hub.peerGone('teacher');
      vi.advanceTimersByTime(200);
      expect(sent.filter((m) => m[0] === 0x90 && m[2] > 0)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MIDI in time: hidden page and late messages', () => {
  it('when the page is hidden, what was waiting plays first, in order (no hanging note)', () => {
    vi.useFakeTimers();
    const doc = globalThis as unknown as { document?: { hidden: boolean } };
    const before = doc.document;
    try {
      const { hub, sent, play } = setup();
      hub.setDelay('teacher', 80);
      doc.document = { hidden: false };
      play([0x90, 60, 100]);
      doc.document = { hidden: true };
      play([0x80, 60, 0]);
      expect(sent).toEqual([
        [0x90, 60, 100],
        [0x80, 60, 0],
      ]);
      vi.advanceTimersByTime(200);
      expect(sent.length).toBe(2);
    } finally {
      doc.document = before;
      vi.useRealTimers();
    }
  });
});
