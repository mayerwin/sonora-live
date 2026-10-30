import { describe, expect, it } from 'vitest';
import { BleMidiParser, encodeBleMidi } from '../../src/midi/ble.ts';
import { EchoFilter } from '../../src/midi/echo.ts';
import { instrumentKey } from '../../src/midi/devices.ts';

describe('BLE-MIDI', () => {
  it('parses a note with a timestamp', () => {
    const p = new BleMidiParser();
    expect(p.parse(new Uint8Array([0x80, 0x80, 0x90, 60, 100]))).toEqual([[0x90, 60, 100]]);
  });

  it('parses several messages and running status', () => {
    const p = new BleMidiParser();
    // header, ts, note on C, ts, (running) note on E, (running, no ts) note on G
    const pkt = new Uint8Array([0x81, 0x85, 0x90, 60, 90, 0x86, 64, 91, 67, 92]);
    expect(p.parse(pkt)).toEqual([
      [0x90, 60, 90],
      [0x90, 64, 91],
      [0x90, 67, 92],
    ]);
  });

  it('keeps real-time bytes out of running status', () => {
    const p = new BleMidiParser();
    const pkt = new Uint8Array([0x80, 0x80, 0xb0, 64, 127, 0x81, 0xfe, 0x82, 64, 0]);
    expect(p.parse(pkt)).toEqual([[0xb0, 64, 127], [0xfe], [0xb0, 64, 0]]);
  });

  it('skips System Exclusive, even across packets', () => {
    const p = new BleMidiParser();
    expect(p.parse(new Uint8Array([0x80, 0x80, 0xf0, 0x7e, 0x7f, 0x06]))).toEqual([]);
    expect(p.parse(new Uint8Array([0x80, 0x01, 0x02, 0x81, 0xf7, 0x82, 0x90, 60, 70]))).toEqual([[0x90, 60, 70]]);
  });

  it('a lost SysEx end does not swallow the messages after it', () => {
    const p = new BleMidiParser();
    expect(p.parse(new Uint8Array([0x80, 0x80, 0xf0, 0x41, 0x10]))).toEqual([]);
    // the F7 never came; the next packet starts with a timestamped note
    expect(p.parse(new Uint8Array([0x80, 0x81, 0x90, 64, 80]))).toEqual([[0x90, 64, 80]]);
  });

  it('round-trips what it encodes', () => {
    const msgs = [
      [0x90, 60, 100],
      [0x80, 60, 64],
      [0xb0, 64, 127],
    ];
    const pkt = encodeBleMidi(msgs, 12345);
    expect(pkt[0] & 0xc0).toBe(0x80);
    expect(new BleMidiParser().parse(pkt)).toEqual(msgs);
  });
});

describe('echo filter', () => {
  it('drops what comes back from the instrument right after we sent it', () => {
    const f = new EchoFilter();
    f.sent([0x90, 60, 80], 0);
    expect(f.isEcho([0x90, 60, 80], 20)).toBe(true);
    // only once
    expect(f.isEcho([0x90, 60, 80], 25)).toBe(false);
  });

  it('only filters releases and pedals once the instrument has shown that it echoes', () => {
    const f = new EchoFilter();
    // most instruments never echo: a release played at the same moment as one we sent is real
    f.sent([0x80, 60, 64], 0);
    expect(f.isEcho([0x80, 60, 40], 10)).toBe(false);
    f.sent([0xb0, 64, 0], 0);
    expect(f.isEcho([0xb0, 64, 0], 10)).toBe(false);
    // this one echoes: a note came back identical
    f.sent([0x90, 62, 77], 100);
    expect(f.isEcho([0x90, 62, 77], 105)).toBe(true);
    f.sent([0x80, 62, 64], 200);
    expect(f.isEcho([0x90, 62, 0], 210)).toBe(true); // note-off echoed as note-on velocity 0
  });

  it('lets the player through: other notes, or the same note later', () => {
    const f = new EchoFilter();
    f.sent([0x90, 60, 80], 0);
    expect(f.isEcho([0x90, 62, 80], 10)).toBe(false);
    expect(f.isEcho([0x90, 60, 80], 500)).toBe(false);
  });

  it('forgets on reset (another instrument)', () => {
    const f = new EchoFilter();
    f.sent([0x90, 62, 77], 0);
    f.isEcho([0x90, 62, 77], 5);
    expect(f.echoes).toBe(true);
    f.reset();
    expect(f.echoes).toBe(false);
  });
});

describe('instrument names', () => {
  it('pairs the input and output ports of one instrument', () => {
    expect(instrumentKey('MIDIIN2 (FP-30X)')).toBe(instrumentKey('MIDIOUT2 (FP-30X)'));
    expect(instrumentKey('FP-30X')).toBe('fp-30x');
    expect(instrumentKey('FP-30X:FP-30X MIDI 1 24:0')).toBe(instrumentKey('FP-30X:FP-30X MIDI 1 24:0'));
    expect(instrumentKey('Digital Piano MIDI Input')).toBe(instrumentKey('Digital Piano MIDI Output'));
  });
});
