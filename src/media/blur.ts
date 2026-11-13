// Background blur for the camera, on this device, only when asked for. Where the operating system blurs the
// camera itself (Windows Studio Effects, some laptops), its own effect is used: no work here. Otherwise the person
// is found in each frame by MediaPipe's selfie segmentation (Apache-2.0; its model and WebAssembly are served with
// the app, loaded the first time blur is turned on) and drawn sharp over a blurred copy of the picture.

import { workerTicker } from './ticker.ts';

import solutionUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.js?url';
import binarypbUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.binarypb?url';
import tfliteUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_landscape.tflite?url';
import tfliteSquareUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.tflite?url';
import simdJsUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.js?url';
import simdWasmUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.wasm?url';
import simdDataUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.data?url';
import jsUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.js?url';
import wasmUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.wasm?url';

const FILES: Record<string, string> = {
  'selfie_segmentation.binarypb': binarypbUrl,
  'selfie_segmentation_landscape.tflite': tfliteUrl,
  'selfie_segmentation.tflite': tfliteSquareUrl,
  'selfie_segmentation_solution_simd_wasm_bin.js': simdJsUrl,
  'selfie_segmentation_solution_simd_wasm_bin.wasm': simdWasmUrl,
  'selfie_segmentation_solution_simd_wasm_bin.data': simdDataUrl,
  'selfie_segmentation_solution_wasm_bin.js': jsUrl,
  'selfie_segmentation_solution_wasm_bin.wasm': wasmUrl,
};

interface Segmenter {
  setOptions(o: { modelSelection?: number; selfieMode?: boolean }): void;
  onResults(cb: (r: { image: CanvasImageSource; segmentationMask: CanvasImageSource }) => void): void;
  send(i: { image: HTMLVideoElement }): Promise<void>;
  initialize(): Promise<void>;
  close(): Promise<void>;
}

let lib: Promise<new (o: { locateFile: (f: string) => string }) => Segmenter> | null = null;

/** The solution's script (a classic script: it defines a global), once. */
function loadLib() {
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      const w = window as unknown as {
        SelfieSegmentation?: new (o: { locateFile: (f: string) => string }) => Segmenter;
      };
      if (w.SelfieSegmentation) return resolve(w.SelfieSegmentation);
      const s = document.createElement('script');
      s.src = solutionUrl;
      s.crossOrigin = 'anonymous';
      s.onload = () => (w.SelfieSegmentation ? resolve(w.SelfieSegmentation) : reject(new Error('no segmenter')));
      s.onerror = () => reject(new Error('blur could not load'));
      document.head.appendChild(s);
    });
    lib.catch(() => (lib = null));
  }
  return lib;
}

/** The system blurs this camera itself (a capability of the track, where the platform offers it). */
export function systemBlur(track: MediaStreamTrack): boolean {
  const caps = track.getCapabilities?.() as MediaTrackCapabilities & { backgroundBlur?: boolean[] };
  return Array.isArray(caps?.backgroundBlur) && caps.backgroundBlur.includes(true);
}

export async function setSystemBlur(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ backgroundBlur: on } as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}

/** A camera with its background blurred: `track` is what to send. */
export class Blurred {
  readonly track: MediaStreamTrack;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private video = document.createElement('video');
  private seg: Segmenter | null = null;
  private busy = false;
  private nextSeg = 0;
  /** the latest mask (white where the person is) */
  private mask = document.createElement('canvas');
  /** the background, small (blurred there) */
  private small = document.createElement('canvas');
  private stopTicker: (() => void) | null = null;
  private stopped = false;

  private constructor(private source: MediaStreamTrack) {
    const st = source.getSettings();
    this.canvas.width = st.width ?? 1280;
    this.canvas.height = st.height ?? 720;
    this.g = this.canvas.getContext('2d')!;
    // a frame each time one is drawn (a stream that captures on its own stops while the tab is in the background)
    const stream = this.canvas.captureStream(0);
    this.track = stream.getVideoTracks()[0];
    this.track.contentHint = 'motion';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([source]);
  }

