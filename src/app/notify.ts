// Telling people what happens: toasts, small musical chimes, system notifications when the tab is in the
// background, and a counter in the tab title.

import { signal } from '@preact/signals';
import { t } from './i18n.ts';

export type ToastKind = 'info' | 'join' | 'leave' | 'warn' | 'error' | 'success' | 'knock' | 'chat';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  /** ms; 0 = until dismissed */
  timeout: number;
}

export const toasts = signal<Toast[]>([]);
let nextId = 1;

export function toast(t: Omit<Toast, 'id' | 'timeout'> & { timeout?: number; key?: string }): number {
  const id = nextId++;
  const item: Toast = { id, timeout: t.timeout ?? (t.action ? 9000 : 4500), ...t };
  // the same message again replaces the previous one
  toasts.value = [...toasts.value.filter((x) => x.title !== t.title || x.kind !== t.kind), item].slice(-4);
  if (item.timeout > 0) setTimeout(() => dismiss(id), item.timeout);
  return id;
}

export function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// ------------------------------------------------------------------------------------------------- chimes

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'playback' });
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a click: browsers only allow sound after one. */
export function unlockChimes(): void {
  audio();
}

function bell(c: AudioContext, freq: number, at: number, gain: number, len = 1.2): void {
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o2.type = 'sine';
  o.frequency.value = freq;
  o2.frequency.value = freq * 2.756; // a bell's inharmonic partial
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  o.connect(g);
  o2.connect(g2).connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.start(at);
  o2.start(at);
  o.stop(at + len);
  o2.stop(at + len);
}

export type Chime = 'join' | 'leave' | 'message' | 'knock';

export function chime(kind: Chime): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.01;
  if (kind === 'join') {
    bell(c, 659.25, t, 0.12); // E5
    bell(c, 987.77, t + 0.13, 0.1); // B5: an open fifth
  } else if (kind === 'leave') {
    bell(c, 987.77, t, 0.08);
    bell(c, 659.25, t + 0.13, 0.08);
  } else if (kind === 'message') {
    bell(c, 1318.5, t, 0.05, 0.5);
  } else {
    // two soft knocks
    for (const d of [0, 0.16]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t + d);
      o.frequency.exponentialRampToValueAtTime(110, t + d + 0.08);
      g.gain.setValueAtTime(0.25, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
      o.connect(g).connect(c.destination);
      o.start(t + d);
      o.stop(t + d + 0.13);
    }
  }
}

// ------------------------------------------------------------------------------------------------- system

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export const notifyPermission = signal<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
);

// the permission can also change from the browser's own controls (the icon in the address bar)
if (typeof navigator !== 'undefined' && notificationsSupported()) {
  void navigator.permissions
    ?.query({ name: 'notifications' })
    .then((st) => {
      st.onchange = () => (notifyPermission.value = Notification.permission);
    })
    .catch(() => {});
}

/**
 * Ask for system notifications; call it from a click (some browsers only ask then). `explain`: the person asked
 * for them, so say what to do when the browser shows its request discreetly, or not at all.
 */
let offered = false;

export async function askNotifications(explain = false): Promise<boolean> {
  if (!notificationsSupported()) return false;
  notifyPermission.value = Notification.permission;
  if (Notification.permission === 'granted') return true;
  // offered on our own initiative: once per visit, not at every link copied
  if (!explain && offered) return false;
  offered = true;
  if (Notification.permission === 'denied') {
    if (explain) blockedToast();
    return false;
  }
  const started = Date.now();
  // the request may be a small bell in the address bar (Edge, and Chrome's quieter requests)
  const hint = explain
    ? setTimeout(
        () =>
          toast({
            kind: 'info',
            title: t('Your browser is asking'),
            body: t(
              'Allow notifications in its request, at the top of the window or behind the bell in the address bar.',
            ),
          }),
        1500,
      )
    : 0;
  try {
    const p = await Notification.requestPermission();
    notifyPermission.value = p;
    if (explain && p === 'denied') blockedToast();
    // answered at once without asking: the browser holds back requests from this site for now
    if (explain && p === 'default' && Date.now() - started < 500) blockedToast();
    return p === 'granted';
  } catch {
    return false;
  } finally {
    clearTimeout(hint);
  }
}

function blockedToast(): void {
  toast({
    kind: 'warn',
    title: t('Notifications are blocked'),
    body: t('Allow them for this site from the icon at the left of the address bar, then come back.'),
    timeout: 9000,
  });
}

/** A system notification, only while the page is hidden (otherwise the toast says it). */
export function systemNotify(title: string, body: string, tag: string): void {
  if (!document.hidden || !notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/badge-96.png' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Android Chrome needs a service worker notification
    void navigator.serviceWorker?.ready
      .then((r) => r.showNotification(title, { body, tag, icon: './icons/icon-192.png' }))
      .catch(() => {});
  }
}

// ------------------------------------------------------------------------------------------------- title

const BASE_TITLE = 'Sonora Live';
let unseen = 0;
let roomLabel = '';

export function setTitleRoom(code: string): void {
  roomLabel = code ? ` · ${code}` : '';
  renderTitle();
}

export function bumpTitle(): void {
  if (!document.hidden) return;
  unseen++;
  renderTitle();
}

function renderTitle(): void {
  document.title = `${unseen ? `(${unseen}) ` : ''}${BASE_TITLE}${roomLabel}`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && unseen) {
      unseen = 0;
      renderTitle();
    }
  });
}

export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}
