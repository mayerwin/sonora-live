// What is open on screen (not part of the lesson itself).

import { signal } from '@preact/signals';
import { settings } from '../app/settings.ts';

export type SheetName = 'midi' | 'settings' | 'share' | 'lock' | null;
export type SettingsTab = 'audio' | 'video' | 'room' | 'connection' | 'about';

export const sheet = signal<SheetName>(null);
export const settingsTab = signal<SettingsTab>('audio');
const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches;
export const chatOpen = signal<boolean>(wide && settings.peek().chatOpen);
export const keyboardOpen = signal(false);
export const menu = signal<'sound' | 'sound-more' | 'react' | 'more' | null>(null);
// 'sound': the sound menu under its own button; 'sound-more': the same, opened from More (small screens)

export function openSettings(tab: SettingsTab = 'audio'): void {
  settingsTab.value = tab;
  sheet.value = 'settings';
}