  /** Blur `source` (loads the segmentation the first time). */
  static async create(source: MediaStreamTrack): Promise<Blurred> {
    const b = new Blurred(source);
    const Seg = await loadLib();
    const seg = new Seg({ locateFile: (f) => FILES[f] ?? f });
    seg.setOptions({ modelSelection: 1, selfieMode: false });
    seg.onResults((r) => b.keepMask(r.segmentationMask));
    await seg.initialize();
    b.seg = seg;
    await b.video.play().catch(() => {});
    const fps = Math.min(30, source.getSettings().frameRate ?? 30);
    // a worker's timer: the picture keeps going while the tab is in the background
    b.stopTicker = workerTicker(Math.round(1000 / fps), () => b.tick());
    return b;
  }

  /**
   * Every frame: the picture with the latest mask (a person moves little between two). The mask itself is renewed
   * at most 15 times a second, and never for more than about a sixth of the time: a slow device keeps its picture
   * smooth and its page responsive, with a mask a little behind.
   */
  private tick(): void {
    if (this.stopped || this.video.readyState < 2) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (vw && (vw !== this.canvas.width || vh !== this.canvas.height)) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    if (this.mask.width) this.draw(this.video, this.mask);
    else this.g.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    (this.track as CanvasCaptureMediaStreamTrack).requestFrame?.();
    const now = performance.now();
    if (!this.busy && this.seg && now >= this.nextSeg) void this.segment(now);
  }

  private async segment(started: number): Promise<void> {
    this.busy = true;
    try {
      await this.seg!.send({ image: this.video });
    } catch {
      // a frame lost: the next one comes
    } finally {
      this.busy = false;
      const took = performance.now() - started;
      // a slow device: the mask renewed less often (its work never more than about a sixth of the time)
      this.nextSeg = started + Math.max(1000 / 15, took * 6);
    }
  }

  /** The newest mask, kept (at its own small size) for the frames until the next one. */
  private keepMask(mask: CanvasImageSource): void {
    const m = mask as { width: number; height: number };
    const w = Math.min(320, m.width || 256);
    const h = Math.round((w * (m.height || 144)) / (m.width || 256));
    if (this.mask.width !== w || this.mask.height !== h) {
      this.mask.width = w;
      this.mask.height = h;
    }
    const g = this.mask.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    // softened at its edge here, where it is small: scaled up, the edge stays soft
    g.filter = 'blur(1.5px)';
    g.drawImage(mask, 0, 0, w, h);
    g.filter = 'none';
  }

  /**
   * The person sharp over a blurred background. The blur is made on a copy a quarter of the size (sixteen times
   * fewer pixels: cheap without a graphics processor too), and scaling it back up softens it further.
   */
  private draw(image: CanvasImageSource, mask: CanvasImageSource): void {
    const g = this.g;
    const { width: w, height: h } = this.canvas;
    const sw = Math.max(16, Math.round(w / 4));
    const sh = Math.max(9, Math.round(h / 4));
    if (this.small.width !== sw || this.small.height !== sh) {
      this.small.width = sw;
      this.small.height = sh;
    }
    const sg = this.small.getContext('2d')!;
    sg.filter = 'blur(3px)';
    // a little larger, so the blurred edges stay out of the frame
    const m = sw * 0.04;
    sg.drawImage(image, -m, -m, sw + 2 * m, sh + 2 * m);
    sg.filter = 'none';
    g.save();
    g.clearRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(mask, 0, 0, w, h);
    g.globalCompositeOperation = 'source-in';
    g.drawImage(image, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-over';
    g.drawImage(this.small, 0, 0, w, h);
    g.restore();
  }

  stop(): void {
    this.stopped = true;
    this.stopTicker?.();
    void this.seg?.close().catch(() => {});
    this.seg = null;
    this.track.stop();
    this.video.srcObject = null;
  }

  get input(): MediaStreamTrack {
    return this.source;
  }
}
