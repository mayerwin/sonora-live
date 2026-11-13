// A WebM recording's length, written into its header. MediaRecorder writes WebM as a live stream, without its
// length: players then show none and cannot seek. Only the header is read and rewritten (its first megabyte at
// most); the rest of the file, gigabytes for a long lesson, is never loaded into memory.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Cluster: 0x1f43b675,
};

const HEAD = 1 << 20;

interface El {
  id: number;
  /** where the element starts, where its data starts, where it ends (null size: unknown) */
  start: number;
  data: number;
  size: number | null;
}

function readId(b: Uint8Array, at: number): { id: number; len: number } | null {
  const first = b[at];
  if (first === undefined) return null;
  let len = 1;
  for (let mask = 0x80; len <= 4 && !(first & mask); mask >>= 1) len++;
  if (len > 4 || at + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i];
  return { id, len };
}

function readSize(b: Uint8Array, at: number): { size: number | null; len: number } | null {
  const first = b[at];
  if (first === undefined) return null;
  let len = 1;
  for (let mask = 0x80; len <= 8 && !(first & mask); mask >>= 1) len++;
  if (len > 8 || at + len > b.length) return null;
  let v = first & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[at + i];
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : v, len };
}

function readEl(b: Uint8Array, at: number): El | null {
  const id = readId(b, at);
  if (!id) return null;
  const size = readSize(b, at + id.len);
  if (!size) return null;
  return { id: id.id, start: at, data: at + id.len + size.len, size: size.size };
}

/** An element with an 8-byte size (room to grow) around `data`. */
function element(id: number, data: Uint8Array): Uint8Array {
  const idBytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 0xff);
  const out = new Uint8Array(idBytes.length + 8 + data.length);
  out.set(idBytes, 0);
  let n = data.length;
  for (let i = 7; i >= 1; i--) {
    out[idBytes.length + i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  out[idBytes.length] = 0x01;
  out.set(data, idBytes.length + 8);
  return out;
}

/** Patch the header of `head` (the file's beginning): the new header bytes and how many of the old ones they replace. */
export function patchHead(head: Uint8Array, durationMs: number): { bytes: Uint8Array; replaces: number } | null {
  const ebml = readEl(head, 0);
  if (!ebml || ebml.id !== ID.EBML || ebml.size === null) return null;
  const seg = readEl(head, ebml.data + ebml.size);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.size === null ? head.length : Math.min(head.length, seg.data + seg.size);
  let at = seg.data;
  let info: El | null = null;
  let seekHead = false;
  while (at < segEnd) {
    const el = readEl(head, at);
    if (!el || el.size === null) break;
    if (el.id === ID.SeekHead) seekHead = true;
    if (el.id === ID.Info) {
      info = el;
      break;
    }
    if (el.id === ID.Cluster) break;
    at = el.data + el.size;
  }
  if (!info || info.size === null || info.data + info.size > head.length) return null;
  let scale = 1_000_000;
  let dur: El | null = null;
  const children: Uint8Array[] = [];
  for (let c = info.data; c < info.data + info.size; ) {
    const el = readEl(head, c);
    if (!el || el.size === null) return null;
    const end = el.data + el.size;
    if (el.id === ID.TimecodeScale) {
      let v = 0;
      for (let i = el.data; i < end; i++) v = v * 256 + head[i];
      if (v > 0) scale = v;
    }
    if (el.id === ID.Duration) dur = el;
    else children.push(head.subarray(c, end));
    c = end;
  }
  const value = (durationMs * 1_000_000) / scale;
  // there already: overwritten in place, nothing moves
  if (dur && (dur.size === 4 || dur.size === 8)) {
    const out = head.slice(0, info.data + info.size);
    const view = new DataView(out.buffer, out.byteOffset);
    if (dur.size === 8) view.setFloat64(dur.data, value);
    else view.setFloat32(dur.data, value);
    return { bytes: out, replaces: out.length };
  }
  // a Duration added makes the header longer: a SeekHead's positions after it would be wrong
  if (seekHead || seg.size !== null) return null;
  const d = new Uint8Array(8);
  new DataView(d.buffer).setFloat64(0, value);
  const dEl = new Uint8Array([0x44, 0x89, 0x88, ...d]);
  const body = new Uint8Array(children.reduce((n, c) => n + c.length, 0) + dEl.length);
  let o = 0;
  for (const c of children) {
    body.set(c, o);
    o += c.length;
  }
  body.set(dEl, o);
  const newInfo = element(ID.Info, body);
  const before = head.subarray(0, info.start);
  const out = new Uint8Array(before.length + newInfo.length);
  out.set(before, 0);
  out.set(newInfo, before.length);
  return { bytes: out, replaces: info.data + info.size };
}

/** The recording with its length in its header (unchanged when it cannot be patched safely). */
export async function withDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEAD)).arrayBuffer());
    const p = patchHead(head, durationMs);
    if (!p) return blob;
    return new Blob([p.bytes as BlobPart, blob.slice(p.replaces)], { type: blob.type });
  } catch {
    return blob;
  }
}
