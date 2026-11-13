import { describe, expect, it } from 'vitest';
import { patchHead, withDuration } from '../../src/media/webm-duration.ts';

/** a WebM as MediaRecorder writes it: EBML header, a Segment of unknown size, Info without a Duration, a Cluster */
function liveWebm(withDur?: number): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77]; // DocType-ish child, 4 bytes
  const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // TimecodeScale = 1 000 000
  const app = [0x4d, 0x80, 0x82, 0x41, 0x42]; // MuxingApp "AB"
  const dur =
    withDur === undefined ? [] : [0x44, 0x89, 0x84, ...new Uint8Array(new Float32Array([0]).buffer).reverse()];
  const infoBody = [...scale, ...app, ...dur];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x84, 1, 2, 3, 4];
  const seg = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...info, ...cluster];
  return new Uint8Array([...ebml, ...seg]);
}

/** the Duration a header now says (ms), read back */
function durationOf(b: Uint8Array): number | null {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 0x44 && b[i + 1] === 0x89) {
      const size = b[i + 2] & 0x7f;
      const v = new DataView(b.buffer, b.byteOffset + i + 3, size);
      return size === 8 ? v.getFloat64(0) : v.getFloat32(0);
    }
  }
  return null;
}

describe('WebM duration', () => {
  it('adds the Duration to a live WebM header, the rest untouched', async () => {
    const src = liveWebm();
    const out = new Uint8Array(await (await withDuration(new Blob([src as BlobPart]), 61_500)).arrayBuffer());
    expect(durationOf(out)).toBe(61_500);
    // the cluster (everything after the header) comes through byte for byte
    expect([...out.slice(-9)]).toEqual([...src.slice(-9)]);
    // and the patched Info is still well formed: read again, it patches in place
    const again = patchHead(out, 1000)!;
    expect(again.replaces).toBe(again.bytes.length);
  });

  it('overwrites a Duration already there, in place', () => {
    const p = patchHead(liveWebm(0), 2000)!;
    expect(p.replaces).toBe(p.bytes.length);
    expect(durationOf(p.bytes)).toBe(2000);
  });

  it('leaves anything it does not understand as it is', async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
    expect(await withDuration(junk, 1000)).toBe(junk);
  });
});
