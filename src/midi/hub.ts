// Where MIDI goes. Notes played here (instrument, on-screen keys, computer keyboard) go to every peer; notes from a
// peer go to this side's instrument, or to the built-in piano when there is none.
//
//   instrument in ──► echo filter ──► keyboard display ──► sender ──► peers
//   on-screen keys ─► built-in piano ─┘
//   peer ──► receiver (redundancy, stuck-note repair) ──► keyboard display ──► instrument out  or  built-in piano

import { signal } from '@preact/signals';
import { MidiDevices } from './devices.ts';
import { EchoFilter } from './echo.ts';
import { Piano } from './piano.ts';
import { MidiReceiver, MidiSender, NoteState, forwardable, type MidiBytes } from './wire.ts';

export type PlayOn = 'auto' | 'instrument' | 'piano' | 'off';

export class MidiHub {
  readonly devices = new MidiDevices();
  readonly piano = new Piano();
  /** send what is played here to the others */
  readonly sending = signal(true);
  /** where the others' notes sound */
  readonly playOn = signal<PlayOn>('auto');
  /** MIDI channel for the instrument output (0: as played, 1–16) */
  readonly outChannel = signal(0);
  /** bumps when the keyboard display should redraw */
  readonly version = signal(0);
  /** last time a note was played here / received (performance.now) */
  readonly lastLocal = signal(0);
  readonly lastRemote = signal(0);
  /** notes held here, and per peer */
  readonly local = new NoteState();
  readonly remote = new Map<string, NoteState>();
  /** packets for every peer */
  broadcast: (packet: Uint8Array) => void = () => {};

  private echo = new EchoFilter();
  private sender: MidiSender;
  private receivers = new Map<string, MidiReceiver>();
  private raf = 0;

  constructor() {
    this.sender = new MidiSender((p) => this.broadcast(p));
    this.devices.onMessage = (m) => this.fromInstrument(m);
    this.devices.onGone = () => this.releaseLocal();
  }

  /** The instrument went away mid-phrase: its key and pedal releases will never come, so send them now. */
  releaseLocal(): void {
    const release = this.local.releaseAll();
    if (!release.length) return;
    for (const m of release) this.played(m);
  }

  /** Where the others' notes sound right now. */
  get target(): 'instrument' | 'piano' | 'off' {
    const p = this.playOn.value;
    if (p === 'off') return 'off';
    if (p === 'piano') return 'piano';
    if (p === 'instrument') return this.devices.hasOutput.value ? 'instrument' : 'piano';
    return this.devices.hasOutput.value ? 'instrument' : 'piano';
  }

  private bump(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.version.value++;
    });
  }

  private fromInstrument(m: number[]): void {
    if (!forwardable(m)) return;
    if (this.echo.isEcho(m)) return;
    this.played(m);
  }

  /** On-screen keys / computer keyboard: they make no sound of their own, so the built-in piano plays them. */
  fromScreen(m: MidiBytes): void {
    this.piano.midi(m, 'local');
    this.played(m);
  }

  private played(m: MidiBytes): void {
    this.local.apply(m);
    if ((m[0] & 0xf0) === 0x90 && m[2] > 0) this.lastLocal.value = performance.now();
    this.bump();
    if (this.sending.peek()) this.sender.push(m);
  }

  /** A packet from peer `id`'s MIDI channel. */
  fromPeer(id: string, packet: ArrayBuffer): void {
    let r = this.receivers.get(id);
    if (!r) {
      let state = this.remote.get(id);
      if (!state) this.remote.set(id, (state = new NoteState()));
      const st = state;
      r = new MidiReceiver((m) => {
        st.apply(m);
        if ((m[0] & 0xf0) === 0x90 && m[2] > 0) this.lastRemote.value = performance.now();
        this.bump();
        this.route(m, id);
      });
      this.receivers.set(id, r);
    }
    r.receive(packet);
  }

  private route(m: MidiBytes, id: string): void {
    const target = this.target;
    if (target === 'piano') {
      this.piano.midi(m, id);
    } else if (target === 'instrument') {
      const out = m.slice();
      const ch = this.outChannel.peek();
      if (ch >= 1 && ch <= 16) out[0] = (out[0] & 0xf0) | (ch - 1);
      this.echo.sent(out);
      this.devices.send(out);
    }
  }

  /** Snapshot for a peer that just connected (it learns what is held, e.g. the pedal). */
  helloPacket(): Uint8Array {
    return this.sender.hello();
  }

  /** Peer `id` left or turned MIDI off: release whatever it was holding. */
  peerGone(id: string): void {
    this.receivers.get(id)?.reset();
    this.receivers.delete(id);
    this.remote.delete(id);
    this.piano.allOff(id);
    this.bump();
  }

  /** Stop sending: release what the others hold of ours. */
  setSending(on: boolean): void {
    if (!on && this.sending.peek()) for (const m of this.local.releaseAll()) this.sender.push(m);
    this.sending.value = on;
  }

  /** The sound moves elsewhere (instrument <-> built-in piano): silence the old place. */
  silenceRemote(): void {
    for (const [id, st] of this.remote) {
      for (const m of st.releaseAll()) {
        this.echo.sent(m);
        this.devices.send(m);
      }
      this.piano.allOff(id);
    }
  }

  /** A short C–E–G–C on the instrument, to check that it plays what it receives. */
  testInstrument(): void {
    const ch = Math.max(0, this.outChannel.peek() - 1);
    const notes = [60, 64, 67, 72];
    notes.forEach((n, i) => {
      setTimeout(() => {
        const on = [0x90 | ch, n, 90];
        this.echo.sent(on);
        this.devices.send(on);
      }, i * 160);
      setTimeout(() => {
        const off = [0x80 | ch, n, 64];
        this.echo.sent(off);
        this.devices.send(off);
      }, i * 160 + (i === notes.length - 1 ? 700 : 150));
    });
  }

  /** Is note `n` held on any side? (for the keyboard display) */
  holder(n: number): { local: boolean; remote: string | null } {
    let local = false;
    for (let ch = 0; ch < 16 && !local; ch++) if (this.local.notes[ch * 128 + n]) local = true;
    let remote: string | null = null;
    for (const [id, st] of this.remote) {
      for (let ch = 0; ch < 16; ch++) {
        if (st.notes[ch * 128 + n]) {
          remote = id;
          break;
        }
      }
      if (remote) break;
    }
    return { local, remote };
  }

  sustainHeld(): { local: boolean; remote: boolean } {
    const any = (st: NoteState) => {
      for (let ch = 0; ch < 16; ch++) if (st.pedals[ch * 3] >= 64) return true;
      return false;
    };
    let remote = false;
    for (const st of this.remote.values()) if (any(st)) remote = true;
    return { local: any(this.local), remote };
  }

  dispose(): void {
    this.sender.dispose();
    this.devices.close();
    this.piano.allOff();
  }
}
