// Loop prevention. Notes from the other side are played on this side's instrument through its MIDI output. Some
// instruments and interfaces send what they receive back out of their MIDI input (MIDI thru, "MIDI echo"), which
// would send the teacher's own notes back to the teacher. Every message written to the output is remembered for a
// moment, and the same message coming back from the input in that window is dropped.

export const ECHO_WINDOW_MS = 120;

function key(m: ArrayLike<number>): number {
  let type = m[0] & 0xf0;
  const ch = m[0] & 0x0f;
  let d2 = m[2] ?? 0;
  // instruments may turn a note-off into a note-on with velocity 0 (or the reverse), and change release velocity
  if (type === 0x80 || (type === 0x90 && d2 === 0)) {
    type = 0x80;
    d2 = 0;
  }
  return (type << 16) | (ch << 12) | ((m[1] ?? 0) << 7) | (type === 0x80 ? 0 : d2);
}

export class EchoFilter {
  private recent: { k: number; t: number }[] = [];

  /** `m` was just sent to the instrument. */
  sent(m: ArrayLike<number>, now = performance.now()): void {
    this.prune(now);
    this.recent.push({ k: key(m), t: now });
    if (this.recent.length > 512) this.recent.shift();
  }

  /** `m` came from the instrument: is it the echo of something we sent it? */
  isEcho(m: ArrayLike<number>, now = performance.now()): boolean {
    this.prune(now);
    const k = key(m);
    const i = this.recent.findIndex((r) => r.k === k);
    if (i < 0) return false;
    this.recent.splice(i, 1);
    return true;
  }

  private prune(now: number): void {
    while (this.recent.length && now - this.recent[0].t > ECHO_WINDOW_MS) this.recent.shift();
  }
}
