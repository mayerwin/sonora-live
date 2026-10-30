import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { find as findLinks } from 'linkifyjs';
import { Download, FileMusic, FileText, Lock, Paperclip, SendHorizontal, Smile, X } from 'lucide-preact';
import { session, roleLabel } from '../app/session.ts';
import { update } from '../app/settings.ts';
import { emojiOnly, formatBytes, type ChatMessage } from '../app/chat.ts';
import { chatOpen } from './state.ts';
import frPicker from 'emoji-picker-element/i18n/fr';
import versions from 'virtual:sonora-assets';
import { clock, lang, t, tn } from '../app/i18n.ts';

function Linkified({ text }: { text: string }) {
  const links = findLinks(text, 'url');
  if (!links.length) return <>{text}</>;
  const out: ComponentChildren[] = [];
  let at = 0;
  for (const l of links) {
    if (l.start > at) out.push(text.slice(at, l.start));
    out.push(
      <a href={l.href} target="_blank" rel="noopener noreferrer">
        {l.value}
      </a>,
    );
    at = l.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function FileBubble({ m }: { m: ChatMessage }) {
  const f = m.file!;
  const done = f.progress >= 1 && !!f.url;
  if (done && f.mime.startsWith('image/')) {
    return (
      <a href={f.url!} target="_blank" rel="noopener">
        <img class="file-img" src={f.url!} alt={f.name} />
      </a>
    );
  }
  const music = /midi|musicxml|\.mxl$|\.mid$|\.musicxml$|audio\//i.test(`${f.mime} ${f.name}`);
  const Ico = music ? FileMusic : FileText;
  const body = (
    <>
      <span class="ico">
        <Ico />
      </span>
      <span class="grow">
        <div class="fname">{f.name}</div>
        <div class="fsub">
          {formatBytes(f.size)}
          {done
            ? ` · ${m.mine ? t('sent') : t('tap to open')}`
            : f.failed
              ? ` · ${t('incomplete')}`
              : ` · ${Math.round(f.progress * 100)}%`}
        </div>
        {!done && (
          <div class="progress">
            <i style={{ width: `${Math.round(f.progress * 100)}%` }} />
          </div>
        )}
      </span>
      {done && <Download size={18} color="var(--muted)" />}
    </>
  );
  return done ? (
    <a
      class="file-card"
      href={f.url!}
      target="_blank"
      rel="noopener"
      download={f.mime === 'application/pdf' ? undefined : f.name}
    >
      {body}
    </a>
  ) : (
    <div class="file-card">{body}</div>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let picker: HTMLElement | null = null;
    let alive = true;
    void import('emoji-picker-element').then(({ Picker }) => {
      if (!alive || !host.current) return;
      const l = lang.peek();
      // the picker's own words and the emoji names (for search) in the language in use; English is its default
      const p = new Picker({
        locale: l,
        dataSource: `${import.meta.env.BASE_URL}emoji/${l}.json${versions.emoji[l] ? `?v=${versions.emoji[l]}` : ''}`,
        skinToneEmoji: '👍',
        ...(l === 'fr' ? { i18n: frPicker } : {}),
      });
      p.addEventListener('emoji-click', (e) => onPick(e.detail.unicode ?? ''));
      host.current.appendChild(p);
      picker = p;
      requestAnimationFrame(() => (p.shadowRoot?.querySelector('input') as HTMLInputElement | null)?.focus());
    }, onClose); // its code is gone when a newer version replaced this one during the lesson (it loads after)
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const out = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.emoji-pop, .emoji-toggle')) onClose();
    };
    window.addEventListener('keydown', k);
    window.addEventListener('pointerdown', out);
    return () => {
      alive = false;
      picker?.remove();
      window.removeEventListener('keydown', k);
      window.removeEventListener('pointerdown', out);
    };
  }, []);
  return <div class="emoji-pop" ref={host} />;
}

