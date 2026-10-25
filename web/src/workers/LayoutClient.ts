import type { LayoutOptions, LayoutResponse, Topology } from './protocol';

export type LayoutListener = (response: LayoutResponse) => void;

/** One layout at a time; starting another or cancelling replaces the worker. */
export class LayoutClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private listener: LayoutListener | undefined;

  /** `mode` 'cpu' runs the whole layout in the worker; 'gpu' only coarsens. */
  start(mode: 'cpu' | 'gpu', topology: Topology, options: LayoutOptions, listener: LayoutListener): void {
    this.cancel();
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'layout' });
    worker.addEventListener('message', (event: MessageEvent<LayoutResponse>) => {
      this.listener?.(event.data);
    });
    worker.addEventListener('error', (event) => {
      this.listener?.({ type: 'error', id: 0, message: `layout worker failed: ${event.message || 'unknown error'}` });
    });
    this.worker = worker;
    this.listener = listener;
    worker.postMessage({ type: mode === 'cpu' ? 'layout' : 'hierarchy', id: this.nextId++, topology, options });
  }

  /** Packs components by the hierarchy this worker built; the answer is a `packed` response. */
  pack(boxes: Float32Array<ArrayBuffer>): void {
    this.worker?.postMessage({ type: 'pack', id: this.nextId++, boxes }, [boxes.buffer]);
  }

  /** WASM cannot be interrupted mid-call, so cancelling ends the worker. */
  cancel(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.listener = undefined;
  }
}
