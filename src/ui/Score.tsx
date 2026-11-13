// The shared score, large on the stage with the cameras beside it: the same page for everyone, and ink on it — a
// pen, a highlighter, a word — each person in their own colour, seen while it is drawn (with their name at the pen's
// tip). Zoom and scrolling are one's own; the page is shared.

import { computed, effect, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  FileText,
  Upload,
  Hand,
  Highlighter,
  Maximize2,
  Minus,
  PenLine,
  Plus,
  Redo2,
  Type,
  Undo2,
  X,
} from 'lucide-preact';
import { session } from '../app/session.ts';
import { t } from '../app/i18n.ts';
import {
  drawStroke,
  drawText,
  INK_COLORS,
  MARKER_WIDTH,
  PEN_WIDTH,
  simplify,
  quantize,
  touches,
  type InkTool,
  type Stroke,
  type TextNote,
} from '../media/ink-core.ts';
import { newId } from '../app/chat.ts';
import { HeldNote } from './Host.tsx';
import { Recent } from './Library.tsx';

const score = session.score;

type Tool = 'view' | InkTool | 'text' | 'eraser';

/** this side's tool and colour (its own colour first: a stable pick from its id) */
export const tool = signal<Tool>('view');
const color = signal<string | null>(null);
const zoom = signal(1);
/** hidden here by hand (until another score is opened) */
export const scoreHidden = signal(false);

export const scoreShown = computed(() => !!score.shared.value?.id && !scoreHidden.value);

function myColor(): string {
  if (color.value) return color.value;
  let h = 0;
  for (const c of session.selfId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return INK_COLORS[h % (INK_COLORS.length - 1)];
}

/** names by id, for the live pen's label */
function nameOf(id: string): string {
  if (id === session.selfId) return session.self.peek().name;
  return session.peers.peek().find((p) => p.id === id)?.info.name ?? '';
}

/** Pick a PDF or a picture to share (from the strip's Score chip). */
export function pickScore(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f && score.load(f)) scoreHidden.value = false;
  };
  input.click();
}

/** The strip's score panel while no score is open: a file, or one used before. */
export function ScorePicker() {
  const can = score.canControl && !session.controlsHeld.value;
  return (
    <div class="tool score-pick" data-testid="score-pick">
      <HeldNote />
      <div class="tool-row">
        <FileText size={18} class="track-ico" />
        <span class="muted grow">
          {t('No score open. A PDF or a photo of the page: everyone sees it, and can write on it.')}
        </span>
        {can && (
          <button class="btn btn-sm btn-ghost" onClick={pickScore} data-testid="score-open">
            <Upload size={15} /> {t('Open a score')}
          </button>
        )}
      </div>
      {can && (
        <Recent
          kind="score"
          onOpen={(f) => {
            if (score.load(f)) scoreHidden.value = false;
          }}
        />
      )}
    </div>
  );
}

/** the page and its ink as drawn now, for the recording */
let frame: { page: HTMLCanvasElement; ink: HTMLCanvasElement } | null = null;
let comp: HTMLCanvasElement | null = null;

/** One picture of the page with its ink (the recording draws it as the large view). */
export function scoreFrame(): HTMLCanvasElement | null {
  if (!frame || !frame.page.width) return null;
  comp ??= document.createElement('canvas');
  if (comp.width !== frame.page.width || comp.height !== frame.page.height) {
    comp.width = frame.page.width;
    comp.height = frame.page.height;
  }
  const g = comp.getContext('2d')!;
  g.drawImage(frame.page, 0, 0);
  g.drawImage(frame.ink, 0, 0, comp.width, comp.height);
  return comp;
}

session.recorder.extraPicture = scoreFrame;

// a new score shows again, here too
let lastScore: string | null = null;
effect(() => {
  const id = score.shared.value?.id ?? null;
  if (id && id !== lastScore) scoreHidden.value = false;
  lastScore = id;
});

