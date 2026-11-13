// A YouTube video everyone watches in time: a performance to listen to together, a lesson to follow along. The
// link is shared, each side plays the video from YouTube itself, and a shared timeline (the backing track's: src/
// media/backing-core.ts) keeps them together; whoever presses Play is the one the others are in time with. Seeking
// and speed are shared. A browser cannot take YouTube's sound into its own audio, so on speakers the microphone
// may pick it up: headphones are best (the panel says so).

import { signal } from '@preact/signals';
import { localTarget, timelinePos, type Timeline } from '../media/backing-core.ts';
import { oneWay, soundDelayFrom } from './sync.ts';
import type { BackingHost } from './backing.ts';
import { t } from './i18n.ts';

/** The part of YouTube's IFrame player this uses (src: www.youtube.com/iframe_api). */
export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  destroy(): void;
}

/** YouTube's player states */
const PLAYING = 1;

export interface VideoShared {
  /** the YouTube id (null: none) */
  id: string | null;
  playing: boolean;
  pos: number;
  anchor: number;
  rate: number;
  ref: string;
  ver: number;
  by: string;
}

/** The video id in a YouTube link (watch, youtu.be, shorts, embed, live), or a bare id. */
export function youtubeId(text: string): string | null {
  const s = text.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return valid(u.pathname.slice(1, 12));
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v) return valid(v);
      const m = /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[2];
    }
  } catch {
    // not a link
  }
  return null;
}

const valid = (id: string) => (/^[\w-]{11}$/.test(id) ? id : null);

/** YouTube offers these speeds */
export const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const LEAD_MS = 600;
const TICK_MS = 250;
/** further off than this, a seek (YouTube's speeds are too coarse to catch up smoothly) */
const SEEK_ABOVE_S = 0.3;

