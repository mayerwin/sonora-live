// The shared YouTube video: on the stage like a score (or small, in a corner of the score when both are open), its
// controls in the Track panel. The player's own controls are off: Play, seeking and speed are shared, and go
// through the lesson's controls.

import { computed, signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Pause, Play, TvMinimalPlay as Youtube, X } from 'lucide-preact';
import { session } from '../app/session.ts';
import { loadYouTube, YT_RATES, youtubeId, type YtPlayer } from '../app/youtube.ts';
import { clockOf } from '../media/backing-core.ts';
import { t } from '../app/i18n.ts';

const video = session.video;

/** the field to share a link is out (from the Track panel's YouTube button) */
export const ytFormOpen = signal(false);

/** hidden here by hand (until another video is shared) */
export const videoHidden = signal(false);
export const videoShown = computed(() => !!video.shared.value?.id && !videoHidden.value);

type YT = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YtPlayer };

export function YouTubeView({ small = false }: { small?: boolean }) {
  const id = video.shared.value?.id ?? null;
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!id || !host.current) return;
    let player: YtPlayer | null = null;
    let alive = true;
    const el = document.createElement('div');
    host.current.replaceChildren(el);
    setFailed(false);
    loadYouTube().then(
      (yt) => {
        if (!alive) return;
        player = new (yt as YT).Player(el, {
          videoId: id,
          width: '100%',
          height: '100%',
          playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3 },
          events: {
            onReady: () => alive && video.attach(player),
            onError: () => setFailed(true),
          },
        });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      video.attach(null);
      try {
        player?.destroy();
      } catch {
        // gone
      }
    };
  }, [id]);
  return (
    <section class={`yt ${small ? 'small' : ''}`} data-testid="youtube" aria-label={t('YouTube video')}>
      <div class="yt-frame" ref={host} />
      {failed && <p class="yt-fail">{t('YouTube could not be reached from here.')}</p>}
    </section>
  );
}

/** In the Track panel: the shared video's controls, or a field to share one. */
export function VideoControls() {
  const s = video.shared.value;
  const can = video.canControl && !session.controlsHeld.value;
  const [link, setLink] = useState('');
  const [bad, setBad] = useState(false);
  if (!s?.id) {
    if (!can || !ytFormOpen.value) return null;
    return (
      <form
        class="yt-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (video.open(link)) {
            setLink('');
            videoHidden.value = false;
            ytFormOpen.value = false;
          } else setBad(true);
        }}
      >
        <Youtube size={17} class="track-ico" />
        <input
          class="input"
          type="url"
          inputMode="url"
          placeholder={t('Or a YouTube link, watched together in time')}
          value={link}
          onInput={(e) => {
            setLink((e.currentTarget as HTMLInputElement).value);
            setBad(false);
          }}
          aria-invalid={bad}
          ref={(el) => {
            if (el && !link) setTimeout(() => el.focus(), 0);
          }}
          onKeyDown={(e) => e.key === 'Escape' && (ytFormOpen.value = false)}
          data-testid="yt-link"
        />
        <button class="btn btn-sm btn-ghost" disabled={!youtubeId(link)} data-testid="yt-open">
          {t('Share')}
        </button>
      </form>
    );
  }
  const dur = video.duration.value;
  const pos = video.position.value;
  return (
    <div class="yt-ctl" data-testid="yt-controls">
      <Youtube size={17} class="track-ico" />
      <button
        class="icon-btn sm"
        disabled={!can}
        onClick={() => (s.playing ? video.pause() : video.play())}
        aria-label={s.playing ? t('Pause') : t('Play')}
        data-testid="yt-play"
      >
        {s.playing ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <span class="yt-time">{clockOf(pos)}</span>
      <input
        type="range"
        class="yt-seek"
        min={0}
        max={Math.max(1, dur)}
        step={0.5}
        value={pos}
        disabled={!can || !dur}
        aria-label={t('Position in the video')}
        onChange={(e) => video.seek(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="yt-time">{dur ? clockOf(dur) : '–:––'}</span>
      <select
        class="select sm"
        value={String(s.rate)}
        disabled={!can}
        aria-label={t('Speed')}
        onChange={(e) => video.setRate(Number((e.currentTarget as HTMLSelectElement).value))}
      >
        {YT_RATES.map((r) => (
          <option value={String(r)}>{`${r}×`}</option>
        ))}
      </select>
      <button
        class="icon-btn sm"
        onClick={() => (can ? video.close() : (videoHidden.value = !videoHidden.value))}
        aria-label={can ? t('Close the video for everyone') : t('Hide the video')}
        title={can ? t('Close the video for everyone') : t('Hide the video')}
      >
        <X size={16} />
      </button>
      {/* on speakers only: the microphone hears the video and cannot take it out */}
      {session.listening.value === 'speakers' && (
        <small class="yt-note">
          {t('Headphones are best: a browser cannot take YouTube’s sound out of the microphone.')}
        </small>
      )}
    </div>
  );
}
