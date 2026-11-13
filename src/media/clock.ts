// The audio context's clock against the page's (performance.now()): which context time is heard at a given moment.
// The context's output timestamp says when what it renders reaches the speakers; scheduling sound for the moment it
// is heard is what keeps a backing track, a metronome and a count-in in time with each other and with the lesson.

/** The context time heard now, and that moment on the page's clock (ms). */
export function heardNow(ctx: AudioContext): { ctx: number; perf: number } {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0)
    return { ctx: ts.contextTime, perf: ts.performanceTime };
  const c = ctx as AudioContext & { outputLatency?: number };
  return { ctx: ctx.currentTime - (c.baseLatency ?? 0) - (c.outputLatency ?? 0), perf: performance.now() };
}

/** The context time heard at `perf` (performance.now(), ms). */
export function ctxTimeAt(ctx: AudioContext, perf: number): number {
  const c = heardNow(ctx);
  return c.ctx + (perf - c.perf) / 1000;
}

/** When (performance.now(), ms) context time `t` is heard. */
export function perfTimeOf(ctx: AudioContext, t: number): number {
  const c = heardNow(ctx);
  return c.perf + (t - c.ctx) * 1000;
}
