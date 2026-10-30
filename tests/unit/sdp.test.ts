import { describe, expect, it } from 'vitest';
import { readOpus, tuneOpus } from '../../src/net/sdp.ts';
import { newRoomCode, normalizeRoomCode, prettyCode, CODE_ALPHABET } from '../../src/net/code.ts';

const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendrecv',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  '',
].join('\r\n');

describe('Opus tuning', () => {
  it('asks for stereo, no DTX, FEC, full band and 10 ms frames', () => {
    const out = tuneOpus(CHROME_OFFER);
    const o = readOpus(out)!;
    expect(o.fmtp).toMatchObject({
      stereo: '1',
      'sprop-stereo': '1',
      usedtx: '0',
      useinbandfec: '1',
      maxaveragebitrate: '510000',
      maxplaybackrate: '48000',
      minptime: '10',
      cbr: '0',
    });
    expect(o.ptime).toBe(10);
  });

  it('leaves video and other codecs alone, keeps line endings', () => {
    const out = tuneOpus(CHROME_OFFER);
    expect(out).toContain('a=fmtp:63 111/111\r\n');
    expect(out).toContain('a=fmtp:97 apt=96');
    expect(out.split('\r\n').length).toBe(CHROME_OFFER.split('\r\n').length + 1);
    // ptime lands in the audio section, before the video section
    expect(out.indexOf('a=ptime:10')).toBeLessThan(out.indexOf('m=video'));
  });

  it('is idempotent', () => {
    const once = tuneOpus(CHROME_OFFER);
    expect(tuneOpus(once)).toBe(once);
  });

  it('adds an fmtp line when there is none', () => {
    const sdp = CHROME_OFFER.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
    expect(readOpus(tuneOpus(sdp))!.fmtp.stereo).toBe('1');
  });

  it('can be told mono and 20 ms', () => {
    const o = readOpus(tuneOpus(CHROME_OFFER, { stereo: false, ptime: 20 }))!;
    expect(o.fmtp.stereo).toBe('0');
    expect(o.ptime).toBe(20);
  });
});

describe('room codes', () => {
  it('are 6 characters without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('accept typing variations and pasted links', () => {
    expect(normalizeRoomCode('k7q 2mx')).toBe('K7Q2MX');
    expect(normalizeRoomCode('K7Q-2MX')).toBe('K7Q2MX');
    expect(normalizeRoomCode('https://mayerwin.github.io/sonora-live/#K7Q2MX')).toBe('K7Q2MX');
    expect(normalizeRoomCode('K7Q2M')).toBeNull();
    expect(normalizeRoomCode('K0Q2MX')).toBeNull();
    expect(prettyCode('K7Q2MX')).toBe('K7Q 2MX');
  });
});
