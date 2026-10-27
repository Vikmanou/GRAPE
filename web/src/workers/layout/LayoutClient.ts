import type { Topology } from '../protocol/graph';
import type { LayoutOptions, LayoutRequest, LayoutResponse } from '../protocol/layout';
import { expect, RpcClient, type WorkerMemory } from '../rpc';

export type LayoutListener = (response: LayoutResponse) => void;

/** One layout at a time: starting another or cancelling replaces the worker. */
export class LayoutClient {
  private rpc: RpcClient<LayoutRequest, LayoutResponse> | undefined;

  /** `mode` 'cpu' runs the whole layout in the worker; 'gpu' only coarsens. */
  start(mode: 'cpu' | 'gpu', topology: Topology, options: LayoutOptions, listener: LayoutListener): void {
    this.cancel();
    const rpc = new RpcClient<LayoutRequest, LayoutResponse>({
      name: 'layout',
      spawn: () => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'layout' }),
      isUpdate: (response) => response.type === 'geometry' || (response.type === 'positions' && !response.done),
    });
    this.rpc = rpc;
    rpc
      .request({ type: mode === 'cpu' ? 'layout' : 'hierarchy', topology, options }, { onUpdate: listener })
      .then(listener, (error: unknown) => {
        if (this.rpc === rpc)
          listener({ type: 'error', id: 0, message: String(error instanceof Error ? error.message : error) });
      });
  }

  /** Packs components by the hierarchy this worker built: `dx, dy` per component. */
  async pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array> {
    const rpc = this.rpc;
    if (!rpc) throw new Error('no layout is running');
    return expect(await rpc.request({ type: 'pack', boxes }, { transfer: [boxes.buffer] }), 'packed').offsets;
  }

  /** Nothing when no worker is running. */
  async memory(): Promise<WorkerMemory> {
    const rpc = this.rpc;
    if (!rpc) return { wasm: 0, held: 0 };
    return expect(await rpc.request({ type: 'memory' }), 'memory').memory;
  }

  cancel(): void {
    this.rpc?.terminate();
    this.rpc = undefined;
  }
}
