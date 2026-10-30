// Bluetooth LE MIDI, straight from the browser (Web Bluetooth: Chrome and Edge on Windows, macOS, Android and
// ChromeOS; Linux behind a flag; Bluefy on iPhone and iPad). No pairing in the system settings, no driver: the
// browser lists the instruments that advertise the MIDI service, you pick yours, it plays.
//
// Packet format (MIDI Association, "Specification for MIDI over Bluetooth Low Energy"):
//   [header 1tHHHHHH] then messages, each preceded by a timestamp byte [1tLLLLLLL]; running status allowed;
//   SysEx F0 ... [ts] F7 may span packets. Timestamps (13 bits, ms) are ignored here: we play on arrival.

export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

function dataLength(status: number): number {
  const t = status & 0xf0;
  if (t === 0xc0 || t === 0xd0) return 1;
  if (t >= 0x80 && t < 0xf0) return 2;
  switch (status) {
    case 0xf1:
    case 0xf3:
      return 1;
    case 0xf2:
      return 2;
    default:
      return 0;
  }
}

/** Parse one BLE-MIDI packet into MIDI messages (System Exclusive is skipped). */
export class BleMidiParser {
  private running = 0;
  private inSysex = false;

  parse(p: Uint8Array): number[][] {
    const out: number[][] = [];
    if (p.length < 2 || !(p[0] & 0x80)) return out;
    let i = 1;
    while (i < p.length) {
      let b = p[i];
      if (this.inSysex) {
        // skip SysEx data until a (timestamp,) F7
        if (b === 0xf7) {
          this.inSysex = false;
          i++;
          continue;
        }
        if (b & 0x80 && i + 1 < p.length && p[i + 1] === 0xf7) {
          this.inSysex = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (b & 0x80) {
        // timestamp byte; a status byte or running-status data follows
        i++;
        if (i >= p.length) break;
        b = p[i];
      }
      if (b & 0x80) {
        if (b === 0xf0) {
          this.inSysex = true;
          this.running = 0;
          i++;
          continue;
        }
        if (b >= 0xf8) {
          out.push([b]); // real-time: does not change running status
          i++;
          continue;
        }
        const n = dataLength(b);
        const msg = [b];
        for (let k = 1; k <= n; k++) {
          const d = p[i + k];
          if (d === undefined || d & 0x80) return out;
          msg.push(d);
        }
        out.push(msg);
        this.running = b < 0xf0 ? b : 0;
        i += 1 + n;
      } else {
        // running status
        if (!this.running) {
          i++;
          continue;
        }
        const n = dataLength(this.running);
        const msg = [this.running];
        for (let k = 0; k < n; k++) {
          const d = p[i + k];
          if (d === undefined || d & 0x80) return out;
          msg.push(d);
        }
        out.push(msg);
        i += n;
      }
    }
    return out;
  }
}

/** Encode MIDI messages into one BLE-MIDI packet. */
export function encodeBleMidi(messages: number[][], nowMs = performance.now()): Uint8Array<ArrayBuffer> {
  const ts = Math.floor(nowMs) & 0x1fff;
  const header = 0x80 | ((ts >> 7) & 0x3f);
  const low = 0x80 | (ts & 0x7f);
  const bytes: number[] = [header];
  for (const m of messages) bytes.push(low, ...m);
  return new Uint8Array(bytes);
}

export const webBluetoothAvailable = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth;

// Minimal Web Bluetooth typings (not in the standard DOM library)
interface BtCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<BtCharacteristic>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BtCharacteristic> }>;
}
export interface BtDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BtServer;
}
interface BtApi {
  requestDevice(o: unknown): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
  getAvailability?(): Promise<boolean>;
}

function api(): BtApi | null {
  return webBluetoothAvailable() ? ((navigator as Navigator & { bluetooth: BtApi }).bluetooth ?? null) : null;
}

/** One Bluetooth LE MIDI instrument. */
export class BleMidiDevice {
  readonly device: BtDevice;
  onMessage: (m: number[]) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  private ch: BtCharacteristic | null = null;
  private parser = new BleMidiParser();
  private queue: number[][] = [];
  private writing = false;
  private closed = false;
  private retry = 0;

  constructor(device: BtDevice) {
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.ch = null;
      this.onStatus(false);
      if (!this.closed) this.reconnect();
    });
  }

  get name(): string {
    return this.device.name || 'Bluetooth instrument';
  }

  get connected(): boolean {
    return !!this.ch && !!this.device.gatt?.connected;
  }

  /** Show the browser's Bluetooth chooser, filtered to MIDI instruments. Must run from a click. */
  static async request(): Promise<BleMidiDevice | null> {
    const bt = api();
    if (!bt) return null;
    const device = await bt.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
    const d = new BleMidiDevice(device);
    await d.connect();
    return d;
  }

  /** Instruments this site was allowed to use before (Chrome with the new permissions backend). */
  static async known(): Promise<BtDevice[]> {
    const bt = api();
    if (!bt?.getDevices) return [];
    try {
      return await bt.getDevices();
    } catch {
      return [];
    }
  }

  async connect(): Promise<void> {
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    const ch = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    ch.addEventListener('characteristicvaluechanged', () => {
      const v = ch.value;
      if (!v) return;
      for (const m of this.parser.parse(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))) this.onMessage(m);
    });
    await ch.startNotifications();
    this.ch = ch;
    this.retry = 0;
    this.onStatus(true);
  }

  private reconnect(): void {
    const wait = Math.min(15_000, 1000 * 2 ** this.retry++);
    setTimeout(() => {
      if (this.closed || this.connected) return;
      this.connect().catch(() => this.reconnect());
    }, wait);
  }

  /** Send messages; those queued while a write is in flight go together in the next packet. */
  send(m: number[]): void {
    if (!this.ch) return;
    this.queue.push(m);
    if (!this.writing) void this.flush();
  }

  private async flush(): Promise<void> {
    this.writing = true;
    while (this.queue.length && this.ch) {
      // BLE packets carry at least 20 bytes (default MTU); keep packets small
      const batch: number[][] = [];
      let size = 1;
      while (this.queue.length && size + 1 + this.queue[0].length <= 20) {
        const m = this.queue.shift()!;
        batch.push(m);
        size += 1 + m.length;
      }
      if (!batch.length) batch.push(this.queue.shift()!);
      const pkt = encodeBleMidi(batch);
      try {
        if (this.ch.writeValueWithoutResponse) await this.ch.writeValueWithoutResponse(pkt);
        else await this.ch.writeValue(pkt);
      } catch {
        // a busy GATT queue: drop this batch rather than block (the snapshot logic cleans up stuck notes)
      }
    }
    this.writing = false;
  }

  close(): void {
    this.closed = true;
    try {
      this.device.gatt?.disconnect();
    } catch {
      // ignore
    }
  }
}
