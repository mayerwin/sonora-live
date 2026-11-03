import { describe, expect, it } from 'vitest';
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
