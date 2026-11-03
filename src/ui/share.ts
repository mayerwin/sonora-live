import { t } from '../app/i18n.ts';
import { askNotifications, notifyPermission, toast } from '../app/notify.ts';
import { settings } from '../app/settings.ts';
import { prettyCode } from '../net/code.ts';
import { copyText } from './common.tsx';

/** The room's link; `watch`: the link for observers (a parent, a guest, a phone as a second camera). */
export function roomLink(code: string, watch = false): string {
  return `${location.origin}${location.pathname}${watch ? '?watch' : ''}#${code}`;
}

/** Sending the link is the moment to want a notification when they arrive: ask then (once), from this click. */
function askToNotify(): void {
  if (settings.peek().notifyJoin && notifyPermission.peek() === 'default') void askNotifications();
}

export async function copyLink(code: string, watch = false): Promise<void> {
  askToNotify();
  const ok = await copyText(roomLink(code, watch));
  toast(
    ok
      ? {
          kind: 'success',
          title: t('Link copied'),
          body: t('Send it to your teacher or student. They open it and they are in.'),
        }
      : { kind: 'warn', title: t('Could not copy'), body: roomLink(code) },
  );
}

export const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function shareLink(code: string): Promise<void> {
  const url = roomLink(code);
  if (canShare) {
    try {
      await navigator.share({
        title: t('Sonora Live lesson'),
        text: t('Join my music lesson on Sonora Live (room {code}):', { code: prettyCode(code) }),
        url,
      });
      askToNotify();
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
    }
  }
  await copyLink(code);
}
