// A score's pages: a PDF (drawn by pdf.js, loaded the first time one is opened: it is large) or a picture (a
// photo of a page, a scan). Each page is drawn at the size it is shown, sharp on high-density screens.

export interface ScoreDoc {
  pages: number;
  /** a page's height over its width */
  aspect(page: number): number;
  /** draw page `page` (0-based) `width` CSS pixels wide into `canvas` */
  render(page: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
  close(): void;
}

type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    pdfjs = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
        return lib;
      },
    );
  }
  return pdfjs;
}

export const isPdf = (mime: string, name: string) => mime === 'application/pdf' || /\.pdf$/i.test(name);
export const isImage = (mime: string, name: string) =>
  /^image\/(png|jpeg|webp|gif|avif)$/.test(mime) || /\.(png|jpe?g|webp|gif|avif)$/i.test(name);

export async function openScore(blob: Blob, name: string): Promise<ScoreDoc> {
  if (isPdf(blob.type, name)) return openPdf(blob);
  return openImage(blob);
}

async function openPdf(blob: Blob): Promise<ScoreDoc> {
  const lib = await loadPdfJs();
  const loading = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await loading.promise;
  const aspects: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    aspects.push(v.height / v.width);
  }
  const tasks = new WeakMap<HTMLCanvasElement, { cancel(): void }>();
  return {
    pages: doc.numPages,
    aspect: (page) => aspects[page] ?? 1.414,
    async render(page, canvas, width) {
      const p = await doc.getPage(page + 1);
      const base = p.getViewport({ scale: 1 });
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale: (width * dpr) / base.width });
      // a page being drawn into the same canvas is superseded
      tasks.get(canvas)?.cancel();
      // drawn off screen, then swapped in: no blank flash while turning pages
      const off = document.createElement('canvas');
      off.width = Math.round(vp.width);
      off.height = Math.round(vp.height);
      const task = p.render({ canvas: off, viewport: vp });
      tasks.set(canvas, task);
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
    },
    close: () => void loading.destroy(),
  };
}

async function openImage(blob: Blob): Promise<ScoreDoc> {
  const bmp = await createImageBitmap(blob);
  return {
    pages: 1,
    aspect: () => bmp.height / bmp.width,
    async render(_page, canvas, width) {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round((width * dpr * bmp.height) / bmp.width);
      const g = canvas.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    },
    close: () => bmp.close(),
  };
}
