// MIDI instruments on this device: USB and system MIDI ports (Web MIDI: Chrome, Edge, Firefox, Opera; not Safari)
// and Bluetooth LE MIDI instruments connected straight from the browser (src/midi/ble.ts).
//
// An instrument usually appears as an input and an output port with the same (or a similar) name; they are shown
// as one instrument, so picking it is one tap.

import { signal } from '@preact/signals';
import { BleMidiDevice, webBluetoothAvailable } from './ble.ts';

export interface Instrument {
  /** stable key (remembered to reconnect next time) */
  key: string;
  name: string;
  kind: 'usb' | 'bluetooth' | 'virtual';
  input: boolean;
  output: boolean;
}

export type MidiStatus = 'idle' | 'asking' | 'ready' | 'denied' | 'unsupported';

/** "MIDIIN2 (FP-30X)" / "MIDIOUT2 (FP-30X)" / "FP-30X:FP-30X MIDI 1 24:0" -> one key */
export function instrumentKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s\d+:\d+$/, '') // ALSA client:port
    .replace(/\b(midi ?in|midi ?out|midiin\d*|midiout\d*)\b/g, ' ')
    .replace(/\b(input|output)\b/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function kindOf(name: string): Instrument['kind'] {
  if (/bluetooth|\bble\b|\bbt\b|bt-midi|widi|md-bt|bridge/i.test(name)) return 'bluetooth';
  if (/loopmidi|\biac\b|virtual|loopback|rtpmidi|network/i.test(name)) return 'virtual';
  return 'usb';
}

const HIDDEN = /midi through|through port|^microsoft gs wavetable|wavetable synth/i;

export class MidiDevices {
  readonly status = signal<MidiStatus>('idle');
  readonly instruments = signal<Instrument[]>([]);
  /** key of the selected instrument */
  readonly current = signal<string | null>(null);
  readonly currentName = signal('');
  /** the selected instrument is present and its input is listened to */
  readonly connected = signal(false);
  readonly hasOutput = signal(false);
  readonly bleBusy = signal(false);
  onMessage: (m: number[]) => void = () => {};
  /** the selected instrument appeared or went away */
  onPresence: (present: boolean, name: string) => void = () => {};

  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private ble: BleMidiDevice | null = null;

  get webMidi(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get bluetooth(): boolean {
    return webBluetoothAvailable();
  }

  /** Was MIDI allowed on this site before (then it can be opened without a prompt)? */
  async granted(): Promise<boolean> {
    try {
      const p = await navigator.permissions.query({ name: 'midi' as PermissionName });
      return p.state === 'granted';
    } catch {
      return false;
    }
  }

  async request(): Promise<boolean> {
    if (!this.webMidi) {
      this.status.value = 'unsupported';
      return false;
    }
    if (this.access) return true;
    this.status.value = 'asking';
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.status.value = 'denied';
      return false;
    }
    this.status.value = 'ready';
    this.access.onstatechange = () => this.refresh();
    this.refresh();
    return true;
  }

  private ports(): { inputs: MIDIInput[]; outputs: MIDIOutput[] } {
    const inputs: MIDIInput[] = [];
    const outputs: MIDIOutput[] = [];
    this.access?.inputs.forEach((p) => {
      if (p.state !== 'disconnected' && !HIDDEN.test(p.name ?? '')) inputs.push(p);
    });
    this.access?.outputs.forEach((p) => {
      if (p.state !== 'disconnected' && !HIDDEN.test(p.name ?? '')) outputs.push(p);
    });
    return { inputs, outputs };
  }

  refresh(): void {
    const { inputs, outputs } = this.ports();
    const map = new Map<string, Instrument>();
    const add = (name: string, dir: 'input' | 'output') => {
      const key = `port:${instrumentKey(name)}`;
      let i = map.get(key);
      if (!i) map.set(key, (i = { key, name: cleanName(name), kind: kindOf(name), input: false, output: false }));
      i[dir] = true;
    };
    for (const p of inputs) add(p.name ?? 'MIDI input', 'input');
    for (const p of outputs) add(p.name ?? 'MIDI output', 'output');
    const list = [...map.values()].sort((a, b) => Number(b.input) - Number(a.input) || a.name.localeCompare(b.name));
    if (this.ble) {
      list.unshift({ key: `ble:${this.ble.name}`, name: this.ble.name, kind: 'bluetooth', input: true, output: true });
    }
    this.instruments.value = list;
    // keep the selected instrument wired (it may have been unplugged and plugged in again)
    const cur = this.current.peek();
    if (cur?.startsWith('port:')) {
      const was = this.connected.peek();
      this.wirePorts(cur);
      if (was !== this.connected.peek()) this.onPresence(this.connected.peek(), this.currentName.peek());
    }
  }

  /** Use instrument `key` (both directions). */
  select(key: string | null): void {
    this.unwire();
    if (this.ble && key !== `ble:${this.ble.name}`) {
      this.ble.close();
      this.ble = null;
      this.refresh();
    }
    this.current.value = key;
    if (!key) {
      this.connected.value = false;
      this.hasOutput.value = false;
      this.currentName.value = '';
      return;
    }
    if (key.startsWith('ble:') && this.ble) {
      this.currentName.value = this.ble.name;
      this.connected.value = this.ble.connected;
      this.hasOutput.value = this.ble.connected;
      return;
    }
    this.wirePorts(key);
  }

  private wirePorts(key: string): void {
    const { inputs, outputs } = this.ports();
    const match = <T extends MIDIPort>(list: T[]) =>
      list
        .filter((p) => `port:${instrumentKey(p.name ?? '')}` === key)
        // "FP-30X" before "MIDIIN2 (FP-30X)": the main port of the instrument
        .sort((a, b) => Number(/midi(in|out)\d/i.test(a.name ?? '')) - Number(/midi(in|out)\d/i.test(b.name ?? '')))[0] ??
      null;
    const input = match(inputs);
    const output = match(outputs);
    if (input !== this.input) {
      if (this.input) this.input.onmidimessage = null;
      this.input = input;
      if (input) {
        input.onmidimessage = (e) => {
          const d = e.data;
          if (d && d.length) this.onMessage(Array.from(d));
        };
      }
    }
    this.output = output;
    if (output) void output.open?.().catch(() => {});
    this.connected.value = !!(input || output);
    this.hasOutput.value = !!output;
    this.currentName.value = cleanName(input?.name ?? output?.name ?? this.currentName.peek());
  }

  private unwire(): void {
    if (this.input) this.input.onmidimessage = null;
    this.input = null;
    this.output = null;
  }

  /** Bluetooth chooser (Web Bluetooth). Must be called from a click. */
  async connectBluetooth(): Promise<boolean> {
    this.bleBusy.value = true;
    try {
      const dev = await BleMidiDevice.request();
      if (!dev) return false;
      this.ble?.close();
      this.ble = dev;
      dev.onMessage = (m) => this.onMessage(m);
      dev.onStatus = (on) => {
        if (this.current.peek() !== `ble:${dev.name}`) return;
        this.connected.value = on;
        this.hasOutput.value = on;
        this.onPresence(on, dev.name);
      };
      this.refresh();
      this.select(`ble:${dev.name}`);
      return true;
    } catch (e) {
      // the user closed the chooser, or the instrument refused the connection
      if ((e as { name?: string })?.name !== 'NotFoundError') console.warn('[sonora] bluetooth', e);
      return false;
    } finally {
      this.bleBusy.value = false;
    }
  }

  /** Send a message to the instrument. */
  send(m: number[]): void {
    if (this.ble && this.current.peek()?.startsWith('ble:')) {
      this.ble.send(m);
      return;
    }
    try {
      this.output?.send(m);
    } catch {
      // port went away
    }
  }

  close(): void {
    this.unwire();
    this.ble?.close();
    this.ble = null;
  }
}

function cleanName(name: string): string {
  const m = /^midi(?:in|out)\d*\s*\((.*)\)$/i.exec(name.trim());
  return (m ? m[1] : name).replace(/\s\d+:\d+$/, '').trim() || 'MIDI instrument';
}