export class SharedVideo {
  readonly shared = signal<VideoShared | null>(null);
  /** where this side's player is (s), and how long the video is */
  readonly position = signal(0);
  readonly duration = signal(0);
  /** the player is ready here */
  readonly ready = signal(false);
  /** how far behind whoever pressed Play this side plays it (ms): their sound's way here */
  readonly delay = signal(0);
  private player: YtPlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: BackingHost) {}

  get canControl(): boolean {
    return !this.host.observer() && this.host.mayControl(this.host.selfId());
  }

  /** Open a YouTube link for everyone (false: not a YouTube link). */
  open(link: string): boolean {
    const id = youtubeId(link);
    if (!id || !this.canControl) return false;
    this.change({ id, playing: false, pos: 0, anchor: performance.now(), rate: 1, ref: this.host.selfId() });
    this.host.note(t('You shared a YouTube video'));
    return true;
  }

  close(): void {
    if (!this.shared.peek()?.id) return;
    this.change({ id: null, playing: false, pos: 0 });
  }

  play(): void {
    const s = this.shared.peek();
    if (!s?.id || s.playing) return;
    const dur = this.duration.peek();
    const from = dur > 0 && s.pos >= dur - 0.5 ? 0 : s.pos;
    this.change({ playing: true, pos: from, anchor: performance.now() + LEAD_MS, ref: this.host.selfId() });
  }

  pause(): void {
    const s = this.shared.peek();
    if (!s?.playing) return;
    const now = performance.now();
    this.change({ playing: false, pos: Math.max(0, timelinePos(this.timeline(s), now)), anchor: now });
  }

  seek(pos: number): void {
    const s = this.shared.peek();
    if (!s?.id) return;
    this.change({ pos: Math.max(0, pos), anchor: performance.now() + (s.playing ? LEAD_MS : 0) });
  }

  setRate(rate: number): void {
    const s = this.shared.peek();
    if (!s?.id || !YT_RATES.includes(rate)) return;
    const now = performance.now();
    this.change({ rate, pos: Math.max(0, timelinePos(this.timeline(s), now)), anchor: now });
  }

  private change(patch: Partial<VideoShared>): void {
    if (!this.canControl) return;
    const s = this.shared.peek();
    const next: VideoShared = {
      id: null,
      playing: false,
      pos: 0,
      anchor: performance.now(),
      rate: 1,
      ref: this.host.selfId(),
      ...s,
      ...patch,
      ver: (s?.ver ?? 0) + 1,
      by: this.host.selfId(),
    };
    this.shared.value = next;
    this.host.send(this.message(next));
    this.reconcile();
  }

  private message(s: VideoShared): Record<string, unknown> {
    const now = performance.now();
    return {
      t: 'yt',
      id: s.id,
      playing: s.playing,
      pos: s.pos,
      // how far ahead the anchor is, here (the others add their own share of the way)
      lead: Math.max(0, s.anchor - now),
      rate: s.rate,
      ref: s.ref,
      ver: s.ver,
      by: s.by,
    };
  }

  onControl(from: string, msg: Record<string, unknown>): void {
    const peer = this.host.peers().find((p) => p.id === from);
    if (!peer || peer.info.role === 'observer') return;
    const ver = Number(msg.ver);
    const by = typeof msg.by === 'string' ? msg.by : '';
    if (!Number.isFinite(ver) || !by || !this.host.mayControl(by)) return;
    const cur = this.shared.peek();
    if (cur && (ver < cur.ver || (ver === cur.ver && by <= cur.by))) return;
    const id = msg.id === null ? null : typeof msg.id === 'string' ? valid(msg.id) : undefined;
    if (id === undefined) return;
    const lead = Math.max(0, Math.min(5000, Number(msg.lead) || 0));
    const pos = Number(msg.pos);
    const rate = Number(msg.rate);
    const was = cur?.id ?? null;
    this.shared.value = {
      id,
      playing: msg.playing === true,
      pos: Number.isFinite(pos) && pos >= 0 ? pos : 0,
      anchor: performance.now() + lead - oneWay(this.host.peers(), from),
      rate: YT_RATES.includes(rate) ? rate : 1,
      ref: typeof msg.ref === 'string' ? msg.ref : by,
      ver,
      by,
    };
    if (id && id !== was) this.host.note(t('{name} shared a YouTube video', { name: peer.info.name }));
    this.reconcile();
  }

  onConnected(id: string): void {
    const s = this.shared.peek();
    if (s) this.host.send(this.message(s), id);
  }

  clear(): void {
    this.shared.value = null;
    this.detach();
  }

  // ------------------------------------------------------------------------------------------- the player

  /** Where this side's player is right now (s), or null without one. */
  currentTime(): number | null {
    try {
      return this.player ? this.player.getCurrentTime() : null;
    } catch {
      return null;
    }
  }

  /** The view's player is ready (or gone: null). */
  attach(p: YtPlayer | null): void {
    this.player = p;
    this.ready.value = !!p;
    if (p) {
      if (!this.timer) this.timer = setInterval(() => this.reconcile(), TICK_MS);
      this.reconcile();
    } else this.detach();
  }

  private detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.player = null;
    this.ready.value = false;
  }

  private timeline(s: VideoShared): Timeline {
    return {
      playing: s.playing,
      pos: s.pos,
      anchor: s.anchor,
      rate: s.rate,
      loop: null,
      duration: this.duration.peek(),
    };
  }

  /** Bring the player to where the shared timeline says it is now, here. */
  private reconcile(): void {
    const p = this.player;
    const s = this.shared.peek();
    if (!p || !s?.id) return;
    try {
      const dur = p.getDuration();
      if (dur > 0) this.duration.value = dur;
      const cur = p.getCurrentTime();
      this.position.value = cur;
      // in time with whoever pressed Play, as they hear it (their sound reaches here later)
      const delay = s.ref === this.host.selfId() ? 0 : soundDelayFrom(this.host.peers(), this.host.selfId(), s.ref);
      this.delay.value = delay;
      const target = localTarget(this.timeline(s), performance.now(), delay);
      const playing = p.getPlayerState() === PLAYING;
      p.setPlaybackRate(s.rate);
      if (!s.playing || target.ended) {
        if (playing) p.pauseVideo();
        if (Math.abs(cur - target.pos) > 0.05) p.seekTo(target.pos, true);
        return;
      }
      if (target.wait > 0) {
        // the lead-in: ready at the start position, paused, and started at its very end (not at the next tick)
        if (playing) p.pauseVideo();
        if (Math.abs(cur - target.pos) > 0.05) p.seekTo(target.pos, true);
        if (target.wait < TICK_MS + 50) {
          if (this.startTimer) clearTimeout(this.startTimer);
          this.startTimer = setTimeout(() => {
            this.startTimer = null;
            this.reconcile();
          }, target.wait);
        }
        return;
      }
      if (!playing) {
        // starting: exactly where the timeline is now
        if (Math.abs(target.pos - cur) > 0.03) p.seekTo(target.pos, true);
        p.playVideo();
      } else if (Math.abs(target.pos - cur) > SEEK_ABOVE_S) p.seekTo(target.pos, true);
    } catch {
      // the player is still loading
    }
  }
}

/** YouTube's IFrame API, loaded once (it calls a global when ready). */
let api: Promise<unknown> | null = null;
export function loadYouTube(): Promise<unknown> {
  const w = window as unknown as { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!api) {
    api = new Promise((resolve, reject) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(w.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        api = null;
        reject(new Error('YouTube could not load'));
      };
      document.head.appendChild(s);
    });
  }
  return api;
}
