// The lesson chat: text with emoji, links, and files (sheet music, pictures) sent directly between the browsers.
// Nothing is stored on a server; messages live in this tab (and are handed to people who join later in the same
// lesson). Files are kept in memory and released when you leave.

import { signal } from '@preact/signals';
import type { Role } from '../net/room.ts';

export interface ChatFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** object URL once complete */
  url: string | null;
  /** 0..1 */
  progress: number;
  failed?: boolean;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  role: Role | null;
  ts: number;
  kind: 'text' | 'file' | 'system';
  text?: string;
  file?: ChatFile;
  mine: boolean;
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export class Chat {
  readonly messages = signal<ChatMessage[]>([]);
  readonly unread = signal(0);
  readonly typing = signal<{ id: string; name: string; until: number }[]>([]);
  /** the panel is visible (no unread counting then) */
  visible = false;

  add(m: ChatMessage): void {
    if (this.messages.peek().some((x) => x.id === m.id)) return;
    const list = [...this.messages.peek(), m].sort((a, b) => a.ts - b.ts);
    this.messages.value = list.slice(-500);
    if (!m.mine && m.kind !== 'system' && !this.visible) this.unread.value++;
    if (!m.mine) this.typing.value = this.typing.peek().filter((t) => t.id !== m.from);
  }

  system(text: string): void {
    this.add({ id: newId(), from: '', name: '', role: null, ts: Date.now(), kind: 'system', text, mine: false });
  }

  updateFile(fileId: string, patch: Partial<ChatFile>): void {
    this.messages.value = this.messages.peek().map((m) =>
      m.file?.id === fileId ? { ...m, file: { ...m.file, ...patch } } : m,
    );
  }

  setTyping(id: string, name: string): void {
    const until = Date.now() + 4000;
    this.typing.value = [...this.typing.peek().filter((t) => t.id !== id), { id, name, until }];
    setTimeout(() => {
      this.typing.value = this.typing.peek().filter((t) => t.until > Date.now());
    }, 4100);
  }

  markRead(): void {
    this.unread.value = 0;
  }

  /** Text messages for someone who joins later (files stay with the people who were there). */
  history(): Omit<ChatMessage, 'mine'>[] {
    return this.messages
      .peek()
      .filter((m) => m.kind === 'text')
      .slice(-150)
      .map(({ mine: _mine, ...rest }) => rest);
  }

  merge(list: unknown, selfId: string): void {
    if (!Array.isArray(list)) return;
    const have = new Set(this.messages.peek().map((m) => m.id));
    const add: ChatMessage[] = [];
    for (const x of list.slice(-150)) {
      const m = x as ChatMessage;
      if (!m || typeof m.id !== 'string' || have.has(m.id) || m.kind !== 'text' || typeof m.text !== 'string') continue;
      add.push({
        id: m.id,
        from: String(m.from),
        name: String(m.name).slice(0, 40),
        role: m.role ?? null,
        ts: Number(m.ts) || Date.now(),
        kind: 'text',
        text: m.text.slice(0, 4000),
        mine: m.from === selfId,
      });
    }
    if (add.length) this.messages.value = [...this.messages.peek(), ...add].sort((a, b) => a.ts - b.ts).slice(-500);
  }

  clear(): void {
    for (const m of this.messages.peek()) if (m.file?.url) URL.revokeObjectURL(m.file.url);
    this.messages.value = [];
    this.unread.value = 0;
    this.typing.value = [];
  }
}

/** A message made only of emoji (shown large). */
export function emojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && /\p{Extended_Pictographic}/u.test(t);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
