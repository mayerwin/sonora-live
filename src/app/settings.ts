// Preferences, kept in this browser only (localStorage). Nothing about a lesson is stored anywhere else.

import { effect, signal } from '@preact/signals';
import type { AudioQuality, VideoQuality } from '../media/constraints.ts';
import type { PlayOn } from '../midi/hub.ts';
import type { TurnConfig } from '../net/ice.ts';

export type SoundSetting = 'auto' | 'pure' | 'voice';
/** echo cancelling in pure sound: 'auto' unless headphones are detected */
export type EchoSetting = 'auto' | 'on' | 'off';

export interface Settings {
  /** 'auto': the browser's language */
  language: 'auto' | 'en' | 'fr';
  name: string;
  sound: SoundSetting;
  echo: EchoSetting;
  /** echo cancelling in pure sound: the music-safe one (linear, never ducks, may leave some echo) rather than the
   * browser's (robust; ducks what is played here while the others play) */
  musicEcho: boolean;
  /** automatic level for music in pure sound (slow, keeps crescendos) */
  autoLevel: boolean;
  /** the others' MIDI waits for their sound (keys, notes, voice and microphone in time) */
  midiSync: boolean;
  audioQuality: AudioQuality;
  videoQuality: VideoQuality;
  micId: string;
  camId: string;
  speakerId: string;
  /** start with the camera off */
  camOff: boolean;
  /** front or back camera (phones and tablets) */
  facing: 'user' | 'environment';
  mirror: boolean;
  lockRooms: boolean;
  roomLimit: number;
  joinSound: boolean;
  /** whose sound this listener cleans of steady background noise (by name: names last from one lesson to the
   * next, ids do not) */
  cleanNoise: string[];
  notifyJoin: boolean;
  chatOpen: boolean;
  /** show the backing track player (shared, synchronized audio files); a track someone else shares shows anyway */
  backingTrack: boolean;
  /** this listener's backing track volume (0..1) */
  backingVolume: number;
  midi: {
    /** instrument key to reconnect automatically */
    instrument: string;
    send: boolean;
    playOn: PlayOn;
    outChannel: number;
    pianoVolume: number;
    reverb: boolean;
    /** show the on-screen keys while MIDI plays */
    keyboard: boolean;
    /** the on-screen keys were left open */
    keysOpen: boolean;
    qwerty: boolean;
  };
  turn: TurnConfig;
}

export const DEFAULTS: Settings = {
  language: 'auto',
  name: '',
  sound: 'auto',
  echo: 'auto',
  musicEcho: false,
  autoLevel: true,
  midiSync: true,
  audioQuality: 'high',
  videoQuality: 'hd',
  micId: '',
  camId: '',
  speakerId: '',
  camOff: false,
  facing: 'user',
  mirror: true,
  lockRooms: true,
  roomLimit: 2,
  joinSound: true,
  cleanNoise: [],
  notifyJoin: true,
  chatOpen: true,
  backingTrack: false,
  backingVolume: 0.8,
  midi: {
    instrument: '',
    send: true,
    playOn: 'auto',
    outChannel: 0,
    pianoVolume: 0.8,
    reverb: true,
    keyboard: true,
    keysOpen: false,
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
