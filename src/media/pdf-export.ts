// The annotated score as a PDF to keep: the original pages (a PDF stays vector and searchable; a picture becomes a
// page), with everyone's ink laid on top as it was drawn: highlighter multiplied under the notes, pen on top.
// pdf-lib is loaded only when someone saves.

import { drawStroke, drawText, type Ink, type Stroke, type TextNote } from './ink-core.ts';
import { isPdf } from './pdf.ts';

/** how many pixels a layer of ink gets per point of the page (sharp when printed) */
const INK_SCALE = 3;

export async function exportAnnotated(blob: Blob, name: string, ink: Ink[]): Promise<Blob> {
  const lib = await import('pdf-lib');
  let doc: import('pdf-lib').PDFDocument;
  if (isPdf(blob.type, name)) {
    doc = await lib.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
  } else {
    doc = await lib.PDFDocument.create();
    const bmp = await createImageBitmap(blob);
    const png = await toPng(bmp.width, bmp.height, (g) => g.drawImage(bmp, 0, 0));
    const img = await doc.embedPng(png);
    // an A4-wide page (595 pt), as tall as the picture asks
    const w = 595;
    const h = (w * bmp.height) / bmp.width;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    bmp.close();
  }
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const mine = ink.filter((k) => k.page === i);
    if (!mine.length) continue;
    const page = pages[i];
    const { width, height } = page.getSize();
    const pw = Math.round(width * INK_SCALE);
    const ph = Math.round(height * INK_SCALE);
    const markers = mine.filter((k): k is Stroke => k.kind !== 'text' && (k as Stroke).tool === 'marker');
    const pens = mine.filter((k) => k.kind === 'text' || (k as Stroke).tool !== 'marker');
    if (markers.length) {
      // drawn opaque here; the page lays it see-through and multiplied, like the highlighter on screen
      const png = await toPng(pw, ph, (g) => {
        for (const s of markers) drawStroke(g, { ...s, tool: 'pen' }, pw, ph);
      });
      page.drawImage(await doc.embedPng(png), {
        x: 0,
        y: 0,
        width,
        height,
        opacity: 0.32,
        blendMode: lib.BlendMode.Multiply,
      });
    }
    if (pens.length) {
      const png = await toPng(pw, ph, (g) => {
        for (const k of pens) {
          if (k.kind === 'text') drawText(g, k as TextNote, pw, ph);
          else drawStroke(g, k as Stroke, pw, ph);
        }
      });
      page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width, height });
    }
  }
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

async function toPng(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Promise<ArrayBuffer> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('no image'))), 'image/png'));
  return blob.arrayBuffer();
}

/** "Sonata.pdf" → "Sonata (annotated).pdf" (the word given translated) */
export function annotatedName(name: string, word = 'annotated'): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return `${base} (${word}).pdf`;
}
