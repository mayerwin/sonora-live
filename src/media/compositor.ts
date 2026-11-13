// The recording's picture: everyone's camera (and a shared screen or score, large) drawn into one frame, laid out
// as the lesson is, with names. Driven by a worker's timer: a page in the background has its own timers slowed to
// once a second, a worker's are not, so the recording keeps its frame rate when the tab is hidden.

import { canvasTrack, workerTicker } from './ticker.ts';

export interface CompSource {
  /** what to draw: a video (a camera, a screen) or a canvas (the score); none (or no picture yet): their initial */
  el: HTMLVideoElement | HTMLCanvasElement | null;
  label: string;
  /** shown large, the others beside it (a screen, a score) */
  main?: boolean;
  /** drawn mirrored (one's own camera, as one sees it) */
  mirror?: boolean;
  /** the colour of the name's dot */
  color?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 8;
const BG = '#0f0e13';

/** Where each source goes in a w×h frame: one large and the rest in a column, or an even grid. */
export function layout(n: number, mainIndex: number, w: number, h: number): Rect[] {
  if (n <= 0) return [];
  if (mainIndex >= 0 && n > 1) {
    const side = Math.round(w * 0.24);
    const rects: Rect[] = [];
    const others = n - 1;
    const ch = Math.min((h - GAP * (others + 1)) / others, ((side - GAP) * 9) / 16);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (i === mainIndex) rects.push({ x: GAP, y: GAP, w: w - side - GAP * 2, h: h - GAP * 2 });
      else {
        rects.push({ x: w - side, y: GAP + k * (ch + GAP), w: side - GAP, h: ch });
        k++;
      }
    }
    return rects;
  }
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (w - GAP * (cols + 1)) / cols;
  const ch = (h - GAP * (rows + 1)) / rows;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    // a short last row is centred
    const offset = ((cols - inRow) * (cw + GAP)) / 2;
    rects.push({ x: GAP + offset + (i % cols) * (cw + GAP), y: GAP + r * (ch + GAP), w: cw, h: ch });
  }
  return rects;
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  readonly stream: MediaStream;
  private g: CanvasRenderingContext2D;
  private stopTicker: (() => void) | null = null;
  private pushFrame: () => void;

  constructor(
    width: number,
    height: number,
    private fps: number,
    private sources: () => CompSource[],
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    // frames only when drawn: the worker's tick decides the rate
    const c = canvasTrack(this.canvas, fps);
    this.pushFrame = c.frame;
    this.stream = new MediaStream([c.track]);
  }

  start(): void {
    this.draw();
    this.stopTicker = workerTicker(Math.round(1000 / this.fps), () => this.draw());
  }

  stop(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    for (const t of this.stream.getTracks()) t.stop();
  }

  private draw(): void {
    const g = this.g;
    const { width: w, height: h } = this.canvas;
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);
    // a person without a picture keeps a tile (their initial); a screen or score only once it shows something
    const list = this.sources().filter((s) => !s.main || (s.el && ready(s.el)));
    const rects = layout(
      list.length,
      list.findIndex((s) => s.main),
      w,
      h,
    );
    list.forEach((s, i) => this.tile(s, rects[i]));
    this.pushFrame();
  }

  private tile(s: CompSource, r: Rect): void {
    const g = this.g;
    if (!s.el || !ready(s.el)) {
      this.initial(s, r);
      if (s.label) this.label(s, r);
      return;
    }
    const sw = s.el instanceof HTMLVideoElement ? s.el.videoWidth : s.el.width;
    const sh = s.el instanceof HTMLVideoElement ? s.el.videoHeight : s.el.height;
    g.save();
    roundRect(g, r, Math.min(14, r.w * 0.03));
    g.clip();
    g.fillStyle = '#18161d';
    g.fillRect(r.x, r.y, r.w, r.h);
    // a camera fills its tile (cropped); a screen or score is shown whole
    const scale = s.main ? Math.min(r.w / sw, r.h / sh) : Math.max(r.w / sw, r.h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = r.x + (r.w - dw) / 2;
    const dy = r.y + (r.h - dh) / 2;
    if (s.mirror) {
      g.translate(dx + dw, dy);
      g.scale(-1, 1);
      g.drawImage(s.el, 0, 0, dw, dh);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      g.drawImage(s.el, dx, dy, dw, dh);
    }
    g.restore();
    if (s.label) this.label(s, r);
  }

  private initial(s: CompSource, r: Rect): void {
    const g = this.g;
    g.save();
    roundRect(g, r, Math.min(14, r.w * 0.03));
    g.fillStyle = '#18161d';
    g.fill();
    const rad = Math.min(r.w, r.h) * 0.16;
    g.beginPath();
    g.arc(r.x + r.w / 2, r.y + r.h / 2, rad, 0, Math.PI * 2);
    g.fillStyle = s.color ?? '#3a3445';
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#f2eef5';
    g.font = `600 ${Math.round(rad)}px "Instrument Sans", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((s.label.trim()[0] ?? '?').toUpperCase(), r.x + r.w / 2, r.y + r.h / 2 + 1);
    g.restore();
  }

  private label(s: CompSource, r: Rect): void {
    const g = this.g;
    const size = Math.max(12, Math.round(Math.min(r.w, r.h) * 0.045));
    g.font = `600 ${size}px "Instrument Sans", system-ui, sans-serif`;
    const tw = g.measureText(s.label).width;
    const pad = size * 0.55;
    const dot = s.color ? size * 0.7 : 0;
    const bw = tw + pad * 2 + (dot ? dot + pad * 0.6 : 0);
    const bh = size * 1.7;
    const x = r.x + size * 0.6;
    const y = r.y + r.h - bh - size * 0.6;
    g.fillStyle = 'rgba(15, 14, 19, 0.62)';
    roundRect(g, { x, y, w: bw, h: bh }, bh / 2);
    g.fill();
    let tx = x + pad;
    if (s.color) {
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(tx + dot / 2, y + bh / 2, dot / 2, 0, Math.PI * 2);
      g.fill();
      tx += dot + pad * 0.6;
    }
    g.fillStyle = '#f2eef5';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(s.label, tx, y + bh / 2 + 1);
  }
}

function ready(el: HTMLVideoElement | HTMLCanvasElement): boolean {
  if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
  return el.width > 0 && el.height > 0;
}

function roundRect(g: CanvasRenderingContext2D, r: Rect, rad: number): void {
  g.beginPath();
  if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, rad);
  else g.rect(r.x, r.y, r.w, r.h);
}
