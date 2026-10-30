import { toast } from '../app/notify.ts';
import { prettyCode } from '../net/code.ts';
import { copyText } from './common.tsx';

export function roomLink(code: string): string {
  return `${location.origin}${location.pathname}#${code}`;
}

export async function copyLink(code: string): Promise<void> {
  const ok = await copyText(roomLink(code));
  toast(
    ok
      ? { kind: 'success', title: 'Link copied', body: 'Send it to your teacher or student. They open it and they are in.' }
      : { kind: 'warn', title: 'Could not copy', body: roomLink(code) },
  );
}

export const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function shareLink(code: string): Promise<void> {
  const url = roomLink(code);
  if (canShare) {
    try {
      await navigator.share({
        title: 'Sonora Live lesson',
        text: `Join my music lesson on Sonora Live (room ${prettyCode(code)}):`,
        url,
      });
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
    }
  }
  await copyLink(code);
}
