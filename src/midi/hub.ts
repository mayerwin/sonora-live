// Where MIDI goes. Notes played here (instrument, on-screen keys, computer keyboard) go to every peer; notes from a
// peer go to this side's instrument, or to the built-in piano when there is none.
//
//   instrument in ──► echo filter ──► keyboard display ──► sender ──► peers
//   on-screen keys ─► built-in piano ─┘
//   peer ──► receiver (redundancy, stuck-note repair) ──► (in time with their sound) ──► keyboard display
//                                                          ──► instrument out  or  built-in piano
//
// In time with their sound: MIDI arrives before the sound of the same moment (it skips the microphone, the audio
// frames and the jitter buffer), so the keys would light up, and the notes sound, before the voice and the
// microphone's piano they belong to. Each peer's notes can wait that difference (setDelay), in order.

import { signal } from '@preact/signals';
import { MidiDevices } from './devices.ts';
import { EchoFilter } from './echo.ts';
import { Piano } from './piano.ts';
import { MidiReceiver, MidiSender, NoteState, forwardable, type MidiBytes } from './wire.ts';

const HubTiming = {
  /** how fast a peer's delay follows a change (ms per ms) */
  GLIDE: 0.02,
  /** a change larger than this (ms) applies at once */
  JUMP: 25,
};

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
  /** what the instrument sounds of the others' playing, as sent to it (output channel applied) */
  private sounding = new NoteState();
  private raf = 0;
  /** per peer: how long their notes wait (ms), the time the last one is due, and what is waiting */
  /** each peer's delay: where it is going and where it is now (it glides, see delayNow) */
  private delays = new Map<string, { target: number; cur: number; at: number }>();
  private lastDue = new Map<string, number>();
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => void }[]>();

  constructor() {
    this.sender = new MidiSender((p) => this.broadcast(p));
    this.devices.onMessage = (m) => this.fromInstrument(m);
    this.devices.onGone = () => {
      this.releaseLocal();
      // the others' notes it was sounding: released while it is still wired (a switch), forgotten if it is gone
      this.releaseInstrument();
      this.echo.reset();
    };
  }

  /**
   * Release what the instrument is sounding of the others' playing, exactly as it was sent (on the output channel
   * chosen then): before the output changes (another channel, another instrument, the built-in piano instead).
   */
  releaseInstrument(): void {
    for (const m of this.sounding.releaseAll()) {
      this.sounding.apply(m);
      this.echo.sent(m);
      this.devices.send(m);
    }
  }

  /** Send the others' notes on another channel (the ones sounding are released first). */
  setOutChannel(ch: number): void {
    if (ch === this.outChannel.peek()) return;
    this.releaseInstrument();
    this.outChannel.value = ch;
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
    const type = m[0] & 0xf0;
    const release = type === 0x80 || (type === 0x90 && m[2] === 0);
    // the player's own release of a key they hold always goes through
    const heldHere = release && this.local.notes[(m[0] & 15) * 128 + m[1]] > 0;
    if (!heldHere && this.echo.isEcho(m)) return;
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
      r = new MidiReceiver((m, late, at) =>
        this.inTime(id, late, at, () => {
          st.apply(m);
          if ((m[0] & 0xf0) === 0x90 && m[2] > 0) this.lastRemote.value = performance.now();
          this.bump();
          this.route(m, id);
        }),
      );
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
      this.sounding.apply(out);
      this.echo.sent(out);
      this.devices.send(out);
    }
  }

  /** Snapshot for a peer that just connected (it learns what is held, e.g. the pedal). */
  helloPacket(): Uint8Array {
    return this.sender.hello();
  }

  /** Delay peer `id`'s notes by `ms` (0: as they arrive), to keep them in time with their sound. */
  setDelay(id: string, ms: number): void {
    const v = Math.max(0, Math.min(500, Math.round(ms)));
    const now = performance.now();
    const d = this.delays.get(id);
    // the first value at once, and a large change (the start, the network changing): its sound's delay jumps too;
    // small changes glide (delayNow)
    if (!d || v === 0 || Math.abs(v - this.delayNow(id, now)) > HubTiming.JUMP)
      this.delays.set(id, { target: v, cur: v, at: now });
    else this.delays.set(id, { target: v, cur: this.delayNow(id, now), at: now });
  }

  delayOf(id: string): number {
    return this.delays.get(id)?.target ?? 0;
  }

  /**
   * The delay applied now: changes glide at 20 ms per second (as the sound's jitter buffer stretches or shrinks
   * its delay), so a new delay never shifts a phrase at once; a step of 10 ms is spread over half a second.
   */
  private delayNow(id: string, now = performance.now()): number {
    const d = this.delays.get(id);
    if (!d) return 0;
    const step = (now - d.at) * HubTiming.GLIDE;
    return d.target > d.cur ? Math.min(d.target, d.cur + step) : Math.max(d.target, d.cur - step);
  }

  /**
   * Run `fn` when peer `id`'s delay has passed, after anything of theirs already waiting (order kept). With the
   * sender's moment `at` (stamped packets), the delay counts from its usual arrival, so the network's jitter is
   * taken out (src/midi/wire.ts, Playout); otherwise from this arrival, minus `late` (how old the message already
   * is: recovered from a later packet).
   */
  private inTime(id: string, late: number, at: number | undefined, fn: () => void): void {
    const d = this.delayNow(id);
    const now = performance.now();
    const queue = this.pending.get(id) ?? [];
    // a hidden page's timers are slowed down to a second: play at once then, after what was already waiting (in
    // order: a release must never overtake its note, or the note hangs)
    if (typeof document !== 'undefined' && document.hidden) {
      this.flush(id);
      fn();
      return;
    }
    if (d <= 0 && !queue.length) {
      fn();
      return;
    }
    const planned = d > 0 && at !== undefined ? (this.receivers.get(id)?.playout.due(at, d) ?? null) : null;
    const due = Math.max(planned ?? now + Math.max(0, d - late), this.lastDue.get(id) ?? 0);
    if (due <= now && !queue.length) {
      fn();
      return;
    }
    this.lastDue.set(id, due);
    const item = {
      timer: setTimeout(() => {
        const q = this.pending.get(id);
        if (q) q.splice(q.indexOf(item), 1);
        fn();
      }, due - now),
      fn,
    };
    queue.push(item);
    this.pending.set(id, queue);
  }

  /** Play at once, in order, whatever of peer `id` is waiting. */
  private flush(id: string): void {
    const q = this.pending.get(id);
    if (!q?.length) return;
    this.pending.delete(id);
    this.lastDue.delete(id);
    for (const item of q) {
      clearTimeout(item.timer);
      item.fn();
    }
  }

  /** Peer `id` left or turned MIDI off: release whatever it was holding. */
  peerGone(id: string): void {
    // what was waiting would sound after the release, and hang
    for (const item of this.pending.get(id) ?? []) clearTimeout(item.timer);
    this.pending.delete(id);
    this.lastDue.delete(id);
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
    this.releaseInstrument();
    for (const id of this.remote.keys()) this.piano.allOff(id);
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
      setTimeout(
        () => {
          const off = [0x80 | ch, n, 64];
          this.echo.sent(off);
          this.devices.send(off);
        },
        i * 160 + (i === notes.length - 1 ? 700 : 150),
      );
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
