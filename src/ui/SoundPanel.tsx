// The Sound tab, beside the chat: everyone's sound settings at a glance, one card per person, and each can be
// changed from here: your own directly; someone else's on their device, which tells them (what they send is what
// you hear); and what you yourself do with their sound (noise cleaning, MIDI in time). Short labels only: what a
// setting does shows on hover, or on a long press on a touch screen.

import { MessageSquare, SlidersHorizontal, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../app/i18n.ts';
import { session, watching, type PeerView, type TheirSettings } from '../app/session.ts';
import { settings, update, updateMidi, type EchoSetting, type SoundSetting } from '../app/settings.ts';
import type { PlayOn } from '../midi/hub.ts';
import { initials } from './icons.tsx';
import { chatOpen, sideTab } from './state.ts';

/** The panel's header: the two tabs, and close. */
export function SideHead({ extra }: { extra?: ComponentChildren }) {
  const tab = sideTab.value;
  return (
    <header class="chat-head">
      <div class="side-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          class={tab === 'chat' ? 'on' : ''}
          onClick={() => (sideTab.value = 'chat')}
          data-testid="tab-chat"
        >
          <MessageSquare size={16} /> {t('Chat')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sound'}
          class={tab === 'sound' ? 'on' : ''}
          onClick={() => (sideTab.value = 'sound')}
          data-testid="tab-sound"
        >
          <SlidersHorizontal size={16} /> {t('Sound')}
        </button>
      </div>
      {extra}
      <button
        class="icon-btn"
        aria-label={t('Close')}
        onClick={() => {
          chatOpen.value = false;
          update({ chatOpen: false });
        }}
      >
        <X />
      </button>
    </header>
  );
}

/** One setting: a short label (its explanation on hover / long press) and its control. */
function Row({ label, tip, children }: { label: string; tip: string; children: ComponentChildren }) {
  return (
    <div class="sp-row">
      <span class="sp-label" data-tip={tip} title={tip}>
        {label}
      </span>
      <span class="sp-ctl">{children}</span>
    </div>
  );
}

function Switch(props: { on: boolean | undefined; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      class="sp-switch"
      aria-checked={!!props.on}
      aria-label={props.label}
      disabled={props.disabled || props.on === undefined}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

function Choice<T extends string>(props: {
  value: T | undefined;
  label: string;
  options: { value: T; label: string; tip?: string }[];
  disabled?: boolean;
  /** the full width of the card, under its heading */
  wide?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <span class={`sp-seg ${props.wide ? 'sp-wide' : ''}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          aria-pressed={o.value === props.value}
          title={o.tip}
          disabled={props.disabled || props.value === undefined}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Everyone's sound settings, as one shape (yours from your settings, theirs from what they tell). */
interface View {
  sound?: SoundSetting;
  echo?: EchoSetting;
  echoOn?: boolean;
  musicEcho?: boolean;
  autoLevel?: boolean;
  playOn?: PlayOn;
  send?: boolean;
  device?: string;
  headphones?: boolean;
  mic?: boolean;
  sendMs?: number;
}

function mine(): View {
  const s = settings.value;
  const m = session.media;
  const d = session.midi.devices;
  return {
    sound: s.sound,
    echo: s.echo,
    echoOn: m.echo.value,
    musicEcho: s.musicEcho,
    autoLevel: s.autoLevel,
    playOn: s.midi.playOn,
    send: s.midi.send,
    device: d.connected.value ? d.currentName.value : '',
    headphones: m.headphones.value,
    mic: m.micOn.value,
  };
}

function theirs(p: PeerView): View {
  const r = p.remote;
  if (!r) return {};
  return {
    sound: r.soundSetting,
    echo: r.echoSetting,
    echoOn: r.echo,
    musicEcho: r.musicEcho,
    autoLevel: r.autoLevel,
    playOn: r.midiPlayOn,
    send: r.midiSend,
    device: r.midi.device,
    headphones: r.headphones,
    mic: r.mic,
    sendMs: r.sendMs,
  };
}

/** On speakers (or set so): echo cancelling applies. */
function speakers(v: View): boolean {
  return v.echo === 'on' || (v.echo === 'auto' && !v.headphones);
}

/** What “Notes wait for sound” does, in words. */
export const midiSyncTip = () =>
  t(
    'MIDI notes travel faster than the sound of a microphone. On: the others’ notes are held back until their microphone sound arrives, so their piano, their voice and their instrument are heard together. Off: their notes play the moment they arrive, a little before the rest of their sound.',
  );

function Card({ peer }: { peer: PeerView | null }) {
  const me = !peer;
  const v = me ? mine() : theirs(peer);
  // an observer only changes what they hear; nobody changes an observer's microphone from here
  const locked = !me && (watching() || peer.info.role === 'observer');
  const set = (patch: TheirSettings) => {
    if (me) {
      const { playOn, send, ...rest } = patch;
      if (Object.keys(rest).length) update(rest);
      if (playOn !== undefined || send !== undefined)
        updateMidi({ ...(playOn !== undefined ? { playOn } : {}), ...(send !== undefined ? { send } : {}) });
    } else session.setTheirSound(peer.id, patch);
  };
  const name = me ? t('You') : peer.info.name;
  const delay = me ? 0 : session.midi.delayOf(peer.id);
  const st = me ? null : peer.stats;
  return (
    <section class="sp-card" data-testid={me ? 'sp-me' : 'sp-peer'} data-peer={peer?.id}>
      <header>
        <span class="sp-avatar" data-role={me ? 'self' : peer.info.role}>
          {initials(me ? session.self.value.name : peer.info.name)}
        </span>
        <b>{name}</b>
        {v.mic === false && <span class="sp-tag sp-off">{t('muted')}</span>}
        {v.headphones && <span class="sp-tag">{t('headphones')}</span>}
        {v.device && <span class="sp-tag sp-ok">{v.device}</span>}
      </header>

      <h4 class="sp-group">{t('Microphone sends')}</h4>
      <Choice<'pure' | 'voice'>
        label={t('Microphone sends')}
        wide
        value={v.sound ? (v.sound === 'voice' ? 'voice' : 'pure') : undefined}
        disabled={locked}
        onChange={(x) => set({ sound: x === 'voice' ? 'voice' : 'auto' })}
        options={[
          {
            value: 'pure',
            label: t('Instrument and voice'),
            tip: t('Untouched sound, for an acoustic instrument and the voice.'),
          },
          {
            value: 'voice',
            label: t('Voice only'),
            tip: t('The browser’s speech processing: removes noise and echo, and part of the music.'),
          },
        ]}
      />
      {v.sound !== 'voice' && (
        <Row
          label={t('Voice only during MIDI')}
          tip={t(
            'While the piano plays through MIDI, the microphone carries the voice only (the piano is not heard twice).',
          )}
        >
          <Switch
            label={t('Voice only during MIDI')}
            on={v.sound === undefined ? undefined : v.sound === 'auto'}
            disabled={locked}
            onChange={(x) => set({ sound: x ? 'auto' : 'pure' })}
          />
        </Row>
      )}
      {v.sound !== 'voice' && (
        <Row
          label={t('Automatic level')}
          tip={t(
            'Brings a quiet microphone up slowly, from the loudest moments, and keeps a forte from clipping: a crescendo stays a crescendo.',
          )}
        >
          <Switch
            label={t('Automatic level')}
            on={v.autoLevel}
            disabled={locked}
            onChange={(x) => set({ autoLevel: x })}
          />
        </Row>
      )}

      <h4 class="sp-group">
        {t('Listening on')}
        {v.echoOn && (
          <span class="sp-live" title={t('Echo cancelling runs now')}>
            {' '}
            · {t('echo cancelled')}
          </span>
        )}
      </h4>
      <Choice<EchoSetting>
        label={t('Listening on')}
        wide
        value={v.echo}
        disabled={locked}
        onChange={(x) => set({ echo: x })}
        options={[
          {
            value: 'auto',
            label: t('Auto'),
            tip: t('Speakers unless headphones are detected by their name.'),
          },
          {
            value: 'on',
            label: t('Speakers'),
            tip: t('The speakers’ sound is taken out of the microphone, so the others do not hear themselves.'),
          },
          { value: 'off', label: t('Headphones'), tip: t('Nothing reaches the microphone: nothing is taken out.') },
        ]}
      />
      {speakers(v) && v.sound !== 'voice' && (
        <Row
          label={t('Echo cancelling')}
          tip={t(
            'Standard: the browser’s, removes echo reliably but turns the playing here down a little while the others play. Music-safe (experimental): never turns the playing down, may leave a little echo on small speakers. A backing track is always taken out.',
          )}
        >
          <Choice<'std' | 'music'>
            label={t('Echo cancelling')}
            value={v.musicEcho === undefined ? undefined : v.musicEcho ? 'music' : 'std'}
            disabled={locked}
            onChange={(x) => set({ musicEcho: x === 'music' })}
            options={[
              { value: 'std', label: t('Standard') },
              { value: 'music', label: t('Music-safe') },
            ]}
          />
        </Row>
      )}

      <h4 class="sp-group">MIDI</h4>
      <Row label={t('Send MIDI')} tip={t('Notes and pedals played on the instrument reach the others.')}>
        <Switch label={t('Send MIDI')} on={v.send} disabled={locked} onChange={(x) => set({ send: x })} />
      </Row>
      <Row
        label={t('Others’ notes on')}
        tip={t(
          'Where the others’ MIDI notes sound on this side: Auto (the instrument if one can play them, else the built-in piano), the built-in piano, the instrument, or not at all (then only what the microphone carries is heard).',
        )}
      >
        <Choice<PlayOn>
          label={t('Others’ notes on')}
          value={v.playOn}
          disabled={locked}
          onChange={(x) => set({ playOn: x })}
          options={[
            { value: 'auto', label: t('Auto') },
            { value: 'piano', label: t('Piano'), tip: t('The built-in piano') },
            { value: 'instrument', label: t('Instr.'), tip: t('The instrument connected here') },
            { value: 'off', label: t('Off') },
          ]}
        />
      </Row>

      {me ? (
        <Row label={t('Notes wait for sound')} tip={midiSyncTip()}>
          <Switch
            label={t('Notes wait for sound')}
            on={settings.value.midiSync}
            onChange={(x) => update({ midiSync: x })}
          />
        </Row>
      ) : (
        <>
          <Row
            label={t('Clean noise (for me)')}
            tip={t(
              'Takes the steady background noise (hiss, a fan) out of what you hear from them, for you only. Adds 8 ms.',
            )}
          >
            <Switch
              label={t('Clean noise (for me)')}
              on={session.cleansNoise(peer.id)}
              onChange={(x) => session.setCleanNoise(peer.id, x)}
            />
          </Row>
          <p
            class="sp-info"
            data-tip={t(
              'Their sound: when it leaves their side, then your buffer; their MIDI waits that long when in time.',
            )}
          >
            {v.sendMs != null && st ? `${t('Sound')} ${v.sendMs} + ${st.bufferMs} ms` : ''}
            {settings.value.midiSync && delay > 0 ? ` · ${t('their notes wait {ms} ms', { ms: delay })}` : ''}
          </p>
        </>
      )}
    </section>
  );
}

/** A long press on a label (touch screens) shows what it does, like hovering with a mouse. */
function useLongPressTips(root: { current: HTMLElement | null }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const down = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
      if (!target || e.pointerType === 'mouse') return;
      const r = target.getBoundingClientRect();
      timer = setTimeout(() => setTip({ text: target.dataset.tip ?? '', x: r.left, y: r.bottom + 6 }), 450);
    };
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const away = () => {
      cancel();
      setTip(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('scroll', away, true);
    const elsewhere = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.sp-tip')) setTip(null);
    };
    window.addEventListener('pointerdown', elsewhere, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', elsewhere, { capture: true });
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', cancel);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('scroll', away, true);
    };
  }, [root]);
  return tip;
}

export function SoundPanel() {
  const peers = session.peers.value.filter((p) => p.link !== 'closed');
  void session.midi.version.value;
  const root = useRef<HTMLElement>(null);
  const tip = useLongPressTips(root);
  // the delays move with the network: redraw now and then
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <aside class="chat sound-panel" aria-label={t('Sound')} data-testid="sound-panel" ref={root}>
      <SideHead />
      <div class="sp-list">
        <Card peer={null} />
        {peers.map((p) => (
          <Card peer={p} key={p.id} />
        ))}
        <p class="sp-foot">
          {watching()
            ? t('As an observer, you can only change what you hear.')
            : t('Changes to someone else’s settings are made on their device, and they are told.')}
        </p>
      </div>
      {tip && (
        <div class="sp-tip" role="tooltip" style={{ left: `${Math.max(8, tip.x)}px`, top: `${tip.y}px` }}>
          {tip.text}
        </div>
      )}
    </aside>
  );
}
