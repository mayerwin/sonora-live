// Keyboard shortcuts in the lesson, for hands that are on an instrument or a keyboard: single keys, nothing to
// hold. They stand aside while one types (a message, a name) and while the computer keyboard plays the on-screen
// piano (its letters are notes then). "?" lists them.

import { useEffect } from 'preact/hooks';
import { Keyboard } from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, update } from '../app/settings.ts';
import { t } from '../app/i18n.ts';
import { Sheet } from './common.tsx';
import { chatOpen, menu, sheet } from './state.ts';
import { shown, toggleMusic } from './Music.tsx';
import { scoreShown, tool } from './Score.tsx';

const typing = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
};

/** the computer keyboard plays the on-screen piano: its letters are notes */
const keysPlay = () => shown.peek().keys && settings.peek().midi.qwerty;

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Shortcut {
  keys: string[];
  what: () => string;
}

/** The list, as the sheet shows it. */
const LIST: { group: () => string; items: Shortcut[] }[] = [
  {
    group: () => t('In the lesson'),
    items: [
      { keys: ['M'], what: () => t('Microphone on or off') },
      { keys: ['V'], what: () => t('Camera on or off') },
      { keys: ['C'], what: () => t('Chat') },
      { keys: ['U'], what: () => t('Music tools') },
      { keys: ['?'], what: () => t('These shortcuts') },
    ],
  },
  {
    group: () => t('Playing'),
    items: [
      { keys: [t('Space')], what: () => t('Play or pause the backing track') },
      { keys: ['T'], what: () => t('Start or stop the metronome') },
    ],
  },
  {
    group: () => t('On the score'),
    items: [
      { keys: ['←', '→'], what: () => t('Previous or next page') },
      { keys: ['P'], what: () => t('Pen') },
      { keys: ['H'], what: () => t('Highlighter') },
      { keys: ['E'], what: () => t('Eraser') },
      { keys: ['Esc'], what: () => t('Back to scrolling') },
      { keys: [mac ? '⌘ Z' : 'Ctrl Z'], what: () => t('Undo') },
      { keys: [mac ? '⇧ ⌘ Z' : 'Ctrl Y'], what: () => t('Redo') },
    ],
  },
];

/** What a key does in the lesson (true: it was a shortcut). */
export function handleKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || typing(e.target) || e.altKey) return false;
  // a sheet open: Escape is its own; the rest waits
  if (sheet.peek()) return false;
  const score = scoreShown.peek();
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (!score) return false;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) session.score.undo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') session.score.redo();
    else return false;
    return true;
  }
  if (e.key === '?') {
    sheet.value = 'shortcuts';
    return true;
  }
  if (score && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    session.score.setPage((session.score.shared.peek()?.page ?? 0) + (e.key === 'ArrowLeft' ? -1 : 1));
    return true;
  }
  if (score && e.key === 'Escape' && tool.peek() !== 'view' && !menu.peek()) {
    tool.value = 'view';
    return true;
  }
  // letters and Space are notes and the pedal while the computer keyboard plays the piano
  if (keysPlay() || e.repeat) return false;
  const media = session.media;
  switch (e.code) {
    case 'KeyM':
      media.setMicOn(!media.micOn.peek());
      return true;
    case 'KeyV': {
      const cam = media.camOn.peek();
      update({ camOff: cam });
      void media.setCamOn(!cam);
      return true;
    }
    case 'KeyC':
      chatOpen.value = !chatOpen.peek();
      update({ chatOpen: chatOpen.peek() });
      return true;
    case 'KeyU':
      toggleMusic();
      return true;
    case 'KeyT':
      if (!session.metronome.canControl || session.controlsHeld.peek()) return false;
      session.metronome.toggle();
      return true;
    case 'Space': {
      // a focused button keeps its own Space
      if ((e.target as HTMLElement | null)?.closest?.('button, a, [role=button], [role=switch]')) return false;
      const b = session.backing;
      if (!b.track.peek() || !b.canControl || session.controlsHeld.peek()) return false;
      if (b.shared.peek()?.playing) b.pause();
      else b.play();
      return true;
    }
  }
  if (score) {
    const next = e.code === 'KeyP' ? 'pen' : e.code === 'KeyH' ? 'marker' : e.code === 'KeyE' ? 'eraser' : null;
    if (next) {
      tool.value = next;
      return true;
    }
  }
  return false;
}

/** Listens in the lesson. */
export function useShortcuts(): void {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}

export function ShortcutsSheet() {
  return (
    <Sheet title={t('Keyboard shortcuts')} icon={<Keyboard />} onClose={() => (sheet.value = null)}>
      <div class="shortcuts" data-testid="shortcuts">
        {LIST.map((g) => (
          <section>
            <h3>{g.group()}</h3>
            <dl>
              {g.items.map((s) => (
                <>
                  <dt>
                    {s.keys.map((k) => (
                      <kbd>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{s.what()}</dd>
                </>
              ))}
            </dl>
          </section>
        ))}
        <p class="hint">
          {t('While the computer keyboard plays the on-screen piano, its letters and Space are notes and the pedal.')}
        </p>
      </div>
    </Sheet>
  );
}
