// The 88 keys: what everyone plays lights up in their role colour (and the sustain pedals). The keys can be
// played with the mouse, touch, or the computer keyboard; they sound on the built-in piano and reach the others.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Keyboard as KeyboardIcon, X } from 'lucide-preact';
import { session } from '../app/session.ts';
import { settings, updateMidi } from '../app/settings.ts';
import { isTouch } from '../app/platform.ts';

const LOW = 21;
const HIGH = 108;
const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Computer keys -> semitones from the octave's C (by physical position: works on AZERTY and QWERTZ too). */
const QWERTY: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

interface KeyGeom {
  note: number;
  black: boolean;
  left: number;
  width: number;
}

function layout(): KeyGeom[] {
  let whites = 0;
  for (let n = LOW; n <= HIGH; n++) if (!BLACK.has(n % 12)) whites++;
  const w = 100 / whites;
  const out: KeyGeom[] = [];
  let wi = 0;
  for (let n = LOW; n <= HIGH; n++) {
    if (BLACK.has(n % 12)) {
      // black keys sit a little off-centre, as on a real keyboard
      const pc = n % 12;
      const shift = pc === 1 || pc === 6 ? -0.12 : pc === 3 || pc === 10 ? 0.12 : 0;
      out.push({ note: n, black: true, left: (wi + shift) * w - w * 0.31, width: w * 0.62 });
    } else {
      out.push({ note: n, black: false, left: wi * w, width: w });
      wi++;
    }
  }
  return out;
}

function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function PianoKeys({ onClose }: { onClose: () => void }) {
  const keys = useMemo(layout, []);
  const hub = session.midi;
  void hub.version.value; // redraw on every change
  const peers = session.peers.value;
  const me = session.self.value;
  const s = settings.value;
  const qwerty = s.midi.qwerty;
  const [octave, setOctave] = useState(4);
  const pointers = useRef(new Map<number, number>());
  const box = useRef<HTMLDivElement>(null);
  const pedals = hub.sustainHeld();
  const roleOf = (id: string | null) => peers.find((p) => p.id === id)?.info.role ?? 'teacher';

  const play = (note: number, vel: number) => {
    hub.piano.context();
    void hub.piano.load();
    hub.fromScreen([0x90, note, vel]);
  };
  const stop = (note: number) => hub.fromScreen([0x80, note, 64]);

  // computer keyboard
  useEffect(() => {
    if (!qwerty) return;
    const held = new Map<string, number>();
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      if (e.code === 'KeyZ') return setOctave((o) => Math.max(1, o - 1));
      if (e.code === 'KeyX') return setOctave((o) => Math.min(7, o + 1));
      if (e.code === 'Space') {
        e.preventDefault();
        hub.fromScreen([0xb0, 64, 127]);
        return;
      }
      const semi = QWERTY[e.code];
      if (semi === undefined || held.has(e.code)) return;
      const note = 12 * (octave + 1) + semi;
      if (note < LOW || note > HIGH) return;
      held.set(e.code, note);
      play(note, 92);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        hub.fromScreen([0xb0, 64, 0]);
        return;
      }
      const note = held.get(e.code);
      if (note === undefined) return;
      held.delete(e.code);
      stop(note);
    };
    const blur = () => {
      for (const n of held.values()) stop(n);
      held.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      blur();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [qwerty, octave]);

  const noteAt = (x: number, y: number): { note: number; vel: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const n = el?.dataset.note;
    if (!n || !box.current) return null;
    const r = box.current.getBoundingClientRect();
    const depth = Math.max(0, Math.min(1, (y - r.top) / r.height));
    return { note: Number(n), vel: Math.round(48 + depth * 70) };
  };

  return (
    <section class="keys" aria-label="Piano keyboard" data-testid="keyboard">
      <div class="keys-head">
        <span class="legend" data-role={me.role}>
          <i /> You
        </span>
        {peers.map((p) => (
          <span class="legend" data-role={p.info.role}>
            <i /> {p.info.name}
          </span>
        ))}
        <span class={`pedal ${pedals.local ? 'on' : ''}`} data-role={me.role} title="Your sustain pedal">
          Pedal
        </span>
        {peers.length > 0 && (
          <span class={`pedal remote ${pedals.remote ? 'on' : ''}`} data-role={roleOf([...hub.remote.keys()][0] ?? null)} title="Their sustain pedal">
            Their pedal
          </span>
        )}
        <span style="flex:1" />
        {!isTouch && (
          <button
            class={`btn btn-sm ${qwerty ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => updateMidi({ qwerty: !qwerty })}
            title="Play with the computer keyboard: A W S E D F T G Y H U J K, Z / X change octave, Space is the pedal"
          >
            <KeyboardIcon /> {qwerty ? `Computer keys on · C${octave}` : 'Play with computer keys'}
          </button>
        )}
        <button class="icon-btn" style="width:30px;height:30px" onClick={onClose} aria-label="Hide keyboard">
          <X size={16} />
        </button>
      </div>
      <div
        class="keyboard"
        ref={box}
        onPointerDown={(e) => {
          const hit = noteAt(e.clientX, e.clientY);
          if (!hit) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, hit.note);
          play(hit.note, hit.vel);
        }}
        onPointerMove={(e) => {
          const cur = pointers.current.get(e.pointerId);
          if (cur === undefined) return;
          const hit = noteAt(e.clientX, e.clientY);
          if (!hit || hit.note === cur) return;
          stop(cur);
          pointers.current.set(e.pointerId, hit.note);
          play(hit.note, hit.vel);
        }}
        onPointerUp={(e) => {
          const cur = pointers.current.get(e.pointerId);
          if (cur !== undefined) stop(cur);
          pointers.current.delete(e.pointerId);
        }}
        onPointerCancel={(e) => {
          const cur = pointers.current.get(e.pointerId);
          if (cur !== undefined) stop(cur);
          pointers.current.delete(e.pointerId);
        }}
      >
        {keys.map((k) => {
          const h = hub.holder(k.note);
          const on = h.local || !!h.remote;
          const role = h.local ? me.role : roleOf(h.remote);
          const name = `${NAMES[k.note % 12]}${Math.floor(k.note / 12) - 1}`;
          return (
            <div
              key={k.note}
              data-note={k.note}
              class={`${k.black ? 'bkey' : 'wkey'} ${on ? 'on' : ''} ${k.note === 60 ? 'middle-c' : ''}`}
              style={{ left: `${k.left}%`, width: `${k.width}%`, '--kc': on ? `var(--${role})` : undefined }}
              aria-label={name}
              data-on={on || undefined}
            >
              {!k.black && k.note % 12 === 0 && <span class="lbl">{`C${k.note / 12 - 1}`}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
