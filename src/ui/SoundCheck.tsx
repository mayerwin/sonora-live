// What the sound really does on this device, in Settings → Sound: the microphone as the browser delivers it,
// the echo cancelling and noise reduction as they run, the output's latency. With a report to copy (for a
// test call, or an issue).

import { Clipboard } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../app/i18n.ts';
import { browserName, os } from '../app/platform.ts';
import { session } from '../app/session.ts';
import { settings } from '../app/settings.ts';
import { engine } from '../media/engine.ts';
import { copyText } from './common.tsx';
import { toast } from '../app/notify.ts';
import { buildId } from '../app/update.ts';

type Settings = MediaTrackSettings & { latency?: number };

function snapshot() {
  const media = session.media;
  const mic = media.audio.peek();
  const st = (mic?.getSettings() ?? {}) as Settings;
  const ctx = engine.ctx as (AudioContext & { outputLatency?: number }) | null;
  const echo = engine.echo.peek();
  const s = settings.peek();
  return {
    app: buildId(),
    browser: `${browserName()} · ${os}`,
    ua: navigator.userAgent,
    mic: {
      label: mic?.label ?? '',
      on: media.micOn.peek(),
      channels: st.channelCount ?? null,
      rate: st.sampleRate ?? null,
      latencyMs: st.latency != null ? Math.round(st.latency * 1000) : null,
      browserEcho: st.echoCancellation ?? null,
      browserNoise: st.noiseSuppression ?? null,
      browserAgc: st.autoGainControl ?? null,
    },
    mode: { setting: s.sound, now: session.soundMode.peek(), echoSetting: s.echo, headphones: media.headphones.peek() },
    engine: {
      state: ctx?.state ?? 'none',
      rate: ctx?.sampleRate ?? null,
      outputMs: ctx ? Math.round(((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000) : null,
      cancelling: engine.cancelling,
      musicEcho: s.musicEcho,
      levelDb: engine.levelDb.peek() != null ? Math.round(engine.levelDb.peek()! * 10) / 10 : null,
      unavailable: engine.aecUnavailable.peek(),
      echoRemovedDb: echo?.reductionDb != null ? Math.round(echo.reductionDb * 10) / 10 : null,
      speakersPlaying: echo ? Math.round(echo.playing * 100) : null,
      delayMs: echo ? Math.round(echo.delayMs) : null,
    },
    sent: media.sentAudio.peek() === mic ? 'microphone as captured' : 'processed by the engine',
    peers: session.peers.peek().map((p) => ({
      route: engine.remoteRoute(p.id),
      theirEcho: p.remote?.echo ?? null,
      theirEchoSetting: p.remote?.echoSetting ?? null,
      rttMs: p.stats?.rtt ?? null,
      via: p.stats?.via ?? null,
      audioInKbps: p.stats?.audioInKbps ?? null,
      jitterBufferMs: p.stats?.bufferMs ?? null,
      lossPct: p.stats?.audioLossPct ?? null,
      theirMode: p.remote?.sound ?? null,
    })),
  };
}

const yes = (v: boolean | string | null | undefined) =>
  v == null ? '—' : v === false ? t('off') : v === true ? t('on') : String(v);

export function SoundCheck() {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const id = setInterval(() => setSnap(snapshot()), 1000);
    return () => clearInterval(id);
  }, []);
  const e = snap.engine;
  const rows: [string, string][] = [
    [
      t('Microphone'),
      [
        snap.mic.channels === 2 ? t('stereo') : snap.mic.channels === 1 ? t('mono') : '—',
        snap.mic.rate ? `${snap.mic.rate / 1000} kHz` : '',
        snap.mic.latencyMs != null ? `${snap.mic.latencyMs} ms` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [
      t('Browser processing'),
      `${t('echo')} ${yes(snap.mic.browserEcho)} · ${t('noise')} ${yes(snap.mic.browserNoise)} · ${t('volume')} ${yes(snap.mic.browserAgc)}`,
    ],
    [
      t('Echo cancelling'),
      snap.mic.browserEcho === true || snap.mic.browserEcho === 'all' || snap.mic.browserEcho === 'remote-only'
        ? t('the browser’s')
        : e.unavailable && e.musicEcho
          ? t('not available in this browser')
          : e.cancelling
            ? [
                t('running'),
                e.echoRemovedDb != null ? t('{db} dB removed', { db: e.echoRemovedDb }) : '',
                e.delayMs ? `${e.delayMs} ms` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : t('off'),
    ],
    [
      t('Noise reduction (what you hear)'),
      snap.peers.some((p) => p.route.denoise)
        ? session.peers
            .peek()
            .filter((p) => engine.remoteRoute(p.id).denoise)
            .map((p) => p.info.name)
            .join(', ')
        : t('off'),
    ],
    [t('Automatic level'), e.levelDb != null ? `${e.levelDb >= 0 ? '+' : ''}${e.levelDb} dB` : t('off')],
    [t('Output'), e.outputMs != null ? `${e.outputMs} ms · ${e.state}` : '—'],
  ];
  return (
    <div class="section">
      <h3>{t('Sound check')}</h3>
      <dl class="soundcheck" data-testid="soundcheck">
        {rows.map(([k, v]) => (
          <div>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button
        class="btn btn-sm"
        onClick={() => {
          void copyText(JSON.stringify(snapshot(), null, 2)).then((ok) =>
            toast({ kind: ok ? 'info' : 'warn', title: ok ? t('Report copied') : t('Could not copy') }),
          );
        }}
      >
        <Clipboard /> {t('Copy report')}
      </button>
    </div>
  );
}
