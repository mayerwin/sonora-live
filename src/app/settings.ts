// Preferences, kept in this browser only (localStorage). Nothing about a lesson is stored anywhere else.

import { effect, signal } from '@preact/signals';
import type { AudioQuality, VideoQuality } from '../media/constraints.ts';
import type { PlayOn } from '../midi/hub.ts';
import type { TurnConfig } from '../net/ice.ts';
import type { Role } from '../net/room.ts';

export type SoundSetting = 'auto' | 'pure' | 'voice';

export interface Settings {
  /** 'auto': the browser's language */
  language: 'auto' | 'en' | 'fr';
  name: string;
  role: Role | null;
  sound: SoundSetting;
  audioQuality: AudioQuality;
  videoQuality: VideoQuality;
  micId: string;
  camId: string;
  speakerId: string;
  /** start with the camera off */
  camOff: boolean;
  mirror: boolean;
  lockRooms: boolean;
  roomLimit: number;
  joinSound: boolean;
  notifyJoin: boolean;
  chatOpen: boolean;
  midi: {
    /** instrument key to reconnect automatically */
    instrument: string;
    send: boolean;
    playOn: PlayOn;
    outChannel: number;
    pianoVolume: number;
    reverb: boolean;
    keyboard: boolean;
    qwerty: boolean;
  };
  turn: TurnConfig;
}

export const DEFAULTS: Settings = {
  language: 'auto',
  name: '',
  role: null,
  sound: 'auto',
  audioQuality: 'high',
  videoQuality: 'hd',
  micId: '',
  camId: '',
  speakerId: '',
  camOff: false,
  mirror: true,
  lockRooms: true,
  roomLimit: 2,
  joinSound: true,
  notifyJoin: true,
  chatOpen: true,
  midi: {
    instrument: '',
    send: true,
    playOn: 'auto',
    outChannel: 0,
    pianoVolume: 0.8,
    reverb: true,
    keyboard: true,
    qwerty: false,
  },
  turn: { urls: '', username: '', credential: '' },
};

const KEY = 'sonora.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...s,
      midi: { ...DEFAULTS.midi, ...(s.midi ?? {}) },
      turn: { ...DEFAULTS.turn, ...(s.turn ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = signal<Settings>(load());

effect(() => {
  const s = settings.value;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / storage full: preferences last for this visit
  }
});

export function update(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export function updateMidi(patch: Partial<Settings['midi']>): void {
  settings.value = { ...settings.value, midi: { ...settings.value.midi, ...patch } };
}

/** This tab's id: kept across reloads of the tab, so a reload rejoins as the same person. */
export function tabId(make: () => string): string {
  try {
    let id = sessionStorage.getItem('sonora.tab');
    if (!id) {
      id = make();
      sessionStorage.setItem('sonora.tab', id);
    }
    return id;
  } catch {
    return make();
  }
}
