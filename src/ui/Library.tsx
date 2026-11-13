// The library, where it is useful: the recent tracks under an empty track player, the recent scores in the score
// picker, everything (with its size) in Settings. One tap opens a file for everyone again.

import { useEffect, useState } from 'preact/hooks';
import { FileMusic, FileText, Trash2 } from 'lucide-preact';
import { t } from '../app/i18n.ts';
import {
  fetchItem,
  forget,
  forgetAll,
  libraryItems,
  librarySize,
  refreshLibrary,
  type LibItem,
  type LibKind,
} from '../media/library.ts';
import { size } from './Record.tsx';

let loaded = false;
function useLibrary(): LibItem[] {
  useEffect(() => {
    if (!loaded) {
      loaded = true;
      void refreshLibrary();
    }
  }, []);
  return libraryItems.value;
}

/** Recent files of one kind, as chips: a tap opens one (for everyone). */
export function Recent({ kind, onOpen, max = 6 }: { kind: LibKind; onOpen: (f: File) => void; max?: number }) {
  const items = useLibrary()
    .filter((x) => x.kind === kind)
    .slice(0, max);
  if (!items.length) return null;
  const Icon = kind === 'track' ? FileMusic : FileText;
  return (
    <div class="recent" data-testid={`recent-${kind}`}>
      <span class="recent-lbl">{t('Recent')}</span>
      {items.map((it) => (
        <button
          type="button"
          class="recent-chip"
          title={it.name}
          onClick={() =>
            void fetchItem(it).then((f) => {
              if (f) onOpen(f);
            })
          }
        >
          <Icon size={14} />
          <span>{it.name.replace(/\.[a-z0-9]+$/i, '')}</span>
        </button>
      ))}
    </div>
  );
}

/** Settings: what the library holds, and a way to empty it. */
export function LibrarySection() {
  const items = useLibrary();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <div class="section">
      <h3>{t('Library on this device')}</h3>
      <p class="lead" style="font-size:13px">
        {items.length
          ? t(
              '{n} files, {size}: the tracks and scores of your lessons, kept here to reopen with one tap. Never uploaded.',
              {
                n: items.length,
                size: size(librarySize(items)),
              },
            )
          : t('The tracks and scores of your lessons will be kept here, to reopen with one tap. Never uploaded.')}
      </p>
      {items.length > 0 && (
        <>
          <ul class="rec-list" data-testid="library-list">
            {shown.map((it) => (
              <li key={it.id}>
                {it.kind === 'track' ? <FileMusic size={16} /> : <FileText size={16} />}
                <span class="grow">
                  <b>{it.name}</b>
                  <small>{size(it.size)}</small>
                </span>
                <button
                  class="icon-btn"
                  title={t('Delete')}
                  aria-label={t('Delete')}
                  onClick={() => void forget(it.id)}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            {items.length > 5 && (
              <button class="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>
                {all ? t('Show fewer') : t('Show all {n}', { n: items.length })}
              </button>
            )}
            <button class="btn btn-sm btn-ghost" onClick={() => void forgetAll()}>
              <Trash2 /> {t('Empty the library')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
