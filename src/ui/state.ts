// What is open on screen (not part of the lesson itself).

import { effect, signal } from '@preact/signals';
import { settings, updateMidi } from '../app/settings.ts';

export type SheetName = 'midi' | 'settings' | 'share' | 'lock' | 'peer-sound' | null;
/** the side panel's tab: the chat, or everyone's sound settings */
export const sideTab = signal<'chat' | 'sound'>('chat');
/** whose sound the 'peer-sound' sheet is about */
export const peerSound = signal<string | null>(null);
export type SettingsTab = 'audio' | 'video' | 'room' | 'connection' | 'about';

export const sheet = signal<SheetName>(null);
export const settingsTab = signal<SettingsTab>('audio');
const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches;
export const chatOpen = signal<boolean>(wide && settings.peek().chatOpen);
/** the on-screen keys, opened by hand (kept for next time) */
export const keyboardOpen = signal(settings.peek().midi.keysOpen);
effect(() => {
  const open = keyboardOpen.value;
  if (open !== settings.peek().midi.keysOpen) updateMidi({ keysOpen: open });
});
/** the backing track player opened or hidden by hand; null: by itself (shown while a track is shared) */
export const trackOpen = signal<boolean | null>(null);
/** the metronome's panel, the same way (shown while it runs) */
export const metroOpen = signal<boolean | null>(null);
/** the tuner's panel, opened by hand */
export const tunerOpen = signal(false);
/** the Music strip opened from the bar (it also shows while any of its tools does) */
export const musicOpen = signal(false);
export const menu = signal<'sound' | 'sound-more' | 'react' | 'more' | null>(null);
// 'sound': the sound menu under its own button; 'sound-more': the same, opened from More (small screens)

export function openSettings(tab: SettingsTab = 'audio'): void {
  settingsTab.value = tab;
  sheet.value = 'settings';
}
