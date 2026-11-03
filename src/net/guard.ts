// Sound and MIDI first. When the round trip grows well past its usual value, packets are queuing somewhere on the
// path (a slow upload, busy Wi-Fi, a relay). Video is what fills that queue, so its bitrate is cut at once, and
// comes back gently once the round trip is back to normal. The browser's own congestion control reacts too, but
// more slowly, and mostly to loss: a second of queue is a second of late notes.

/** a round trip this much above its usual value means a queue is building on the path */
export const QUEUE_MS = 60;
export const MIN_VIDEO_BPS = 150_000;
/** the usual round trip: the lowest over this window */
const BASE_WINDOW_MS = 30_000;
/** calm time between two raises of the video's room */
const RAISE_EVERY_MS = 3000;

export class LatencyGuard {
  /** video bitrate allowed now (Infinity: whatever was asked) */
  cap = Infinity;
  private log: { t: number; rtt: number }[] = [];
  /** since when the round trip has been calm (null: it is not) */
  private calmSince: number | null = null;

  /** A new round-trip measurement (ms; give each one once); true when the cap changed. `wanted`: the video
   * bitrate asked for. */
  sample(rtt: number, now: number, wanted: number): boolean {
    this.log.push({ t: now, rtt });
    while (this.log.length && now - this.log[0].t > BASE_WINDOW_MS) this.log.shift();
    let base = Infinity;
    for (const x of this.log) base = Math.min(base, x.rtt);
    let cap = this.cap;
    if (rtt > base + QUEUE_MS) {
      // halve at every new queued measurement (each one counted once): a queue drains within a few
      cap = Math.max(MIN_VIDEO_BPS, Math.min(cap, wanted) * 0.5);
      this.calmSince = null;
    } else if (rtt < base + QUEUE_MS / 2 && cap !== Infinity) {
      // a quarter more every few calm seconds, however often measurements come
      if (this.calmSince === null) this.calmSince = now;
      const steps = Math.floor((now - this.calmSince) / RAISE_EVERY_MS);
      if (steps > 0) {
        this.calmSince += steps * RAISE_EVERY_MS;
        const next = cap * 1.25 ** steps;
        cap = next >= wanted ? Infinity : next;
      }
    } else {
      this.calmSince = null;
    }
    if (cap === this.cap) return false;
    this.cap = cap;
    return true;
  }
}
