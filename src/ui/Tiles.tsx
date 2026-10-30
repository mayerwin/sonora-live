import { useMemo, useRef, useState } from 'preact/hooks';
import { AudioWaveform, Bell, Copy, MicOff, MonitorUp, Piano, QrCode, Share2, SwitchCamera, Video } from 'lucide-preact';
import { session, ROLE_LABEL, type PeerView } from '../app/session.ts';
import { settings } from '../app/settings.ts';
import { askNotifications, notifyPermission } from '../app/notify.ts';
import { isMobile } from '../app/platform.ts';
import { prettyCode } from '../net/code.ts';
import { LevelBars, Qr, SignalBars, VideoView } from './common.tsx';
import { initials, RoleIcon } from './icons.tsx';
import { canShare, copyLink, roomLink, shareLink } from './share.ts';

export function PeerTile({ peer, extra = false }: { peer: PeerView; extra?: boolean }) {
  const r = peer.remote;
  const role = peer.info.role;
  const stream = extra ? peer.extra : peer.video;
  const showVideo = !!stream && (extra ? !!r?.extra : r?.cam !== false);
  const [portrait, setPortrait] = useState(false);
  const st = peer.stats;
  return (
    <div class={`tile ${extra ? 'extra' : ''}`} data-role={role} data-testid={extra ? 'tile-extra' : 'tile'} data-peer={peer.id}>
      {showVideo ? (
        <>
          {!extra && portrait && <VideoView stream={stream} class="backdrop" />}
          <VideoView stream={stream} onResize={(w, h) => setPortrait(h > w)} />
        </>
      ) : (
        <div class="tile-center">
          <div class="avatar" data-role={role}>
            {initials(peer.info.name)}
          </div>
          <span>{peer.link === 'connected' ? (r ? 'Camera off' : 'Connecting…') : ''}</span>
        </div>
      )}
      {!extra && (
        <div class="tile-badges">
          {r?.midi.sending && (
            <span class="chip chip-ok" title={`${peer.info.name} plays over MIDI`}>
              <Piano /> {r.midi.device || 'MIDI'}
            </span>
          )}
          {r && (
            <span class="chip" title={r.sound === 'pure' ? 'Unprocessed sound (no noise suppression)' : 'Speech processing on'}>
              <AudioWaveform /> {r.sound === 'pure' ? (r.stereo ? 'Pure · stereo' : 'Pure') : 'Voice'}
            </span>
          )}
          {st?.latencyMs != null && (
            <span class="chip" title={`Estimated delay of the sound from ${peer.info.name}`}>
              <SignalBars quality={st.quality} /> {st.latencyMs} ms
            </span>
          )}
        </div>
      )}
      <div class="tile-label">
        <span class="role-dot" title={ROLE_LABEL[role]}>
          {extra ? <MonitorUp size={13} /> : <RoleIcon role={role} size={13} />}
        </span>
        <span class="name">
          {extra ? `${peer.info.name} · ${r?.extra === 'camera' ? 'second camera' : 'screen'}` : peer.info.name}
        </span>
        {!extra && r && !r.mic && <MicOff class="muted-ico" aria-label="Microphone off" />}
      </div>
      {!extra && peer.link === 'reconnecting' && (
        <div class="tile-overlay">
          <span class="spinner" /> Reconnecting…
        </div>
      )}
      {!extra && peer.link === 'connecting' && (
        <div class="tile-overlay">
          <span class="spinner" /> Connecting to {peer.info.name === '…' ? 'a new participant' : peer.info.name}…
        </div>
      )}
    </div>
  );
}

type Corner = 'br' | 'bl' | 'tr' | 'tl';

export function SelfPip() {
  const media = session.media;
  const track = media.video.value;
  const stream = useMemo(() => (track ? new MediaStream([track]) : null), [track]);
  const s = settings.value;
  const me = session.self.value;
  const [corner, setCorner] = useState<Corner>('br');
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const level = session.meter.level.value;
  const pos: Record<string, string> = drag
    ? { left: `${drag.x}px`, top: `${drag.y}px` }
    : {
        [corner.includes('b') ? 'bottom' : 'top']: '14px',
        [corner.includes('r') ? 'right' : 'left']: '18px',
      };
  return (
    <div
      ref={ref}
      class={`pip ${drag ? 'dragging' : ''}`}
      style={pos}
      data-role={me.role}
      data-testid="self-view"
      onPointerDown={(e) => {
        const el = ref.current!;
        const parent = el.offsetParent as HTMLElement;
        const r = el.getBoundingClientRect();
        const pr = parent.getBoundingClientRect();
        start.current = { px: e.clientX, py: e.clientY, x: r.left - pr.left, y: r.top - pr.top };
        el.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const st = start.current;
        if (!st) return;
        const dx = e.clientX - st.px;
        const dy = e.clientY - st.py;
        if (!drag && Math.hypot(dx, dy) < 6) return;
        setDrag({ x: st.x + dx, y: st.y + dy });
      }}
      onPointerUp={() => {
        const el = ref.current!;
        start.current = null;
        if (!drag) return;
        const parent = el.offsetParent as HTMLElement;
        const pr = parent.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - pr.left;
        const cy = r.top + r.height / 2 - pr.top;
        setCorner(`${cy > pr.height / 2 ? 'b' : 't'}${cx > pr.width / 2 ? 'r' : 'l'}` as Corner);
        setDrag(null);
      }}
    >
      {stream && media.camOn.value ? (
        <VideoView stream={stream} class={s.mirror && media.facing.value === 'user' ? 'mirror' : ''} />
      ) : (
        <div class="tile-center">
          <div class="avatar" data-role={me.role}>
            {initials(me.name)}
          </div>
        </div>
      )}
      <div class="pip-label">
        {media.micOn.value ? <LevelBars level={level} n={4} /> : <MicOff size={13} color="var(--red)" />}
        You
      </div>
      {isMobile && media.camOn.value && (
        <button
          class="pip-flip"
          aria-label="Switch camera"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void media.flipCamera()}
        >
          <SwitchCamera />
        </button>
      )}
    </div>
  );
}

export function Waiting() {
  const code = session.code.value;
  const perm = notifyPermission.value;
  return (
    <div class="card waiting" data-testid="waiting">
      <div>
        <div class="status-line">
          <span class="pulse-ring" /> You're in. Waiting for others…
        </div>
        <h2>Invite your {settings.value.role === 'teacher' ? 'student' : settings.value.role === 'student' ? 'teacher' : 'class'}</h2>
        <p>Send the link or the code. They open it, pick their role, and appear here. You'll hear a chime.</p>
        <div class="code" aria-label={`Room code ${code.split('').join(' ')}`}>
          {prettyCode(code)
            .split(' ')
            .map((p) => (
              <span>{p}</span>
            ))}
        </div>
        <div class="code-actions">
          <button class="btn btn-primary" onClick={() => void copyLink(code)}>
            <Copy /> Copy link
          </button>
          {canShare && (
            <button class="btn" onClick={() => void shareLink(code)}>
              <Share2 /> Share
            </button>
          )}
          {perm === 'default' && (
            <button class="btn btn-ghost" onClick={() => void askNotifications()}>
              <Bell /> Notify me when they join
            </button>
          )}
        </div>
      </div>
      <div>
        <Qr text={roomLink(code)} />
        <div class="qr-cap">
          <QrCode size={13} style="vertical-align:-2px" /> Scan to join
        </div>
      </div>
    </div>
  );
}

export function NoCamera() {
  const media = session.media;
  return (
    <button class="btn btn-sm" onClick={() => void media.setCamOn(true)}>
      <Video /> Turn camera on
    </button>
  );
}
