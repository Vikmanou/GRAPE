import type { LayoutResponse, Topology } from './protocol';

export type LayoutListener = (response: LayoutResponse) => void;

/** One layout at a time; starting another or cancelling replaces the worker. */
export class LayoutClient {
  private worker: Worker | undefined;
  private nextId = 1;

  start(topology: Topology, seed: number, listener: LayoutListener): void {
    this.cancel();
    const id = this.nextId++;
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'layout' });
    worker.addEventListener('message', (event: MessageEvent<LayoutResponse>) => {
      if (event.data.id === id) listener(event.data);
    });
    worker.addEventListener('error', (event) => {
      listener({ type: 'error', id, message: `layout worker failed: ${event.message || 'unknown error'}` });
    });
    worker.postMessage({ type: 'layout', id, topology, seed });
    this.worker = worker;
  }

  /** WASM cannot be interrupted mid-call, so cancelling ends the worker. */
  cancel(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}
