import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { CircleAlert, Info, LogIn, LogOut, MessageSquare, TriangleAlert, Check, X, DoorOpen } from 'lucide-preact';
import { encode } from 'uqr';
import { dismiss, toasts, type ToastKind } from '../app/notify.ts';

export function Sheet(props: {
  title: string;
  icon?: ComponentChildren;
  onClose: () => void;
  wide?: boolean;
  tabs?: ComponentChildren;
  children: ComponentChildren;
  label?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <section class={`sheet ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.label ?? props.title}>
        <div>
          <header class="sheet-head">
            {props.icon && <div class="big-ico">{props.icon}</div>}
            <h2>{props.title}</h2>
            <button class="icon-btn" onClick={props.onClose} aria-label="Close">
              <X />
            </button>
          </header>
          {props.tabs}
        </div>
        <div class="sheet-body">{props.children}</div>
      </section>
    </>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={(e) => {
        e.stopPropagation();
        props.onChange(!props.checked);
      }}
    />
  );
}

export function ToggleRow(props: {
  title: string;
  sub?: ComponentChildren;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div class="row-toggle" style={props.disabled ? 'opacity:.5;pointer-events:none' : undefined} onClick={() => props.onChange(!props.checked)}>
      <div class="grow">
        <div class="row-title">{props.title}</div>
        {props.sub && <div class="row-sub">{props.sub}</div>}
      </div>
      <Switch checked={props.checked} onChange={props.onChange} label={props.title} />
    </div>
  );
}

export function Seg<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ComponentChildren; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" aria-pressed={o.value === props.value} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A <video> showing a stream (muted: sound plays from separate audio elements). */
export function VideoView(props: { stream: MediaStream | null; class?: string; onResize?: (w: number, h: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== props.stream) v.srcObject = props.stream;
    if (props.stream) void v.play().catch(() => {});
  }, [props.stream]);
  return (
    <video
      ref={ref}
      class={props.class}
      autoplay
      playsInline
      muted
      disablePictureInPicture={false}
      onResize={(e) => {
        const v = e.currentTarget as HTMLVideoElement;
        props.onResize?.(v.videoWidth, v.videoHeight);
      }}
    />
  );
}

/** Level bars (0..1). */
export function LevelBars({ level, clipping, n = 5 }: { level: number; clipping?: boolean; n?: number }) {
  const lit = Math.round(level * n * 1.15);
  return (
    <span class="bars" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i
          style={{ height: `${30 + (i * 70) / (n - 1)}%` }}
          class={i < lit ? (clipping && i >= n - 2 ? 'clip' : i >= n - 1 ? 'hot' : 'on') : ''}
        />
      ))}
    </span>
  );
}

export function SignalBars({ quality }: { quality: 'good' | 'fair' | 'poor' | 'unknown' }) {
  return (
    <span class={`signal ${quality}`} aria-label={`Connection ${quality}`}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** QR code with rounded modules, drawn as SVG. */
export function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const { data, size } = encode(text, { ecc: 'M', border: 0 });
    const parts: string[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y][x]) parts.push(`M${x + 0.08} ${y + 0.08}h0.84v0.84h-0.84z`);
      }
    }
    return { d: parts.join(''), size };
  }, [text]);
  return (
    <div class="qr" role="img" aria-label="QR code of the room link">
      <svg viewBox={`0 0 ${svg.size} ${svg.size}`} shape-rendering="geometricPrecision">
        <path d={svg.d} fill="#17141c" />
      </svg>
    </div>
  );
}

const TOAST_ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  join: LogIn,
  leave: LogOut,
  warn: TriangleAlert,
  error: CircleAlert,
  success: Check,
  knock: DoorOpen,
  chat: MessageSquare,
};

export function Toasts() {
  const list = toasts.value;
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => {
        const Ico = TOAST_ICONS[t.kind];
        return (
          <div class={`toast ${t.kind}`} key={t.id} role="status">
            <div class="t-ico">
              <Ico />
            </div>
            <div class="grow">
              <b>{t.title}</b>
              {t.body && <small>{t.body}</small>}
            </div>
            {t.action && (
              <button
                class="btn btn-sm btn-primary"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button class="icon-btn" style="width:28px;height:28px" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Copy text, with a fallback for browsers without the async clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
