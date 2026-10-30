// One direct WebRTC connection to another member of the room.
//
// Media layout (fixed for the life of the connection, so devices, mute, camera off and screen sharing never need
// a renegotiation, only RTCRtpSender.replaceTrack):
//   transceiver 0  audio   instrument / voice
//   transceiver 1  video   camera
//   transceiver 2  video   extra: screen share or a second camera (e.g. pointed at the keys)
// Audio and video use separate MediaStreams on purpose: tracks of one stream are lip-synced, which holds the sound
// back until the (slower) video is decoded. Here the sound is played the moment it arrives.
//
// Data channels (negotiated, so they open together with the connection):
//   0 ctl   reliable, ordered      state, chat, room rules, signaling
//   1 midi  unordered, no resend   MIDI events, which carry their own redundancy (src/midi/wire.ts)
//   2 file  reliable, ordered      files shared in the chat (sheet music, pictures)
//
// The "perfect negotiation" pattern keeps offers from both sides safe (ICE restarts can start on either side), and
// a connection that drops (Wi-Fi change, a laptop waking up) is restarted instead of rebuilt.

import { tuneOpus, type OpusTuning } from './sdp.ts';

export type Slot = 'audio' | 'video' | 'extra';
export const SLOTS: Slot[] = ['audio', 'video', 'extra'];

