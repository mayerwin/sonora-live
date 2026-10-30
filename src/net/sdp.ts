// Opus tuning for instruments. A session description tells the other side how this side wants to RECEIVE, so
// these settings are written into the descriptions we send (our own local description is left untouched):
//
//   stereo=1; sprop-stereo=1   stereo both ways (a piano is wide; mono microphones simply stay mono)
//   maxaveragebitrate=510000   no codec ceiling: the sender's quality setting decides (RTCRtpSender maxBitrate)
//   maxplaybackrate=48000      full band, 20 kHz
//   usedtx=0                   never stop sending during quiet passages: a soft, sustained note must not be
//                              treated as silence and cut
//   useinbandfec=1             forward error correction: a lost packet is rebuilt from the next one
//   cbr=0                      variable bitrate: more bits where the music needs them
//   a=ptime:10 / minptime=10   10 ms frames instead of 20: one frame less of delay at each end, the
//                              packetisation that low-latency game voice chat uses

export interface OpusTuning {
  stereo: boolean;
  /** frame length in ms (10 or 20) */
  ptime: number;
}

export const DEFAULT_TUNING: OpusTuning = { stereo: true, ptime: 10 };

export function tuneOpus(sdp: string, tuning: OpusTuning = DEFAULT_TUNING): string {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  // find the payload types of opus
  const opusPts = new Set<string>();
  for (const l of lines) {
    const m = /^a=rtpmap:(\d+) opus\/48000/i.exec(l);
    if (m) opusPts.add(m[1]);
  }
  if (!opusPts.size) return sdp;

  const out: string[] = [];
  let inAudio = false;
  let audioHasOpus = false;
  let ptimeWritten = false;
  const fmtpSeen = new Set<string>();

  const flushAudio = () => {
    if (inAudio && audioHasOpus) {
      // fmtp lines missing for an opus payload type
      for (const pt of opusPts) {
        if (!fmtpSeen.has(pt)) out.push(`a=fmtp:${pt} ${formatParams(tuneParams(new Map(), tuning))}`);
      }
      if (!ptimeWritten) out.push(`a=ptime:${tuning.ptime}`);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('m=')) {
      flushAudio();
      inAudio = l.startsWith('m=audio');
      audioHasOpus = inAudio && l.split(' ').slice(3).some((pt) => opusPts.has(pt.trim()));
      ptimeWritten = false;
      fmtpSeen.clear();
      out.push(l);
      continue;
    }
    if (inAudio && audioHasOpus) {
      const f = /^a=fmtp:(\d+) (.*)$/.exec(l);
      if (f && opusPts.has(f[1])) {
        fmtpSeen.add(f[1]);
        out.push(`a=fmtp:${f[1]} ${formatParams(tuneParams(parseParams(f[2]), tuning))}`);
        continue;
      }
      if (l.startsWith('a=ptime:')) {
        out.push(`a=ptime:${tuning.ptime}`);
        ptimeWritten = true;
        continue;
      }
      if (l === '' && i === lines.length - 1) {
        flushAudio();
        inAudio = false;
        out.push(l);
        continue;
      }
    }
    out.push(l);
  }
  flushAudio();
  return out.join(nl);
}

function parseParams(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of s.split(';')) {
    const [k, v] = part.split('=');
    if (k?.trim()) m.set(k.trim(), (v ?? '').trim());
  }
  return m;
}

function tuneParams(p: Map<string, string>, t: OpusTuning): Map<string, string> {
  p.set('minptime', String(Math.min(10, t.ptime)));
  p.set('useinbandfec', '1');
  p.set('usedtx', '0');
  p.set('stereo', t.stereo ? '1' : '0');
  p.set('sprop-stereo', t.stereo ? '1' : '0');
  p.set('maxaveragebitrate', '510000');
  p.set('maxplaybackrate', '48000');
  p.set('cbr', '0');
  return p;
}

function formatParams(p: Map<string, string>): string {
  return [...p].map(([k, v]) => `${k}=${v}`).join(';');
}

/** Opus parameters this description asks for (tests and the connection panel). */
export function readOpus(sdp: string): { fmtp: Record<string, string>; ptime: number | null } | null {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return null;
  const fmtp = new RegExp(`a=fmtp:${pt} (.*)`).exec(sdp)?.[1] ?? '';
  const ptime = /a=ptime:(\d+)/.exec(sdp)?.[1];
  return { fmtp: Object.fromEntries(parseParams(fmtp.trim())), ptime: ptime ? Number(ptime) : null };
}
