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

import { LatencyGuard } from './guard.ts';
import { tuneOpus, type OpusTuning } from './sdp.ts';

export type Slot = 'audio' | 'video' | 'extra';
export const SLOTS: Slot[] = ['audio', 'video', 'extra'];

export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface SignalData {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** the sending connection's id, and (once known) the receiving connection's: a signal meant for an older
   * connection is dropped, an offer from a newer one replaces the old (src/app/participants.ts) */
  cid?: string;
  to?: string;
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
  /** how the two meet: on the same network, across the internet, or through a relay */
  via: 'local' | 'internet' | 'relay' | null;
  /** transport protocol of the path (UDP, TCP) */
  path: string;
  /** round trip measured on the audio itself (RTCP), ms */
  audioRtt: number | null;
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
/** a connection that never opens is given up after this */
const CONNECT_TIMEOUT_MS = 25_000;

/** Testing: relayed paths only, as on networks that block direct ones (?nodirect, or window.sonoraNoDirect). */
function noDirect(): boolean {
  if (typeof location === 'undefined') return false;
  const flag = (globalThis as { sonoraNoDirect?: boolean }).sonoraNoDirect;
  return flag ?? /[?&]nodirect\b/.test(location.search);
}
/** an offer not answered yet is sent again (the relay may lose a message, or be down for a moment) */
const RESEND_OFFER_MS = 4000;

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
  /** this connection's id (random), and the other side's connection's, learnt from its first signal */
  readonly cid = Math.random().toString(36).slice(2, 12);
  remoteCid: string | null = null;

  onState: (s: LinkState) => void = () => {};
  onTrack: (slot: Slot, track: MediaStreamTrack) => void = () => {};
  onControl: (msg: Record<string, unknown>) => void = () => {};
  onMidi: (data: ArrayBuffer) => void = () => {};
  onFile: (data: ArrayBuffer | string) => void = () => {};
  onSignal: (data: SignalData) => void = () => {};
  /** the connection could not be restored */
  onLost: () => void = () => {};
  /** the MIDI channel opened (the moment to tell the peer which keys and pedals are held) */
  onMidiOpen: () => void = () => {};

  private tx: Partial<Record<Slot, RTCRtpTransceiver>> = {};
  private local: Record<Slot, MediaStreamTrack | null>;
  private streams: Record<Slot, MediaStream>;
  private params: SendParams;
  private tuning: OpusTuning;
  private makingOffer = false;
  private ignoreOffer = false;
  private answeredFirst = false;
  /** a first offer/answer exchange completed on this link */
  private negotiated = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private queue: string[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private prev: Map<string, { t: number; v: Record<string, number> }> = new Map();
  private closed = false;
  /** keeps video from queuing ahead of sound and MIDI (src/net/guard.ts) */
  readonly guard = new LatencyGuard();
  /** measurement counters at the last poll: the guard only takes new measurements */
  private pairResponses = -1;
  private audioRttCount = -1;

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
      iceTransportPolicy: noDirect() ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 1,
    });
    this.pc = pc;

    if (this.initiator) {
      // the offer carries the three media sections in a fixed order
      this.tx.audio = pc.addTransceiver(this.local.audio ?? 'audio', {
        direction: 'sendrecv',
        streams: [this.streams.audio],
      });
      this.tx.video = pc.addTransceiver(this.local.video ?? 'video', {
        direction: 'sendrecv',
        streams: [this.streams.video],
      });
      this.tx.extra = pc.addTransceiver(this.local.extra ?? 'video', {
        direction: 'sendrecv',
        streams: [this.streams.extra],
      });
    }
    // MIDI goes first on the shared connection; files only fill what is left (priority: browsers that support it)
    const dc = (label: string, init: RTCDataChannelInit & { priority?: RTCPriorityType }) =>
      pc.createDataChannel(label, init);
    this.ctl = dc('ctl', { negotiated: true, id: 0, ordered: true, priority: 'medium' });
    this.midi = dc('midi', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0, priority: 'high' });
    this.file = dc('file', { negotiated: true, id: 2, ordered: true, priority: 'very-low' });
    this.midi.binaryType = 'arraybuffer';
    this.file.binaryType = 'arraybuffer';
    this.file.bufferedAmountLowThreshold = 64 * 1024;

    pc.onnegotiationneeded = () => void this.negotiate();
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signalOut({ candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      // video frames are shown as soon as they are decoded, without the smoothing buffer: hands on the keys
      // seen at once matter more than perfectly even motion (Chromium; other browsers ignore it)
      if (e.track.kind === 'video') {
        try {
          (e.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = 0;
        } catch {
          // not supported
        }
      }
      // by the order of the media sections both sides agree on (the offer's), not by our own list, which also
      // holds the unused transceivers of an offer we gave up in a collision
      const order = midsOf(pc.remoteDescription?.sdp);
      const at = e.transceiver.mid ? order.indexOf(e.transceiver.mid) : -1;
      const slot = SLOTS[at >= 0 ? at : pc.getTransceivers().indexOf(e.transceiver)];
      if (slot) this.onTrack(slot, e.track);
    };
    pc.onconnectionstatechange = () => this.onConnectionState();
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyParams();
    };

    this.ctl.onopen = () => {
      this.everConnected = true;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      for (const m of this.queue.splice(0)) this.ctl.send(m);
      this.setState('connected');
    };
    this.midi.onopen = () => this.onMidiOpen();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.everConnected) this.lost();
    }, CONNECT_TIMEOUT_MS);
    this.resendTimer = setInterval(() => {
      if (this.state !== 'connected' && this.pc.signalingState === 'have-local-offer' && !this.makingOffer) {
        this.sendDescription();
      }
    }, RESEND_OFFER_MS);
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
    this.signalOut({ description: { type: d.type, sdp: tuneOpus(d.sdp, this.tuning) } });
  }

  /** Signals leave tagged with this connection's id and, once known, the other side's. */
  private signalOut(data: SignalData): void {
    this.onSignal({ ...data, cid: this.cid, ...(this.remoteCid ? { to: this.remoteCid } : {}) });
  }

  async receiveSignal(data: SignalData): Promise<void> {
    if (this.closed) return;
    if (typeof data.cid === 'string' && !this.remoteCid) this.remoteCid = data.cid;
    const pc = this.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          // the first negotiation of this link comes from their offer (we answer it, or we gave up our own
          // offer in a collision): its media sections are the ones to send on
          if (!this.negotiated) await this.adoptTransceivers(d.sdp);
          await pc.setLocalDescription();
          this.answeredFirst = true;
          this.sendDescription();
        }
        this.negotiated = true;
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

  /** Take over the media sections of their first offer (in its order) and send on them too. */
  private async adoptTransceivers(sdp?: string): Promise<void> {
    const all = this.pc.getTransceivers();
    const mids = midsOf(sdp);
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const t = all.find((x) => x.mid !== null && x.mid === mids[i]) ?? (mids.length ? undefined : all[i]);
      if (!t) continue;
      const before = this.tx[slot];
      // ours from an offer given up in a collision: never negotiated, it must not come back in a later offer
      if (before && before !== t) {
        try {
          before.stop();
        } catch {
          // already
        }
      }
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
    const set = async (
      slot: Slot,
      f: (e: RTCRtpEncodingParameters) => void,
      degradation?: RTCDegradationPreference,
    ) => {
      const s = this.tx[slot]?.sender;
      if (!s) return;
      for (const withDegradation of degradation ? [true, false] : [false]) {
        try {
          const p = s.getParameters();
          if (!p.encodings?.length) return;
          for (const e of p.encodings) f(e);
          if (withDegradation)
            (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = degradation;
          await s.setParameters(p);
          return;
        } catch {
          // not negotiated yet, or a browser without that parameter: try the essentials
        }
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
        e.maxBitrate = Math.min(this.params.videoBitrate, this.guard.cap);
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

  /** Connected, with its control channel open. */
  healthy(): boolean {
    return this.pc.connectionState === 'connected' && this.ctlOpen;
  }

  get ctlOpen(): boolean {
    return this.ctl.readyState === 'open';
  }

  /** The DTLS fingerprint of the other side's connection (a new one means it made a new connection). */
  get remoteFingerprint(): string | null {
    return fingerprintOf(this.pc.remoteDescription?.sdp);
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

  private clearTimers(): void {
    this.clearRecovery();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.connectTimer = null;
    this.resendTimer = null;
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
      via: null,
      path: '',
      audioRtt: null,
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
    /** round trips measured since the last poll (for the latency guard) */
    const fresh: number[] = [];
    let pair: Record<string, unknown> | undefined;
    for (const v of all.values()) {
      if (v.type === 'transport' && v.selectedCandidatePairId) pair = all.get(String(v.selectedCandidatePairId));
    }
    if (!pair) {
      for (const v of all.values()) if (v.type === 'candidate-pair' && v.nominated && v.state === 'succeeded') pair = v;
    }
    if (pair) {
      if (typeof pair.currentRoundTripTime === 'number') out.rtt = Math.round(pair.currentRoundTripTime * 1000);
      // a new measurement only when the pair received a new answer to its checks
      const responses = Number(pair.responsesReceived ?? 0);
      if (responses !== this.pairResponses && out.rtt !== null) fresh.push(out.rtt);
      this.pairResponses = responses;
      const lc = all.get(String(pair.localCandidateId));
      const rc = all.get(String(pair.remoteCandidateId));
      out.relayed = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
      out.via = out.relayed
        ? 'relay'
        : lc?.candidateType === 'host' && rc?.candidateType === 'host'
          ? 'local'
          : 'internet';
      out.path = String(lc?.protocol ?? 'udp').toUpperCase();
    }
    // the audio's own round trip (each RTCP report): a new measurement when its count moves
    for (const v of all.values()) {
      if (
        v.type === 'remote-inbound-rtp' &&
        v.kind === 'audio' &&
        typeof v.roundTripTime === 'number' &&
        v.roundTripTime > 0
      ) {
        out.audioRtt = Math.round(v.roundTripTime * 1000);
        const n = Number(v.roundTripTimeMeasurements ?? 0);
        if (n !== this.audioRttCount) fresh.push(out.audioRtt);
        this.audioRttCount = n;
      }
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
    // the guard takes each new measurement once (a value read again at the next poll is not a new sample)
    for (const rtt of fresh) this.guardLatency(rtt);
    if (out.rtt !== null) {
      // capture (~10 ms) + one 10 ms frame + network (half the round trip) + jitter buffer + playout (~10 ms)
      out.latencyMs = Math.round(10 + this.tuning.ptime + out.rtt / 2 + out.bufferMs + 10);
      out.quality =
        out.rtt < 160 && out.audioLossPct < 2 ? 'good' : out.rtt < 320 && out.audioLossPct < 6 ? 'fair' : 'poor';
    }
    return out;
  }

  private guardLatency(rtt: number): void {
    if (this.guard.sample(rtt, performance.now(), this.params.videoBitrate)) void this.applyParams();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.setState('closed');
    try {
      this.pc.close();
    } catch {
      // ignore
    }
  }
}

/** The `a=mid:` of each media section of a session description, in order. */
export function midsOf(sdp: string | undefined): string[] {
  if (!sdp) return [];
  const out: string[] = [];
  for (const line of sdp.split(/\r?\n/)) if (line.startsWith('a=mid:')) out.push(line.slice(6).trim());
  return out;
}

/** `a=fingerprint:` of a session description (one per connection: a new value is a new connection). */
export function fingerprintOf(sdp: string | undefined): string | null {
  if (!sdp) return null;
  return /a=fingerprint:([^\r\n]+)/.exec(sdp)?.[1]?.trim() ?? null;
}