export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface SignalData {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface SendParams {
  audioBitrate: number;
  videoBitrate: number;
  extraBitrate: number;
}

export interface LinkStats {
  at: number;
  rtt: number | null;
  /** the path goes through a TURN relay */
  relayed: boolean;
  path: string;
  audioInKbps: number;
  audioOutKbps: number;
  audioOutPps: number;
  audioLossPct: number;
  jitterMs: number;
  bufferMs: number;
  audioCodec: string;
  audioChannels: number;
  videoIn: { w: number; h: number; fps: number; kbps: number } | null;
  videoOut: { w: number; h: number; fps: number; kbps: number; limit: string } | null;
  /** estimated mouth-to-ear delay of the sound coming from this peer, ms */
  latencyMs: number | null;
  quality: 'good' | 'fair' | 'poor' | 'unknown';
}

const RESTART_AFTER_MS = 2500;
const GIVE_UP_MS = 45_000;

export class PeerLink {
  readonly id: string;
  readonly pc: RTCPeerConnection;
  readonly ctl: RTCDataChannel;
  readonly midi: RTCDataChannel;
  readonly file: RTCDataChannel;
  readonly polite: boolean;
  readonly initiator: boolean;
  state: LinkState = 'connecting';
  /** the data channels opened at least once */
  everConnected = false;

  onState: (s: LinkState) => void = () => {};
  onTrack: (slot: Slot, track: MediaStreamTrack) => void = () => {};
  onControl: (msg: Record<string, unknown>) => void = () => {};
  onMidi: (data: ArrayBuffer) => void = () => {};
  onFile: (data: ArrayBuffer | string) => void = () => {};
  onSignal: (data: SignalData) => void = () => {};
  /** the connection could not be restored */
  onLost: () => void = () => {};

  private tx: Partial<Record<Slot, RTCRtpTransceiver>> = {};
  private local: Record<Slot, MediaStreamTrack | null>;
  private streams: Record<Slot, MediaStream>;
  private params: SendParams;
  private tuning: OpusTuning;
  private makingOffer = false;
  private ignoreOffer = false;
  private answeredFirst = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private queue: string[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private prev: Map<string, { t: number; v: Record<string, number> }> = new Map();
  private closed = false;

  constructor(opts: {
    id: string;
    selfId: string;
    initiator: boolean;
    iceServers: RTCIceServer[];
    tracks: Record<Slot, MediaStreamTrack | null>;
    streams: Record<Slot, MediaStream>;
    params: SendParams;
    tuning: OpusTuning;
  }) {
    this.id = opts.id;
    this.initiator = opts.initiator;
    this.polite = opts.selfId < opts.id;
    this.local = { ...opts.tracks };
    this.streams = opts.streams;
    this.params = opts.params;
    this.tuning = opts.tuning;
    const pc = new RTCPeerConnection({
      iceServers: opts.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 1,
    });
    this.pc = pc;

    if (this.initiator) {
      // the offer carries the three media sections in a fixed order
      this.tx.audio = pc.addTransceiver(this.local.audio ?? 'audio', { direction: 'sendrecv', streams: [this.streams.audio] });
      this.tx.video = pc.addTransceiver(this.local.video ?? 'video', { direction: 'sendrecv', streams: [this.streams.video] });
      this.tx.extra = pc.addTransceiver(this.local.extra ?? 'video', { direction: 'sendrecv', streams: [this.streams.extra] });
    }
    this.ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true });
    this.midi = pc.createDataChannel('midi', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.file = pc.createDataChannel('file', { negotiated: true, id: 2, ordered: true });
    this.midi.binaryType = 'arraybuffer';
    this.file.binaryType = 'arraybuffer';
    this.file.bufferedAmountLowThreshold = 256 * 1024;

    pc.onnegotiationneeded = () => void this.negotiate();
    pc.onicecandidate = (e) => {
      if (e.candidate) this.onSignal({ candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
      if (slot) this.onTrack(slot, e.track);
    };
    pc.onconnectionstatechange = () => this.onConnectionState();
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyParams();
    };

    this.ctl.onopen = () => {
      this.everConnected = true;
      for (const m of this.queue.splice(0)) this.ctl.send(m);
      this.setState('connected');
    };
    this.ctl.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg && typeof msg === 'object') this.onControl(msg);
      } catch {
        // malformed: ignore
      }
    };
    this.ctl.onclose = () => {
      if (!this.closed) this.lost();
    };
    this.midi.onmessage = (e) => this.onMidi(e.data as ArrayBuffer);
    this.file.onmessage = (e) => this.onFile(e.data as ArrayBuffer | string);
  }

  // ------------------------------------------------------------------------------------------- negotiation

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    // the answerer's first negotiation-needed (its data channels) is covered by the offer it answers
    if (!this.initiator && !this.answeredFirst) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.sendDescription();
    } catch (e) {
      console.warn('[sonora] offer failed', e);
    } finally {
      this.makingOffer = false;
    }
  }

  private sendDescription(): void {
    const d = this.pc.localDescription;
    if (!d) return;
    this.onSignal({ description: { type: d.type, sdp: tuneOpus(d.sdp, this.tuning) } });
  }

  async receiveSignal(data: SignalData): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          if (!this.initiator && !this.answeredFirst) await this.adoptTransceivers();
          await pc.setLocalDescription();
          this.answeredFirst = true;
          this.sendDescription();
        }
        for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (!pc.remoteDescription) {
          this.pendingCandidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!this.ignoreOffer) console.warn('[sonora] candidate', e);
        }
      }
    } catch (e) {
      console.warn('[sonora] signaling', e);
    }
  }

  /** Answerer: take over the media sections of the first offer and send on them too. */
  private async adoptTransceivers(): Promise<void> {
    const ts = this.pc.getTransceivers();
    for (let i = 0; i < SLOTS.length && i < ts.length; i++) {
      const slot = SLOTS[i];
      const t = ts[i];
      this.tx[slot] = t;
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(this.local[slot]).catch(() => {});
      try {
        t.sender.setStreams?.(this.streams[slot]);
      } catch {
        // Firefox: no setStreams (no lip sync there either way)
      }
    }
  }

  // ------------------------------------------------------------------------------------------- media

  /** Send `track` on `slot` (null: nothing), without renegotiation. */
  async setTrack(slot: Slot, track: MediaStreamTrack | null): Promise<void> {
    this.local[slot] = track;
    const t = this.tx[slot];
    if (!t) return; // answerer before the first offer: adopted then
    try {
      await t.sender.replaceTrack(track);
    } catch (e) {
      console.warn('[sonora] replaceTrack', slot, e);
    }
  }

  setParams(p: SendParams): void {
    this.params = p;
    void this.applyParams();
  }

  private async applyParams(): Promise<void> {
    const set = async (slot: Slot, f: (e: RTCRtpEncodingParameters) => void, degradation?: RTCDegradationPreference) => {
      const s = this.tx[slot]?.sender;
      if (!s) return;
      try {
        const p = s.getParameters();
        if (!p.encodings?.length) return;
        for (const e of p.encodings) f(e);
        if (degradation) (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = degradation;
        await s.setParameters(p);
      } catch {
        // not negotiated yet, or a browser without that parameter
      }
    };
    await set('audio', (e) => {
      e.maxBitrate = this.params.audioBitrate;
      e.priority = 'high';
      e.networkPriority = 'high';
    });
    await set(
      'video',
      (e) => {
        e.maxBitrate = this.params.videoBitrate;
        e.maxFramerate = 30;
        e.priority = 'medium';
        e.networkPriority = 'medium';
      },
      'maintain-framerate',
    );
    await set(
      'extra',
      (e) => {
        e.maxBitrate = this.params.extraBitrate;
        e.priority = 'low';
      },
      'maintain-resolution',
    );
  }

  // ------------------------------------------------------------------------------------------- data

  sendControl(msg: Record<string, unknown>): void {
    const text = JSON.stringify(msg);
    if (this.ctl.readyState === 'open') {
      try {
        this.ctl.send(text);
        return;
      } catch {
        // fall through to the queue
      }
    }
    if (this.queue.length < 500) this.queue.push(text);
  }

  sendMidi(data: Uint8Array): void {
    if (this.midi.readyState !== 'open') return;
    try {
      this.midi.send(data as Uint8Array<ArrayBuffer>);
    } catch {
      // buffer full: the next packet repeats these events
    }
  }

  get ctlOpen(): boolean {
    return this.ctl.readyState === 'open';
  }

  // ------------------------------------------------------------------------------------------- recovery

  private onConnectionState(): void {
    const s = this.pc.connectionState;
    if (s === 'connected') {
      this.clearRecovery();
      if (this.ctl.readyState === 'open') this.setState('connected');
    } else if (s === 'disconnected' || s === 'failed') {
      if (!this.everConnected) {
        // never connected: give it the same grace, then give up
        this.armLost();
      }
      this.setState('reconnecting');
      if (!this.restartTimer) {
        const wait = s === 'failed' ? 0 : RESTART_AFTER_MS + (this.polite ? 1500 : 0);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.restartIce();
        }, wait);
      }
      this.armLost();
    } else if (s === 'closed') {
      this.lost();
    }
  }

  private armLost(): void {
    if (this.lostTimer) return;
    this.lostTimer = setTimeout(() => {
      this.lostTimer = null;
      if (this.pc.connectionState !== 'connected') this.lost();
    }, GIVE_UP_MS);
  }

  /** Ask for new network paths (after a network change or a dropped connection). */
  restartIce(): void {
    if (this.closed || this.pc.connectionState === 'connected') return;
    try {
      this.pc.restartIce();
    } catch {
      // closed
    }
  }

  private clearRecovery(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.restartTimer = null;
    this.lostTimer = null;
  }

  private lost(): void {
    if (this.closed) return;
    this.close();
    this.onLost();
  }

  private setState(s: LinkState): void {
    if (this.state === s || this.state === 'closed') return;
    this.state = s;
    this.onState(s);
  }

  // ------------------------------------------------------------------------------------------- stats

  async stats(): Promise<LinkStats | null> {
    if (this.closed) return null;
    let report: RTCStatsReport;
    try {
      report = await this.pc.getStats();
    } catch {
      return null;
    }
    const now = performance.now();
    const all = new Map<string, Record<string, unknown>>();
    report.forEach((v) => all.set((v as { id: string }).id, v as Record<string, unknown>));
    const out: LinkStats = {
      at: Date.now(),
      rtt: null,
      relayed: false,
      path: '',
      audioInKbps: 0,
      audioOutKbps: 0,
      audioOutPps: 0,
      audioLossPct: 0,
      jitterMs: 0,
      bufferMs: 0,
      audioCodec: '',
      audioChannels: 0,
      videoIn: null,
      videoOut: null,
      latencyMs: null,
      quality: 'unknown',
    };
    // the candidate pair in use
    let pair: Record<string, unknown> | undefined;
    for (const v of all.values()) {
      if (v.type === 'transport' && v.selectedCandidatePairId) pair = all.get(String(v.selectedCandidatePairId));
    }
    if (!pair) {
      for (const v of all.values()) if (v.type === 'candidate-pair' && v.nominated && v.state === 'succeeded') pair = v;
    }
    if (pair) {
      if (typeof pair.currentRoundTripTime === 'number') out.rtt = Math.round(pair.currentRoundTripTime * 1000);
      const lc = all.get(String(pair.localCandidateId));
      const rc = all.get(String(pair.remoteCandidateId));
      out.relayed = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
      const kind = (c?: Record<string, unknown>) =>
        c?.candidateType === 'host' ? 'local network' : c?.candidateType === 'relay' ? 'relay' : 'internet';
      out.path = `${out.relayed ? 'Relayed (TURN)' : 'Direct'} · ${String(lc?.protocol ?? 'udp').toUpperCase()} · ${kind(rc)}`;
    }
    const delta = (key: string, v: Record<string, number>) => {
      const p = this.prev.get(key);
      this.prev.set(key, { t: now, v });
      if (!p) return null;
      const dt = (now - p.t) / 1000;
      if (dt <= 0) return null;
      const d: Record<string, number> = { dt };
      for (const k of Object.keys(v)) d[k] = (v[k] ?? 0) - (p.v[k] ?? 0);
      return d;
    };
    for (const v of all.values()) {
      if (v.type === 'inbound-rtp' && v.kind === 'audio') {
        const d = delta('ain', {
          bytes: Number(v.bytesReceived ?? 0),
          lost: Number(v.packetsLost ?? 0),
          recv: Number(v.packetsReceived ?? 0),
          jbd: Number(v.jitterBufferDelay ?? 0),
          jbe: Number(v.jitterBufferEmittedCount ?? 0),
        });
        out.jitterMs = Math.round(Number(v.jitter ?? 0) * 1000);
        const codec = all.get(String(v.codecId));
        if (codec) {
          out.audioCodec = String(codec.mimeType ?? '').replace('audio/', '');
          out.audioChannels = Number(codec.channels ?? 0);
        }
        if (d) {
          out.audioInKbps = Math.round((d.bytes * 8) / d.dt / 1000);
          const total = d.lost + d.recv;
          out.audioLossPct = total > 0 ? Math.max(0, (d.lost / total) * 100) : 0;
          if (d.jbe > 0) out.bufferMs = Math.round((d.jbd / d.jbe) * 1000);
        }
      } else if (v.type === 'outbound-rtp' && v.kind === 'audio') {
        const d = delta('aout', { bytes: Number(v.bytesSent ?? 0), pk: Number(v.packetsSent ?? 0) });
        if (d) {
          out.audioOutKbps = Math.round((d.bytes * 8) / d.dt / 1000);
          out.audioOutPps = Math.round(d.pk / d.dt);
        }
      } else if (v.type === 'inbound-rtp' && v.kind === 'video') {
        const mid = String(v.mid ?? '');
        if (mid && mid !== String(this.tx.video?.mid ?? '1')) continue;
        const d = delta('vin', { bytes: Number(v.bytesReceived ?? 0) });
        out.videoIn = {
          w: Number(v.frameWidth ?? 0),
          h: Number(v.frameHeight ?? 0),
          fps: Math.round(Number(v.framesPerSecond ?? 0)),
          kbps: d ? Math.round((d.bytes * 8) / d.dt / 1000) : 0,
        };
      } else if (v.type === 'outbound-rtp' && v.kind === 'video') {
        const mid = String(v.mid ?? '');
        if (mid && mid !== String(this.tx.video?.mid ?? '1')) continue;
        const d = delta('vout', { bytes: Number(v.bytesSent ?? 0) });
        out.videoOut = {
          w: Number(v.frameWidth ?? 0),
          h: Number(v.frameHeight ?? 0),
          fps: Math.round(Number(v.framesPerSecond ?? 0)),
          kbps: d ? Math.round((d.bytes * 8) / d.dt / 1000) : 0,
          limit: String(v.qualityLimitationReason ?? 'none'),
        };
      }
    }
    if (out.rtt !== null) {
      // capture (~10 ms) + one 10 ms frame + network (half the round trip) + jitter buffer + playout (~10 ms)
      out.latencyMs = Math.round(10 + this.tuning.ptime + out.rtt / 2 + out.bufferMs + 10);
      out.quality =
        out.rtt < 160 && out.audioLossPct < 2 ? 'good' : out.rtt < 320 && out.audioLossPct < 6 ? 'fair' : 'poor';
    }
    return out;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearRecovery();
    this.setState('closed');
    try {
      this.pc.close();
    } catch {
      // ignore
    }
  }
}
