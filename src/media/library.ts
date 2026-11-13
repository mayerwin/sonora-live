// The library on this device: every backing track and score used in a lesson (opened here or received), kept so
// that next week's lesson reopens it with one tap. In the browser's own storage (IndexedDB), never uploaded; the
// least recently used go first past a size budget.

import { signal } from '@preact/signals';

export type LibKind = 'track' | 'score';

export interface LibItem {
  id: string;
  kind: LibKind;
  name: string;
  size: number;
  mime: string;
  added: number;
  used: number;
}

/** what the library may take of this device (the oldest go beyond it) */
export const LIBRARY_BUDGET = 600 * 1024 * 1024;

const DB = 'sonora-library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('items', { keyPath: 'id' });
      r.result.createObjectStore('blobs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let db: Promise<IDBDatabase> | null = null;
const conn = () => (db ??= open());

function tx<T>(stores: string[], mode: IDBTransactionMode, f: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return conn().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        const req = f(t);
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** The items, most recently used first (shown in the panels). */
export const libraryItems = signal<LibItem[]>([]);

export async function refreshLibrary(): Promise<void> {
  try {
    const all = await tx<LibItem[]>(['items'], 'readonly', (t) => t.objectStore('items').getAll());
    libraryItems.value = all.sort((a, b) => b.used - a.used);
  } catch {
    libraryItems.value = [];
  }
}

const sameFile = (a: { name: string; size: number; kind: LibKind }, b: typeof a) =>
  a.kind === b.kind && a.name === b.name && a.size === b.size;

/** Keep a file (or, already kept, mark it used now). */
export async function keep(kind: LibKind, name: string, blob: Blob): Promise<void> {
  if (!blob.size || blob.size > LIBRARY_BUDGET / 4) return;
  try {
    await refreshLibrary();
    const now = Date.now();
    const known = libraryItems.peek().find((x) => sameFile(x, { kind, name, size: blob.size }));
    if (known) {
      await tx(['items'], 'readwrite', (t) => t.objectStore('items').put({ ...known, used: now }));
    } else {
      const item: LibItem = {
        id: `${kind}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        name,
        size: blob.size,
        mime: blob.type,
        added: now,
        used: now,
      };
      await tx(['items', 'blobs'], 'readwrite', (t) => {
        t.objectStore('items').put(item);
        t.objectStore('blobs').put(blob, item.id);
      });
      await trim();
    }
    await refreshLibrary();
  } catch {
    // private browsing, storage refused: the lesson goes on without a library
  }
}

/** The file of an item, to open again. */
export async function fetchItem(item: LibItem): Promise<File | null> {
  try {
    const blob = await tx<Blob | undefined>(['blobs'], 'readonly', (t) => t.objectStore('blobs').get(item.id));
    if (!blob) return null;
    await tx(['items'], 'readwrite', (t) => t.objectStore('items').put({ ...item, used: Date.now() }));
    void refreshLibrary();
    return new File([blob], item.name, { type: item.mime || blob.type });
  } catch {
    return null;
  }
}

export async function forget(id: string): Promise<void> {
  try {
    await tx(['items', 'blobs'], 'readwrite', (t) => {
      t.objectStore('items').delete(id);
      t.objectStore('blobs').delete(id);
    });
  } catch {
    // gone already
  }
  await refreshLibrary();
}

export async function forgetAll(): Promise<void> {
  try {
    await tx(['items', 'blobs'], 'readwrite', (t) => {
      t.objectStore('items').clear();
      t.objectStore('blobs').clear();
    });
  } catch {
    // nothing
  }
  await refreshLibrary();
}

/** Past the budget, the least recently used go. */
async function trim(): Promise<void> {
  const all = (await tx<LibItem[]>(['items'], 'readonly', (t) => t.objectStore('items').getAll())).sort(
    (a, b) => b.used - a.used,
  );
  let total = 0;
  const drop: string[] = [];
  for (const it of all) {
    total += it.size;
    if (total > LIBRARY_BUDGET) drop.push(it.id);
  }
  for (const id of drop) await forget(id);
}

export const librarySize = (items: LibItem[]) => items.reduce((a, b) => a + b.size, 0);
