// Echo cancelling: kept in pure sound unless headphones are in use, always in voice mode.

import { describe, expect, it } from 'vitest';
import { audioConstraints } from '../../src/media/constraints.ts';
import { looksLikeHeadphones } from '../../src/media/local.ts';

describe('echo cancelling', () => {
  it('pure sound cancels echo unless told otherwise, and keeps the rest of the processing off', () => {
    const c = audioConstraints('pure');
    expect(c.echoCancellation).toBe(true);
    expect(c.noiseSuppression).toBe(false);
    expect(c.autoGainControl).toBe(false);
    expect(audioConstraints('pure', undefined, false).echoCancellation).toBe(false);
  });

  it('voice mode always cancels echo', () => {
    expect(audioConstraints('voice', undefined, false).echoCancellation).toBe(true);
  });

  it('recognises headphones by name, and never takes speakers for them', () => {
    for (const h of [
      'Default - Headphones (Realtek(R) Audio)',
      'External Headphones',
      'AirPods Pro',
      'Galaxy Buds2',
      'Casque (USB Audio)',
      'Écouteurs',
      'Jabra Evolve2 Headset',
      'Kopfhörer (High Definition Audio)',
    ])
      expect(looksLikeHeadphones(h), h).toBe(true);
    for (const s of [
      'Default - Speakers (Realtek(R) Audio)',
      'MacBook Pro Speakers',
      'Haut-parleurs (Realtek High Definition Audio)',
      'JBL Flip 5',
      'Bluetooth speaker',
      'Sony TV',
      'LG HDR 4K (NVIDIA High Definition Audio)',
      'Display Audio',
      '',
    ])
      expect(looksLikeHeadphones(s), s).toBe(false);
  });
});
