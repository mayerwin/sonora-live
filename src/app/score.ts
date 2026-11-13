// The shared score: one person opens a PDF or a picture, everyone sees it large, on the same page, and anyone can
// write on it (pen, highlighter, text), each in their own colour. The file travels once over the file channel; the
// page and the ink travel as small control messages, ink while it is being drawn (the others see the pen move).
// Deleted ink is remembered by id so that someone reconnecting with an older copy cannot bring it back.

import { signal } from '@preact/signals';
import { validInk, type Ink, type Stroke } from '../media/ink-core.ts';
import { isImage, isPdf, openScore, type ScoreDoc } from '../media/pdf.ts';
import { annotatedName, exportAnnotated } from '../media/pdf-export.ts';
import type { PeerView } from './participants.ts';
import { newId } from './chat.ts';
import { toast } from './notify.ts';
import { t } from './i18n.ts';
import { log } from './log.ts';

export const MAX_SCORE_BYTES = 60 * 1024 * 1024;

export interface ScoreMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface ScoreHost {
  selfId(): string;
  observer(): boolean;
  peers(): PeerView[];
  send(msg: Record<string, unknown>, to?: string): void;
  sendFile(meta: ScoreMeta, blob: Blob, to?: string): void;
  note(text: string): void;
  mayControl(id: string): boolean;
}

interface Shared {
  /** the score shown (null: closed for everyone) */
  id: string | null;
  name: string;
  page: number;
  ver: number;
  by: string;
}

interface File extends ScoreMeta {
  owner: string;
  blob: Blob;
}

type Undo = { add: Ink } | { del: Ink[] };

/** how often a stroke being drawn is sent (ms) */
const LIVE_EVERY_MS = 50;

