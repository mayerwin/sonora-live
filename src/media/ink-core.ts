// Ink on a shared score: strokes and text in page coordinates (0..1 of the page's width and height, so they land on
// the same notes at any zoom and on any screen), drawn smoothly, erased by touch, and kept small on the wire.

export type InkTool = 'pen' | 'marker';

export interface Stroke {
  id: string;
  /** who drew it (undo takes back one's own) */
  by: string;
  page: number;
  tool: InkTool;
  color: string;
  /** line width, as a fraction of the page's width */
  width: number;
  /** x0, y0, x1, y1, … in 0..1 */
  pts: number[];
}

export interface TextNote {
  id: string;
  by: string;
  page: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

export type Ink = (Stroke & { kind?: 'stroke' }) | (TextNote & { kind: 'text' });

/** The pen colours: one is each person's own by default; any can be picked. */
export const INK_COLORS = ['#e5484d', '#2f6fed', '#1f9d55', '#c26a00', '#8e4ec6', '#111111'];

export const PEN_WIDTH = 0.0028;
export const MARKER_WIDTH = 0.018;

const round = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;

/** Points rounded to a tenth of a per mille of the page: plenty for a pen, a third of the bytes. */
export function quantize(pts: number[]): number[] {
  return pts.map(round);
}

/** Fewer points along a stroke, within `tol` of the original (Ramer–Douglas–Peucker). */
export function simplify(pts: number[], tol = 0.0006): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const bx = pts[b * 2];
    const by = pts[b * 2 + 1];
    let far = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Distance from (px, py) to the segment a–b. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

/** The eraser at (x, y) with radius r (page units, aspect `ar` = height / width) touches this stroke. */
export function touches(s: Stroke, x: number, y: number, r: number, ar = 1): boolean {
  const p = s.pts;
  const reach = r + s.width / 2;
  // distances measured in page widths: y scaled by the page's aspect
  if (p.length === 2) return Math.hypot(p[0] - x, (p[1] - y) * ar) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segDist(x, y * ar, p[i], p[i + 1] * ar, p[i + 2], p[i + 3] * ar) <= reach) return true;
  }
  return false;
}

/** Draw a stroke on a page drawn at w×h pixels: smooth curves through the midpoints. */
export function drawStroke(g: CanvasRenderingContext2D, s: Stroke, w: number, h: number): void {
  const p = s.pts;
  if (!p.length) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = Math.max(1, s.width * w);
  if (s.tool === 'marker') {
    // a highlighter: see-through, and drawn under the notes' black (multiply)
    g.globalAlpha = 0.32;
    g.globalCompositeOperation = 'multiply';
    g.lineCap = 'butt';
  }
  if (p.length === 2) {
    g.beginPath();
    g.arc(p[0] * w, p[1] * h, g.lineWidth / 2, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return;
  }
  g.beginPath();
  g.moveTo(p[0] * w, p[1] * h);
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = ((p[i] + p[i + 2]) / 2) * w;
    const my = ((p[i + 1] + p[i + 3]) / 2) * h;
    g.quadraticCurveTo(p[i] * w, p[i + 1] * h, mx, my);
  }
  g.lineTo(p[p.length - 2] * w, p[p.length - 1] * h);
  g.stroke();
  g.restore();
}

export function drawText(g: CanvasRenderingContext2D, n: TextNote, w: number, h: number): void {
  const size = Math.max(10, w * 0.022);
  g.save();
  g.font = `600 ${size}px "Instrument Sans", system-ui, sans-serif`;
  g.textBaseline = 'top';
  // a soft halo keeps it readable over the staves
  g.lineWidth = size * 0.28;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineJoin = 'round';
  const lines = n.text.split('\n');
  lines.forEach((line, i) => {
    g.strokeText(line, n.x * w, n.y * h + i * size * 1.2);
    g.fillStyle = n.color;
    g.fillText(line, n.x * w, n.y * h + i * size * 1.2);
  });
  g.restore();
}

/** A stroke or note received from someone: well formed, or nothing. */
export function validInk(x: unknown): Ink | null {
  const v = x as Record<string, unknown>;
  if (!v || typeof v.id !== 'string' || typeof v.by !== 'string') return null;
  const page = Number(v.page);
  const color = typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#e5484d';
  if (!Number.isInteger(page) || page < 0 || page > 5000) return null;
  const base = { id: v.id.slice(0, 40), by: v.by.slice(0, 40), page, color };
  if (v.kind === 'text') {
    if (typeof v.text !== 'string') return null;
    return {
      ...base,
      kind: 'text',
      x: round(Number(v.x) || 0),
      y: round(Number(v.y) || 0),
      text: v.text.slice(0, 500),
    };
  }
  if (!Array.isArray(v.pts) || v.pts.length > 20000 || v.pts.length % 2) return null;
  const pts = v.pts.map(Number);
  if (pts.some((n) => !Number.isFinite(n))) return null;
  const tool: InkTool = v.tool === 'marker' ? 'marker' : 'pen';
  const width = Math.max(0.0005, Math.min(0.05, Number(v.width) || PEN_WIDTH));
  return { ...base, tool, width, pts: quantize(pts) };
}
