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