export function ChatPanel() {
  const chat = session.chat;
  const messages = chat.messages.value;
  const typing = chat.typing.value;
  const peers = session.peers.value;
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [drag, setDrag] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    chat.visible = true;
    chat.markRead();
    return () => {
      chat.visible = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    chat.markRead();
  }, [messages.length, typing.length]);

  const autosize = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  };

  const send = () => {
    if (!text.trim()) return;
    session.sendChat(text);
    setText('');
    stick.current = true;
    requestAnimationFrame(autosize);
  };

  const insert = (s: string) => {
    const el = ta.current;
    if (!el) {
      setText(text + s);
      return;
    }
    const a = el.selectionStart ?? text.length;
    const b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + s.length;
      autosize();
    });
  };

  const files = (fl: FileList | null | undefined) => {
    if (!fl) return;
    for (const f of Array.from(fl)) session.sendFile(f);
    stick.current = true;
  };

  const typingNames = typing.filter((x) => x.until > Date.now()).map((x) => x.name);
  const people = peers.length + 1;

  return (
    <aside
      class="chat"
      aria-label={t('Chat')}
      data-testid="chat"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        files(e.dataTransfer?.files);
      }}
    >
      <header class="chat-head">
        <h2>{t('Chat')}</h2>
        <span class="chip">{tn(people, '{n} person', '{n} people')}</span>
        <button
          class="icon-btn"
          aria-label={t('Close chat')}
          onClick={() => {
            chatOpen.value = false;
            update({ chatOpen: false });
          }}
        >
          <X />
        </button>
      </header>
      <div
        class="chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div class="chat-empty">
            <Lock />
            <span>{t('Messages and files go straight to the others and disappear when the lesson ends.')}</span>
            <span style="font-size:12.5px">{t('Drop sheet music (PDF, images, MusicXML) here to share it.')}</span>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.kind === 'system') {
            return (
              <div class="msg-sys" key={m.id}>
                {m.text}
              </div>
            );
          }
          const prev = messages[i - 1];
          const first = !prev || prev.from !== m.from || prev.kind === 'system' || m.ts - prev.ts > 5 * 60_000;
          const big = m.kind === 'text' && emojiOnly(m.text ?? '');
          return (
            <div
              class={`msg ${m.mine ? 'mine' : ''} ${first ? 'first' : ''}`}
              key={m.id}
              data-role={m.role ?? undefined}
            >
              {first && (
                <div class="who">
                  {m.mine ? t('You') : m.name}
                  {!m.mine && m.role && <span style="color:var(--faint);font-weight:500">{roleLabel(m.role)}</span>}
                  <time>{clock(m.ts)}</time>
                </div>
              )}
              {m.kind === 'file' ? (
                <FileBubble m={m} />
              ) : (
                <div class={`bubble ${big ? 'emoji' : ''}`}>
                  <Linkified text={m.text ?? ''} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div class="typing" aria-live="polite">
        {typingNames.length > 0 && (
          <>
            <span class="dots">
              <i />
              <i />
              <i />
            </span>
            {tn(typingNames.length, '{names} is typing', '{names} are typing', { names: typingNames.join(', ') })}
          </>
        )}
      </div>
      <div class="composer">
        {emoji && <EmojiPicker onPick={(e) => insert(e)} onClose={() => setEmoji(false)} />}
        <div class="composer-box">
          <button class="icon-btn" aria-label={t('Attach a file')} onClick={() => file.current?.click()}>
            <Paperclip />
          </button>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf,audio/*,.mid,.midi,.musicxml,.mxl,.xml,.txt,.doc,.docx"
            onChange={(e) => {
              files((e.currentTarget as HTMLInputElement).files);
              (e.currentTarget as HTMLInputElement).value = '';
            }}
          />
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={t('Message')}
            aria-label={t('Message')}
            enterkeyhint="send"
            onInput={(e) => {
              setText((e.currentTarget as HTMLTextAreaElement).value);
              autosize();
              session.typing();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const fl = e.clipboardData?.files;
              if (fl && fl.length) {
                e.preventDefault();
                files(fl);
              }
            }}
          />
          <button
            class="icon-btn emoji-toggle"
            aria-label={t('Emoji')}
            aria-expanded={emoji}
            onClick={() => setEmoji(!emoji)}
          >
            <Smile />
          </button>
          <button
            class="send-btn"
            aria-label={t('Send')}
            disabled={!text.trim()}
            onClick={send}
            data-testid="chat-send"
          >
            <SendHorizontal />
          </button>
        </div>
      </div>
      {drag && <div class="drop-hint">{t('Drop to share with everyone')}</div>}
    </aside>
  );
}
