// Where a recording goes while it is made: in this browser's own storage, a second at a time, each piece written
// and closed at once. A crash, a closed tab or a dead battery loses at most the last second; the next visit finds
// the pieces and offers to save them. The private file system of the origin (OPFS) where the browser has it,
// IndexedDB otherwise. Nothing leaves the device.

export interface RecMeta {
  id: string;
  /** when it started (ms since 1970) */
  started: number;
  /** the container's type, e.g. video/webm;codecs=vp9,opus */
  mime: string;
  /** what it is: the lesson (picture and sound), or one person's sound */
  kind: 'lesson' | 'voice';
  /** whose sound, for a voice */
  name?: string;
  /** it was stopped and closed properly */
  done: boolean;
  /** how long, when known (ms): noted as it goes, final when done */
  durationMs?: number;
  /** a voice that started after the lesson's recording: how long after (ms) */
  offsetMs?: number;
}

interface Backend {
  put(id: string, n: number, data: Blob): Promise<void>;
  parts(id: string): Promise<Blob[]>;
  saveMeta(m: RecMeta): Promise<void>;
  list(): Promise<RecMeta[]>;
  remove(id: string): Promise<void>;
}

const pad = (n: number) => String(n).padStart(6, '0');

class OpfsBackend implements Backend {
  private root: Promise<FileSystemDirectoryHandle>;
  constructor() {
    this.root = navigator.storage.getDirectory().then((d) => d.getDirectoryHandle('recordings', { create: true }));
  }
  private async dir(id: string, create = true): Promise<FileSystemDirectoryHandle> {
    return (await this.root).getDirectoryHandle(id, { create });
  }
  private async write(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
    const f = await dir.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write(data);
    await w.close();
  }
  async put(id: string, n: number, data: Blob): Promise<void> {
    await this.write(await this.dir(id), `${pad(n)}.part`, data);
  }
  async parts(id: string): Promise<Blob[]> {
    const dir = await this.dir(id, false);
    const names: string[] = [];
    for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (name.endsWith('.part')) names.push(name);
    }
    names.sort();
    return Promise.all(names.map(async (n) => (await dir.getFileHandle(n)).getFile()));
  }
  async saveMeta(m: RecMeta): Promise<void> {
    await this.write(await this.dir(m.id), 'meta.json', JSON.stringify(m));
  }
  async list(): Promise<RecMeta[]> {
    const out: RecMeta[] = [];
    for await (const [name, h] of (await this.root) as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind !== 'directory') continue;
      try {
        const f = await (h as FileSystemDirectoryHandle).getFileHandle('meta.json');
        out.push(JSON.parse(await (await f.getFile()).text()) as RecMeta);
      } catch {
        // a folder without its description: an interrupted start, nothing to keep
        await (await this.root).removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
    return out.sort((a, b) => b.started - a.started);
  }
  async remove(id: string): Promise<void> {
    await (await this.root).removeEntry(id, { recursive: true }).catch(() => {});
  }
}

/** IndexedDB: one store of pieces (keyed id/n), one of descriptions. */
class IdbBackend implements Backend {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open('sonora-recordings', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('parts');
        r.result.createObjectStore('meta', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  private async tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = f(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
    });
  }
  async put(id: string, n: number, data: Blob): Promise<void> {
    await this.tx('parts', 'readwrite', (s) => s.put(data, `${id}/${pad(n)}`));
  }
  async parts(id: string): Promise<Blob[]> {
    const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
    return this.tx('parts', 'readonly', (s) => s.getAll(range) as IDBRequest<Blob[]>);
  }
  async saveMeta(m: RecMeta): Promise<void> {
    await this.tx('meta', 'readwrite', (s) => s.put(m));
  }
  async list(): Promise<RecMeta[]> {
    const all = await this.tx('meta', 'readonly', (s) => s.getAll() as IDBRequest<RecMeta[]>);
    return all.sort((a, b) => b.started - a.started);
  }
  async remove(id: string): Promise<void> {
    const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
    await this.tx('parts', 'readwrite', (s) => s.delete(range));
    await this.tx('meta', 'readwrite', (s) => s.delete(id));
  }
}

let backend: Backend | null = null;
function store(): Backend {
  if (!backend) {
    const opfs =
      typeof navigator !== 'undefined' &&
      !!navigator.storage?.getDirectory &&
      typeof FileSystemFileHandle !== 'undefined' &&
      'createWritable' in FileSystemFileHandle.prototype;
    backend = opfs ? new OpfsBackend() : new IdbBackend();
  }
  return backend;
}

/** One recording being written: its pieces, in order, each stored as it comes. */
export class RecWriter {
  private n = 0;
  private chain: Promise<void> = Promise.resolve();
  /** bytes stored so far */
  bytes = 0;
  /** a piece could not be stored (the disk is full) */
  failed = false;

  constructor(readonly meta: RecMeta) {}

  async open(): Promise<void> {
    // ask the browser to keep this site's storage (no eviction under pressure), where it can; never waited for:
    // Firefox asks the person, and a recording must start at once
    void navigator.storage?.persist?.().catch(() => false);
    await store().saveMeta(this.meta);
  }

  /** Store the next piece (in order, after the ones before it). */
  write(data: Blob): Promise<void> {
    if (!data.size) return this.chain;
    const n = ++this.n;
    this.chain = this.chain.then(async () => {
      try {
        await store().put(this.meta.id, n, data);
        this.bytes += data.size;
      } catch {
        this.failed = true;
      }
    });
    return this.chain;
  }

  /** How long it is so far (what an interrupted recording is known to last). */
  note(durationMs: number): Promise<void> {
    this.chain = this.chain.then(async () => {
      this.meta.durationMs = durationMs;
      await store()
        .saveMeta(this.meta)
        .catch(() => {});
    });
    return this.chain;
  }

  /** The last piece is in: mark it complete. */
  async close(durationMs: number): Promise<void> {
    await this.chain;
    this.meta.done = true;
    this.meta.durationMs = durationMs;
    await store().saveMeta(this.meta);
  }
}

/** A recovered recording, complete as far as it goes. */
export async function markDone(meta: RecMeta, durationMs: number): Promise<void> {
  await store().saveMeta({ ...meta, done: true, durationMs });
}

/** Recordings kept in this browser (complete ones, and interrupted ones to recover), newest first. */
export function listRecordings(): Promise<RecMeta[]> {
  return store().list();
}

/** The recording as one file, and how many pieces it was stored in (one a second). */
export async function assemble(meta: RecMeta): Promise<{ blob: Blob; pieces: number }> {
  const parts = await store().parts(meta.id);
  return { blob: new Blob(parts, { type: meta.mime.split(';')[0] }), pieces: parts.length };
}

export function removeRecording(id: string): Promise<void> {
  return store().remove(id);
}

/** How much this site may still store (bytes), when the browser says. */
export async function storageLeft(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota == null) return null;
    return e.quota - (e.usage ?? 0);
  } catch {
    return null;
  }
}
