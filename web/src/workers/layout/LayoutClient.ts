import type { Topology } from '../protocol/graph';
import type { LayoutControl, LayoutOptions, LayoutRequest, LayoutResponse } from '../protocol/layout';
import { expect, RpcClient, type WithoutId, type WorkerMemory } from '../rpc';

export type LayoutListener = (response: LayoutResponse) => void;

function spawn(): RpcClient<LayoutRequest, LayoutResponse> {
  return new RpcClient<LayoutRequest, LayoutResponse>({
    name: 'layout',
    spawn: () => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'layout' }),
    isUpdate: (response) => response.type === 'geometry' || response.type === 'positions',
  });
}

/**
 * One layout at a time: starting another or cancelling replaces the worker.
 * WASM memory never shrinks, so once the worker has handed over the GPU
 * layout's hierarchy it is replaced by a fresh one that only packs.
 */
export class LayoutClient {
  private rpc: RpcClient<LayoutRequest, LayoutResponse> | undefined;
  private frozen = new Uint8Array();

  /** `mode` 'cpu' runs the whole layout in the worker; 'gpu' only coarsens. */
  start(mode: 'cpu' | 'gpu', topology: Topology, options: LayoutOptions, listener: LayoutListener): void {
    this.cancel();
    const rpc = spawn();
    this.rpc = rpc;
    rpc.request({ type: mode === 'cpu' ? 'layout' : 'hierarchy', topology, options }, { onUpdate: listener }).then(
      (response) => {
        if (this.rpc !== rpc) return;
        if (response.type === 'hierarchy') {
          this.frozen = response.hierarchy.frozen.slice();
          rpc.terminate();
          this.rpc = spawn();
        }
        listener(response);
      },
      (error: unknown) => {
        if (this.rpc === rpc)
          listener({ type: 'error', id: 0, message: String(error instanceof Error ? error.message : error) });
      },
    );
  }

  /** Packs components by the hierarchy's components: `dx, dy` per component. */
  async pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array> {
    const rpc = this.rpc;
    if (!rpc) throw new Error('no layout is running');
    const response = await rpc.request({ type: 'pack', boxes, frozen: this.frozen }, { transfer: [boxes.buffer] });
    return expect(response, 'packed').offsets;
  }

  /** Steers a running CPU layout. */
  send(request: WithoutId<LayoutControl>): void {
    const transfer = request.type === 'refine' && request.selected ? [request.selected.buffer] : [];
    this.rpc?.request(request, { transfer }).catch(() => undefined);
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
