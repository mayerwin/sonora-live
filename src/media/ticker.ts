// A steady timer for drawing video: a worker's interval, because a page in the background has its own timers slowed
// to once a second (and animation frames stopped), a worker's are not.

const SOURCE = `let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;

/** Call `fn` every `ms`; returns the stop. */
export function workerTicker(ms: number, fn: () => void): () => void {
  const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  w.onmessage = fn;
  w.postMessage(ms);
  return () => w.terminate();
}

const firefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

/**
 * A canvas as a video track, with a frame each time it is drawn (`frame()` after drawing). Chromium: frames pushed
 * one by one (captureStream(0) + requestFrame), so a tab in the background keeps its frame rate. Firefox does not
 * encode pushed frames (a recording got nothing until it stopped): there the canvas is captured at `fps`.
 */
export function canvasTrack(canvas: HTMLCanvasElement, fps: number): { track: MediaStreamTrack; frame: () => void } {
  if (firefox) {
    return { track: canvas.captureStream(fps).getVideoTracks()[0], frame: () => {} };
  }
  const track = canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  return { track, frame: () => track.requestFrame?.() };
}
