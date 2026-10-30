// Capture settings for the two sound modes.
//
// Pure (default): what the microphone hears, untouched. Browsers process microphones for speech by default:
// echo cancellation, noise suppression and automatic gain. To a speech processor, a sustained piano chord is
// "noise" to remove and a crescendo is "gain" to undo. Pure turns all of that off and keeps stereo, like
// Cleanfeed or Zoom's "Original sound for musicians". Use headphones: nothing removes the echo of the
// speakers then.
//
// Voice: the browser's speech processing, on. Chosen automatically while MIDI carries the instrument (the
// microphone then only needs to carry speech), or by hand when there is no headphone.

export type SoundMode = 'pure' | 'voice';

export function audioConstraints(mode: SoundMode, deviceId?: string): MediaTrackConstraints {
  const device = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (mode === 'voice') {
    return {
      ...device,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
    };
  }
  return {
    ...device,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
    // Chromium also has voice isolation on some platforms; never for instruments
    ...({ voiceIsolation: false } as MediaTrackConstraints),
  };
}

export type VideoQuality = 'sd' | 'hd' | 'fhd';

export const VIDEO_QUALITY: Record<VideoQuality, { width: number; height: number; bitrate: number; label: string }> = {
  sd: { width: 640, height: 360, bitrate: 700_000, label: 'Data saver · 360p' },
  hd: { width: 1280, height: 720, bitrate: 2_000_000, label: 'HD · 720p' },
  fhd: { width: 1920, height: 1080, bitrate: 4_000_000, label: 'Full HD · 1080p' },
};

export function videoConstraints(
  q: VideoQuality,
  deviceId?: string,
  facing?: 'user' | 'environment',
): MediaTrackConstraints {
  const v = VIDEO_QUALITY[q];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : facing ? { facingMode: { ideal: facing } } : {}),
    width: { ideal: v.width },
    height: { ideal: v.height },
    frameRate: { ideal: 30, max: 30 },
    aspectRatio: { ideal: 16 / 9 },
  };
}

export type AudioQuality = 'standard' | 'high' | 'studio';

export const AUDIO_QUALITY: Record<AudioQuality, { bitrate: number; label: string; hint: string }> = {
  standard: { bitrate: 96_000, label: 'Standard', hint: '96 kbps · slow or mobile connections' },
  high: { bitrate: 192_000, label: 'High', hint: '192 kbps stereo · recommended' },
  studio: { bitrate: 320_000, label: 'Studio', hint: '320 kbps stereo · broadcast quality' },
};
