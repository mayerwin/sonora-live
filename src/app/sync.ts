// What the shared music tools (the backing track, the metronome) need to play in time with one performer: how long
// a message from someone takes to arrive, and how long that person's sound takes to reach this side's ears.

import { engine } from '../media/engine.ts';
import type { PeerView } from './participants.ts';

/** Half the round trip to someone (ms): the usual guess for a message's one-way time. */
export function oneWay(peers: PeerView[], id: string): number {
  const rtt = peers.find((p) => p.id === id)?.stats?.rtt;
  return typeof rtt === 'number' ? rtt / 2 : 0;
}

/**
 * How long the sound of `ref` takes to reach this side's ears (ms): their microphone's way out (as they said),
 * the network, this side's jitter buffer and its speakers. Their own speakers do not count: each side schedules
 * what it plays for the moment it is heard. 0 for this side itself, or when `ref` is not connected.
 */
export function soundDelayFrom(peers: PeerView[], selfId: string, ref: string): number {
  if (ref === selfId) return 0;
  const p = peers.find((x) => x.id === ref && x.link === 'connected');
  if (!p?.stats || p.stats.rtt === null) return 0;
  // their own measured extra (Bluetooth headphones): they hear the track and play along that much later
  return (
    (p.remote?.sendMs ?? 20) + (p.remote?.hearExtra ?? 0) + p.stats.rtt / 2 + p.stats.bufferMs + engine.outputLatencyMs
  );
}