export class Score {
  readonly shared = signal<Shared | null>(null);
  readonly file = signal<File | null>(null);
  readonly doc = signal<ScoreDoc | null>(null);
  readonly failed = signal(false);
  /** finished ink, in drawing order */
  readonly ink = signal<Ink[]>([]);
  /** strokes others are drawing right now */
  readonly live = signal<Stroke[]>([]);
  readonly incoming = signal<{ name: string; progress: number; from: string } | null>(null);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  private gone = new Set<string>();
  private undos: Undo[] = [];
  private redos: Undo[] = [];
  private liveSentAt = 0;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: ScoreHost) {}

  /** May this side open, close or turn the pages (musicians; the host while holding the controls)? */
  get canControl(): boolean {
    return !this.host.observer() && this.host.mayControl(this.host.selfId());
  }

  /** Anyone in the lesson may write on it (an observer too: a question, circled). */
  get canWrite(): boolean {
    return !!this.shared.peek()?.id;
  }

  // ------------------------------------------------------------------------------------------- the file

  /** Open a PDF or a picture from this device, for everyone. */
  load(f: globalThis.File): boolean {
    if (!this.canControl) return false;
    if (f.size > MAX_SCORE_BYTES) {
      toast({ kind: 'warn', title: t('File too large'), body: t('Scores can be up to 60 MB.') });
      return false;
    }
    if (!isPdf(f.type, f.name) && !isImage(f.type, f.name)) {
      toast({ kind: 'warn', title: t('Not a score'), body: t('Choose a PDF, or a photo of the page.') });
      return false;
    }
    const meta: ScoreMeta = { id: newId(), name: f.name.slice(0, 120), size: f.size, mime: f.type };
    this.resetInk();
    this.setFile({ ...meta, owner: this.host.selfId(), blob: f });
    this.change({ id: meta.id, name: meta.name, page: 0 });
    this.host.sendFile(meta, f);
    return true;
  }

  /** Close it, for everyone. */
  close(): void {
    if (!this.canControl || !this.shared.peek()?.id) return;
    this.change({ id: null, name: '', page: 0 });
    this.unload();
    this.resetInk();
  }

  setPage(page: number): void {
    const s = this.shared.peek();
    const doc = this.doc.peek();
    if (!s?.id || !this.canControl) return;
    const p = Math.max(0, Math.min((doc?.pages ?? 1) - 1, Math.round(page)));
    if (p !== s.page) this.change({ page: p });
  }

  private change(patch: Partial<Shared>): void {
    const s = this.shared.peek();
    const next: Shared = {
      id: null,
      name: '',
      page: 0,
      ...s,
      ...patch,
      ver: (s?.ver ?? 0) + 1,
      by: this.host.selfId(),
    };
    this.shared.value = next;
    this.host.send({ t: 'sc', ...next });
  }

  private setFile(f: File): void {
    this.unload();
    this.file.value = f;
    this.failed.value = false;
    openScore(f.blob, f.name).then(
      (doc) => {
        if (this.file.peek() !== f) return doc.close();
        this.doc.value = doc;
      },
      (e) => {
        log('score could not open', e);
        if (this.file.peek() === f) this.failed.value = true;
      },
    );
  }

  private unload(): void {
    this.doc.peek()?.close();
    this.doc.value = null;
    this.file.value = null;
    this.failed.value = false;
  }

  /** Save the score with everyone's ink, as a PDF on this device. */
  async save(): Promise<void> {
    const f = this.file.peek();
    if (!f) return;
    const blob = await exportAnnotated(f.blob, f.name, this.ink.peek());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = annotatedName(f.name, t('annotated'));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ------------------------------------------------------------------------------------------- ink

  /** A stroke being drawn here: shown to the others as it grows (sent a few times a second). */
  drawing(s: Stroke): void {
    const send = () => {
      this.liveSentAt = performance.now();
      this.liveTimer = null;
      this.host.send({ t: 'sc-ink', op: 'live', ink: s });
    };
    if (this.liveTimer) return;
    const wait = LIVE_EVERY_MS - (performance.now() - this.liveSentAt);
    if (wait <= 0) send();
    else this.liveTimer = setTimeout(send, wait);
  }

  /** A stroke or a text finished here. */
  add(k: Ink): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = null;
    this.put([k]);
    this.host.send({ t: 'sc-ink', op: 'add', ink: k });
    this.push({ add: k });
  }

  /** The eraser took these (anyone's). */
  erase(ids: string[]): void {
    const taken = this.ink.peek().filter((k) => ids.includes(k.id));
    if (!taken.length) return;
    this.remove(taken.map((k) => k.id));
    this.host.send({ t: 'sc-ink', op: 'del', ids: taken.map((k) => k.id) });
    this.push({ del: taken });
  }

  /** Clear this page: one's own ink only (the others' stays theirs to take away). */
  clearMine(page: number): void {
    const me = this.host.selfId();
    this.erase(
      this.ink
        .peek()
        .filter((k) => k.page === page && k.by === me)
        .map((k) => k.id),
    );
  }

  undo(): void {
    const u = this.undos.pop();
    if (!u) return;
    this.redos.push(u);
    this.apply(u, true);
    this.flags();
  }

  redo(): void {
    const u = this.redos.pop();
    if (!u) return;
    this.undos.push(u);
    this.apply(u, false);
    this.flags();
  }

  private apply(u: Undo, back: boolean): void {
    // undoing an add takes it away; undoing an erase brings the ink back (under new ids: the old ones are gone
    // for good, everywhere)
    if ('add' in u) {
      if (back) {
        this.remove([u.add.id]);
        this.host.send({ t: 'sc-ink', op: 'del', ids: [u.add.id] });
      } else {
        u.add = { ...u.add, id: newId() };
        this.put([u.add]);
        this.host.send({ t: 'sc-ink', op: 'add', ink: u.add });
      }
    } else if (back) {
      u.del = u.del.map((k) => ({ ...k, id: newId() }));
      this.put(u.del);
      for (const k of u.del) this.host.send({ t: 'sc-ink', op: 'add', ink: k });
    } else {
      this.remove(u.del.map((k) => k.id));
      this.host.send({ t: 'sc-ink', op: 'del', ids: u.del.map((k) => k.id) });
    }
  }

  private push(u: Undo): void {
    this.undos.push(u);
    if (this.undos.length > 200) this.undos.shift();
    this.redos = [];
    this.flags();
  }

  private flags(): void {
    this.canUndo.value = this.undos.length > 0;
    this.canRedo.value = this.redos.length > 0;
  }

  private put(list: Ink[]): void {
    const fresh = list.filter((k) => !this.gone.has(k.id));
    if (!fresh.length) return;
    const ids = new Set(fresh.map((k) => k.id));
    this.ink.value = [...this.ink.peek().filter((k) => !ids.has(k.id)), ...fresh];
    // a finished stroke replaces its live version
    if (this.live.peek().some((s) => ids.has(s.id))) this.live.value = this.live.peek().filter((s) => !ids.has(s.id));
  }

  private remove(ids: string[]): void {
    for (const id of ids) this.gone.add(id);
    const set = new Set(ids);
    this.ink.value = this.ink.peek().filter((k) => !set.has(k.id));
    this.live.value = this.live.peek().filter((s) => !set.has(s.id));
  }

  private resetInk(): void {
    this.ink.value = [];
    this.live.value = [];
    this.gone.clear();
    this.undos = [];
    this.redos = [];
    this.flags();
  }

  // ------------------------------------------------------------------------------------------- messages

  onControl(from: string, msg: Record<string, unknown>): void {
    const peer = this.host.peers().find((p) => p.id === from);
    if (!peer) return;
    if (msg.t === 'sc-ink') return this.onInk(from, msg);
    if (peer.info.role === 'observer') return;
    const ver = Number(msg.ver);
    const by = typeof msg.by === 'string' ? msg.by : '';
    if (!Number.isFinite(ver) || !by || !this.host.mayControl(by)) return;
    const cur = this.shared.peek();
    if (cur && (ver < cur.ver || (ver === cur.ver && by <= cur.by))) return;
    const id = msg.id === null ? null : typeof msg.id === 'string' ? msg.id.slice(0, 40) : undefined;
    if (id === undefined) return;
    const next: Shared = {
      id,
      name: String(msg.name ?? '').slice(0, 120),
      page: Math.max(0, Math.min(5000, Math.round(Number(msg.page) || 0))),
      ver,
      by,
    };
    const was = cur?.id ?? null;
    this.shared.value = next;
    if (id === null) {
      if (was) {
        this.unload();
        this.resetInk();
        this.host.note(t('{name} closed the score', { name: peer.info.name }));
      }
      return;
    }
    if (was !== id) {
      // another score: the one here (and its ink) is over
      if (this.file.peek()?.id !== id) this.unload();
      if (was) this.resetInk();
    }
  }

  private onInk(from: string, msg: Record<string, unknown>): void {
    switch (msg.op) {
      case 'live': {
        const k = validInk(msg.ink);
        if (!k || k.kind === 'text' || k.by !== from || this.gone.has(k.id)) return;
        const s = k as Stroke;
        this.live.value = [...this.live.peek().filter((x) => x.id !== s.id), s];
        break;
      }
      case 'add': {
        const k = validInk(msg.ink);
        if (k) this.put([k]);
        break;
      }
      case 'del':
        if (Array.isArray(msg.ids))
          this.remove(msg.ids.filter((x): x is string => typeof x === 'string').slice(0, 5000));
        break;
      case 'all': {
        // a newcomer's copy: what is deleted anywhere stays deleted
        if (msg.score !== this.shared.peek()?.id) return;
        if (Array.isArray(msg.gone))
          this.remove(msg.gone.filter((x): x is string => typeof x === 'string').slice(0, 20000));
        if (Array.isArray(msg.list)) this.put(msg.list.map(validInk).filter((k): k is Ink => !!k));
        break;
      }
    }
  }

  /** Someone joined or connected again: the score, where it is, and the ink so far. */
  onConnected(id: string): void {
    const s = this.shared.peek();
    if (!s) return;
    this.host.send({ t: 'sc', ...s }, id);
    if (!s.id) return;
    const f = this.file.peek();
    if (f && f.id === s.id && this.sendsTo(f)) this.host.sendFile(f, f.blob, id);
    this.host.send({ t: 'sc-ink', op: 'all', score: s.id, list: this.ink.peek(), gone: [...this.gone] }, id);
  }

  /** One holder sends the file to newcomers: the one who opened it, or, when they are gone, the smallest id. */
  private sendsTo(f: File): boolean {
    const self = this.host.selfId();
    if (f.owner === self) return true;
    const present = this.host.peers().filter((p) => p.link === 'connected');
    if (present.some((p) => p.id === f.owner)) return false;
    return present.every((p) => p.id > self);
  }

  receiving(from: string, meta: ScoreMeta): void {
    this.incoming.value = { name: meta.name, progress: 0, from };
  }

  progress(from: string, progress: number): void {
    const cur = this.incoming.peek();
    if (cur && cur.from === from) this.incoming.value = { ...cur, progress };
  }

  received(from: string, meta: ScoreMeta, blob: Blob | null): void {
    if (this.incoming.peek()?.from === from) this.incoming.value = null;
    if (!blob) return;
    const s = this.shared.peek();
    if (s && s.id !== meta.id) return;
    if (this.file.peek()?.id === meta.id) return;
    this.setFile({ ...meta, owner: from, blob });
    if (!s) this.shared.value = { id: meta.id, name: meta.name, page: 0, ver: 0, by: from };
    const name = this.host.peers().find((p) => p.id === from)?.info.name ?? t('Someone');
    this.host.note(t('{name} shared a score: {file}', { name, file: meta.name }));
  }

  peerGone(id: string): void {
    if (this.incoming.peek()?.from === id) this.incoming.value = null;
    if (this.live.peek().some((s) => s.by === id)) this.live.value = this.live.peek().filter((s) => s.by !== id);
  }

  /** Leaving the lesson: nothing is kept. */
  clear(): void {
    this.unload();
    this.resetInk();
    this.shared.value = null;
    this.incoming.value = null;
  }
}