export function ScoreView() {
  const s = score.shared.value!;
  const doc = score.doc.value;
  const failed = score.failed.value;
  const incoming = score.incoming.value;
  const can = score.canControl && !session.controlsHeld.value;
  const pages = doc?.pages ?? 0;
  const page = Math.min(s.page, Math.max(0, pages - 1));
  const wrap = useRef<HTMLDivElement>(null);
  const pageCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [typing, setTyping] = useState<{ x: number; y: number } | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const erased = useRef<Set<string>>(new Set());
  const typingDone = useRef<{ x: number; y: number } | null>(null);

  // the space the page has
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit the whole page at zoom 1; wider when zoomed in
  const aspect = doc ? doc.aspect(page) : 1.414;
  const fitW = Math.max(100, Math.min(box.w - 24, (box.h - 24) / aspect));
  const width = Math.round(fitW * zoom.value);
  const height = Math.round(width * aspect);

  useEffect(() => {
    if (!doc || !pageCanvas.current || width < 50) return;
    void doc.render(page, pageCanvas.current, width);
  }, [doc, page, width]);

  // the ink, drawn again on every change
  const ink = score.ink.value;
  const live = score.live.value;
  const paint = () => {
    const c = inkCanvas.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, pw, ph);
    for (const k of score.ink.peek()) {
      if (k.page !== page || erased.current.has(k.id)) continue;
      if (k.kind === 'text') drawText(g, k as TextNote, pw, ph);
      else drawStroke(g, k as Stroke, pw, ph);
    }
    for (const s of score.live.peek()) {
      if (s.page !== page) continue;
      drawStroke(g, s, pw, ph);
      penLabel(g, s, pw, ph, dpr);
    }
    if (drawing.current) drawStroke(g, drawing.current, pw, ph);
  };
  useEffect(paint, [ink, live, page, width, height]);

  useEffect(() => {
    if (pageCanvas.current && inkCanvas.current) frame = { page: pageCanvas.current, ink: inkCanvas.current };
    return () => {
      frame = null;
    };
  }, []);

  const at = (e: PointerEvent) => {
    const r = inkCanvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const down = (e: PointerEvent) => {
    const tl = tool.value;
    if (tl === 'view' || e.button > 0) return;
    e.preventDefault();
    const p = at(e);
    if (tl === 'text') {
      setTyping(p);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tl === 'eraser') {
      erased.current = new Set();
      eraseAt(p);
      return;
    }
    drawing.current = {
      id: newId(),
      by: session.selfId,
      page,
      tool: tl,
      color: myColor(),
      width: tl === 'marker' ? MARKER_WIDTH : PEN_WIDTH,
      pts: [p.x, p.y],
    };
    paint();
  };

  const move = (e: PointerEvent) => {
    const tl = tool.value;
    if (tl === 'eraser' && e.buttons) return eraseAt(at(e));
    const d = drawing.current;
    if (!d) return;
    // every point the pen passed (a fast stroke stays smooth)
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const p = at(ev);
      d.pts.push(p.x, p.y);
    }
    paint();
    score.drawing({ ...d, pts: quantize(simplify(d.pts, 0.0004)) });
  };

  const up = () => {
    if (tool.value === 'eraser') {
      if (erased.current.size) score.erase([...erased.current]);
      erased.current = new Set();
      return;
    }
    const d = drawing.current;
    drawing.current = null;
    if (!d) return;
    score.add({ ...d, pts: quantize(simplify(d.pts)) });
  };

  const eraseAt = (p: { x: number; y: number }) => {
    let hit = false;
    for (const k of score.ink.peek()) {
      if (k.page !== page || k.kind === 'text' || erased.current.has(k.id)) continue;
      if (touches(k as Stroke, p.x, p.y, 0.012, aspect)) {
        erased.current.add(k.id);
        hit = true;
      }
    }
    // text: erased when the eraser is on its first letters
    for (const k of score.ink.peek()) {
      if (k.page !== page || k.kind !== 'text' || erased.current.has(k.id)) continue;
      const n = k as TextNote;
      if (p.x >= n.x - 0.01 && p.x <= n.x + 0.012 * n.text.length + 0.01 && p.y >= n.y - 0.01 && p.y <= n.y + 0.035) {
        erased.current.add(k.id);
        hit = true;
      }
    }
    if (hit) paint();
  };

  const commitText = (text: string) => {
    // Enter commits, and the box closing then blurs it: only once
    if (!typing || typingDone.current === typing) return;
    typingDone.current = typing;
    if (text.trim()) {
      score.add({
        kind: 'text',
        id: newId(),
        by: session.selfId,
        page,
        x: typing.x,
        y: typing.y,
        text: text.trim().slice(0, 500),
        color: myColor(),
      });
    }
    setTyping(null);
  };

  const go = (d: number) => score.setPage(page + d);

  return (
    <section class="score" data-testid="score" aria-label={t('Score: {name}', { name: s.name })}>
      <div class="score-bar" role="toolbar" aria-label={t('Score tools')}>
        <div class="score-group">
          <button
            class="icon-btn sm"
            onClick={() => go(-1)}
            disabled={!can || page <= 0}
            aria-label={t('Previous page')}
            title={t('Previous page')}
          >
            <ChevronLeft size={18} />
          </button>
          <span class="score-page" data-testid="score-page">
            {pages ? t('{n} of {total}', { n: page + 1, total: pages }) : '…'}
          </span>
          <button
            class="icon-btn sm"
            onClick={() => go(1)}
            disabled={!can || page >= pages - 1}
            aria-label={t('Next page')}
            title={t('Next page')}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div class="score-group tools">
          {(
            [
              ['view', Hand, t('Scroll and zoom')],
              ['pen', PenLine, t('Pen')],
              ['marker', Highlighter, t('Highlighter')],
              ['text', Type, t('Text')],
              ['eraser', Eraser, t('Eraser')],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              class={`icon-btn sm ${tool.value === id ? 'on' : ''}`}
              aria-pressed={tool.value === id}
              aria-label={label}
              title={label}
              onClick={() => (tool.value = id)}
              data-testid={`ink-${id}`}
            >
              <Icon size={17} />
            </button>
          ))}
          <span class="score-colors" role="radiogroup" aria-label={t('Ink colour')}>
            {INK_COLORS.map((c) => (
              <button
                role="radio"
                aria-checked={myColor() === c}
                aria-label={c}
                class="swatch"
                style={`--c:${c}`}
                onClick={() => {
                  color.value = c;
                  if (tool.value === 'view' || tool.value === 'eraser') tool.value = 'pen';
                }}
              />
            ))}
          </span>
        </div>
        <div class="score-group">
          <button
            class="icon-btn sm"
            onClick={() => score.undo()}
            disabled={!score.canUndo.value}
            aria-label={t('Undo')}
            title={t('Undo')}
            data-testid="ink-undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            class="icon-btn sm"
            onClick={() => score.redo()}
            disabled={!score.canRedo.value}
            aria-label={t('Redo')}
            title={t('Redo')}
          >
            <Redo2 size={17} />
          </button>
          <button
            class="icon-btn sm hide-xs"
            onClick={() => (zoom.value = Math.max(1, zoom.value / 1.25))}
            disabled={zoom.value <= 1}
            aria-label={t('Zoom out')}
            title={t('Zoom out')}
          >
            <Minus size={17} />
          </button>
          <button
            class="icon-btn sm hide-xs"
            onClick={() => (zoom.value = Math.min(4, zoom.value * 1.25))}
            aria-label={t('Zoom in')}
            title={t('Zoom in')}
          >
            <Plus size={17} />
          </button>
          {zoom.value > 1 && (
            <button
              class="icon-btn sm"
              onClick={() => (zoom.value = 1)}
              aria-label={t('The whole page')}
              title={t('The whole page')}
            >
              <Maximize2 size={16} />
            </button>
          )}
          <button
            class="icon-btn sm"
            onClick={() => void score.save()}
            disabled={!score.file.value}
            aria-label={t('Save with the annotations (PDF)')}
            title={t('Save with the annotations (PDF)')}
            data-testid="score-save"
          >
            <Download size={17} />
          </button>
          <button
            class="icon-btn sm"
            onClick={() => (can ? score.close() : (scoreHidden.value = true))}
            aria-label={can ? t('Close the score for everyone') : t('Hide the score')}
            title={can ? t('Close the score for everyone') : t('Hide the score')}
            data-testid="score-close"
          >
            <X size={17} />
          </button>
        </div>
      </div>
      <HeldNote />
      <div class={`score-scroll tool-${tool.value}`} ref={wrap}>
        {!doc && (
          <div class="score-wait">
            {failed
              ? t('This file could not be opened.')
              : incoming
                ? t('Receiving {name}… {pct}%', { name: incoming.name, pct: Math.round(incoming.progress * 100) })
                : t('Opening {name}…', { name: s.name })}
          </div>
        )}
        <div class="score-page-box" style={doc ? `width:${width}px;height:${height}px` : 'display:none'}>
          <canvas ref={pageCanvas} class="score-canvas" style={`width:${width}px;height:${height}px`} />
          <canvas
            ref={inkCanvas}
            class="score-ink"
            style={`width:${width}px;height:${height}px`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            data-testid="score-ink"
          />
          {typing && (
            <textarea
              class="score-text"
              style={`left:${typing.x * width}px;top:${typing.y * height}px;color:${myColor()}`}
              placeholder={t('Type, then Enter')}
              ref={(el) => {
                if (el) setTimeout(() => el.focus(), 0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText((e.currentTarget as HTMLTextAreaElement).value);
                } else if (e.key === 'Escape') setTyping(null);
              }}
              onBlur={(e) => commitText((e.currentTarget as HTMLTextAreaElement).value)}
              data-testid="score-text"
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** Whose pen it is, at its tip, while they draw. */
function penLabel(g: CanvasRenderingContext2D, s: Stroke, w: number, h: number, dpr: number): void {
  const name = nameOf(s.by);
  if (!name || s.pts.length < 2) return;
  const x = s.pts[s.pts.length - 2] * w;
  const y = s.pts[s.pts.length - 1] * h;
  const size = 12 * dpr;
  g.save();
  g.font = `600 ${size}px "Instrument Sans", system-ui, sans-serif`;
  const tw = g.measureText(name).width;
  const pad = 6 * dpr;
  g.fillStyle = s.color;
  g.globalAlpha = 0.92;
  g.beginPath();
  g.roundRect?.(x + 8 * dpr, y + 8 * dpr, tw + pad * 2, size + pad, (size + pad) / 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(name, x + 8 * dpr + pad, y + 8 * dpr + (size + pad) / 2);
  g.restore();
}
